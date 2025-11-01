import base64
import io
import os
import zipfile
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from shapely.geometry import GeometryCollection, MultiPolygon, Point, Polygon, shape
from shapely.ops import transform, unary_union
from simplekml import Kml
from pyproj import Geod, Transformer
import shapefile  # type: ignore[import-untyped]
from fastkml import kml as fastkml  # type: ignore[import-untyped]

BUFFER_DISTANCE_METERS = 3000
SMOOTH_DISTANCE_METERS = 500

ADVANCED_BREAKS_KM = [0.5, 1.5, 3.0]
ADVANCED_WEIGHTS = [1.0, 0.75, 0.5]

ELLIPSOID = "GRS80"
GEOD = Geod(ellps=ELLIPSOID)
TO_METRIC = Transformer.from_crs("EPSG:4326", "EPSG:7855", always_xy=True)
TO_GEODETIC = Transformer.from_crs("EPSG:7855", "EPSG:4326", always_xy=True)

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
    ringClasses: List[Dict[str, Any]] = []


class GrazingProcessResponse(BaseModel):
    method: str
    buffers: Optional[GrazingFeatureCollection] = None
    convexHull: Optional[GrazingFeatureCollection] = None
    rings: Optional[GrazingFeatureCollection] = None
    summary: GrazingSummary
    downloads: Dict[str, GrazingDownload]


def _load_points_from_upload(file: UploadFile) -> List[Point]:
    filename = file.filename or ""
    content = file.file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    name_lower = filename.lower()
    if name_lower.endswith(".kmz"):
        return _points_from_kmz(content)
    if name_lower.endswith(".kml"):
        return _points_from_kml(content)
    if name_lower.endswith(".zip"):
        return _points_from_shapefile_zip(content)
    if name_lower.endswith(".shp"):
        raise HTTPException(
            status_code=400,
            detail="Upload shapefiles as a ZIP containing .shp, .shx, and .dbf files",
        )

    raise HTTPException(status_code=400, detail="Unsupported file type. Upload KML, KMZ, or zipped SHP.")


def _points_from_kmz(data: bytes) -> List[Point]:
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        kml_names = [name for name in archive.namelist() if name.lower().endswith(".kml")]
        if not kml_names:
            raise HTTPException(status_code=400, detail="KMZ did not contain a KML file")
        kml_data = archive.read(kml_names[0])
    return _points_from_kml(kml_data)


def _points_from_kml(data: bytes) -> List[Point]:
    doc = fastkml.KML()
    try:
        doc.from_string(data)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Unable to parse KML: {exc}") from exc

    points: List[Point] = []

    def _extract(container):
        for feature in getattr(container, "features", lambda: [])():
            geometry = getattr(feature, "geometry", None)
            if geometry is not None:
                shapely_geom = shape(geometry)
                points.extend(_extract_points_from_geom(shapely_geom))
            if hasattr(feature, "features"):
                _extract(feature)

    _extract(doc)

    if not points:
        raise HTTPException(status_code=400, detail="No point features found in KML")
    return points


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


def _points_from_shapefile_zip(data: bytes) -> List[Point]:
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
        raise HTTPException(status_code=400, detail="No polygon geometry found in boundary file")
    merged = unary_union(valid)
    if isinstance(merged, Polygon):
        return MultiPolygon([merged])
    if isinstance(merged, MultiPolygon):
        return merged
    raise HTTPException(status_code=400, detail="Boundary file did not contain polygon geometry")


def _boundary_from_kml(data: bytes) -> MultiPolygon:
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
                shapely_geom = shape(geometry)
                polygons.extend(_extract_polygons_from_geom(shapely_geom))
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
            raise HTTPException(status_code=400, detail="Boundary shapefile ZIP must contain .shp, .shx, and .dbf files")

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


def _load_boundary_from_upload(file: UploadFile | None) -> Tuple[MultiPolygon | None, MultiPolygon | None]:
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
        boundary_wgs = _boundary_from_kml(content)
    elif name_lower.endswith(".kml"):
        boundary_wgs = _boundary_from_kml(content)
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
    return area_m2 / 10_000


def _create_basic_kml(buffers: MultiPolygon, convex: Polygon) -> bytes:
    doc = Kml()
    buffer_folder = doc.newfolder(name="Grazing Buffers 3km")
    for idx, polygon in enumerate(buffers.geoms, start=1):
        placemark = buffer_folder.newpolygon(name=f"Buffer {idx}")
        placemark.outerboundaryis.coords = list(polygon.exterior.coords)
        for interior in polygon.interiors:
            placemark.innerboundaryis.append(list(interior.coords))
    hull_folder = doc.newfolder(name="Smoothed Convex Hull")
    hull = hull_folder.newpolygon(name="Smoothed Hull")
    hull.outerboundaryis.coords = list(convex.exterior.coords)
    for interior in convex.interiors:
        hull.innerboundaryis.append(list(interior.coords))
    return doc.kml().encode("utf-8")


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


def _create_basic_shapefile_zip(buffers: MultiPolygon, convex: Polygon, buffer_areas: List[float], convex_area: float) -> bytes:
    import tempfile

    with tempfile.TemporaryDirectory() as tmpdir:
        shp_path = os.path.join(tmpdir, "grazing")
        writer = shapefile.Writer(shp_path, shapeType=shapefile.POLYGON)
        writer.field("TYPE", "C", size=20)
        writer.field("AREA_HA", "F", decimal=2)

        for idx, (poly, area) in enumerate(zip(buffers.geoms, buffer_areas), start=1):
            writer.poly(_polygon_parts(poly))
            writer.record(f"BUFFER_{idx}", round(area, 2))

        writer.poly(_polygon_parts(convex))
        writer.record("CONVEX", round(convex_area, 2))
        writer.close()

        # Write WGS84 projection file
        prj_path = f"{shp_path}.prj"
        with open(prj_path, "w", encoding="utf-8") as prj_file:
            prj_file.write(
                'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],'
                'PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]]'
            )

        output = io.BytesIO()
        with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
            for ext in (".shp", ".shx", ".dbf", ".prj"):
                filename = f"grazing{ext}"
                archive.write(f"{shp_path}{ext}", arcname=filename)

        return output.getvalue()


def _create_kmz(kml_bytes: bytes) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("grazing.kml", kml_bytes)
    return buffer.getvalue()


def _create_rings_kml(labels: List[str], weights: List[float], geoms: List[Polygon | MultiPolygon]) -> bytes:
    doc = Kml()
    folder = doc.newfolder(name="Grazing Water Zones")
    for label, weight, geom in zip(labels, weights, geoms):
        if isinstance(geom, MultiPolygon):
            for idx, poly in enumerate(geom.geoms, start=1):
                placemark = folder.newpolygon(name=f"{label} km (part {idx})")
                placemark.description = f"Weight: {weight}"
                placemark.outerboundaryis.coords = list(poly.exterior.coords)
                for interior in poly.interiors:
                    placemark.innerboundaryis.append(list(interior.coords))
        else:
            placemark = folder.newpolygon(name=f"{label} km")
            placemark.description = f"Weight: {weight}"
            placemark.outerboundaryis.coords = list(geom.exterior.coords)
            for interior in geom.interiors:
                placemark.innerboundaryis.append(list(interior.coords))
    return doc.kml().encode("utf-8")


def _create_rings_shapefile_zip(
    labels: List[str],
    weights: List[float],
    areas: List[float],
    geoms: List[Polygon | MultiPolygon],
) -> bytes:
    import tempfile

    with tempfile.TemporaryDirectory() as tmpdir:
        shp_path = os.path.join(tmpdir, "grazing_rings")
        writer = shapefile.Writer(shp_path, shapeType=shapefile.POLYGON)
        writer.field("CLASS_KM", "C", size=32)
        writer.field("WEIGHT", "F", decimal=2)
        writer.field("AREA_HA", "F", decimal=2)

        for label, weight, area, geom in zip(labels, weights, areas, geoms):
            writer.poly(_polygon_parts(geom))
            writer.record(label, round(weight, 2), round(area, 2))

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
                filename = f"grazing_rings{ext}"
                archive.write(f"{shp_path}{ext}", arcname=filename)

        return output.getvalue()


def _feature_collection_from_polygons(polygons: Iterable[Polygon], feature_type: str) -> GrazingFeatureCollection:
    features: List[GrazingFeature] = []
    for idx, poly in enumerate(polygons, start=1):
        area = _calculate_area_ha(poly)
        features.append(
            GrazingFeature(
                type="Feature",
                geometry=poly.__geo_interface__,
                properties={
                    "type": feature_type,
                    "name": f"{feature_type.title()} {idx}",
                    "area_ha": round(area, 3),
                },
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


@router.post("/process", response_model=GrazingProcessResponse)
async def process_grazing_upload(
    file: UploadFile = File(...),
    method: str = Form("basic"),
    boundary: UploadFile | None = File(None),
):
    method_normalized = method.strip().lower()
    if method_normalized not in {"basic", "advanced"}:
        raise HTTPException(status_code=400, detail="Method must be 'basic' or 'advanced'")

    if boundary is None:
        raise HTTPException(status_code=400, detail="Boundary file is required for grazing processing")

    points = _load_points_from_upload(file)
    if len(points) < 1:
        raise HTTPException(status_code=400, detail="At least one point is required")

    boundary_wgs, boundary_metric = _load_boundary_from_upload(boundary)
    if boundary_wgs is None or boundary_metric is None:
        raise HTTPException(status_code=400, detail="Failed to read boundary geometry")

    projected_points = [_project_geometry(point, forward=True) for point in points]

    if method_normalized == "basic":
        projected_buffers = [point.buffer(BUFFER_DISTANCE_METERS) for point in projected_points]
        buffer_union_metric = unary_union(projected_buffers)
        buffer_union_metric = _ensure_multipolygon(buffer_union_metric)

        convex_metric = unary_union(projected_buffers).convex_hull
        smoothed_metric = convex_metric.buffer(SMOOTH_DISTANCE_METERS).buffer(-SMOOTH_DISTANCE_METERS)
        if smoothed_metric.is_empty:
            raise HTTPException(status_code=400, detail="Unable to create smoothed convex hull from the supplied points")

        if boundary_metric is not None:
            clipped_buffers = buffer_union_metric.intersection(boundary_metric)
            if clipped_buffers.is_empty:
                raise HTTPException(status_code=400, detail="Buffer results lie outside the supplied boundary")
            buffer_union_metric = _ensure_multipolygon(clipped_buffers)

            smoothed_metric = smoothed_metric.intersection(boundary_metric)
            if smoothed_metric.is_empty:
                raise HTTPException(status_code=400, detail="Convex hull lies outside the supplied boundary")

        buffer_geodetic = _ensure_multipolygon(_project_geometry(buffer_union_metric, forward=False))
        smoothed_geodetic = _project_geometry(smoothed_metric, forward=False)
        if isinstance(smoothed_geodetic, MultiPolygon):
            smoothed_geodetic = unary_union(smoothed_geodetic)
            if isinstance(smoothed_geodetic, MultiPolygon):
                smoothed_geodetic = smoothed_geodetic.convex_hull

        if boundary_wgs is not None:
            buffer_geodetic = _ensure_multipolygon(buffer_geodetic.intersection(boundary_wgs))
            smoothed_geodetic = smoothed_geodetic.intersection(boundary_wgs)

        buffer_areas = [_calculate_area_ha(poly) for poly in buffer_geodetic.geoms]
        convex_area = _calculate_area_ha(smoothed_geodetic)

        buffers_fc = _feature_collection_from_polygons(buffer_geodetic.geoms, "buffer")
        convex_fc = _feature_collection_from_polygons([smoothed_geodetic], "convex")

        kml_bytes = _create_basic_kml(buffer_geodetic, smoothed_geodetic)
        kmz_bytes = _create_kmz(kml_bytes)
        shp_bytes = _create_basic_shapefile_zip(buffer_geodetic, smoothed_geodetic, buffer_areas, convex_area)

        downloads = {
            "kml": GrazingDownload(
                filename="grazing_buffers.kml",
                contentType="application/vnd.google-earth.kml+xml",
                data=base64.b64encode(kml_bytes).decode("utf-8"),
            ),
            "kmz": GrazingDownload(
                filename="grazing_buffers.kmz",
                contentType="application/vnd.google-earth.kmz",
                data=base64.b64encode(kmz_bytes).decode("utf-8"),
            ),
            "shp": GrazingDownload(
                filename="grazing_buffers.zip",
                contentType="application/zip",
                data=base64.b64encode(shp_bytes).decode("utf-8"),
            ),
        }

        summary = GrazingSummary(
            pointCount=len(points),
            bufferAreaHa=round(sum(buffer_areas), 3),
            convexAreaHa=round(convex_area, 3),
        )

        return GrazingProcessResponse(
            method="basic",
            buffers=buffers_fc,
            convexHull=convex_fc,
            summary=summary,
            downloads=downloads,
        )

    # Advanced method
    union_pts_metric = unary_union(projected_points)
    outer_dists_m = [int(km * 1000) for km in ADVANCED_BREAKS_KM]
    outer_buffers = [union_pts_metric.buffer(dist) for dist in outer_dists_m]

    rings_metric = []
    previous = None
    for buf in outer_buffers:
        ring_geom = buf if previous is None else buf.difference(previous)
        previous = buf
        rings_metric.append(ring_geom)

    if boundary_metric is not None:
        rings_metric = [ring.intersection(boundary_metric) for ring in rings_metric]

    clean_rings_metric = []
    clean_weights = []
    clean_labels = []
    for idx, ring in enumerate(rings_metric):
        if idx == 0:
            label = f"0–{ADVANCED_BREAKS_KM[idx]}"
        else:
            label = f"{ADVANCED_BREAKS_KM[idx-1]}–{ADVANCED_BREAKS_KM[idx]}"
        ring_clean = ring.buffer(0)
        if not ring_clean.is_empty:
            clean_rings_metric.append(ring_clean)
            clean_weights.append(ADVANCED_WEIGHTS[idx])
            clean_labels.append(label)

    if not clean_rings_metric:
        raise HTTPException(status_code=400, detail="Advanced ring buffers collapsed after clipping; no results to export")

    rings_geodetic_raw = [_project_geometry(ring, forward=False) for ring in clean_rings_metric]
    normalized_rings: List[MultiPolygon] = []
    normalized_labels: List[str] = []
    normalized_weights: List[float] = []
    for label, weight, geom in zip(clean_labels, clean_weights, rings_geodetic_raw):
        extracted = _extract_polygons_from_geom(geom)
        if not extracted:
            continue
        merged = _merge_polygons(extracted)
        normalized_rings.append(merged)
        normalized_labels.append(label)
        normalized_weights.append(weight)

    if not normalized_rings:
        raise HTTPException(status_code=400, detail="Advanced ring buffers collapsed after clipping; no results to export")

    ring_areas = [_calculate_area_ha(ring) for ring in normalized_rings]

    ring_features = []
    for label, weight, geom, area in zip(normalized_labels, normalized_weights, normalized_rings, ring_areas):
        ring_features.append(
            GrazingFeature(
                type="Feature",
                geometry=geom.__geo_interface__,
                properties={
                    "type": "ring",
                    "name": f"{label} km",
                    "distance_class": label,
                    "weight": weight,
                    "area_ha": round(area, 3),
                },
            )
        )
    rings_fc = GrazingFeatureCollection(features=ring_features)

    rings_kml = _create_rings_kml(normalized_labels, normalized_weights, normalized_rings)
    rings_kmz = _create_kmz(rings_kml)
    rings_shp = _create_rings_shapefile_zip(normalized_labels, normalized_weights, ring_areas, normalized_rings)

    ring_summaries = [
        {"label": label, "weight": weight, "areaHa": round(area, 3)}
        for label, weight, area in zip(normalized_labels, normalized_weights, ring_areas)
    ]

    downloads = {
        "kml": GrazingDownload(
            filename="grazing_rings.kml",
            contentType="application/vnd.google-earth.kml+xml",
            data=base64.b64encode(rings_kml).decode("utf-8"),
        ),
        "kmz": GrazingDownload(
            filename="grazing_rings.kmz",
            contentType="application/vnd.google-earth.kmz",
            data=base64.b64encode(rings_kmz).decode("utf-8"),
        ),
        "shp": GrazingDownload(
            filename="grazing_rings.zip",
            contentType="application/zip",
            data=base64.b64encode(rings_shp).decode("utf-8"),
        ),
    }

    summary = GrazingSummary(
        pointCount=len(points),
        bufferAreaHa=round(sum(ring_areas), 3),
        convexAreaHa=0.0,
        ringClasses=ring_summaries,
    )

    return GrazingProcessResponse(
        method="advanced",
        rings=rings_fc,
        summary=summary,
        downloads=downloads,
    )
