import base64
import io
import logging
import os
import tempfile
import zipfile
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import alphashape
import numpy as np
from sklearn.neighbors import NearestNeighbors
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastkml import kml as fastkml  # type: ignore[import-untyped]
from pydantic import BaseModel
from shapely.geometry import GeometryCollection, LineString, MultiPolygon, Point, Polygon, mapping, shape
from shapely.ops import nearest_points, transform, unary_union
from simplekml import Kml
from pyproj import Geod, Transformer
import shapefile  # type: ignore[import-untyped]

from .settings import sanitize_export_filename

BUFFER_DISTANCE_METERS = 3000

ADVANCED_BREAKS_KM = [0.5, 1.5, 3.0]
ADVANCED_WEIGHTS = [1.0, 0.75, 0.5]

DEFAULT_BASIC_COLOR = "#5EC68F"
DEFAULT_RING_COLORS = ["#5EC68F", "#4FA679", "#FCEE9C"]
ALPHA_MIN = 0.0001
ALPHA_MAX = 0.005
HULL_JOIN_DISTANCE_METERS = 6000.0
PERIMETER_SAMPLE_STEP = 200.0  # metres

FILL_OPACITY = 0.4
OUTLINE_WIDTH = 4.0
OUTLINE_COLOR = "#000000"

ELLIPSOID = "GRS80"
GEOD = Geod(ellps=ELLIPSOID)
TO_METRIC = Transformer.from_crs("EPSG:4326", "EPSG:7855", always_xy=True)
TO_GEODETIC = Transformer.from_crs("EPSG:7855", "EPSG:4326", always_xy=True)

logger = logging.getLogger(__name__)

router = APIRouter()


class GrazingFeature(BaseModel):
    type: str
    geometry: Dict[str, Any]
    properties: Dict[str, Any]


class GrazingFeatureCollection(BaseModel):
    type: str = "FeatureCollection"
    features: List[GrazingFeature]


class GrazingDownload(BaseModel):
    filename: str
    contentType: str
    data: str


class GrazingSummary(BaseModel):
    pointCount: int
    bufferAreaHa: float = 0.0
    convexAreaHa: float = 0.0
    concaveAlpha: Optional[float] = None
    concaveTightness: Optional[float] = None
    ringClasses: List[Dict[str, Any]] = []


class GrazingProcessResponse(BaseModel):
    method: str
    buffers: Optional[GrazingFeatureCollection] = None
    convexHull: Optional[GrazingFeatureCollection] = None
    rings: Optional[GrazingFeatureCollection] = None
    ringHulls: Optional[GrazingFeatureCollection] = None
    summary: GrazingSummary
    downloads: Dict[str, GrazingDownload]


def _normalize_hex(color: str, fallback: str) -> str:
    candidate = (color or "").strip()
    if candidate.startswith("#") and len(candidate) == 7:
        return candidate.upper()
    if len(candidate) == 6 and all(ch in "0123456789ABCDEFabcdef" for ch in candidate):
        return f"#{candidate.upper()}"
    return fallback.upper()


def _hex_to_kml_color(hex_color: str, opacity: float) -> str:
    clean = hex_color.lstrip("#")
    if len(clean) != 6:
        clean = "5EC68F"
    red = int(clean[0:2], 16)
    green = int(clean[2:4], 16)
    blue = int(clean[4:6], 16)
    alpha = max(0, min(255, int(round(opacity * 255))))
    return f"{alpha:02x}{blue:02x}{green:02x}{red:02x}"


def _extract_points_from_geom(geom) -> List[Point]:
    if geom.geom_type == "Point":
        return [geom]
    if geom.geom_type == "MultiPoint":
        return list(geom.geoms)
    if geom.geom_type == "GeometryCollection":
        points: List[Point] = []
        for sub_geom in geom.geoms:
            points.extend(_extract_points_from_geom(sub_geom))
        return points
    return []


def _extract_polygons_from_geom(geom) -> List[Polygon]:
    if geom.is_empty:
        return []
    if isinstance(geom, Polygon):
        return [geom]
    if isinstance(geom, MultiPolygon):
        return list(geom.geoms)
    if isinstance(geom, GeometryCollection):
        polygons: List[Polygon] = []
        for sub_geom in geom.geoms:
            polygons.extend(_extract_polygons_from_geom(sub_geom))
        return polygons
    return []


def _merge_polygons(polygons: List[Polygon]) -> MultiPolygon:
    valid = [poly.buffer(0) for poly in polygons if not poly.is_empty]
    if not valid:
        raise HTTPException(status_code=400, detail="No polygon geometry found")
    merged = unary_union(valid)
    if isinstance(merged, Polygon):
        return MultiPolygon([merged])
    if isinstance(merged, MultiPolygon):
        return merged
    raise HTTPException(status_code=400, detail="Unable to merge polygon geometry")


def _load_points_from_upload(file: UploadFile) -> List[Point]:
    filename = file.filename or ""
    content = file.file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    name_lower = filename.lower()
    if name_lower.endswith(".kmz"):
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            kml_names = [name for name in archive.namelist() if name.lower().endswith(".kml")]
            if not kml_names:
                raise HTTPException(status_code=400, detail="KMZ did not contain a KML file")
            content = archive.read(kml_names[0])
        return _load_points_from_kml_bytes(content)
    if name_lower.endswith(".kml"):
        return _load_points_from_kml_bytes(content)
    if name_lower.endswith(".zip"):
        return _load_points_from_shapefile_zip(content)
    if name_lower.endswith(".shp"):
        raise HTTPException(
            status_code=400,
            detail="Upload shapefiles as a ZIP containing .shp, .shx, and .dbf files",
        )
    raise HTTPException(status_code=400, detail="Unsupported trough file type. Upload KML, KMZ, or zipped SHP.")


def _load_points_from_kml_bytes(data: bytes) -> List[Point]:
    doc = fastkml.KML()
    try:
        doc.from_string(data)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Unable to parse KML: {exc}") from exc

    points: List[Point] = []

    def _walk(container):
        for feature in getattr(container, "features", lambda: [])():
            geometry = getattr(feature, "geometry", None)
            if geometry is not None:
                shapely_geom = shape(geometry)
                points.extend(_extract_points_from_geom(shapely_geom))
            if hasattr(feature, "features"):
                _walk(feature)

    _walk(doc)

    if not points:
        raise HTTPException(status_code=400, detail="No point features found in KML")
    return points


def _load_points_from_shapefile_zip(data: bytes) -> List[Point]:
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        shp = shx = dbf = None
        for name in archive.namelist():
            lower = name.lower()
            if lower.endswith(".shp"):
                shp = io.BytesIO(archive.read(name))
            elif lower.endswith(".shx"):
                shx = io.BytesIO(archive.read(name))
            elif lower.endswith(".dbf"):
                dbf = io.BytesIO(archive.read(name))
        if not shp or not shx or not dbf:
            raise HTTPException(status_code=400, detail="Shapefile ZIP must contain .shp, .shx, and .dbf files")

    try:
        reader = shapefile.Reader(shp=shp, shx=shx, dbf=dbf)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Unable to read shapefile: {exc}") from exc

    if reader.shapeType not in (shapefile.POINT, shapefile.POINTZ, shapefile.MULTIPOINT, shapefile.MULTIPOINTZ):
        raise HTTPException(status_code=400, detail="Shapefile must contain point geometries")

    points: List[Point] = []
    for shape_record in reader.shapeRecords():
        for x, y in shape_record.shape.points:
            points.append(Point(x, y))

    if not points:
        raise HTTPException(status_code=400, detail="No point features found in shapefile")
    return points


def _boundary_from_upload(file: UploadFile | None) -> Tuple[MultiPolygon | None, MultiPolygon | None]:
    if file is None:
        return None, None

    filename = file.filename or ""
    content = file.file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Boundary file is empty")

    name_lower = filename.lower()
    if name_lower.endswith(".kmz"):
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            kml_names = [name for name in archive.namelist() if name.lower().endswith(".kml")]
            if not kml_names:
                raise HTTPException(status_code=400, detail="Boundary KMZ did not contain a KML file")
            content = archive.read(kml_names[0])
        boundary_wgs = _boundary_from_kml_bytes(content)
    elif name_lower.endswith(".kml"):
        boundary_wgs = _boundary_from_kml_bytes(content)
    elif name_lower.endswith(".zip"):
        boundary_wgs = _boundary_from_shapefile_zip(content)
    elif name_lower.endswith(".shp"):
        raise HTTPException(
            status_code=400,
            detail="Upload shapefile boundaries as a ZIP containing .shp, .shx, and .dbf files",
        )
    else:
        raise HTTPException(status_code=400, detail="Unsupported boundary file type. Upload KML, KMZ, or zipped SHP.")

    boundary_metric = _project_geometry(boundary_wgs, forward=True)
    if isinstance(boundary_metric, Polygon):
        boundary_metric = MultiPolygon([boundary_metric])
    elif isinstance(boundary_metric, MultiPolygon):
        pass
    else:
        boundary_metric = _merge_polygons(_extract_polygons_from_geom(boundary_metric))

    return boundary_wgs, boundary_metric


def _boundary_from_kml_bytes(data: bytes) -> MultiPolygon:
    doc = fastkml.KML()
    try:
        doc.from_string(data)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Unable to parse boundary KML: {exc}") from exc

    polygons: List[Polygon] = []

    def _walk(container):
        for feature in getattr(container, "features", lambda: [])():
            geometry = getattr(feature, "geometry", None)
            if geometry is not None:
                polygons.extend(_extract_polygons_from_geom(shape(geometry)))
            if hasattr(feature, "features"):
                _walk(feature)

    _walk(doc)
    if not polygons:
        raise HTTPException(status_code=400, detail="No polygons found in boundary KML")
    return _merge_polygons(polygons)


def _boundary_from_shapefile_zip(data: bytes) -> MultiPolygon:
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        shp = shx = dbf = None
        for name in archive.namelist():
            lower = name.lower()
            if lower.endswith(".shp"):
                shp = io.BytesIO(archive.read(name))
            elif lower.endswith(".shx"):
                shx = io.BytesIO(archive.read(name))
            elif lower.endswith(".dbf"):
                dbf = io.BytesIO(archive.read(name))
        if not shp or not shx or not dbf:
            raise HTTPException(status_code=400, detail="Boundary ZIP must contain .shp, .shx, and .dbf files")

    try:
        reader = shapefile.Reader(shp=shp, shx=shx, dbf=dbf)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Unable to read boundary shapefile: {exc}") from exc

    if reader.shapeType not in (
        shapefile.POLYGON,
        shapefile.POLYGONZ,
        shapefile.POLYGONM,
        shapefile.MULTIPATCH,
    ):
        raise HTTPException(status_code=400, detail="Boundary shapefile must contain polygon geometries")

    polygons: List[Polygon] = []
    for shape_record in reader.shapeRecords():
        geom = shape(shape_record.shape.__geo_interface__)
        polygons.extend(_extract_polygons_from_geom(geom))

    if not polygons:
        raise HTTPException(status_code=400, detail="No polygon features found in boundary shapefile")
    return _merge_polygons(polygons)


def _project_geometry(geom, forward: bool = True):
    transformer = TO_METRIC if forward else TO_GEODETIC
    return transform(lambda x, y, z=None: transformer.transform(x, y), geom)


def _ensure_multipolygon(geom) -> MultiPolygon:
    if isinstance(geom, Polygon):
        return MultiPolygon([geom])
    if isinstance(geom, MultiPolygon):
        return geom
    raise ValueError("Expected polygon geometry")


def _calculate_area_ha(geom) -> float:
    if geom.is_empty:
        return 0.0
    area_m2 = abs(GEOD.geometry_area_perimeter(geom)[0])
    return area_m2 / 10_000.0


def _sample_perimeter_points(poly: Polygon, step: float = PERIMETER_SAMPLE_STEP) -> np.ndarray:
    line = LineString(poly.exterior.coords)
    if line.length == 0:
        return np.asarray(poly.exterior.coords)

    num_samples = max(int(line.length / step), 1)
    distances = np.linspace(0, line.length, num_samples, endpoint=False)
    sampled = [line.interpolate(distance).coords[0] for distance in distances]
    coords = np.asarray(poly.exterior.coords)
    if sampled:
        coords = np.vstack([coords, np.asarray(sampled)])
    return coords


def _connector_width_from_tightness(tightness_percent: Optional[float]) -> float:
    tightness = 100.0 if tightness_percent is None else max(0.0, min(100.0, tightness_percent))
    min_width = 10.0
    max_width = max(min_width, BUFFER_DISTANCE_METERS * 0.05)
    factor = (100.0 - tightness) / 100.0
    return min_width + factor * (max_width - min_width)


def _build_connector_lines(components: Sequence[Polygon]) -> List[LineString]:
    polygons = [poly.buffer(0) for poly in components if not poly.is_empty]
    count = len(polygons)
    if count <= 1:
        return []

    edges: List[Tuple[float, int, int, Point, Point]] = []
    for i in range(count):
        for j in range(i + 1, count):
            distance = polygons[i].distance(polygons[j])
            if distance <= 0:
                continue
            point_a, point_b = nearest_points(polygons[i], polygons[j])
            edges.append((distance, i, j, point_a, point_b))

    if not edges:
        return []

    edges.sort(key=lambda item: item[0])
    parent = list(range(count))

    def find(idx: int) -> int:
        while parent[idx] != idx:
            parent[idx] = parent[parent[idx]]
            idx = parent[idx]
        return idx

    def union(a: int, b: int) -> None:
        root_a = find(a)
        root_b = find(b)
        if root_a != root_b:
            parent[root_b] = root_a

    connectors: List[LineString] = []
    for _, i, j, point_a, point_b in edges:
        if find(i) == find(j):
            continue
        coords_a = point_a.coords[0]
        coords_b = point_b.coords[0]
        if coords_a == coords_b:
            continue
        connectors.append(LineString([coords_a, coords_b]))
        union(i, j)

    return connectors


def _polygon_parts(geom: Polygon | MultiPolygon) -> List[List[Tuple[float, float]]]:
    if isinstance(geom, Polygon):
        parts = [list(geom.exterior.coords)]
        for interior in geom.interiors:
            parts.append(list(interior.coords))
        return parts
    if isinstance(geom, MultiPolygon):
        parts: List[List[Tuple[float, float]]] = []
        for poly in geom.geoms:
            parts.extend(_polygon_parts(poly))
        return parts
    raise ValueError("Expected polygon geometry")


def _build_filename(base_name: Optional[str], default: str, extension: str) -> str:
    sanitized = sanitize_export_filename(base_name, extension) if base_name else None
    if sanitized:
        return sanitized
    return f"{default}{extension}"


def _build_base_slug(base_name: Optional[str], default: str) -> str:
    filename = _build_filename(base_name, default, ".tmp")
    return os.path.splitext(filename)[0]


def _create_basic_kml(
    buffers: MultiPolygon,
    hull_geom: Polygon | MultiPolygon,
    buffer_color: str,
) -> bytes:
    doc = Kml()
    buffers_folder = doc.newfolder(name="3 km Buffers")
    outline_color = OUTLINE_COLOR
    outline_kml = _hex_to_kml_color(outline_color, 1.0)
    fill_kml = _hex_to_kml_color(buffer_color, FILL_OPACITY)

    for idx, polygon in enumerate(buffers.geoms, start=1):
        placemark = buffers_folder.newpolygon(name=f"Buffer {idx}")
        placemark.outerboundaryis.coords = list(polygon.exterior.coords)
        for interior in polygon.interiors:
            placemark.innerboundaryis.append(list(interior.coords))
        placemark.style.polystyle.color = fill_kml
        placemark.style.polystyle.fill = 1
        placemark.style.linestyle.color = outline_kml
        placemark.style.linestyle.width = OUTLINE_WIDTH

    hull_folder = doc.newfolder(name="Developed Area")

    if isinstance(hull_geom, MultiPolygon):
        if len(hull_geom.geoms) == 1:
            hull_geom = hull_geom.geoms[0]
        else:
            merged = hull_geom.buffer(0)
            hull_geom = merged if isinstance(merged, Polygon) else hull_geom.convex_hull

    polygon_geom = hull_geom if isinstance(hull_geom, Polygon) else hull_geom.convex_hull

    placemark = hull_folder.newpolygon(name="Developed Area")
    placemark.outerboundaryis.coords = list(polygon_geom.exterior.coords)
    for interior in polygon_geom.interiors:
        placemark.innerboundaryis.append(list(interior.coords))
    placemark.style.polystyle.color = fill_kml
    placemark.style.polystyle.fill = 1
    placemark.style.linestyle.color = outline_kml
    placemark.style.linestyle.width = OUTLINE_WIDTH

    return doc.kml().encode("utf-8")


def _create_kmz(kml_bytes: bytes) -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("doc.kml", kml_bytes)
    return output.getvalue()


def _compute_concave_hull(
    buffers: Sequence[Polygon],
    alpha: float,
    join_distance: float = HULL_JOIN_DISTANCE_METERS,
    perimeter_step: float = PERIMETER_SAMPLE_STEP,
) -> Polygon:
    if not buffers:
        raise HTTPException(status_code=400, detail="No buffer geometries available")

    merged = unary_union(buffers)
    base_polygons = _extract_polygons_from_geom(merged)
    if not base_polygons:
        raise HTTPException(status_code=400, detail="Unable to build base geometry for concave hull")

    perimeter_arrays: List[np.ndarray] = []
    for buffer_poly in buffers:
        perimeter_arrays.append(_sample_perimeter_points(buffer_poly, perimeter_step))

    all_points = np.vstack(perimeter_arrays)
    unique_points = np.unique(all_points, axis=0)
    if unique_points.shape[0] < 4:
        fallback = merged if isinstance(merged, Polygon) else merged.convex_hull
        return fallback.buffer(0)

    perimeter_points = [Point(xy) for xy in unique_points]

    try:
        hull_geom = alphashape.alphashape(perimeter_points, alpha)
    except Exception as exc:
        logger.warning("alphashape failed, using convex hull fallback", extra={"error": str(exc)})
        hull_geom = merged.convex_hull

    hull_polygons = _extract_polygons_from_geom(hull_geom)
    if not hull_polygons:
        hull_polygons = base_polygons

    if len(hull_polygons) > 1:
        filtered: List[Polygon] = []
        for poly in hull_polygons:
            distances = [poly.distance(other) for other in hull_polygons if other is not poly]
            min_distance = min(distances) if distances else float("inf")
            if min_distance < join_distance:
                filtered.append(poly)

        if filtered:
            hull_polygons = filtered
        else:
            hull_polygons = [max(hull_polygons, key=lambda p: p.area)]

    combined = unary_union([polygon.buffer(0) for polygon in hull_polygons])
    if isinstance(combined, MultiPolygon):
        combined = combined.buffer(0)
        if isinstance(combined, MultiPolygon):
            combined = combined.convex_hull

    developed = combined if isinstance(combined, Polygon) else combined.convex_hull

    for buffer_poly in buffers:
        if not developed.contains(buffer_poly):
            developed = developed.union(buffer_poly).buffer(0)

    if isinstance(developed, MultiPolygon):
        developed = max(developed.geoms, key=lambda g: g.area).buffer(0)

    return developed


def _create_basic_shapefile_zip(
    buffers: Sequence[Polygon],
    hull: Polygon | MultiPolygon,
    buffer_areas: Sequence[float],
    hull_area: float,
    base_slug: str,
    buffer_color: str,
) -> bytes:
    with tempfile.TemporaryDirectory() as tmpdir:
        shp_path = os.path.join(tmpdir, base_slug or "grazing")
        writer = shapefile.Writer(shp_path, shapeType=shapefile.POLYGON)
        writer.field("TYPE", "C", size=20)
        writer.field("AREA_HA", "F", decimal=2)
        writer.field("COLOR_HEX", "C", size=16)

        for idx, (poly, area) in enumerate(zip(buffers, buffer_areas), start=1):
            writer.poly(_polygon_parts(poly))
            writer.record(f"BUFFER_{idx}", round(area, 2), buffer_color)

        writer.poly(_polygon_parts(hull))
        writer.record("DEVELOPED_AREA", round(hull_area, 2), buffer_color)
        writer.close()

        prj_path = f"{shp_path}.prj"
        with open(prj_path, "w", encoding="utf-8") as prj_file:
            prj_file.write(
                'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],'
                'PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]]'
            )

        output = io.BytesIO()
        with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
            for ext in (".shp", ".shx", ".dbf", ".prj"):
                archive.write(f"{shp_path}{ext}", arcname=f"{base_slug}{ext}")
        return output.getvalue()


def _create_rings_kml(
    labels: List[str],
    weights: List[float],
    geoms: List[Polygon | MultiPolygon],
    colors: List[str],
    ring_hulls: List[Polygon | MultiPolygon],
) -> bytes:
    doc = Kml()
    rings_folder = doc.newfolder(name="Distance Rings")
    hulls_folder = doc.newfolder(name="Ring Convex Hulls")
    outer_label = labels[-1] if labels else ""

    for label, weight, geom, color in zip(labels, weights, geoms, colors):
        fill_kml = _hex_to_kml_color(color, FILL_OPACITY)
        stroke_color = OUTLINE_COLOR if label == outer_label else color
        stroke_alpha = 1.0 if label == outer_label else 0.0
        stroke_kml = _hex_to_kml_color(stroke_color, stroke_alpha)
        stroke_width = OUTLINE_WIDTH if label == outer_label else 0.0

        if isinstance(geom, MultiPolygon):
            for idx, poly in enumerate(geom.geoms, start=1):
                placemark = rings_folder.newpolygon(name=f"{label} km (part {idx})")
                placemark.outerboundaryis.coords = list(poly.exterior.coords)
                for interior in poly.interiors:
                    placemark.innerboundaryis.append(list(interior.coords))
                placemark.style.polystyle.color = fill_kml
                placemark.style.polystyle.fill = 1
                placemark.style.linestyle.color = stroke_kml
                placemark.style.linestyle.width = stroke_width
        else:
            placemark = rings_folder.newpolygon(name=f"{label} km")
            placemark.outerboundaryis.coords = list(geom.exterior.coords)
            for interior in geom.interiors:
                placemark.innerboundaryis.append(list(interior.coords))
            placemark.style.polystyle.color = fill_kml
            placemark.style.polystyle.fill = 1
            placemark.style.linestyle.color = stroke_kml
            placemark.style.linestyle.width = stroke_width

    for label, geom, color in zip(labels, ring_hulls, colors):
        stroke_kml = _hex_to_kml_color(color, 1.0)
        if isinstance(geom, MultiPolygon):
            for idx, poly in enumerate(geom.geoms, start=1):
                placemark = hulls_folder.newpolygon(name=f"{label} km Hull (part {idx})")
                placemark.outerboundaryis.coords = list(poly.exterior.coords)
                for interior in poly.interiors:
                    placemark.innerboundaryis.append(list(interior.coords))
                placemark.style.polystyle.fill = 0
                placemark.style.linestyle.color = stroke_kml
                placemark.style.linestyle.width = OUTLINE_WIDTH
        else:
            placemark = hulls_folder.newpolygon(name=f"{label} km Hull")
            placemark.outerboundaryis.coords = list(geom.exterior.coords)
            for interior in geom.interiors:
                placemark.innerboundaryis.append(list(interior.coords))
            placemark.style.polystyle.fill = 0
            placemark.style.linestyle.color = stroke_kml
            placemark.style.linestyle.width = OUTLINE_WIDTH

    return doc.kml().encode("utf-8")


def _create_rings_shapefile_zip(
    labels: List[str],
    weights: List[float],
    colors: List[str],
    geoms: List[Polygon | MultiPolygon],
    ring_hulls: List[Polygon | MultiPolygon],
    base_slug: str,
) -> bytes:
    with tempfile.TemporaryDirectory() as tmpdir:
        rings_path = os.path.join(tmpdir, f"{base_slug}_rings")
        ring_writer = shapefile.Writer(rings_path, shapeType=shapefile.POLYGON)
        ring_writer.field("CLASS_KM", "C", size=32)
        ring_writer.field("WEIGHT", "F", decimal=2)
        ring_writer.field("COLOR_HEX", "C", size=16)

        for label, weight, color, geom in zip(labels, weights, colors, geoms):
            ring_writer.poly(_polygon_parts(geom))
            ring_writer.record(label, weight, color)
        ring_writer.close()

        hull_path = os.path.join(tmpdir, f"{base_slug}_ring_hulls")
        hull_writer = shapefile.Writer(hull_path, shapeType=shapefile.POLYGON)
        hull_writer.field("CLASS_KM", "C", size=32)
        hull_writer.field("COLOR_HEX", "C", size=16)

        for label, color, geom in zip(labels, colors, ring_hulls):
            hull_writer.poly(_polygon_parts(geom))
            hull_writer.record(label, color)
        hull_writer.close()

        proj_wkt = (
            'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],'
            'PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]]'
        )
        for path in (rings_path, hull_path):
            with open(f"{path}.prj", "w", encoding="utf-8") as prj_file:
                prj_file.write(proj_wkt)

        output = io.BytesIO()
        with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
            for ext in (".shp", ".shx", ".dbf", ".prj"):
                archive.write(f"{rings_path}{ext}", arcname=f"{base_slug}_rings{ext}")
                archive.write(f"{hull_path}{ext}", arcname=f"{base_slug}_ring_hulls{ext}")
        return output.getvalue()


def _feature_collection_from_polygons(
    polygons: Iterable[Polygon],
    feature_type: str,
    color: Optional[str] = None,
    outline_color: Optional[str] = None,
    outline_width: Optional[float] = None,
    extra_props: Optional[Dict[str, Any]] = None,
) -> GrazingFeatureCollection:
    features: List[GrazingFeature] = []
    for idx, poly in enumerate(polygons, start=1):
        area = _calculate_area_ha(poly)
        props: Dict[str, Any] = {
            "type": feature_type,
            "name": f"{feature_type.title()} {idx}",
            "area_ha": round(area, 3),
        }
        if color:
            props["fill_color"] = color
        if outline_color:
            props["stroke_color"] = outline_color
        if outline_width is not None:
            props["stroke_width"] = outline_width
        if extra_props:
            props.update(extra_props)
        features.append(
            GrazingFeature(
                type="Feature",
                geometry=poly.__geo_interface__,
                properties=props,
            )
        )
    if not features:
        features.append(
            GrazingFeature(
                type="Feature",
                geometry={"type": "GeometryCollection", "geometries": []},
                properties={"type": feature_type, "area_ha": 0.0},
            )
        )
    return GrazingFeatureCollection(features=features)
def _run_basic_method(
    points: List[Point],
    boundary_wgs: MultiPolygon,
    boundary_metric: MultiPolygon,
    projected_points: Sequence[Point],
    base_name: Optional[str],
    buffer_color: str,
    tightness_percent: Optional[float],
) -> GrazingProcessResponse:
    projected_buffers = [point.buffer(BUFFER_DISTANCE_METERS) for point in projected_points]
    base_union_metric = unary_union(projected_buffers).buffer(0)
    buffer_union_metric = _ensure_multipolygon(base_union_metric)

    buffer_centroids = np.array([[poly.centroid.x, poly.centroid.y] for poly in projected_buffers], dtype=float)

    tightness = 100.0 if tightness_percent is None else max(0.0, min(100.0, tightness_percent))
    effective_percent = max(tightness, 1.0)

    if buffer_centroids.shape[0] > 1:
        try:
            nbrs = NearestNeighbors(n_neighbors=2).fit(buffer_centroids)
            distances, _ = nbrs.kneighbors(buffer_centroids)
            nearest = distances[:, 1]
            nearest = nearest[nearest > 0]
            mean_dist = float(np.mean(nearest)) if nearest.size else BUFFER_DISTANCE_METERS * 2
        except Exception as exc:
            logger.warning("Failed to compute nearest neighbour distances", extra={"error": str(exc)})
            mean_dist = BUFFER_DISTANCE_METERS * 2
    else:
        mean_dist = BUFFER_DISTANCE_METERS * 2

    base_alpha = 1.0 / max(mean_dist * 0.7, 1e-6)
    alpha_scale = effective_percent / 100.0
    used_alpha = float(np.clip(base_alpha / alpha_scale, ALPHA_MIN, ALPHA_MAX))

    components = _extract_polygons_from_geom(buffer_union_metric)
    connector_width = _connector_width_from_tightness(tightness_percent)
    connector_lines = _build_connector_lines(components)

    developed_metric = base_union_metric
    if connector_lines:
        connector_polys = [
            line.buffer(connector_width / 2.0, cap_style=2, join_style=2)
            for line in connector_lines
            if not line.is_empty and line.length > 0
        ]
        if connector_polys:
            connector_geom = unary_union(connector_polys)
            if not connector_geom.is_empty:
                developed_metric = unary_union([developed_metric, connector_geom]).buffer(0)

    concave_clipped = developed_metric.intersection(boundary_metric)
    if concave_clipped.is_empty:
        concave_clipped = developed_metric

    buffer_geodetic_polys = [_project_geometry(poly, forward=False).buffer(0) for poly in projected_buffers]
    concave_geodetic = _project_geometry(concave_clipped, forward=False)

    buffer_areas = [_calculate_area_ha(poly) for poly in buffer_geodetic_polys]
    concave_geom_final = concave_geodetic.buffer(0)
    if isinstance(concave_geom_final, MultiPolygon):
        concave_geom_final = max(concave_geom_final.geoms, key=lambda g: g.area).buffer(0)
    concave_area = _calculate_area_ha(concave_geom_final)

    buffer_features: List[GrazingFeature] = []
    for idx, (poly, area) in enumerate(zip(buffer_geodetic_polys, buffer_areas), start=1):
        buffer_features.append(
            GrazingFeature(
                type="Feature",
                geometry=poly.__geo_interface__,
                properties={
                    "type": "buffer",
                    "name": f"Buffer {idx}",
                    "area_ha": round(area, 3),
                    "fill_color": buffer_color,
                    "stroke_color": OUTLINE_COLOR,
                    "stroke_width": OUTLINE_WIDTH,
                },
            )
        )
    buffers_fc = GrazingFeatureCollection(features=buffer_features)
    concave_fc = GrazingFeatureCollection(
        features=[
            GrazingFeature(
                type="Feature",
                geometry=concave_geom_final.__geo_interface__,
                properties={
                    "type": "concave",
                    "name": "Developed Area",
                    "area_ha": round(concave_area, 3),
                    "fill_color": buffer_color,
                    "stroke_color": OUTLINE_COLOR,
                    "stroke_width": OUTLINE_WIDTH,
                },
            )
        ]
    )

    concave_merged = concave_geom_final

    if len(buffer_geodetic_polys) == 1:
        buffers_for_export = MultiPolygon([buffer_geodetic_polys[0]])
    else:
        buffers_for_export = MultiPolygon(buffer_geodetic_polys)

    kml_bytes = _create_basic_kml(buffers_for_export, concave_merged, buffer_color)
    kmz_bytes = _create_kmz(kml_bytes)
    shapefile_slug = _build_base_slug(base_name, "grazing-basic")
    shp_bytes = _create_basic_shapefile_zip(
        buffer_geodetic_polys,
        concave_merged,
        buffer_areas,
        concave_area,
        shapefile_slug,
        buffer_color,
    )

    kml_name = _build_filename(base_name, "grazing-basic", ".kml")
    kmz_name = _build_filename(base_name, "grazing-basic", ".kmz")
    shp_name = _build_filename(base_name, "grazing-basic", ".zip")

    downloads = {
        "kml": GrazingDownload(
            filename=kml_name,
            contentType="application/vnd.google-earth.kml+xml",
            data=base64.b64encode(kml_bytes).decode("utf-8"),
        ),
        "kmz": GrazingDownload(
            filename=kmz_name,
            contentType="application/vnd.google-earth.kmz",
            data=base64.b64encode(kmz_bytes).decode("utf-8"),
        ),
        "shp": GrazingDownload(
            filename=shp_name,
            contentType="application/zip",
            data=base64.b64encode(shp_bytes).decode("utf-8"),
        ),
    }

    summary = GrazingSummary(
        pointCount=len(points),
        bufferAreaHa=round(sum(buffer_areas), 3),
        convexAreaHa=round(concave_area, 3),
        concaveAlpha=round(used_alpha, 6),
        concaveTightness=round(tightness, 2),
    )

    logger.info(
        "Grazing basic run resolved alpha",
        extra={
            "tightness_percent": summary.concaveTightness,
            "alpha_value": summary.concaveAlpha,
            "mean_distance": round(mean_dist, 2),
            "point_count": len(points),
        },
    )

    return GrazingProcessResponse(
        method="basic",
        buffers=buffers_fc,
        convexHull=concave_fc,
        summary=summary,
        downloads=downloads,
    )


def _run_advanced_method(
    points: List[Point],
    boundary_wgs: MultiPolygon,
    boundary_metric: MultiPolygon,
    projected_points: Sequence[Polygon],
    base_name: Optional[str],
    ring_colors: Sequence[str],
) -> GrazingProcessResponse:
    union_pts_metric = unary_union(projected_points)
    outer_dists_m = [int(km * 1000) for km in ADVANCED_BREAKS_KM]
    outer_buffers = [union_pts_metric.buffer(dist) for dist in outer_dists_m]

    rings_metric: List[Polygon | MultiPolygon] = []
    previous = None
    for buf in outer_buffers:
        ring_geom = buf if previous is None else buf.difference(previous)
        previous = buf
        rings_metric.append(ring_geom)

    rings_metric = [ring.intersection(boundary_metric) for ring in rings_metric]

    clean_metric: List[MultiPolygon] = []
    clean_labels: List[str] = []
    clean_weights: List[float] = []
    clean_colors: List[str] = []
    for idx, ring in enumerate(rings_metric):
        ring_clean = ring.buffer(0)
        if ring_clean.is_empty:
            continue
        label = f"{ADVANCED_BREAKS_KM[idx-1]}–{ADVANCED_BREAKS_KM[idx]}" if idx > 0 else f"0–{ADVANCED_BREAKS_KM[idx]}"
        merged = _merge_polygons(_extract_polygons_from_geom(ring_clean))
        clean_metric.append(merged)
        clean_labels.append(label)
        clean_weights.append(ADVANCED_WEIGHTS[idx])
        clean_colors.append(ring_colors[idx] if idx < len(ring_colors) else ring_colors[-1])

    if not clean_metric:
        raise HTTPException(status_code=400, detail="Advanced ring buffers collapsed after clipping; no results to export")

    normalized_rings = [
        _merge_polygons(_extract_polygons_from_geom(_project_geometry(ring, forward=False).intersection(boundary_wgs)))
        for ring in clean_metric
    ]
    ring_areas = [_calculate_area_ha(ring) for ring in normalized_rings]

    ring_hulls_metric = [ring.convex_hull for ring in clean_metric]
    ring_hulls_geodetic = [
        _merge_polygons(_extract_polygons_from_geom(_project_geometry(hull, forward=False).intersection(boundary_wgs)))
        for hull in ring_hulls_metric
    ]
    ring_hull_areas = [_calculate_area_ha(hull) for hull in ring_hulls_geodetic]

    rings_fc = GrazingFeatureCollection(
        features=[
            GrazingFeature(
                type="Feature",
                geometry=geom.__geo_interface__,
                properties={
                    "type": "ring",
                    "name": f"{label} km",
                    "distance_class": label,
                    "weight": weight,
                    "area_ha": round(area, 3),
                    "fill_color": color,
                    "stroke_color": OUTLINE_COLOR if idx == len(normalized_rings) - 1 else color,
                    "stroke_width": OUTLINE_WIDTH if idx == len(normalized_rings) - 1 else 0.0,
                    "is_outer_ring": idx == len(normalized_rings) - 1,
                },
            )
            for idx, (label, weight, area, geom, color) in enumerate(
                zip(clean_labels, clean_weights, ring_areas, normalized_rings, clean_colors)
            )
        ]
    )

    ring_hulls_fc = GrazingFeatureCollection(
        features=[
            GrazingFeature(
                type="Feature",
                geometry=geom.__geo_interface__,
                properties={
                    "type": "ring_hull",
                    "name": f"{label} km Hull",
                    "distance_class": label,
                    "area_ha": round(area, 3),
                    "stroke_color": color,
                    "stroke_width": OUTLINE_WIDTH,
                },
            )
            for label, area, geom, color in zip(clean_labels, ring_hull_areas, ring_hulls_geodetic, clean_colors)
        ]
    )

    kml_bytes = _create_rings_kml(clean_labels, clean_weights, normalized_rings, clean_colors, ring_hulls_geodetic)
    kmz_bytes = _create_kmz(kml_bytes)
    shapefile_slug = _build_base_slug(base_name, "grazing-advanced")
    shp_bytes = _create_rings_shapefile_zip(clean_labels, clean_weights, clean_colors, normalized_rings, ring_hulls_geodetic, shapefile_slug)

    kml_name = _build_filename(base_name, "grazing-advanced", ".kml")
    kmz_name = _build_filename(base_name, "grazing-advanced", ".kmz")
    shp_name = _build_filename(base_name, "grazing-advanced", ".zip")

    downloads = {
        "kml": GrazingDownload(
            filename=kml_name,
            contentType="application/vnd.google-earth.kml+xml",
            data=base64.b64encode(kml_bytes).decode("utf-8"),
        ),
        "kmz": GrazingDownload(
            filename=kmz_name,
            contentType="application/vnd.google-earth.kmz",
            data=base64.b64encode(kmz_bytes).decode("utf-8"),
        ),
        "shp": GrazingDownload(
            filename=shp_name,
            contentType="application/zip",
            data=base64.b64encode(shp_bytes).decode("utf-8"),
        ),
    }

    ring_summaries = [
        {
            "label": label,
            "weight": weight,
            "areaHa": round(area, 3),
            "hullAreaHa": round(hull_area, 3),
            "colorHex": color,
        }
        for label, weight, area, hull_area, color in zip(
            clean_labels,
            clean_weights,
            ring_areas,
            ring_hull_areas,
            clean_colors,
        )
    ]

    summary = GrazingSummary(
        pointCount=len(points),
        bufferAreaHa=round(sum(ring_areas), 3),
        convexAreaHa=round(sum(ring_hull_areas), 3),
        ringClasses=ring_summaries,
    )

    return GrazingProcessResponse(
        method="advanced",
        rings=rings_fc,
        ringHulls=ring_hulls_fc,
        summary=summary,
        downloads=downloads,
    )


@router.post("/process", response_model=GrazingProcessResponse)
async def process_grazing_upload(
    file: UploadFile = File(...),
    method: str = Form("basic"),
    boundary: UploadFile = File(...),
    folderName: Optional[str] = Form(None),
    colorBasic: Optional[str] = Form(None),
    colorRing0: Optional[str] = Form(None),
    colorRing1: Optional[str] = Form(None),
    colorRing2: Optional[str] = Form(None),
    alphaBasic: Optional[float] = Form(None),
):
    method_normalized = method.strip().lower()
    if method_normalized not in {"basic", "advanced"}:
        raise HTTPException(status_code=400, detail="Method must be 'basic' or 'advanced'")

    points = _load_points_from_upload(file)
    if len(points) < 1:
        raise HTTPException(status_code=400, detail="At least one point is required")

    boundary_wgs, boundary_metric = _boundary_from_upload(boundary)
    if boundary_wgs is None or boundary_metric is None:
        raise HTTPException(status_code=400, detail="Boundary file could not be parsed")

    projected_points = [_project_geometry(point, forward=True) for point in points]

    if method_normalized == "basic":
        color = _normalize_hex(colorBasic or DEFAULT_BASIC_COLOR, DEFAULT_BASIC_COLOR)
        tightness_percent: Optional[float] = None
        if alphaBasic is not None:
            tightness_percent = max(0.0, min(100.0, alphaBasic))
        return _run_basic_method(
            points,
            boundary_wgs,
            boundary_metric,
            projected_points,
            folderName,
            color,
            tightness_percent,
        )

    ring_colors = [
        _normalize_hex(colorRing0 or DEFAULT_RING_COLORS[0], DEFAULT_RING_COLORS[0]),
        _normalize_hex(colorRing1 or DEFAULT_RING_COLORS[1], DEFAULT_RING_COLORS[1]),
        _normalize_hex(colorRing2 or DEFAULT_RING_COLORS[2], DEFAULT_RING_COLORS[2]),
    ]
    return _run_advanced_method(points, boundary_wgs, boundary_metric, projected_points, folderName, ring_colors)
