import asyncio
import datetime as dt
import json
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import httpx
from pyproj import Geod
from shapely.geometry import GeometryCollection, shape, mapping
from shapely.ops import unary_union

from .arcgis import ArcGISClient, ArcGISError
from .models import ParcelState
from .parsers.qld import parse_qld
from .property_config import PROPERTY_LAYER_MAP, PROPERTY_REPORT_LAYERS, PropertyLayer
from .landtype.colors import color_from_code
from .style.colors import resolve_layer_color
from .utils.logging import get_logger

logger = get_logger(__name__)

_GEOD = Geod(ellps="WGS84")


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


def _clean_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _safe_float(value: Any) -> Optional[float]:
    if value in (None, ""):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    try:
        text = str(value).replace(",", "").strip()
        return float(text) if text else None
    except (TypeError, ValueError):
        return None


def _normalise_single_lotplan(candidate: Optional[str]) -> Optional[str]:
    if not candidate:
        return None
    valid, _ = parse_qld(str(candidate))
    if valid:
        return valid[0].id
    cleaned = _clean_text(candidate).upper()
    return cleaned or None


def _normalize_bore_number(value: Any) -> str:
    if value is None:
        return ""
    return "".join(ch for ch in str(value).strip() if ch.isalnum()).upper()


def _normalize_bore_drill_date(value: Any) -> Optional[str]:
    if value in (None, ""):
        return None
    if isinstance(value, dt.datetime):
        return value.date().isoformat()
    if isinstance(value, dt.date):
        return value.isoformat()
    if isinstance(value, (int, float)):
        try:
            return dt.datetime.utcfromtimestamp(float(value) / 1000.0).date().isoformat()
        except (OSError, OverflowError, ValueError):
            return None
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            parsed = dt.datetime.fromisoformat(text)
            if parsed.tzinfo:
                parsed = parsed.astimezone(dt.timezone.utc)
            return parsed.date().isoformat()
        except ValueError:
            return text
    return None


def _normalise_bore_properties(raw: Dict[str, Any]) -> Dict[str, Any]:
    props = raw or {}
    bore_number = _normalize_bore_number(
        props.get("bore_number")
        or props.get("rn_char")
        or props.get("rn")
        or props.get("facility_id")
    )
    status_code = _clean_text(
        props.get("status")
        or props.get("status_code")
        or props.get("facility_status")
    )
    status_label = _clean_text(
        props.get("status_label")
        or props.get("statusLabel")
        or props.get("facility_status_decode")
    )
    type_code = _clean_text(
        props.get("type")
        or props.get("type_code")
        or props.get("facility_type")
    )
    type_label = _clean_text(
        props.get("type_label")
        or props.get("typeLabel")
        or props.get("facility_type_decode")
    )
    drilled = _normalize_bore_drill_date(
        props.get("drilled_date")
        or props.get("drill_date")
        or props.get("date_drill")
    )
    report_url = _clean_text(
        props.get("report_url")
        or props.get("bore_report_url")
        or props.get("geology_url")
    )

    merged: Dict[str, Any] = {}
    if bore_number:
        merged["bore_number"] = bore_number
        merged.setdefault("name", bore_number)
        merged.setdefault("display_name", bore_number)
    if status_code:
        merged["status"] = status_code
    if status_label:
        merged["status_label"] = status_label
    if type_code:
        merged["type"] = type_code
    if type_label:
        merged["type_label"] = type_label
    if drilled:
        merged["drilled_date"] = drilled
    if report_url:
        merged["report_url"] = report_url
    return merged


def _normalise_easement_properties(raw: Dict[str, Any], fallback_lotplan: Optional[str]) -> Dict[str, Any]:
    props = raw or {}
    owner_lp = (
        _normalise_single_lotplan(
            props.get("lotplan")
            or props.get("lot_plan")
            or props.get("parcel_lotplan")
        )
        or fallback_lotplan
    )

    alias = _clean_text(
        props.get("alias")
        or props.get("feat_alias")
        or props.get("feature_alias")
    )
    parcel_type = _clean_text(
        props.get("parcel_type")
        or props.get("parcel_typ")
    )
    tenure = _clean_text(
        props.get("tenure")
        or props.get("tenure_type")
    )

    area_m2 = _safe_float(
        props.get("area_m2")
        or props.get("lot_area_m2")
        or props.get("shape_area")
    )

    merged: Dict[str, Any] = {}
    if owner_lp:
        merged["lotplan"] = owner_lp
    if alias:
        merged["alias"] = alias
    if parcel_type:
        merged["parcel_type"] = parcel_type
    if tenure:
        merged["tenure"] = tenure
    if area_m2 is not None:
        merged["area_m2"] = area_m2
        merged["area_ha"] = area_m2 / 10000.0
    return merged


def _normalise_water_properties(raw: Dict[str, Any], layer: PropertyLayer, lotplan_label: Optional[str]) -> Dict[str, Any]:
    props = raw or {}
    display_name = (
        props.get("display_name")
        or props.get("name")
        or props.get("feature_name")
        or props.get("water_name")
        or layer.label
    )
    merged: Dict[str, Any] = {}
    merged["display_name"] = _clean_text(display_name) or layer.label
    merged.setdefault("name", merged["display_name"])
    merged["layer_title"] = layer.label
    merged["source_layer_name"] = props.get("source_layer_name") or layer.service_url.rsplit("/", 1)[-1]
    if lotplan_label:
        merged["lotplan"] = lotplan_label
    return merged


def _calculate_area_hectares(shapely_geom) -> Optional[float]:
    if shapely_geom is None or shapely_geom.is_empty:
        return None
    try:
        area, _ = _GEOD.geometry_area_perimeter(shapely_geom)
    except Exception as exc:
        logger.debug("Failed to compute area: %s", exc)
        return None
    return abs(area) / 10000.0 if area else None


def _rgb_to_hex(rgb: Tuple[int, int, int]) -> str:
    r, g, b = rgb
    return f"#{max(0, min(255, r)):02x}{max(0, min(255, g)):02x}{max(0, min(255, b)):02x}"


def _color_from_code_hex(code: Optional[str]) -> Optional[str]:
    if not code:
        return None
    return _rgb_to_hex(color_from_code(str(code)))


def _apply_layer_color(layer: PropertyLayer, props: Dict[str, Any]) -> Optional[str]:
    if layer.color_strategy == "static":
        return layer.color
    if layer.color_strategy == "hash_code":
        key = None
        if layer.code_field and props.get(layer.code_field):
            key = props.get(layer.code_field)
        else:
            key = props.get("code") or props.get("name")
        return _color_from_code_hex(key)
    if layer.color_strategy == "lookup":
        if not layer.color_map:
            return None
        key = props.get(layer.code_field or "status") or props.get("status")
        if key is None:
            return None
        key_str = str(key).strip()
        return (
            layer.color_map.get(key_str)
            or layer.color_map.get(key_str.upper())
            or layer.color_map.get(key_str.lower())
        )
    return layer.color



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
        area_ha = None
    else:
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

        shapely_geom = clipped
        area_ha = _calculate_area_hectares(shapely_geom) if layer.geometry_type == "polygon" else None

    feature = dict(feature)
    props = dict(feature.get("properties") or {})
    if area_ha is not None:
        props.setdefault("area_ha", area_ha)
        props.setdefault("area_m2", area_ha * 10000.0)
    feature["properties"] = props

    if layer.geometry_type == "point":
        feature["geometry"] = geom_dict
    else:
        feature["geometry"] = mapping(shapely_geom)
    return feature


async def _fetch_layer_features(
    client: httpx.AsyncClient,
    layer: PropertyLayer,
    parcel_union,
    envelope: Dict[str, Any],
    lotplans: Sequence[str],
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
    lotplan_label = ", ".join(lotplans)
    primary_lotplan = lotplans[0] if lotplans else None

    seen_bore_numbers: set[str] = set()

    for index, feature in enumerate(fc.get("features", []), start=1):
        clipped = _clip_feature_to_union(feature, layer, parcel_union)
        if not clipped:
            continue

        props = dict(clipped.get("properties") or {})
        props.setdefault("layer_id", layer.id)
        props.setdefault("layer_label", layer.label)
        props.setdefault("geometry_type", layer.geometry_type)
        if layer.group:
            props.setdefault("layer_group", layer.group)

        if layer.name_field and props.get(layer.name_field):
            props.setdefault("name", props.get(layer.name_field))
        if layer.code_field and props.get(layer.code_field):
            props.setdefault("code", props.get(layer.code_field))

        if lotplan_label:
            props.setdefault("lotplan", lotplan_label)

        if layer.id == "bores":
            props.update(_normalise_bore_properties(props))
            bore_id = props.get("bore_number")
            if bore_id:
                bore_id_str = str(bore_id).strip().upper()
                if bore_id_str in seen_bore_numbers:
                    continue
                seen_bore_numbers.add(bore_id_str)
        elif layer.id == "easements":
            props.update(_normalise_easement_properties(props, primary_lotplan))
        elif layer.group == "Water" or layer.id.startswith("water-"):
            props.update(_normalise_water_properties(props, layer, lotplan_label))
            if not props.get("code"):
                props["code"] = f"{layer.id}-{index}"
            if not props.get("name"):
                props["name"] = props.get("display_name") or f"{layer.label} {index}"
        else:
            display_name = props.get("name") or props.get("code")
            if display_name:
                props.setdefault("display_name", _clean_text(display_name))

        if not props.get("layer_color"):
            color_value = resolve_layer_color(layer.id, props)
            if not color_value:
                color_value = _apply_layer_color(layer, props)
            if color_value:
                props["layer_color"] = color_value

        clipped["properties"] = props
        features_out.append(clipped)

    return {
        "id": layer.id,
        "label": layer.label,
        "geometryType": layer.geometry_type,
        "color": layer.color,
        "colorStrategy": layer.color_strategy,
        "colorMap": layer.color_map,
        "group": layer.group,
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
                _fetch_layer_features(client, layer, parcel_union, envelope, lotplans)
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
