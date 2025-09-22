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

    default_payload = {
        'features': [
            {
                'attributes': {
                    'cadid': '123456',
                    'lotidstring': '1/DP123456',
                    'lotnumber': '1',
                    'planlabel': 'DP123456',
                    'locality': 'SYDNEY'
                }
            }
        ]
    }

    captured['payload'] = default_payload

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
            return MockResponse(captured['payload'])

        async def aclose(self):
            return None

    async def immediate_sleep(*args, **kwargs):
        return None

    monkeypatch.setattr("app.arcgis.asyncio.sleep", immediate_sleep)
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
    assert '1/DP123456' in result['label']
    assert 'LOT 1 DP123456' in result['label'].upper()
    assert result['lot'] == '1'
    assert result['plan'] == 'DP123456'
    assert result['address'] == '1/DP123456'

    params = mocked_httpx['params']
    assert params['returnGeometry'] == 'false'
    assert 'lotidstring' in params['outFields']
    assert 'planlabel' in params['outFields']
    assert params['orderByFields'] == 'lotidstring ASC'
    assert "UPPER(lotidstring) LIKE '%GEORGE%STREET%'" in params['where']
    assert "UPPER(lotnumber) LIKE '%GEORGE%STREET%'" in params['where']
    assert "UPPER(planlabel) LIKE '%GEORGE%STREET%'" in params['where']
    assert 'plannumber' not in params['where']


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


def test_search_endpoint_arcgis_error(mocked_httpx):
    mocked_httpx['payload'] = {
        'error': {
            'code': 500,
            'message': 'Service unavailable'
        }
    }

    payload = {
        'state': 'NSW',
        'term': 'George Street'
    }

    response = client.post("/api/search", json=payload)
    assert response.status_code == 502
    body = response.json()
    assert body['error'] == 'Service unavailable'
