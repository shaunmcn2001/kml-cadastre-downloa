import asyncio
import json
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import httpx
from shapely.geometry import GeometryCollection, shape, mapping
from shapely.ops import unary_union

from .arcgis import ArcGISClient, ArcGISError
from .models import ParcelState
from .parsers.qld import parse_qld
from .property_config import PROPERTY_LAYER_MAP, PROPERTY_REPORT_LAYERS, PropertyLayer
from .utils.logging import get_logger

logger = get_logger(__name__)


class LotPlanNormalizationError(ValueError):
    """Raised when a QLD lot/plan token cannot be normalised."""


def _normalise_qld_lotplan(token: str) -> List[str]:
    """Normalise raw lot/plan text into canonical `LOTPLAN` strings."""
    valid, malformed = parse_qld(token)
    if malformed and not valid:
        raise LotPlanNormalizationError(malformed[0].error or f"Invalid lotplan: {token}")
    return [entry.id for entry in valid]


def _dedupe_preserve_order(values: Iterable[str]) -> List[str]:
    seen = set()
    ordered: List[str] = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        ordered.append(value)
    return ordered


async def _fetch_parcels(
    lotplans: Sequence[str],
    timeout: int,
    max_ids_per_chunk: int,
) -> List[Dict[str, Any]]:
    """Fetch parcel geometries for the supplied QLD lotplans."""
    if not lotplans:
        return []

    async with ArcGISClient(timeout=timeout, max_ids_per_chunk=max_ids_per_chunk) as client:
        try:
            raw_features = await client.query_features(ParcelState.QLD, list(lotplans))
        except ArcGISError as exc:
            logger.error("Failed to fetch QLD parcels: %s", exc)
            raise

    # Ensure we only return features in the same order as lotplans list
    features_by_id: Dict[str, Dict[str, Any]] = {}
    for feature in raw_features:
        feature_id = str(feature.get("properties", {}).get("id") or feature.get("properties", {}).get("lotplan"))
        if feature_id:
            features_by_id.setdefault(feature_id, feature)

    ordered_features = []
    for lotplan in lotplans:
        feature = features_by_id.get(lotplan)
        if feature:
            ordered_features.append(feature)

    return ordered_features


def _union_parcel_geometry(features: Sequence[Dict[str, Any]]):
    from shapely.geometry import shape as shapely_shape

    geometries = []
    for feature in features:
        geom = feature.get("geometry")
        if not geom:
            continue
        shapely_geom = shapely_shape(geom)
        if shapely_geom.is_empty:
            continue
        geometries.append(shapely_geom)

    if not geometries:
        return None

    return unary_union(geometries)


def _envelope_from_union(union_geom):
    bounds = union_geom.bounds  # minx, miny, maxx, maxy
    xmin, ymin, xmax, ymax = bounds
    return {
        "xmin": float(xmin),
        "ymin": float(ymin),
        "xmax": float(xmax),
        "ymax": float(ymax),
        "spatialReference": {"wkid": 4326},
    }


async def _arcgis_geojson_query(
    client: httpx.AsyncClient,
    layer: PropertyLayer,
    base_params: Dict[str, Any],
    max_records: int = 1000,
) -> Dict[str, Any]:
    """Query an ArcGIS layer returning GeoJSON FeatureCollection."""
    url = f"{layer.service_url.rstrip('/')}/{layer.layer_id}/query"
    result_offset = 0
    features: List[Dict[str, Any]] = []

    while True:
        params = dict(base_params)
        params["resultOffset"] = result_offset
        params["resultRecordCount"] = max_records
        response = await client.get(url, params=params)
        response.raise_for_status()
        payload = response.json()
        layer_features = payload.get("features", [])
        features.extend(layer_features)

        if len(layer_features) < max_records:
            break

        result_offset += max_records

    return {"type": "FeatureCollection", "features": features}


def _clip_feature_to_union(feature: Dict[str, Any], layer: PropertyLayer, parcel_union):
    geom_dict = feature.get("geometry")
    if not geom_dict:
        return None

    shapely_geom = shape(geom_dict)

    if shapely_geom.is_empty:
        return None

    if layer.geometry_type == "point":
        if not parcel_union.contains(shapely_geom):
            return None
        return feature

    clipped = shapely_geom.intersection(parcel_union)
    if clipped.is_empty:
        return None

    if isinstance(clipped, GeometryCollection):
        geoms = [
            g
            for g in clipped.geoms
            if not g.is_empty and g.geom_type.lower().startswith(layer.geometry_type[:3])
        ]
        if not geoms:
            return None
        clipped = unary_union(geoms)

    feature = dict(feature)
    feature["geometry"] = mapping(clipped)
    return feature


async def _fetch_layer_features(
    client: httpx.AsyncClient,
    layer: PropertyLayer,
    parcel_union,
    envelope: Dict[str, Any],
) -> Dict[str, Any]:
    params = {
        "f": "geojson",
        "where": layer.where or "1=1",
        "geometryType": "esriGeometryEnvelope",
        "geometry": json.dumps(envelope),
        "inSR": 4326,
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": layer.out_fields or "*",
        "returnGeometry": "true",
        "outSR": 4326,
    }

    fc = await _arcgis_geojson_query(client, layer, params)
    features_out: List[Dict[str, Any]] = []

    for feature in fc.get("features", []):
        clipped = _clip_feature_to_union(feature, layer, parcel_union)
        if not clipped:
            continue

        props = dict(clipped.get("properties") or {})
        props.setdefault("layer_id", layer.id)
        props.setdefault("layer_label", layer.label)
        if layer.color:
            props.setdefault("layer_color", layer.color)

        if layer.name_field and props.get(layer.name_field):
            props.setdefault("name", props.get(layer.name_field))
        if layer.code_field and props.get(layer.code_field):
            props.setdefault("code", props.get(layer.code_field))

        clipped["properties"] = props
        features_out.append(clipped)

    return {
        "id": layer.id,
        "label": layer.label,
        "geometryType": layer.geometry_type,
        "color": layer.color,
        "featureCollection": {
            "type": "FeatureCollection",
            "features": features_out,
        },
        "featureCount": len(features_out),
    }


async def generate_property_report(
    raw_lotplans: Sequence[str],
    layer_ids: Sequence[str],
    timeout: int,
    max_ids_per_chunk: int,
) -> Dict[str, Any]:
    if not raw_lotplans:
        raise ValueError("At least one lot/plan must be supplied")

    normalised: List[str] = []
    for token in raw_lotplans:
        normalised.extend(_normalise_qld_lotplan(token))

    lotplans = _dedupe_preserve_order(normalised)
    if not lotplans:
        raise ValueError("No valid QLD lotplans were supplied")

    parcels = await _fetch_parcels(lotplans, timeout=timeout, max_ids_per_chunk=max_ids_per_chunk)
    if not parcels:
        raise ValueError("No cadastral parcels were returned for the supplied lotplans")

    parcel_union = _union_parcel_geometry(parcels)
    if parcel_union is None or parcel_union.is_empty:
        raise ValueError("Unable to build parcel geometry for supplied lotplans")

    envelope = _envelope_from_union(parcel_union)

    requested_layers = [layer_id.lower() for layer_id in layer_ids]
    if "all" in requested_layers or "select_all" in requested_layers:
        active_layers = PROPERTY_REPORT_LAYERS
    else:
        missing = [layer_id for layer_id in requested_layers if layer_id not in PROPERTY_LAYER_MAP]
        if missing:
            raise ValueError(f"Unknown dataset id(s): {', '.join(missing)}")
        active_layers = [PROPERTY_LAYER_MAP[layer_id] for layer_id in requested_layers]

    layer_results: List[Dict[str, Any]] = []

    if active_layers:
        async with httpx.AsyncClient(timeout=timeout) as client:
            tasks = [
                _fetch_layer_features(client, layer, parcel_union, envelope)
                for layer in active_layers
            ]
            layer_results = await asyncio.gather(*tasks)

    return {
        "lotPlans": lotplans,
        "parcelFeatures": {
            "type": "FeatureCollection",
            "features": parcels,
        },
        "layers": layer_results,
    }


def list_property_layers() -> List[dict]:
    return [layer.metadata() for layer in PROPERTY_REPORT_LAYERS]
