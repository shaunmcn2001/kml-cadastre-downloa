import xml.etree.ElementTree as ET

from app.exports.kml import export_kml
from app.models import Feature, FeatureProperties, ParcelState, StyleOptions


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


def test_export_kml_applies_default_opacity_and_stroke_width():
    polygon = {
        "type": "Polygon",
        "coordinates": [
            [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]],
        ],
    }

    kml_output = export_kml([
        _build_feature(polygon)
    ], StyleOptions(colorByState=False))

    namespace = {"kml": "http://www.opengis.net/kml/2.2"}
    root = ET.fromstring(kml_output.encode("utf-8"))
    color = root.find(".//kml:Style/kml:PolyStyle/kml:color", namespace).text
    width = float(root.find(".//kml:Style/kml:LineStyle/kml:width", namespace).text)

    assert color == "66ff0000"  # 0.4 opacity applied to default blue fill
    assert width == 3.0


def test_export_kml_uses_custom_fill_and_stroke_colors():
    polygon = {
        "type": "Polygon",
        "coordinates": [
            [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]],
        ],
    }

    style_options = StyleOptions(
        colorByState=False,
        fillColor="#FFA500",
        strokeColor="#123456",
        fillOpacity=0.4,
        strokeWidth=3,
    )

    kml_output = export_kml([_build_feature(polygon)], style_options)

    namespace = {"kml": "http://www.opengis.net/kml/2.2"}
    root = ET.fromstring(kml_output.encode("utf-8"))
    fill_color = root.find(".//kml:Style/kml:PolyStyle/kml:color", namespace).text
    stroke_color = root.find(".//kml:Style/kml:LineStyle/kml:color", namespace).text

    assert fill_color == "6600a5ff"  # #FFA500 with 0.4 opacity
    assert stroke_color == "ff563412"  # #123456 with full opacity


def test_export_kml_honours_state_colours_when_color_by_state_enabled():
    polygon = {
        "type": "Polygon",
        "coordinates": [
            [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]],
        ],
    }

    style_options = StyleOptions(
        colorByState=True,
        fillColor="#00FF00",
        strokeColor="#FF0000",
    )

    kml_output = export_kml([_build_feature(polygon)], style_options)

    namespace = {"kml": "http://www.opengis.net/kml/2.2"}
    root = ET.fromstring(kml_output.encode("utf-8"))
    fill_color = root.find(".//kml:Style/kml:PolyStyle/kml:color", namespace).text

    assert fill_color == "66ff0000"  # NSW state colour with default opacity
