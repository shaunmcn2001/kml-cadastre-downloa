import json
from fastapi.testclient import TestClient
import pytest

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
        ("geojson", "application/geo+json", ".json"),
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

    monkeypatch.setattr("app.landtype.router.fetch_parcel_geojson", fake_fetch_parcel_geojson)
    monkeypatch.setattr("app.landtype.router.fetch_landtypes_intersecting_envelope", fake_fetch_landtypes)

    response = client.get("/landtype/geojson", params={"lotplans": "1RP12345"})
    assert response.status_code == 200
    data = response.json()
    assert data["type"] == "FeatureCollection"
    assert len(data["features"]) == 1
