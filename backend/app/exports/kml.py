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
    kml.document.name = "Cadastral Parcels"
    kml.document.description = f"Exported {len(features)} cadastral parcels"

    # Group features by state if requested
    if style_options.colorByState:
        features_by_state = {}
        for feature in features:
            state = feature.properties.state
            features_by_state.setdefault(state, []).append(feature)

        # Create folder for each state
        for state, state_features in features_by_state.items():
            folder = kml.newfolder(name=f"{state} Parcels ({len(state_features)})")
            folder.description = f"Cadastral parcels from {state}"

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
    for feature in features:
        try:
            props = feature.properties
            geometry = feature.geometry

            # Placemark with sidebar name = lotplan only
            placemark = container.newpolygon(name=_display_name_from_props(props))

            # 🔕 Hide grey snippet under the name in Places panel
            placemark.snippet.maxlines = 0      # no snippet displayed
            placemark.snippet.content = ""      # be explicit

            # 🎈 Popup content: keep ID + Area (and nothing else)
            placemark.description = _create_popup_description(props)

            # Apply shared style
            placemark.style = style

            # Geometry
            if geometry['type'] == 'Polygon':
                coords = geometry['coordinates']
                if coords:
                    placemark.outerboundaryis = coords[0]
                    if len(coords) > 1:
                        for inner_coords in coords[1:]:
                            placemark.innerboundaryis = inner_coords

            elif geometry['type'] == 'MultiPolygon':
                coords = geometry['coordinates']
                if coords and coords[0]:
                    poly_coords = coords[0]
                    placemark.outerboundaryis = poly_coords[0]
                    if len(poly_coords) > 1:
                        for inner_coords in poly_coords[1:]:
                            placemark.innerboundaryis = inner_coords

            # ExtendedData is fine to include; it does not show in the sidebar
            _add_extended_data(placemark, props)

        except Exception as e:
            logger.warning(f"Failed to add feature {getattr(feature.properties, 'id', 'unknown')} to KML: {e}")
            continue


def _create_popup_description(properties) -> str:
    """Create HTML description for the popup balloon (
