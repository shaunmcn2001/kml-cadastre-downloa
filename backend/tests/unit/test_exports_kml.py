import xml.etree.ElementTree as ET

from app.exports.kml import export_kml
from app.models import Feature, FeatureProperties, ParcelState


def _build_feature(geometry):
    return Feature(
        geometry=geometry,
        properties=FeatureProperties(
            id="123",
            state=ParcelState.NSW,
            name="Test Lot",
        ),
    )


def _count_kml_elements(kml_str: str, tag: str) -> int:
    namespace = {"kml": "http://www.opengis.net/kml/2.2"}
    root = ET.fromstring(kml_str.encode("utf-8"))
    return len(root.findall(f".//kml:{tag}", namespace))


def test_export_kml_includes_all_polygons_from_multipolygon_geometry():
    multipolygon = {
        "type": "MultiPolygon",
        "coordinates": [
            [
                [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]],
            ],
            [
                [[2, 2], [3, 2], [3, 3], [2, 3], [2, 2]],
            ],
        ],
    }

    kml_output = export_kml([_build_feature(multipolygon)])

    assert _count_kml_elements(kml_output, "Placemark") == 2
    assert _count_kml_elements(kml_output, "Polygon") == 2


def test_export_kml_preserves_single_polygon_geometry():
    polygon = {
        "type": "Polygon",
        "coordinates": [
            [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]],
        ],
    }

    kml_output = export_kml([_build_feature(polygon)])

    assert _count_kml_elements(kml_output, "Placemark") == 1
    assert _count_kml_elements(kml_output, "Polygon") == 1
