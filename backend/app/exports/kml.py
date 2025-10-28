from collections import defaultdict
from typing import Dict, List, Optional, Tuple
import html

import simplekml
from pyproj import Geod
from shapely.geometry import GeometryCollection, shape, mapping
from shapely.ops import unary_union

from ..models import Feature, FeatureProperties, StyleOptions
from ..utils.logging import get_logger

logger = get_logger(__name__)

# State color mapping for KML styles
STATE_COLORS = {
    'NSW': simplekml.Color.blue,
    'QLD': simplekml.Color.red,
    'SA': simplekml.Color.green,
    'VIC': simplekml.Color.yellow,
}

_DEFAULT_STYLE = StyleOptions()
_DEFAULT_FILL_OPACITY = _DEFAULT_STYLE.fillOpacity or 0.0
_DEFAULT_STROKE_WIDTH = _DEFAULT_STYLE.strokeWidth or 3.0

_GEOD = Geod(ellps="WGS84")


def _opacity_to_alpha(opacity: Optional[float]) -> int:
    if opacity is None:
        opacity = _DEFAULT_FILL_OPACITY
    alpha = int(round(opacity * 255))
    return max(0, min(255, alpha))


def _hex_to_kml_color(hex_color: str, opacity: Optional[float] = 1.0) -> str:
    color = hex_color.lstrip('#')
    red, green, blue = color[0:2], color[2:4], color[4:6]
    alpha = _opacity_to_alpha(opacity)
    return f"{alpha:02x}{blue.lower()}{green.lower()}{red.lower()}"


def _apply_opacity_to_kml_color(color: str, opacity: Optional[float]) -> str:
    alpha = _opacity_to_alpha(opacity)
    if isinstance(color, str) and len(color) == 8:
        return f"{alpha:02x}{color[2:]}"
    return f"{alpha:02x}0000ff"


def _build_style(
    base_color: str,
    style_options: StyleOptions,
    fill_override: Optional[str] = None,
    stroke_override: Optional[str] = None,
) -> simplekml.Style:
    style = simplekml.Style()
    style.polystyle.fill = 1
    style.polystyle.outline = 1
    style.polystyle.altitudemode = simplekml.AltitudeMode.clamptoground

    fill_color = fill_override or _apply_opacity_to_kml_color(base_color, style_options.fillOpacity)
    style.polystyle.color = fill_color

    stroke_color = stroke_override or base_color
    style.linestyle.color = stroke_color
    stroke_width = style_options.strokeWidth if style_options.strokeWidth is not None else _DEFAULT_STROKE_WIDTH
    style.linestyle.width = stroke_width
    return style


def _clone_style(
    base_style: simplekml.Style,
    fill_override: Optional[str] = None,
    stroke_override: Optional[str] = None,
) -> simplekml.Style:
    style = simplekml.Style()
    style.polystyle.fill = base_style.polystyle.fill
    style.polystyle.outline = base_style.polystyle.outline
    style.polystyle.altitudemode = base_style.polystyle.altitudemode
    style.polystyle.color = fill_override or base_style.polystyle.color
    style.linestyle.color = stroke_override or base_style.linestyle.color
    style.linestyle.width = base_style.linestyle.width
    return style


def _compose_kml_color(hex_color: str, alpha_hex: str = "ff") -> str:
    color = hex_color.lstrip('#')
    if len(color) != 6:
        return f"{alpha_hex}0000ff"
    red, green, blue = color[0:2], color[2:4], color[4:6]
    return f"{alpha_hex}{blue.lower()}{green.lower()}{red.lower()}"


def _calculate_area_hectares(geom) -> Optional[float]:
    try:
        area, _ = _GEOD.geometry_area_perimeter(geom)
        return abs(area) / 10000.0
    except Exception as exc:
        logger.debug(f"Failed to calculate merged geometry area: {exc}")
        return None


def _merge_features_by_name(
    features: List[Feature],
    style_options: StyleOptions
) -> List[Feature]:
    """Union geometries that share a display name so the KMZ matches requested formatting."""

    if not features:
        return []

    if not style_options.mergeByName:
        return features

    grouped: Dict[Tuple[str, str], List[Feature]] = defaultdict(list)

    for feature in features:
        props = feature.properties
        display_name = (style_options.folderName or props.name or props.id or "Parcel").strip()
        key = (props.state, display_name)
        grouped[key].append(feature)

    merged_features: List[Feature] = []

    for (state, display_name), group in grouped.items():
        geometries = []
        for feat in group:
            try:
                geom = shape(feat.geometry)
                if geom.is_empty:
                    continue
                geometries.append(geom)
            except Exception as exc:
                logger.warning(
                    f"Skipping feature {getattr(feat.properties, 'id', 'unknown')} during merge: {exc}"
                )

        if not geometries:
            continue

        merged_geom = unary_union(geometries) if len(geometries) > 1 else geometries[0]

        if isinstance(merged_geom, GeometryCollection):
            polygons = [geom for geom in merged_geom.geoms if geom.geom_type in ("Polygon", "MultiPolygon")]
            if not polygons:
                logger.warning(
                    f"Merged geometry for '{display_name}' produced non-polygonal collection; skipping."
                )
                continue
            merged_geom = unary_union(polygons) if len(polygons) > 1 else polygons[0]

        geometry_dict = mapping(merged_geom)

        props_template = group[0].properties.model_dump()
        props_template["state"] = state
        props_template["name"] = display_name or props_template.get("name") or props_template.get("id") or "Parcel"
        props_template["id"] = props_template.get("id") or props_template["name"]

        area_ha = _calculate_area_hectares(merged_geom)
        if area_ha is None:
            area_ha = sum(feat.properties.area_ha or 0.0 for feat in group) or None
        props_template["area_ha"] = area_ha

        merged_feature = Feature(
            geometry=geometry_dict,
            properties=FeatureProperties(**props_template)
        )
        merged_features.append(merged_feature)

    return merged_features if merged_features else features


def export_kml(features: List[Feature], style_options: StyleOptions = None) -> str:
    """Export features to KML format with sidebar-only lotplan names and no snippet."""
    if not features:
        raise ValueError("No features to export")

    if style_options is None:
        style_options = StyleOptions()

    merged_features = _merge_features_by_name(features, style_options)

    logger.info(
        "Exporting %d features to KML (merged from %d source features)",
        len(merged_features),
        len(features),
    )

    # Create KML document
    kml = simplekml.Kml()
    
    # Use custom folder name if provided, otherwise use default
    if style_options.folderName:
        kml.document.name = style_options.folderName.strip()
        kml.document.description = ""  # Remove folder description as requested
    else:
        kml.document.name = "Cadastral Parcels"
        kml.document.description = ""  # Remove folder description as requested

    # Group features by state if requested and no custom folder name is provided
    if style_options.colorByState and not style_options.folderName:
        features_by_state = {}
        for feature in merged_features:
            state = feature.properties.state
            features_by_state.setdefault(state, []).append(feature)

        # Create folder for each state
        for state, state_features in features_by_state.items():
            folder = kml.newfolder(name=f"{state} Parcels ({len(state_features)})")
            folder.description = ""  # Remove folder descriptions as requested

            # Create style for this state
            base_color = STATE_COLORS.get(state, simplekml.Color.gray)
            style = _build_style(
                base_color,
                style_options,
            )

            _add_grouped_features(folder, state_features, style)
    elif style_options.folderName:
        # Single custom folder for all features, styled by state but in one folder
        folder = kml.newfolder(name=style_options.folderName.strip())
        folder.description = ""  # Remove folder description as requested

        if style_options.colorByState:
            # Group by state for styling but keep in single folder
            features_by_state = {}
            for feature in merged_features:
                state = feature.properties.state
                features_by_state.setdefault(state, []).append(feature)

            for state, state_features in features_by_state.items():
                # Create style for this state
                base_color = STATE_COLORS.get(state, simplekml.Color.gray)
                style = _build_style(
                    base_color,
                    style_options,
                )

                _add_grouped_features(folder, state_features, style)
        else:
            # Single style for all features in custom folder
            fill_override = None
            stroke_override = None
            if style_options.fillColor:
                fill_override = _hex_to_kml_color(style_options.fillColor, style_options.fillOpacity)
            if style_options.strokeColor:
                stroke_override = _hex_to_kml_color(style_options.strokeColor, 1.0)

            style = _build_style(
                simplekml.Color.blue,
                style_options,
                fill_override=fill_override,
                stroke_override=stroke_override,
            )

            _add_grouped_features(folder, merged_features, style)
    else:
        # Single style for all features
        fill_override = None
        stroke_override = None
        if style_options.fillColor:
            fill_override = _hex_to_kml_color(style_options.fillColor, style_options.fillOpacity)
        if style_options.strokeColor:
            stroke_override = _hex_to_kml_color(style_options.strokeColor, 1.0)

        style = _build_style(
            simplekml.Color.blue,
            style_options,
            fill_override=fill_override,
            stroke_override=stroke_override,
        )

        _add_grouped_features(kml, merged_features, style)

    logger.info("KML export completed successfully")
    return kml.kml()


# ---------- Helpers ----------

def _display_name_from_props(props) -> str:
    """
    Sidebar name should be just the lotplan.
    Tries common fields in order; falls back to id if nothing else exists.
    """
    for key in ("lotplan", "lot_plan", "lot_plan_id", "parcel_spi", "PARCEL_SPI", "name"):
        if hasattr(props, key) and getattr(props, key):
            return str(getattr(props, key))
    return str(getattr(props, "id", "Parcel"))


def _add_features_to_container(container, features: List[Feature], style):
    """Add features to KML container with given style."""

    def _format_description(props) -> str:
        data = props.__dict__.copy()
        lines: List[str] = []

        layer_label = data.get("layer_label") or data.get("layer")
        title = data.get("name") or layer_label or data.get("id")
        if title:
            lines.append(f"<div class='kml-title'><strong>{html.escape(str(title))}</strong></div>")

        def add_row(label: str, value_key: str, formatter=lambda v: v):
            value = data.get(value_key)
            if value is None or value == "":
                return
            if isinstance(value, float):
                value_text = formatter(value)
            else:
                value_text = formatter(value)
            value_text = str(value_text)
            if not value_text:
                return
            lines.append(
                f"<div class='kml-row'><span class='kml-label'>{html.escape(label)}:</span> {html.escape(value_text)}</div>"
            )

        add_row("Lot/Plan", "lotplan")
        add_row("Parcel ID", "id")
        add_row("Layer", "layer_label")
        add_row("Code", "code")
        add_row("Area (ha)", "area_ha", lambda v: f"{float(v):.2f}")
        add_row("Status", "status_label")
        add_row("Type", "type_label")
        add_row("Drilled", "drilled_date")

        report_url = data.get("report_url") or data.get("bore_report_url")
        if report_url:
            link = html.escape(str(report_url))
            lines.append(
                f"<div class='kml-row'><span class='kml-label'>Report:</span> <a href='{link}' target='_blank'>{link}</a></div>"
            )

        if not lines:
            return ""
        body = "".join(lines)
        return f"<![CDATA[<div class='kml-popup'>{body}</div>]]>"

    def _apply_common_metadata(placemark, props, desired_name: str):
        placemark.name = desired_name        # override any upstream props.name
        placemark.snippet.maxlines = 0       # hide grey line in Places panel
        placemark.snippet.content = ""
        placemark.description = _format_description(props)

        layer_color = getattr(props, "layer_color", None) or getattr(props, "color", None)
        if layer_color:
            base_alpha = style.polystyle.color[:2] if style.polystyle.color else "ff"
            fill_override = _compose_kml_color(layer_color, base_alpha)
            stroke_override = _compose_kml_color(layer_color, "ff")
            placemark.style = _clone_style(style, fill_override=fill_override, stroke_override=stroke_override)
        else:
            placemark.style = _clone_style(style)

    for feature in features:
        try:
            props = feature.properties
            geometry = feature.geometry

            # --- force sidebar name to lotplan (fallback to id) and remove snippet ---
            desired_name = None
            for key in ("lotplan", "lot_plan", "lot_plan_id"):
                if hasattr(props, key) and getattr(props, key):
                    desired_name = str(getattr(props, key))
                    break
            if not desired_name:
                desired_name = str(getattr(props, "id", "Parcel"))

            geom_type = geometry.get('type')
            coords = geometry.get('coordinates')

            if geom_type == 'Polygon':
                if not coords:
                    continue

                placemark = container.newpolygon()   # NOTE: no 'name=' here
                _apply_common_metadata(placemark, props, desired_name)

                placemark.outerboundaryis = coords[0]
                if len(coords) > 1:
                    for inner_coords in coords[1:]:
                        placemark.innerboundaryis = inner_coords

            elif geom_type == 'MultiPolygon':
                if not coords:
                    continue

                multigeom = container.newmultigeometry(name=desired_name)
                _apply_common_metadata(multigeom, props, desired_name)

                total_parts = len(coords)
                for index, poly_coords in enumerate(coords, start=1):
                    if not poly_coords:
                        continue

                    child_poly = multigeom.newpolygon()
                    child_poly.outerboundaryis = poly_coords[0]
                    if len(poly_coords) > 1:
                        child_poly.innerboundaryis = [inner for inner in poly_coords[1:] if inner]

                    part_name = (
                        f"{desired_name} (Part {index})" if total_parts > 1 else desired_name
                    )
                    _apply_common_metadata(child_poly, props, part_name)

            else:
                logger.warning(
                    f"Unsupported geometry type '{geom_type}' for feature {getattr(props, 'id', 'unknown')}"
                )

        except Exception as e:
            logger.warning(f"Failed to add feature {getattr(feature.properties, 'id', 'unknown')} to KML: {e}")
            continue


def _add_grouped_features(container, features: List[Feature], style):
    groups: Dict[str, List[Feature]] = defaultdict(list)
    for feature in features:
        layer_label = getattr(feature.properties, "layer_label", None)
        key = layer_label or "_default"
        groups[key].append(feature)

    if not groups:
        return

    if len(groups) == 1 and "_default" in groups:
        _add_features_to_container(container, groups["_default"], style)
        return

    for label, group_features in groups.items():
        if label == "_default":
            folder = container.newfolder(name="Parcels")
        else:
            folder = container.newfolder(name=label)
        _add_features_to_container(folder, group_features, style)


def _create_popup_description(properties) -> str:
    """Create HTML description for the popup balloon (ID + Area only)."""
    parts = [f"<b>ID:</b> {properties.id}<br/>"]
    if getattr(properties, "area_ha", None):
        parts.append(f"<b>Area:</b> {properties.area_ha:.2f} hectares<br/>")
    # If you also want to keep state in the popup, uncomment next line:
    # parts.append(f"<b>State:</b> {properties.state}<br/>")
    return "<![CDATA[" + "".join(parts) + "]]>"


def _add_extended_data(placemark, properties):
    """Add ExtendedData to KML placemark (doesn't affect sidebar)."""
    for key, value in properties.__dict__.items():
        if value is not None:
            placemark.extendeddata.newdata(name=key, value=str(value))
