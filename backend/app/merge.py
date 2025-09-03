from typing import List
from shapely.geometry import shape, Polygon, MultiPolygon
from shapely.ops import unary_union
import logging
from .models import Feature
from .utils.logging import get_logger

logger = get_logger(__name__)

def dissolve_features(features: List[Feature]) -> List[Feature]:
    """
    Dissolve/merge features by state to reduce complexity.
    Handles invalid geometries and repairs them if possible.
    """
    if not features:
        return []
    
    # Group features by state
    features_by_state = {}
    for feature in features:
        state = feature.properties.state
        if state not in features_by_state:
            features_by_state[state] = []
        features_by_state[state].append(feature)
    
    dissolved_features = []
    
    for state, state_features in features_by_state.items():
        try:
            logger.info(f"Dissolving {len(state_features)} features for {state}")
            
            # Convert to shapely geometries
            geometries = []
            total_area = 0
            
            for feature in state_features:
                try:
                    geom = shape(feature.geometry)
                    
                    # Attempt to fix invalid geometries
                    if not geom.is_valid:
                        logger.warning(f"Invalid geometry found for {feature.properties.id}, attempting to fix")
                        geom = geom.buffer(0)  # Common fix for self-intersections
                    
                    if geom.is_valid and not geom.is_empty:
                        geometries.append(geom)
                        if feature.properties.area_ha:
                            total_area += feature.properties.area_ha
                            
                except Exception as e:
                    logger.warning(f"Failed to process geometry for {feature.properties.id}: {e}")
                    continue
            
            if not geometries:
                logger.warning(f"No valid geometries found for {state}")
                continue
            
            # Dissolve geometries
            if len(geometries) == 1:
                dissolved_geom = geometries[0]
            else:
                try:
                    dissolved_geom = unary_union(geometries)
                except Exception as e:
                    logger.error(f"Failed to dissolve geometries for {state}: {e}")
                    # Fallback: use individual geometries
                    dissolved_geom = MultiPolygon(geometries) if len(geometries) > 1 else geometries[0]
            
            # Convert back to GeoJSON
            if dissolved_geom.is_empty:
                logger.warning(f"Dissolved geometry is empty for {state}")
                continue
            
            # Create dissolved feature
            dissolved_feature = Feature(
                type="Feature",
                geometry=dissolved_geom.__geo_interface__,
                properties={
                    'id': f"{state}_dissolved",
                    'state': state,
                    'name': f"{state} Cadastral Parcels ({len(state_features)} merged)",
                    'area_ha': total_area,
                    'feature_count': len(state_features),
                    'original_ids': [f.properties.id for f in state_features[:10]]  # Store first 10 IDs
                }
            )
            
            dissolved_features.append(dissolved_feature)
            logger.info(f"Successfully dissolved {len(state_features)} features into 1 for {state}")
            
        except Exception as e:
            logger.error(f"Failed to dissolve features for {state}: {e}")
            # Fallback: return original features
            dissolved_features.extend(state_features)
    
    return dissolved_features

def simplify_features(features: List[Feature], tolerance: float = 0.0001) -> List[Feature]:
    """
    Simplify feature geometries to reduce file size.
    """
    if not features or tolerance <= 0:
        return features
    
    simplified_features = []
    
    for feature in features:
        try:
            geom = shape(feature.geometry)
            simplified_geom = geom.simplify(tolerance, preserve_topology=True)
            
            if simplified_geom.is_empty or not simplified_geom.is_valid:
                # Keep original if simplification failed
                simplified_features.append(feature)
                continue
            
            # Create new feature with simplified geometry
            simplified_feature = Feature(
                type=feature.type,
                geometry=simplified_geom.__geo_interface__,
                properties=feature.properties.copy()
            )
            
            simplified_features.append(simplified_feature)
            
        except Exception as e:
            logger.warning(f"Failed to simplify geometry for {feature.properties.id}: {e}")
            simplified_features.append(feature)  # Keep original
    
    return simplified_features

def calculate_bounds(features: List[Feature]) -> List[float]:
    """
    Calculate bounding box for all features.
    Returns [minx, miny, maxx, maxy]
    """
    if not features:
        return [0, 0, 0, 0]
    
    bounds = []
    
    for feature in features:
        try:
            geom = shape(feature.geometry)
            bounds.append(geom.bounds)
        except Exception as e:
            logger.warning(f"Failed to get bounds for {feature.properties.id}: {e}")
            continue
    
    if not bounds:
        return [0, 0, 0, 0]
    
    # Calculate overall bounds
    min_x = min(b[0] for b in bounds)
    min_y = min(b[1] for b in bounds)
    max_x = max(b[2] for b in bounds)
    max_y = max(b[3] for b in bounds)
    
    return [min_x, min_y, max_x, max_y]