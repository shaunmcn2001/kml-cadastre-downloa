import os
import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

class TestAPIEndpoints:
    
    def test_health_check(self):
        """Test health check endpoint."""
        response = client.get("/healthz")
        assert response.status_code == 200
        
        data = response.json()
        assert data["status"] == "ok"
        assert "timestamp" in data
    
    def test_parse_endpoint_nsw(self):
        """Test parse endpoint with NSW data."""
        payload = {
            "state": "NSW",
            "rawText": "1//DP131118\n2//DP131118"
        }
        
        response = client.post("/api/parse", json=payload)
        assert response.status_code == 200
        
        data = response.json()
        assert len(data["valid"]) == 2
        assert len(data["malformed"]) == 0
        assert data["valid"][0]["state"] == "NSW"
    
    def test_parse_endpoint_invalid_state(self):
        """Test parse endpoint with invalid state."""
        payload = {
            "state": "INVALID",
            "rawText": "1//DP131118"
        }
        
        response = client.post("/api/parse", json=payload)
        assert response.status_code == 422  # Validation error
    
    def test_parse_endpoint_malformed_data(self):
        """Test parse endpoint with malformed data."""
        payload = {
            "state": "NSW", 
            "rawText": "invalid_format\nanother_invalid"
        }
        
        response = client.post("/api/parse", json=payload)
        assert response.status_code == 200
        
        data = response.json()
        assert len(data["valid"]) == 0
        assert len(data["malformed"]) == 2
    
    def test_query_endpoint_no_ids(self):
        """Test query endpoint with no IDs."""
        payload = {
            "states": ["NSW"],
            "ids": []
        }
        
        response = client.post("/api/query", json=payload)
        assert response.status_code == 400
    
    def test_query_endpoint_too_many_ids(self):
        """Test query endpoint with too many IDs."""
        payload = {
            "states": ["NSW"],
            "ids": [f"id_{i}" for i in range(1001)]  # Over limit
        }
        
        response = client.post("/api/query", json=payload)
        assert response.status_code == 400
    
    def test_export_endpoints_no_features(self):
        """Test export endpoints with no features."""
        payload = {
            "features": [],
            "styleOptions": {}
        }

        # Test KML
        response = client.post("/api/kml", json=payload)
        assert response.status_code == 400

        # Test KMZ
        response = client.post("/api/kmz", json=payload)
        assert response.status_code == 400

        # Test GeoTIFF
        response = client.post("/api/geotiff", json=payload)
        assert response.status_code == 400

    @pytest.mark.skipif(not os.getenv("RUN_NETWORK_TESTS"), reason="Network tests disabled")
    def test_search_endpoint_live(self):
        """Exercise the live NSW search endpoint when network tests are enabled."""
        payload = {
            "state": "NSW",
            "term": "Sydney",
            "pageSize": 5
        }

        response = client.post("/api/search", json=payload, timeout=30)
        assert response.status_code == 200

        data = response.json()
        assert isinstance(data, list)
        if data:
            assert data[0]["state"] == "NSW"
