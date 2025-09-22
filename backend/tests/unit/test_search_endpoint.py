import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.utils.cache import get_cache

client = TestClient(app)


@pytest.fixture(autouse=True)
def clear_cache():
    cache = get_cache()
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def mocked_httpx(monkeypatch):
    captured = {}

    class MockResponse:
        status_code = 200

        def __init__(self, data):
            self._data = data

        def raise_for_status(self):
            return None

        def json(self):
            return self._data

    class MockAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def get(self, url, params=None):
            captured['url'] = url
            captured['params'] = params
            data = {
                'features': [
                    {
                        'attributes': {
                            'cadid': '123456',
                            'primaryaddress': '1 GEORGE STREET',
                            'lotnumber': '1',
                            'plannumber': 'DP123456',
                            'locality': 'SYDNEY'
                        }
                    }
                ]
            }
            return MockResponse(data)

        async def aclose(self):
            return None

    monkeypatch.setattr("app.arcgis.httpx.AsyncClient", MockAsyncClient)
    return captured


def test_search_endpoint_success(mocked_httpx):
    payload = {
        'state': 'NSW',
        'term': 'George Street',
        'page': 1,
        'pageSize': 5
    }

    response = client.post("/api/search", json=payload)
    assert response.status_code == 200

    data = response.json()
    assert isinstance(data, list)
    assert len(data) == 1

    result = data[0]
    assert result['id'] == '123456'
    assert result['state'] == 'NSW'
    assert 'GEORGE' in result['label'].upper()
    assert result['lot'] == '1'
    assert result['plan'] == 'DP123456'

    params = mocked_httpx['params']
    assert params['returnGeometry'] == 'false'
    assert 'primaryaddress' in params['outFields']
    assert "UPPER(primaryaddress) LIKE '%GEORGE%" in params['where']


def test_search_endpoint_non_nsw():
    payload = {
        'state': 'QLD',
        'term': 'George',
        'page': 1,
        'pageSize': 5
    }

    response = client.post("/api/search", json=payload)
    assert response.status_code == 400


def test_search_endpoint_short_term():
    payload = {
        'state': 'NSW',
        'term': 'A',
    }

    response = client.post("/api/search", json=payload)
    assert response.status_code == 422
