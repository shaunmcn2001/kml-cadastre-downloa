from typing import List
import simplekml
from ..models import Feature, StyleOptions
from ..utils.logging import get_logger

logger = get_logger(__name__)

# State color mapping for KML styles
STATE_COLORS = {
    'NSW': simplekml.Color.blue,
    'QLD': simplekml.Color.red,
    'SA': simplekml.Color.green,
}

def export_kml(features: List[Feature], style_options: StyleOptions = None) -> str:
    """Export features to KML format with sidebar-only lotplan names and no snippet."""
    if not features:
        raise ValueError("No features to export")

    if style_options is None:
        style_options = StyleOptions()

    logger.info(f"Exporting {len(features)} features to KML")

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
        for feature in features:
            state = feature.properties.state
            features_by_state.setdefault(state, []).append(feature)

        # Create folder for each state
        for state, state_features in features_by_state.items():
            folder = kml.newfolder(name=f"{state} Parcels ({len(state_features)})")
            folder.description = ""  # Remove folder descriptions as requested

            # Create style for this state
            style = simplekml.Style()
            style.polystyle.color = STATE_COLORS.get(state, simplekml.Color.gray)
            style.polystyle.fill = 1
            style.polystyle.outline = 1
            style.polystyle.altitudemode = simplekml.AltitudeMode.clamptoground

            # Set opacity
            alpha = int(style_options.fillOpacity * 255)
            # simplekml colors are AABBGGRR (hex string)
            # Convert the existing color to a string, then replace alpha (first 2 chars)
            current_color = style.polystyle.color
            if isinstance(current_color, str) and len(current_color) == 8:
                style.polystyle.color = f"{alpha:02x}{current_color[2:]}"
            else:
                # default to blue with alpha if unexpected format
                style.polystyle.color = f"{alpha:02x}0000ff"

            style.linestyle.color = STATE_COLORS.get(state, simplekml.Color.gray)
            style.linestyle.width = style_options.strokeWidth

            _add_features_to_container(folder, state_features, style)
    elif style_options.folderName:
        # Single custom folder for all features, styled by state but in one folder
        folder = kml.newfolder(name=style_options.folderName.strip())
        folder.description = ""  # Remove folder description as requested
        
        if style_options.colorByState:
            # Group by state for styling but keep in single folder
            features_by_state = {}
            for feature in features:
                state = feature.properties.state
                features_by_state.setdefault(state, []).append(feature)
            
            for state, state_features in features_by_state.items():
                # Create style for this state
                style = simplekml.Style()
                style.polystyle.color = STATE_COLORS.get(state, simplekml.Color.gray)
                style.polystyle.fill = 1
                style.polystyle.outline = 1
                style.polystyle.altitudemode = simplekml.AltitudeMode.clamptoground

                # Set opacity
                alpha = int(style_options.fillOpacity * 255)
                current_color = style.polystyle.color
                if isinstance(current_color, str) and len(current_color) == 8:
                    style.polystyle.color = f"{alpha:02x}{current_color[2:]}"
                else:
                    style.polystyle.color = f"{alpha:02x}0000ff"

                style.linestyle.color = STATE_COLORS.get(state, simplekml.Color.gray)
                style.linestyle.width = style_options.strokeWidth

                _add_features_to_container(folder, state_features, style)
        else:
            # Single style for all features in custom folder
            style = simplekml.Style()
            style.polystyle.fill = 1
            style.polystyle.outline = 1
            alpha = int(style_options.fillOpacity * 255)
            style.polystyle.color = f"{alpha:02x}0000ff"  # Blue with alpha (AABBGGRR)
            style.linestyle.color = simplekml.Color.blue
            style.linestyle.width = style_options.strokeWidth
            
            _add_features_to_container(folder, features, style)
    else:
        # Single style for all features
        style = simplekml.Style()
        style.polystyle.fill = 1
        style.polystyle.outline = 1
        alpha = int(style_options.fillOpacity * 255)
        style.polystyle.color = f"{alpha:02x}0000ff"  # Blue with alpha (AABBGGRR)
        style.linestyle.color = simplekml.Color.blue
        style.linestyle.width = style_options.strokeWidth

        _add_features_to_container(kml, features, style)

    logger.info("KML export completed successfully")
    return kml.kml()


# ---------- Helpers ----------

def _display_name_from_props(props) -> str:
    """
    Sidebar name should be just the lotplan.
    Tries common fields in order; falls back to id if nothing else exists.
    """
    for key in ("lotplan", "lot_plan", "lot_plan_id", "name"):
        if hasattr(props, key) and getattr(props, key):
            return str(getattr(props, key))
    return str(getattr(props, "id", "Parcel"))


def _add_features_to_container(container, features: List[Feature], style):
    """Add features to KML container with given style."""

    def _apply_common_metadata(placemark, props, desired_name: str):
        placemark.name = desired_name        # override any upstream props.name
        placemark.snippet.maxlines = 0       # hide grey line in Places panel
        placemark.snippet.content = ""

        # Popup: ID + Area only
        desc_parts = [f"<b>ID:</b> {props.id}<br/>"]
        if getattr(props, "area_ha", None) is not None:
            try:
                desc_parts.append(f"<b>Area:</b> {float(props.area_ha):.2f} hectares<br/>")
            except Exception:
                desc_parts.append(f"<b>Area:</b> {props.area_ha} hectares<br/>")
        placemark.description = "<![CDATA[" + "".join(desc_parts) + "]]>"

        # Apply style
        placemark.style = style

        # Keep ExtendedData (doesn't show in sidebar)
        for key, value in props.__dict__.items():
            if value is not None:
                placemark.extendeddata.newdata(name=key, value=str(value))

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

                total_parts = len(coords)
                for index, poly_coords in enumerate(coords, start=1):
                    if not poly_coords:
                        continue

                    placemark = container.newpolygon()
                    part_name = (
                        f"{desired_name} (Part {index})"
                        if total_parts > 1 else desired_name
                    )
                    _apply_common_metadata(placemark, props, part_name)

                    placemark.outerboundaryis = poly_coords[0]
                    if len(poly_coords) > 1:
                        for inner_coords in poly_coords[1:]:
                            placemark.innerboundaryis = inner_coords

            else:
                logger.warning(
                    f"Unsupported geometry type '{geom_type}' for feature {getattr(props, 'id', 'unknown')}"
                )

        except Exception as e:
            logger.warning(f"Failed to add feature {getattr(feature.properties, 'id', 'unknown')} to KML: {e}")
            continue


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
