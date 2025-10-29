import importlib
import json
import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _sample_feature_collection():
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [
                        [
                            [153.0, -27.0],
                            [153.0, -27.1],
                            [153.1, -27.1],
                            [153.1, -27.0],
                            [153.0, -27.0],
                        ]
                    ],
                },
                "properties": {
                    "code": "LT01",
                    "name": "Land Type 01",
                    "example_prop": "Example",
                },
            }
        ],
    }


def test_landtype_health():
    response = client.get("/landtype/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


@pytest.mark.parametrize(
    "export_format, expected_type, expected_suffix",
    [
        ("kml", "application/vnd.google-earth.kml+xml", ".kml"),
        ("kmz", "application/vnd.google-earth.kmz", ".kmz"),
        ("geojson", "application/geo+json", ".geojson"),
        ("tiff", "image/tiff", ".tif"),
    ],
)
def test_landtype_export_formats(export_format, expected_type, expected_suffix):
    payload = {
        "features": _sample_feature_collection(),
        "format": export_format,
        "styleOptions": {"colorMode": "preset", "presetName": "subjects", "alpha": 180},
        "filenameTemplate": "Test Export",
    }
    response = client.post("/landtype/export", json=payload)
    assert response.status_code == 200
    assert response.headers["content-type"].startswith(expected_type)
    disposition = response.headers.get("content-disposition")
    if disposition:
        assert expected_suffix in disposition
    assert len(response.content) > 0

    if export_format == "kmz":
        assert response.content.startswith(b"PK")
    if export_format == "geojson":
        data = json.loads(response.content)
        assert data["features"][0]["properties"]["landtype_color"].startswith("#")


def test_landtype_geojson_lotplan(monkeypatch):
    def fake_fetch_parcel_geojson(lotplan: str):
        return {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [
                            [
                                [153.0, -27.0],
                                [153.0, -27.1],
                                [153.1, -27.1],
                                [153.1, -27.0],
                                [153.0, -27.0],
                            ]
                        ],
                    },
                    "properties": {"lotplan": lotplan},
                }
            ],
        }

    def fake_fetch_landtypes(bounds):
        return {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [
                            [
                                [153.0, -27.0],
                                [153.0, -27.05],
                                [153.05, -27.05],
                                [153.05, -27.0],
                                [153.0, -27.0],
                            ]
                        ],
                    },
                    "properties": {"code": "LT01", "name": "Land Type"},
                }
            ],
        }

    router_module = importlib.import_module("app.landtype.router")
    monkeypatch.setattr(router_module, "fetch_parcel_geojson", fake_fetch_parcel_geojson)
    monkeypatch.setattr(
        router_module,
        "fetch_landtypes_intersecting_envelope",
        fake_fetch_landtypes,
    )
    from shapely.geometry import Polygon

    sample_geom = Polygon(
        [
            (153.0, -27.0),
            (153.0, -27.05),
            (153.05, -27.05),
            (153.05, -27.0),
        ]
    )

    def fake_prepare(parcel_fc, thematic_fc):
        return [(sample_geom, "LT01", "Land Type", 1.23)]

    monkeypatch.setattr(router_module, "prepare_clipped_shapes", fake_prepare)

    response = client.get("/landtype/geojson", params={"lotplans": "1RP12345"})
    assert response.status_code == 200
    data = response.json()
    assert data["type"] == "FeatureCollection"
    assert len(data["features"]) == 1
    feature_props = data["features"][0]["properties"]
    assert feature_props["code"] == "LT01"
    assert feature_props["lotplan"] == "1RP12345"
    assert feature_props["style"]["fillColor"].startswith("#")
    legend = data["properties"]["legend"]
    assert legend and legend[0]["code"] == "LT01"
