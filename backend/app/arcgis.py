import asyncio
import logging
from typing import List, Dict, Any, Optional
from urllib.parse import urlencode
import httpx
from tenacity import retry, stop_after_attempt, wait_exponential, before_sleep_log
from .models import ParcelState, Feature
from .utils.logging import get_logger

logger = get_logger(__name__)

# ArcGIS service endpoints
ARCGIS_SERVICES = {
    ParcelState.NSW: "https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Cadastre/MapServer/9",
    ParcelState.QLD: "https://spatial-gis.information.qld.gov.au/arcgis/rest/services/PlanningCadastre/LandParcelPropertyFramework/MapServer/4", 
    ParcelState.SA: "https://lsa2.geohub.sa.gov.au/server/rest/services/ePlanning/DAP_Parcels/MapServer/1"
}

# Field mappings for different states
STATE_FIELD_MAPPINGS = {
    ParcelState.NSW: {
        'id_field': 'cadid',
        'name_field': 'primaryaddress',
        'lot_field': 'lotnumber',
        'plan_field': 'plannumber'
    },
    ParcelState.QLD: {
        'id_field': 'lotplan',
        'name_field': 'addr_legal',
        'lot_field': 'lot',
        'plan_field': 'plan'
    },
    ParcelState.SA: {
        'id_field': 'parcel_id',
        'name_field': 'legal_desc',
        'lot_field': 'lot_number',
        'plan_field': 'plan_number'
    }
}

class ArcGISClient:
    def __init__(self, timeout: int = 20, max_ids_per_chunk: int = 50):
        self.timeout = timeout
        self.max_ids_per_chunk = max_ids_per_chunk
        
    async def __aenter__(self):
        self.session = httpx.AsyncClient(timeout=self.timeout)
        return self
        
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.session.aclose()

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=4, max=10),
        before_sleep=before_sleep_log(logger, logging.WARNING)
    )
    async def query_features(
        self, 
        state: ParcelState, 
        parcel_ids: List[str], 
        bbox: Optional[List[float]] = None
    ) -> List[Dict[str, Any]]:
        """Query features from ArcGIS service for given parcel IDs."""
        service_url = ARCGIS_SERVICES[state]
        field_mapping = STATE_FIELD_MAPPINGS[state]
        
        all_features = []
        
        # Process in chunks to respect ArcGIS query limits
        for i in range(0, len(parcel_ids), self.max_ids_per_chunk):
            chunk = parcel_ids[i:i + self.max_ids_per_chunk]
            
            # Build WHERE clause
            where_conditions = [f"'{pid}'" for pid in chunk]
            where_clause = f"{field_mapping['id_field']} IN ({','.join(where_conditions)})"
            
            params = {
                'where': where_clause,
                'outFields': '*',
                'returnGeometry': 'true',
                'geometryPrecision': 6,
                'f': 'geojson',
                'outSR': '4326'  # WGS84
            }
            
            if bbox:
                params.update({
                    'geometry': f"{bbox[0]},{bbox[1]},{bbox[2]},{bbox[3]}",
                    'geometryType': 'esriGeometryEnvelope',
                    'spatialRel': 'esriSpatialRelIntersects'
                })
            
            url = f"{service_url}/query"
            
            logger.info(f"Querying {service_url} for {len(chunk)} {state} parcels")
            
            try:
                response = await self.session.get(url, params=params)
                response.raise_for_status()
                
                data = response.json()
                
                # Handle different response formats
                if 'features' in data:
                    features = data['features']
                elif 'error' in data:
                    logger.error(f"ArcGIS API error: {data['error']}")
                    continue
                else:
                    logger.warning(f"Unexpected response format: {list(data.keys())}")
                    continue
                
                # Process and standardize features
                processed_features = []
                for feature in features:
                    processed = self._process_feature(feature, state, field_mapping)
                    if processed:
                        processed_features.append(processed)
                
                all_features.extend(processed_features)
                
                logger.info(f"Retrieved {len(processed_features)} features for chunk")
                
            except Exception as e:
                logger.error(f"Failed to query chunk {i//self.max_ids_per_chunk + 1}: {e}")
                continue
        
        logger.info(f"Total retrieved: {len(all_features)} features for {state}")
        return all_features

    def _process_feature(
        self, 
        feature: Dict[str, Any], 
        state: ParcelState, 
        field_mapping: Dict[str, str]
    ) -> Optional[Dict[str, Any]]:
        """Process and standardize a feature from ArcGIS response."""
        try:
            properties = feature.get('properties', {})
            geometry = feature.get('geometry')
            
            if not geometry:
                return None
            
            # Extract standard fields
            feature_id = properties.get(field_mapping['id_field'], 'unknown')
            name = properties.get(field_mapping['name_field'], f"{state} Parcel {feature_id}")
            
            # Calculate area in hectares if geometry is available
            area_ha = None
            if geometry and geometry.get('type') in ['Polygon', 'MultiPolygon']:
                try:
                    from shapely.geometry import shape
                    from pyproj import Geod
                    
                    geom = shape(geometry)
                    # Use WGS84 ellipsoid for area calculation
                    geod = Geod(ellps='WGS84')
                    area_m2 = abs(geod.geometry_area_perimeter(geom)[0])
                    area_ha = area_m2 / 10000  # Convert to hectares
                except Exception as e:
                    logger.warning(f"Failed to calculate area for {feature_id}: {e}")
            
            return {
                'type': 'Feature',
                'geometry': geometry,
                'properties': {
                    'id': str(feature_id),
                    'state': state.value,
                    'name': name,
                    'area_ha': area_ha,
                    **{k: v for k, v in properties.items() if v is not None}
                }
            }
            
        except Exception as e:
            logger.error(f"Error processing feature: {e}")
            return None

async def query_parcels_bulk(
    parcel_ids_by_state: Dict[ParcelState, List[str]],
    bbox: Optional[List[float]] = None,
    timeout: int = 20,
    max_ids_per_chunk: int = 50
) -> List[Feature]:
    """Query parcels from multiple states concurrently."""
    
    async with ArcGISClient(timeout=timeout, max_ids_per_chunk=max_ids_per_chunk) as client:
        tasks = []
        
        for state, parcel_ids in parcel_ids_by_state.items():
            if parcel_ids:
                task = client.query_features(state, parcel_ids, bbox)
                tasks.append(task)
        
        if not tasks:
            return []
        
        # Execute all queries concurrently
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        all_features = []
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                logger.error(f"Task {i} failed: {result}")
            elif isinstance(result, list):
                all_features.extend(result)
        
        # Convert to Feature objects
        feature_objects = []
        for feature_data in all_features:
            try:
                feature = Feature(**feature_data)
                feature_objects.append(feature)
            except Exception as e:
                logger.error(f"Failed to create Feature object: {e}")
        
        return feature_objects