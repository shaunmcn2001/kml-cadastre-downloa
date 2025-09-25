from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_ui_endpoint_returns_html_page():
    response = client.get("/ui")

    assert response.status_code == 200
    assert "KML Downloads UI" in response.text
    assert response.headers["content-type"].startswith("text/html")

