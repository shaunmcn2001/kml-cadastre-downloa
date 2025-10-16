from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_ui_endpoint_returns_html_page():
    response = client.get("/ui")

    assert response.status_code == 200
    assert "Download KML" in response.text
    assert "fileName" in response.text
    assert response.headers["content-type"].startswith("text/html")

