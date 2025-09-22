import asyncio
import logging
import re
from typing import List, Dict, Any, Optional
import httpx
from tenacity import retry, stop_after_attempt, wait_exponential, before_sleep_log
from .models import ParcelState, Feature, SearchResult
from .utils.logging import get_logger

logger = get_logger(__name__)

MAX_SEARCH_PAGE_SIZE = 50

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
        'name_field': 'lotidstring',
        'lot_field': 'lotnumber',
        'plan_field': 'planlabel',
        'order_field': 'planlabel',
        'search_fields': ['planlabel', 'lotidstring', 'lotnumber', 'sectionnumber'],
        'like_fields': ['planlabel', 'lotidstring', 'lotnumber', 'sectionnumber'],
        'locality_field': None,
        'extra_fields': []
    },
    ParcelState.QLD: {
        'id_field': 'lotplan',
        'name_field': 'addr_legal',
        'lot_field': 'lot',
        'plan_field': 'plan',
        'search_fields': ['addr_legal', 'lot', 'plan'],
        'like_fields': ['addr_legal', 'lot', 'plan'],
        'extra_fields': ['locality']
    },
    ParcelState.SA: {
        'id_field': 'parcel_id',
        'name_field': 'legal_desc',
        'lot_field': 'lot_number',
        'plan_field': 'plan_number',
        'search_fields': ['legal_desc', 'lot_number', 'plan_number'],
        'like_fields': ['legal_desc', 'lot_number', 'plan_number'],
        'extra_fields': ['locality']
    }
}


class ArcGISError(Exception):
    """Raised when ArcGIS returns an application level error response."""

    def __init__(self, message: str, code: Optional[int] = None):
        super().__init__(message)
        self.code = code

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
        before_sleep=before_sleep_log(logger, logging.WARNING),
        reraise=True
    )
    async def search_parcels(
        self,
        state: ParcelState,
        term: str,
        page: int = 1,
        page_size: int = 10
    ) -> List[SearchResult]:
        """Search parcel metadata for a given state and term."""

        if state != ParcelState.NSW:
            raise ValueError("Parcel search is currently supported only for NSW")

        if page < 1:
            page = 1
        page_size = max(1, min(page_size, MAX_SEARCH_PAGE_SIZE))

        sanitized_term = self._sanitize_search_term(term)
        if not sanitized_term:
            logger.debug("Search term sanitized to empty string; returning no results")
            return []

        field_mapping = STATE_FIELD_MAPPINGS[state]
        service_url = ARCGIS_SERVICES[state]

        like_value = sanitized_term.replace(" ", "%")
        pattern = f"%{like_value}%"

        search_fields = field_mapping.get('search_fields') or [
            field_mapping['name_field'],
            field_mapping['lot_field'],
            field_mapping['plan_field']
        ]
        # Preserve ordering while ensuring we only query distinct fields
        unique_search_fields = [field for field in dict.fromkeys(search_fields) if field]

        like_fields = field_mapping.get('like_fields') or unique_search_fields
        unique_like_fields = [field for field in dict.fromkeys(like_fields) if field]
        if not unique_like_fields:
            unique_like_fields = [field_mapping['name_field']]

        where_clauses = [
            f"UPPER({field}) LIKE '{pattern}'" for field in unique_like_fields
        ]
        where_clause = f"({' OR '.join(where_clauses)})"

        offset = (page - 1) * page_size

        out_fields = {field_mapping['id_field']}
        for key in ('name_field', 'lot_field', 'plan_field', 'order_field'):
            field_name = field_mapping.get(key)
            if field_name:
                out_fields.add(field_name)
        for field in unique_search_fields:
            out_fields.add(field)
        for field in unique_like_fields:
            out_fields.add(field)

        locality_field = field_mapping.get('locality_field')
        if locality_field:
            out_fields.add(locality_field)

        for field in field_mapping.get('extra_fields', []):
            out_fields.add(field)

        order_field = field_mapping.get('order_field') or field_mapping['name_field']

        params = {
            'where': where_clause,
            'outFields': ','.join(sorted(out_fields)),
            'returnGeometry': 'false',
            'f': 'json',
            'resultOffset': offset,
            'resultRecordCount': page_size,
        }

        if order_field:
            params['orderByFields'] = f"{order_field} ASC"

        query_url = f"{service_url}/query"

        logger.info(
            "Searching parcels",
            extra={
                'state': state.value,
                'term': sanitized_term,
                'page': page,
                'page_size': page_size
            }
        )

        response = await self.session.get(query_url, params=params)
        response.raise_for_status()

        payload = response.json()

        if 'error' in payload:
            error_info = payload['error'] or {}
            message = error_info.get('message') or 'ArcGIS API error'
            details = error_info.get('details')
            if details:
                detail_text = '; '.join(str(item) for item in details if item)
                if detail_text:
                    message = f"{message}: {detail_text}"
            logger.error(f"ArcGIS API error: {message}")
            raise ArcGISError(message, code=error_info.get('code'))

        features = payload.get('features', [])
        results: List[SearchResult] = []

        for feature in features:
            attributes = feature.get('attributes') or {}
            result = self._build_search_result(attributes, field_mapping)
            if result:
                results.append(result)

        logger.info(f"Search completed with {len(results)} results")
        return results

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

    def _sanitize_search_term(self, term: str) -> str:
        """Sanitize search term for safe ArcGIS LIKE queries."""
        cleaned = re.sub(r"[^A-Za-z0-9\s/\-]", " ", term.upper())
        cleaned = re.sub(r"\s+", " ", cleaned).strip()
        return cleaned[:100]

    def _build_search_result(
        self,
        attributes: Dict[str, Any],
        field_mapping: Dict[str, str]
    ) -> Optional[SearchResult]:
        """Build a SearchResult model from ArcGIS attributes."""

        parcel_id = attributes.get(field_mapping['id_field'])
        if parcel_id is None:
            return None

        address = attributes.get(field_mapping['name_field'])
        lot = attributes.get(field_mapping['lot_field'])
        plan = attributes.get(field_mapping['plan_field'])

        locality_field = field_mapping.get('locality_field', 'locality')
        locality = attributes.get(locality_field) if locality_field else None

        label_parts = []
        if address:
            label_parts.append(str(address))

        title_parts = []
        if lot:
            title_parts.append(f"Lot {lot}")
        if plan:
            title_parts.append(str(plan))

        if title_parts:
            label_parts.append(" ".join(title_parts))

        if locality and locality not in label_parts:
            label_parts.append(str(locality))

        label = " · ".join(label_parts) if label_parts else str(parcel_id)

        return SearchResult(
            id=str(parcel_id),
            state=ParcelState.NSW,
            label=label,
            address=str(address) if address is not None else None,
            lot=str(lot) if lot is not None else None,
            plan=str(plan) if plan is not None else None,
            locality=str(locality) if locality is not None else None
        )

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
