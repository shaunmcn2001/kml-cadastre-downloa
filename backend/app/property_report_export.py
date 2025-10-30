from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional

from pyproj import Geod
from shapely.geometry import mapping, shape
from shapely.ops import unary_union

from .exports.kml import export_kml
from .exports.kmz import export_kmz
from .models import (
    Feature,
    FeatureProperties,
    ParcelState,
    PropertyReportLayer,
    PropertyReportResponse,
    StyleOptions,
)
from .utils.logging import get_logger

logger = get_logger(__name__)

_GEOD = Geod(ellps="WGS84")


def _clean_text(value: Any) -> Optional[str]:
    if value in (None, ""):
        return None
    if isinstance(value, str):
        text = value.strip()
        return text or None
    return str(value).strip() or None


def _safe_float(value: Any) -> Optional[float]:
    if value in (None, ""):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        cleaned = value.replace(",", "").strip()
        if not cleaned:
            return None
        try:
            return float(cleaned)
        except ValueError:
            return None
    return None


def _normalise_state(value: Any) -> ParcelState:
    if isinstance(value, ParcelState):
        return value
    if isinstance(value, str):
        text = value.strip().upper()
        try:
            return ParcelState(text)
        except ValueError:
            return ParcelState.QLD
    return ParcelState.QLD


def _serialise_geometry(feature: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    geometry = feature.get("geometry")
    if not geometry:
        return None
    geom_type = geometry.get("type")
    coords = geometry.get("coordinates")
    if not geom_type or coords is None:
        return None
    return {"type": geom_type, "coordinates": coords}


def _ensure_layer_metadata(props: Dict[str, Any], layer: PropertyReportLayer) -> None:
    props.setdefault("layer_id", layer.id)
    props.setdefault("layer_label", layer.label)
    group_value = getattr(layer, "group", None)
    if group_value:
        props.setdefault("layer_group", group_value)
    color_value = getattr(layer, "color", None)
    if color_value and not props.get("layer_color"):
        props["layer_color"] = color_value


def _compose_sidebar_name(
    layer_id: Optional[str],
    display_name: Optional[str],
    code_value: Optional[str],
    props: Dict[str, Any],
    fallback: str,
) -> Optional[str]:
    layer_norm = (layer_id or "").strip().lower()
    code_clean = _clean_text(code_value)
    title = _clean_text(display_name) or _clean_text(props.get("name")) or fallback

    if layer_norm in {"vegetation", "regulated_vegetation", "veg"}:
        category = title or code_clean or fallback
        if category:
            if not category.lower().startswith("category"):
                category = f"Category {category}"
        if code_clean and code_clean.upper() not in (category or "").upper():
            category = f"{category} ({code_clean})" if category else code_clean
        return category

    if layer_norm in {"landtypes", "land_types"}:
        name_value = title or code_clean or fallback
        if code_clean and code_clean.upper() not in (name_value or "").upper():
            name_value = f"{name_value} ({code_clean})" if name_value else code_clean
        return name_value

    if layer_norm == "easements":
        alias = _clean_text(props.get("alias"))
        parcel_type = _clean_text(props.get("parcel_type"))
        tenure = _clean_text(props.get("tenure"))
        lotplan = _clean_text(props.get("lotplan"))
        parts = [part for part in (alias, parcel_type, tenure, lotplan) if part]
        if parts:
            return " – ".join(parts)

    if code_clean:
        label = title or fallback or code_clean
        if code_clean.upper() not in (label or "").upper():
            label = f"{label} ({code_clean})" if label else code_clean
        return label

    return title or fallback


def _calculate_area_hectares(geom) -> Optional[float]:
    if geom is None or getattr(geom, "is_empty", True):
        return None
    try:
        area, _ = _GEOD.geometry_area_perimeter(geom)
    except Exception:
        return None
    if not area:
        return 0.0
    return abs(area) / 10000.0


def _ensure_polygon_area(feature: Feature) -> Feature:
    geometry = feature.geometry or {}
    geom_type = geometry.get("type")
    if geom_type not in ("Polygon", "MultiPolygon"):
        return feature
    try:
        shp_geom = shape(geometry)
    except Exception:
        return feature
    area_ha = _calculate_area_hectares(shp_geom)
    if area_ha is None:
        return feature
    props = feature.properties.model_dump()
    props["area_ha"] = area_ha
    props["area_m2"] = area_ha * 10000.0
    new_props = FeatureProperties.model_validate(props)
    return Feature(geometry=geometry, properties=new_props)


def _merge_polygon_features(features: List[Feature]) -> List[Feature]:
    grouped: Dict[tuple, List[Feature]] = {}
    non_polygons: List[Feature] = []

    for feature in features:
        geometry = feature.geometry or {}
        geom_type = geometry.get("type")
        if geom_type not in ("Polygon", "MultiPolygon"):
            non_polygons.append(feature)
            continue

        props = feature.properties
        layer_id = getattr(props, "layer_id", None)
        sidebar = (
            getattr(props, "sidebar_name", None)
            or getattr(props, "display_name", None)
            or getattr(props, "name", None)
        )
        code = getattr(props, "code", None)
        key = (layer_id, sidebar or code or getattr(props, "name", None), code)
        grouped.setdefault(key, []).append(feature)

    merged: List[Feature] = []
    for group_features in grouped.values():
        shapely_geoms = []
        for feat in group_features:
            try:
                shapely_geoms.append(shape(feat.geometry))
            except Exception:
                shapely_geoms = []
                break
        if not shapely_geoms:
            for feat in group_features:
                merged.append(_ensure_polygon_area(feat))
            continue

        try:
            union_geom = unary_union(shapely_geoms)
        except Exception:
            for feat in group_features:
                merged.append(_ensure_polygon_area(feat))
            continue

        if union_geom.is_empty:
            continue
        if union_geom.geom_type == "GeometryCollection":
            polys = [g for g in getattr(union_geom, "geoms", []) if g.geom_type in ("Polygon", "MultiPolygon")]
            if not polys:
                continue
            union_geom = unary_union(polys)

        area_ha = _calculate_area_hectares(union_geom)
        props_dict = group_features[0].properties.model_dump()
        if area_ha is not None:
            props_dict["area_ha"] = area_ha
            props_dict["area_m2"] = area_ha * 10000.0

        new_props = FeatureProperties.model_validate(props_dict)
        merged.append(Feature(geometry=mapping(union_geom), properties=new_props))

    merged.extend(non_polygons)
    return merged


def _feature_from_geojson(
    feature: Dict[str, Any],
    *,
    fallback_id: str,
    fallback_name: str,
    default_state: ParcelState,
    layer_id: Optional[str] = None,
) -> Optional[Feature]:
    geometry = _serialise_geometry(feature)
    if not geometry:
        logger.debug("Skipping feature with invalid geometry")
        return None

    props_raw = dict(feature.get("properties") or {})

    state_value = props_raw.get("state")
    state = _normalise_state(state_value) if state_value else default_state

    code_value = _clean_text(props_raw.get("code"))

    identifier = _clean_text(
        props_raw.get("id")
        or props_raw.get("lotplan")
        or props_raw.get("code")
        or fallback_id
    ) or fallback_id

    display_name = _clean_text(
        props_raw.get("display_name")
        or props_raw.get("name")
        or props_raw.get("title")
        or props_raw.get("layer_title")
        or props_raw.get("lotplan")
        or props_raw.get("code")
        or fallback_name
    ) or fallback_name

    props_payload: Dict[str, Any] = dict(props_raw)
    props_payload["id"] = identifier
    props_payload["name"] = display_name
    props_payload["state"] = state.value

    area_float = _safe_float(props_payload.get("area_ha"))
    if area_float is not None:
        props_payload["area_ha"] = area_float

    if display_name:
        props_payload.setdefault("display_name", display_name)

    sidebar_label = _compose_sidebar_name(layer_id, display_name, code_value, props_payload, fallback_name)
    if sidebar_label:
        props_payload["sidebar_name"] = sidebar_label

    try:
        properties = FeatureProperties.model_validate(props_payload)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to serialise feature properties for '%s': %s", identifier, exc)
        return None

    return Feature(geometry=geometry, properties=properties)


def _collect_layer_features(
    layer: PropertyReportLayer,
    *,
    default_state: ParcelState,
    only_visible: bool,
) -> List[Feature]:
    if only_visible and not layer.featureCollection.get("features"):
        return []

    features: List[Feature] = []
    for index, raw in enumerate(layer.featureCollection.get("features", []), start=1):
        props = dict(raw.get("properties") or {})
        _ensure_layer_metadata(props, layer)
        raw["properties"] = props

        feature = _feature_from_geojson(
            raw,
            fallback_id=f"{layer.id}-{index}",
            fallback_name=f"{layer.label} {index}",
            default_state=default_state,
            layer_id=layer.id,
        )
        if feature:
            features.append(feature)
    return features


def build_property_report_features(
    report: PropertyReportResponse,
    *,
    visible_layers: Optional[Dict[str, bool]] = None,
    include_parcels: bool = True,
) -> List[Feature]:
    visible_layers = visible_layers or {}
    default_state = ParcelState.QLD
    features: List[Feature] = []

    if include_parcels:
        for index, raw in enumerate(report.parcelFeatures.get("features", []), start=1):
            feature = _feature_from_geojson(
                raw,
                fallback_id=f"parcel-{index}",
                fallback_name=raw.get("properties", {}).get("lotplan", f"Parcel {index}") or f"Parcel {index}",
                default_state=default_state,
                layer_id="parcel",
            )
            if feature:
                features.append(feature)

    for layer in report.layers:
        if visible_layers.get(layer.id) is False:
            continue
        features.extend(
            _collect_layer_features(
                layer,
                default_state=default_state,
                only_visible=True,
            )
        )

    return features


def build_property_report_geojson(
    report: PropertyReportResponse,
    features: List[Feature],
) -> Dict[str, Any]:
    converted: List[Dict[str, Any]] = []
    exported_layers: set[str] = set()

    for feature in features:
        props = feature.properties.model_dump()
        layer_id = props.get("layer_id")
        if layer_id and layer_id != "parcel":
            exported_layers.add(str(layer_id))
        converted.append({
            "type": "Feature",
            "geometry": feature.geometry,
            "properties": props,
        })

    return {
        "type": "FeatureCollection",
        "features": converted,
        "properties": {
            "lotPlans": report.lotPlans,
            "layerCount": len(report.layers),
            "exportedLayers": sorted(exported_layers),
        },
    }


def export_property_report(
    report: PropertyReportResponse,
    *,
    visible_layers: Optional[Dict[str, bool]] = None,
    include_parcels: bool = True,
    folder_name: Optional[str] = None,
    format: str = "kml",
) -> Dict[str, Any]:
    cleaned_format = (format or "kml").strip().lower()

    if cleaned_format not in {"kml", "kmz", "geojson"}:
        raise ValueError(f"Unsupported export format '{format}'")

    features = build_property_report_features(
        report,
        visible_layers=visible_layers,
        include_parcels=include_parcels,
    )

    if not features:
        raise ValueError("No features available for export")

    features = _merge_polygon_features(features)
    features = [_ensure_polygon_area(feature) for feature in features]

    style_options = StyleOptions(
        fillOpacity=0.4,
        strokeWidth=2.0,
        colorByState=False,
        folderName=folder_name,
        mergeByName=False,
    )

    if cleaned_format == "kml":
        logger.info("Exporting property report to KML with %d features", len(features))
        content = export_kml(features, style_options)
        return {"content": content.encode("utf-8"), "media_type": "application/vnd.google-earth.kml+xml"}

    if cleaned_format == "kmz":
        logger.info("Exporting property report to KMZ with %d features", len(features))
        content = export_kmz(features, style_options)
        return {"content": content, "media_type": "application/vnd.google-earth.kmz"}

    geojson = build_property_report_geojson(report, features)
    logger.info("Exporting property report to GeoJSON with %d features", len(features))
    return {"content": geojson, "media_type": "application/geo+json"}
