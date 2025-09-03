from typing import List
import simplekml
from ..models import Feature, StyleOptions
from ..utils.logging import get_logger

logger = get_logger(__name__)

# State color mapping for KML styles
STATE_COLORS = {
    'NSW': simplekml.Color.blue,
    'QLD': simplekml.Color.red, 
    'SA': simplekml.Color.green
}

def export_kml(features: List[Feature], style_options: StyleOptions = None) -> str:
    """Export features to KML format."""
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
            if state not in features_by_state:
                features_by_state[state] = []
            features_by_state[state].append(feature)
        
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
            if hasattr(style.polystyle, 'color'):
                # Convert opacity to alpha (0-255)
                alpha = int(style_options.fillOpacity * 255)
                current_color = style.polystyle.color
                # Modify alpha channel (first 2 hex digits)
                style.polystyle.color = f"{alpha:02x}{current_color[2:]}"
            
            style.linestyle.color = STATE_COLORS.get(state, simplekml.Color.gray)
            style.linestyle.width = style_options.strokeWidth
            
            _add_features_to_container(folder, state_features, style)
    else:
        # Single style for all features
        style = simplekml.Style()
        style.polystyle.color = simplekml.Color.blue
        style.polystyle.fill = 1
        style.polystyle.outline = 1
        alpha = int(style_options.fillOpacity * 255)
        style.polystyle.color = f"{alpha:02x}0000ff"  # Blue with alpha
        style.linestyle.color = simplekml.Color.blue
        style.linestyle.width = style_options.strokeWidth
        
        _add_features_to_container(kml, features, style)
    
    logger.info("KML export completed successfully")
    return kml.kml()

def _add_features_to_container(container, features: List[Feature], style):
    """Add features to KML container with given style."""
    for feature in features:
        try:
            props = feature.properties
            geometry = feature.geometry
            
            # Create placemark
            placemark = container.newpolygon(name=props.name or props.id)
            placemark.description = _create_description(props)
            placemark.style = style
            
            # Handle different geometry types
            if geometry['type'] == 'Polygon':
                coords = geometry['coordinates']
                if coords:
                    # Exterior ring
                    placemark.outerboundaryis = coords[0]
                    # Interior rings (holes)
                    if len(coords) > 1:
                        for inner_coords in coords[1:]:
                            placemark.innerboundaryis = inner_coords
            
            elif geometry['type'] == 'MultiPolygon':
                # For MultiPolygon, create multiple placemarks or use the first polygon
                coords = geometry['coordinates']
                if coords and coords[0]:
                    # Use first polygon
                    poly_coords = coords[0]
                    placemark.outerboundaryis = poly_coords[0]
                    if len(poly_coords) > 1:
                        for inner_coords in poly_coords[1:]:
                            placemark.innerboundaryis = inner_coords
            
            # Add extended data
            _add_extended_data(placemark, props)
            
        except Exception as e:
            logger.warning(f"Failed to add feature {props.id} to KML: {e}")
            continue

def _create_description(properties) -> str:
    """Create HTML description for KML placemark."""
    desc_parts = [
        f"<b>ID:</b> {properties.id}<br/>",
        f"<b>State:</b> {properties.state}<br/>"
    ]
    
    if properties.area_ha:
        desc_parts.append(f"<b>Area:</b> {properties.area_ha:.2f} hectares<br/>")
    
    # Add other properties
    skip_fields = {'id', 'state', 'name', 'area_ha'}
    for key, value in properties.__dict__.items():
        if key not in skip_fields and value is not None:
            desc_parts.append(f"<b>{key.replace('_', ' ').title()}:</b> {value}<br/>")
    
    return "".join(desc_parts)

def _add_extended_data(placemark, properties):
    """Add extended data to KML placemark."""
    for key, value in properties.__dict__.items():
        if value is not None:
            placemark.extendeddata.newdata(name=key, value=str(value))