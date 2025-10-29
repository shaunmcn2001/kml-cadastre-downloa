from __future__ import annotations

import io
import json
import os
import tempfile
from typing import Dict, List, Mapping, Optional, Sequence, Tuple

from zipfile import ZipFile, ZIP_DEFLATED

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field
from shapely.geometry import shape, mapping, box
from pyproj import Geod

from ..settings import build_content_disposition, rate_limiter, sanitize_export_filename
from ..parsers.qld import parse_qld
from ..utils.logging import get_logger
from .colors import color_from_code
from .geometry import prepare_clipped_shapes, to_shapely_union, bbox_3857
from .arcgis import fetch_parcel_geojson, fetch_landtypes_intersecting_envelope
from .kml import build_kml
from .raster import make_geotiff_rgba

router = APIRouter()
logger = get_logger(__name__)

_GEOD = Geod(ellps="WGS84")

PRESET_COLORS_HEX: Dict[str, str] = {
    "subjects": "#009FDF",
    "quotes": "#A23F97",
    "sales": "#FF0000",
    "for-sales": "#ED7D31",
}
DEFAULT_PRESET = "subjects"
DEFAULT_ALPHA = 180


def _rgb_to_hex(color: Tuple[int, int, int]) -> str:
    r, g, b = (max(0, min(255, int(val))) for val in color)
    return f"#{r:02x}{g:02x}{b:02x}"


def _hex_to_rgb(color: str) -> Tuple[int, int, int]:
    color = color.strip().lstrip("#")
    if len(color) != 6:
        raise ValueError("Hex colours must be six characters")
    return tuple(int(color[i : i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


def _feature_area_hectares(geom) -> float:
    try:
        area, _ = _GEOD.geometry_area_perimeter(geom)
        return abs(area) / 10000.0
    except Exception:
        return float(abs(geom.area)) * 12308.8  # crude fallback


class LandTypeStyleOptions(BaseModel):
    colorMode: str = Field("preset", pattern="^(preset|byProperty)$")
    presetName: Optional[str] = Field(default=None)
    propertyKey: Optional[str] = Field(default=None)
    alpha: Optional[int] = Field(default=180, ge=0, le=255)


class LandTypeExportRequest(BaseModel):
    features: Dict[str, object]
    format: str = Field(..., pattern="^(kml|kmz|geojson|tiff)$")
    styleOptions: LandTypeStyleOptions = LandTypeStyleOptions()
    filenameTemplate: Optional[str] = None


def _build_color_lookup(
    clipped: Sequence[Tuple],
    style_options: LandTypeStyleOptions,
    metadata: Sequence[Dict[str, object]],
) -> Tuple[Mapping[str, Tuple[int, int, int]], List[Dict[str, object]]]:
    if not metadata:
        return {}, []

    color_map: Dict[str, Tuple[int, int, int]] = {}
    annotated = []

    alpha = style_options.alpha if style_options.alpha is not None else 180
    alpha = max(0, min(255, alpha))

    if style_options.colorMode == "preset":
        preset = style_options.presetName or "subjects"
        hex_color = PRESET_COLORS_HEX.get(preset.lower())
        if not hex_color:
            raise HTTPException(status_code=400, detail=f"Unknown preset '{preset}'")
        preset_rgb = _hex_to_rgb(hex_color)
        for entry in metadata:
            color_map[entry["code"]] = preset_rgb
    else:
        property_key = style_options.propertyKey
        if not property_key:
            raise HTTPException(status_code=400, detail="propertyKey is required when colorMode is 'byProperty'")
        for entry in metadata:
            value = entry["properties"].get(property_key)
            color_map[entry["code"]] = color_from_code(str(value)) if value is not None else color_from_code(entry["code"])

    styled_features: List[Dict[str, object]] = []
    for entry in metadata:
        code = entry["code"]
        rgb = color_map.get(code) or color_from_code(code)
        props = dict(entry["properties"])
        props.setdefault("code", code)
        props.setdefault("name", entry.get("name") or props.get("name") or code)
        color_hex = _rgb_to_hex(rgb)
        props["landtype_color"] = color_hex
        props["landtype_alpha"] = alpha
        props["color_hex"] = color_hex
        style = dict(props.get("style") or {})
        style.setdefault("color", "#202020")
        style.setdefault("weight", 1.5)
        style["fillColor"] = color_hex
        style["fillOpacity"] = round(alpha / 255.0, 3)
        props["style"] = style
        styled_features.append(
            {
                "type": "Feature",
                "geometry": entry["geometry"],
                "properties": props,
            }
        )

    return color_map, styled_features


def _features_to_clipped(features: Dict[str, object]) -> Tuple[List[Tuple], List[Dict[str, object]]]:
    feature_list = features.get("features")
    if not isinstance(feature_list, list):
        raise HTTPException(status_code=400, detail="FeatureCollection must include a features array")

    clipped: List[Tuple] = []
    metadata: List[Dict[str, object]] = []

    for feature in feature_list:
        if not isinstance(feature, dict):
            continue
        geometry = feature.get("geometry")
        if not geometry:
            continue
        props = dict(feature.get("properties") or {})
        try:
            geom = shape(geometry)
        except Exception as exc:
            logger.warning("Skipping feature due to invalid geometry: %s", exc)
            continue
        if geom.is_empty:
            continue
        code = str(
            props.get("code")
            or props.get("lotplan")
            or props.get("name")
            or props.get("id")
            or "Feature"
        )
        name = str(props.get("name") or props.get("display_name") or code)
        area_ha = props.get("area_ha")
        if area_ha is None:
            area_ha = _feature_area_hectares(geom)
        props["code"] = code
        props["name"] = name
        props["area_ha"] = float(area_ha)
        clipped.append((geom, code, name, float(area_ha)))
        metadata.append(
            {
                "code": code,
                "geometry": geometry,
                "properties": props,
                "name": name,
            }
        )

    if not clipped:
        raise HTTPException(status_code=400, detail="No valid geometries were supplied")

    return clipped, metadata


def _clipped_to_feature_data(
    clipped: Sequence[Tuple],
    *,
    lotplan: Optional[str],
    source: str,
) -> Tuple[List[Dict[str, object]], Dict[str, Dict[str, object]]]:
    features: List[Dict[str, object]] = []
    legend: Dict[str, Dict[str, object]] = {}
    for geom, code, name, area_ha in clipped:
        if geom is None or getattr(geom, "is_empty", False):
            continue
        try:
            geom_mapping = mapping(geom)
        except Exception:
            continue
        rgb = color_from_code(code)
        color_hex = _rgb_to_hex(rgb)
        properties: Dict[str, object] = {
            "code": code,
            "name": name,
            "area_ha": float(area_ha),
            "color_hex": color_hex,
            "landtype_color": color_hex,
            "landtype_alpha": DEFAULT_ALPHA,
            "source": source,
            "style": {
                "color": "#202020",
                "weight": 1.5,
                "fillColor": color_hex,
                "fillOpacity": round(DEFAULT_ALPHA / 255.0, 3),
            },
        }
        if lotplan:
            properties["lotplan"] = lotplan
        features.append(
            {
                "type": "Feature",
                "geometry": geom_mapping,
                "properties": properties,
            }
        )
        legend_entry = legend.setdefault(
            code,
            {
                "code": code,
                "name": name,
                "color_hex": color_hex,
                "area_ha": 0.0,
            },
        )
        legend_entry["area_ha"] = float(legend_entry.get("area_ha", 0.0)) + float(area_ha)
    return features, legend


def _merge_legends(
    base: Dict[str, Dict[str, object]],
    incoming: Dict[str, Dict[str, object]],
) -> None:
    for code, info in incoming.items():
        entry = base.setdefault(
            code,
            {
                "code": info.get("code"),
                "name": info.get("name"),
                "color_hex": info.get("color_hex"),
                "area_ha": 0.0,
            },
        )
        entry["area_ha"] = float(entry.get("area_ha", 0.0)) + float(info.get("area_ha", 0.0))


@router.get("/health")
async def landtype_health():
    return {"status": "ok"}


@router.get("/geojson")
async def landtype_geojson(
    request: Request,
    lotplans: Optional[str] = None,
    bbox: Optional[str] = None,
):
    client_ip = request.client.host if request.client else "unknown"
    if not rate_limiter.is_allowed(client_ip):
        raise HTTPException(status_code=429, detail="Rate limit exceeded")

    lotplan_list: List[str] = []
    warnings: List[str] = []

    if lotplans:
        parsed, malformed = parse_qld(lotplans)
        if not parsed and malformed:
            raise HTTPException(status_code=400, detail=malformed[0].error)
        seen = set()
        for entry in parsed:
            if entry.id in seen:
                continue
            seen.add(entry.id)
            lotplan_list.append(entry.id)
        warnings.extend([f"Skipping '{item.raw}': {item.error}" for item in malformed])

    features: List[Dict[str, object]] = []
    legend_map: Dict[str, Dict[str, object]] = {}
    selection_mode = "lotplans" if lotplan_list else "bbox"
    bbox_values: Optional[List[float]] = None

    if lotplan_list:
        for lotplan in lotplan_list:
            parcel_fc = fetch_parcel_geojson(lotplan)
            parcel_features = parcel_fc.get("features") or []
            if not parcel_features:
                warnings.append(f"No parcel geometry returned for {lotplan}")
                continue
            parcel_union = to_shapely_union(parcel_fc)
            if parcel_union.is_empty:
                warnings.append(f"Parcel geometry invalid for {lotplan}")
                continue
            env_3857 = bbox_3857(parcel_union)
            landtypes = fetch_landtypes_intersecting_envelope(env_3857)
            clipped = prepare_clipped_shapes(parcel_fc, landtypes)
            if not clipped:
                warnings.append(f"No land types intersect {lotplan}")
                continue
            lotplan_features, legend_entries = _clipped_to_feature_data(
                clipped,
                lotplan=lotplan,
                source="lotplans",
            )
            features.extend(lotplan_features)
            _merge_legends(legend_map, legend_entries)
    elif bbox:
        try:
            west, south, east, north = [float(part) for part in bbox.split(",")]
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid bbox format")

        bbox_values = [west, south, east, north]
        bbox_geom = box(west, south, east, north)
        selection_fc = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": mapping(bbox_geom),
                    "properties": {"code": "bbox"},
                }
            ],
        }
        env_3857 = bbox_3857(bbox_geom)
        landtypes = fetch_landtypes_intersecting_envelope(env_3857)
        clipped = prepare_clipped_shapes(selection_fc, landtypes)
        bbox_features, legend_entries = _clipped_to_feature_data(
            clipped,
            lotplan=None,
            source="bbox",
        )
        features.extend(bbox_features)
        _merge_legends(legend_map, legend_entries)
    else:
        raise HTTPException(status_code=400, detail="Provide lotplans or bbox")

    feature_collection: Dict[str, object] = {
        "type": "FeatureCollection",
        "features": features,
        "properties": {
            "styleOptions": {
                "colorMode": "preset",
                "presetName": DEFAULT_PRESET,
                "alpha": DEFAULT_ALPHA,
            },
            "legend": sorted(
                legend_map.values(),
                key=lambda entry: (-float(entry.get("area_ha", 0.0)), entry.get("code") or ""),
            ),
            "lotplans": lotplan_list,
            "mode": selection_mode,
            "warnings": warnings,
        },
    }

    if bbox_values:
        feature_collection["properties"]["bbox"] = bbox_values

    return feature_collection


@router.post("/export")
async def landtype_export(request: LandTypeExportRequest, http_request: Request):
    client_ip = http_request.client.host if http_request.client else "unknown"
    if not rate_limiter.is_allowed(client_ip):
        raise HTTPException(status_code=429, detail="Rate limit exceeded")

    clipped, filtered = _features_to_clipped(request.features)
    color_map, styled_features = _build_color_lookup(clipped, request.styleOptions, filtered)
    alpha = request.styleOptions.alpha if request.styleOptions.alpha is not None else 180
    alpha = max(0, min(255, alpha))

    color_fn = lambda code: color_map.get(code) or color_from_code(code)

    folder_name = request.filenameTemplate or "LandType Export"
    sanitized_base = sanitize_export_filename(folder_name, "")
    if sanitized_base:
        sanitized_base = sanitized_base.rstrip(".")
    else:
        sanitized_base = "landtype-export"

    if request.format == "kml":
        kml_text = build_kml(clipped, color_fn=color_fn, folder_name=sanitized_base, alpha=alpha)
        file_name = sanitize_export_filename(f"{sanitized_base}", ".kml") or "landtype.kml"
        return Response(
            content=kml_text.encode("utf-8"),
            media_type="application/vnd.google-earth.kml+xml",
            headers={"Content-Disposition": build_content_disposition(file_name)},
        )

    if request.format == "kmz":
        kml_text = build_kml(clipped, color_fn=color_fn, folder_name=sanitized_base, alpha=alpha)
        buffer = io.BytesIO()
        with ZipFile(buffer, "w", compression=ZIP_DEFLATED) as zipf:
            zipf.writestr("doc.kml", kml_text.encode("utf-8"))
        buffer.seek(0)
        file_name = sanitize_export_filename(f"{sanitized_base}", ".kmz") or "landtype.kmz"
        return Response(
            content=buffer.getvalue(),
            media_type="application/vnd.google-earth.kmz",
            headers={"Content-Disposition": build_content_disposition(file_name)},
        )

    if request.format == "geojson":
        styled_fc = dict(request.features)
        styled_fc["features"] = styled_features
        properties = dict(styled_fc.get("properties") or {})
        properties["styleOptions"] = {
            "colorMode": request.styleOptions.colorMode,
            "presetName": request.styleOptions.presetName or DEFAULT_PRESET,
            "propertyKey": request.styleOptions.propertyKey,
            "alpha": alpha,
        }
        styled_fc["properties"] = properties
        file_name = sanitize_export_filename(f"{sanitized_base}", ".geojson") or "landtype.geojson"
        return Response(
            content=json.dumps(styled_fc),
            media_type="application/geo+json",
            headers={"Content-Disposition": build_content_disposition(file_name)},
        )

    if request.format == "tiff":
        with tempfile.TemporaryDirectory() as tmpdir:
            out_path = os.path.join(tmpdir, "landtype.tif")
            make_geotiff_rgba(
                clipped,
                out_path=out_path,
                max_px=4096,
                color_lookup=color_map,
                alpha=alpha,
            )
            with open(out_path, "rb") as fh:
                tiff_bytes = fh.read()
        file_name = sanitize_export_filename(f"{sanitized_base}", ".tif") or "landtype.tif"
        return Response(
            content=tiff_bytes,
            media_type="image/tiff",
            headers={"Content-Disposition": build_content_disposition(file_name)},
        )

    raise HTTPException(status_code=400, detail="Unsupported format")
