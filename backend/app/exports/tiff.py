import numpy as np
import rasterio
from rasterio.transform import from_bounds
from rasterio.features import rasterize
from shapely.geometry import shape
from typing import List, Dict, Any, Optional
import io
from ..models import Feature, StyleOptions
from ..utils.logging import get_logger

logger = get_logger(__name__)

# State to integer mapping for raster values
STATE_VALUES = {
    'NSW': 1,
    'QLD': 2,
    'SA': 3
}

def export_geotiff(
    features: List[Feature], 
    style_options: StyleOptions = None,
    resolution: float = 0.001,  # degrees (roughly 100m at equator)
    bbox: Optional[List[float]] = None
) -> bytes:
    """Export features to GeoTIFF raster format."""
    if not features:
        raise ValueError("No features to export")
    
    if style_options is None:
        style_options = StyleOptions()
    
    logger.info(f"Exporting {len(features)} features to GeoTIFF")
    
    # Calculate bounding box if not provided
    if bbox is None:
        bbox = _calculate_bbox(features)
    
    # Calculate raster dimensions
    width = int((bbox[2] - bbox[0]) / resolution)
    height = int((bbox[3] - bbox[1]) / resolution)
    
    # Limit raster size for performance
    max_dimension = 5000
    if width > max_dimension or height > max_dimension:
        scale_factor = min(max_dimension / width, max_dimension / height)
        width = int(width * scale_factor)
        height = int(height * scale_factor)
        resolution = resolution / scale_factor
        logger.warning(f"Raster size limited to {width}x{height}, resolution adjusted to {resolution}")
    
    # Create transform
    transform = from_bounds(bbox[0], bbox[1], bbox[2], bbox[3], width, height)
    
    # Prepare geometries for rasterization
    if style_options.colorByState:
        # Rasterize by state
        geometries_with_values = []
        for feature in features:
            try:
                geom = shape(feature.geometry)
                state_value = STATE_VALUES.get(feature.properties.state, 0)
                geometries_with_values.append((geom, state_value))
            except Exception as e:
                logger.warning(f"Failed to process geometry for {feature.properties.id}: {e}")
                continue
    else:
        # Single value for all features
        geometries_with_values = []
        for feature in features:
            try:
                geom = shape(feature.geometry)
                geometries_with_values.append((geom, 1))
            except Exception as e:
                logger.warning(f"Failed to process geometry for {feature.properties.id}: {e}")
                continue
    
    if not geometries_with_values:
        raise ValueError("No valid geometries to rasterize")
    
    # Rasterize
    logger.info(f"Rasterizing to {width}x{height} grid with resolution {resolution}")
    
    raster = rasterize(
        geometries_with_values,
        out_shape=(height, width),
        transform=transform,
        fill=0,
        dtype=rasterio.uint8
    )
    
    # Create GeoTIFF in memory
    tiff_buffer = io.BytesIO()
    
    # Prepare metadata
    profile = {
        'driver': 'GTiff',
        'dtype': rasterio.uint8,
        'nodata': 0,
        'width': width,
        'height': height,
        'count': 1,
        'crs': 'EPSG:4326',  # WGS84
        'transform': transform,
        'compress': 'lzw',
        'tiled': True,
        'blockxsize': 512,
        'blockysize': 512
    }
    
    # Write GeoTIFF
    with rasterio.open(tiff_buffer, 'w', **profile) as dst:
        dst.write(raster, 1)
        
        # Add colormap if using state colors
        if style_options.colorByState:
            colormap = {
                0: (0, 0, 0, 0),        # Transparent background
                1: (0, 0, 139, 255),    # NSW - Dark blue  
                2: (139, 0, 0, 255),    # QLD - Dark red
                3: (0, 100, 0, 255),    # SA - Dark green
            }
            dst.write_colormap(1, colormap)
        
        # Add metadata
        dst.update_tags(
            title="Cadastral Parcels",
            description=f"Australian cadastral parcels ({len(features)} features)",
            source="KML Downloads Service",
            states=','.join(set(f.properties.state for f in features)),
            feature_count=str(len(features)),
            resolution=str(resolution),
            bbox=','.join(map(str, bbox))
        )
        
        # Add state value meanings
        if style_options.colorByState:
            for state, value in STATE_VALUES.items():
                dst.update_tags(**{f"state_{value}": state})
    
    tiff_buffer.seek(0)
    logger.info("GeoTIFF export completed successfully")
    return tiff_buffer.read()

def _calculate_bbox(features: List[Feature]) -> List[float]:
    """Calculate bounding box for features."""
    bounds = []
    
    for feature in features:
        try:
            geom = shape(feature.geometry)
            bounds.append(geom.bounds)
        except Exception as e:
            logger.warning(f"Failed to get bounds for {feature.properties.id}: {e}")
            continue
    
    if not bounds:
        return [-180, -90, 180, 90]  # World bounds as fallback
    
    # Calculate overall bounds with small buffer
    min_x = min(b[0] for b in bounds)
    min_y = min(b[1] for b in bounds) 
    max_x = max(b[2] for b in bounds)
    max_y = max(b[3] for b in bounds)
    
    # Add 1% buffer
    x_buffer = (max_x - min_x) * 0.01
    y_buffer = (max_y - min_y) * 0.01
    
    return [min_x - x_buffer, min_y - y_buffer, max_x + x_buffer, max_y + y_buffer]