import httpx
from tests.test_api import fresh_app


def test_environment_partial_failure_recovers_and_preserves_product_time(tmp_path, monkeypatch):
    fresh_app(tmp_path, 'open')
    from app import providers
    providers._cache.clear()
    providers._health.clear()
    failed = [True]
    def response(url, **kwargs):
        assert kwargs['params']['timeformat'] == 'unixtime'
        if 'air-quality' in url and failed[0]:
            return httpx.Response(503, request=httpx.Request('GET', url))
        return httpx.Response(200, request=httpx.Request('GET', url), json={
            'current': {'time': 1791540000, 'interval': 900, 'weather_code': 63, 'precipitation': 1},
            'current_units': {'precipitation': 'mm'}})
    monkeypatch.setattr(providers.httpx, 'get', response)
    result = providers.weather_and_air(40.94, 14.27)
    assert result['status'] == 'partial' and 'air' not in result
    assert result['weather']['validAt'] != result['weather']['retrievedAt']
    assert result['weather']['values']['interval'] == 900
    assert result['weather']['provenance'] == 'modelled'
    failed[0] = False
    recovered = providers.weather_and_air(40.94, 14.27)
    assert recovered['status'] == 'ok' and recovered['air']

def test_provider_cache_is_bounded_and_weather_http_failure_is_not_success(tmp_path, monkeypatch):
    fresh_app(tmp_path, 'open')
    from app import providers
    for i in range(300):
        providers._cached(str(i), 60, lambda: {'status': 'ok'})
    assert len(providers._cache) == 128
    monkeypatch.setattr(providers.httpx, 'get', lambda url, **kwargs: httpx.Response(503, request=httpx.Request('GET', url), json={'error': 'maintenance'}))
    result=providers.weather_and_air(40.94165,14.2745)
    assert result['status']=='error' and '503' in result['message']
    assert 'weather' not in result


def test_here_retains_capture_time_and_never_invents_flow_counts(tmp_path, monkeypatch):
    fresh_app(tmp_path, 'open')
    from app import providers
    providers._cache.clear()
    providers._health.clear()
    monkeypatch.setattr(providers, 'provider_secret', lambda name: 'test-contract-key')
    payload = {'results': [{'currentFlow': {'speed': 5, 'freeFlow': 10, 'confidence': .8},
        'location': {'shape': {'links': [{'points': [{'lng': 14.27, 'lat': 40.94}, {'lng': 14.271, 'lat': 40.94}]}]}}}]}
    monkeypatch.setattr(providers.httpx, 'get', lambda url, **kwargs: httpx.Response(200, request=httpx.Request('GET', url), json=payload))
    result = providers.here_flow([14.26, 40.93, 14.28, 40.95])
    assert result['capturedAt'] is None and result['freshness'] == 'unknown'
    properties = result['features'][0]['properties']
    assert properties['speedKmh'] == 18
    assert properties['flowVph'] is None and properties['densityVehKm'] is None
    assert properties['retrievedAt'] and properties['capturedAt'] is None
    providers._cache.clear()
    payload['sourceUpdated'] = '2020-01-01T00:00:00Z'
    assert providers.here_flow([14.26, 40.93, 14.28, 40.95])['freshness'] == 'stale'
    providers._cache.clear()
    payload['results'][0]['currentFlow']['speed'] = -1
    assert providers.here_flow([14.26, 40.93, 14.28, 40.95])['features'] == []


def test_here_rate_limit_has_cooldown_and_no_success_payload(tmp_path, monkeypatch):
    fresh_app(tmp_path, 'open')
    from app import providers
    providers._cache.clear()
    providers._health.clear()
    monkeypatch.setattr(providers, 'provider_secret', lambda name: 'test-contract-key')
    calls = []
    def limited(url, **kwargs):
        calls.append(url)
        return httpx.Response(429, request=httpx.Request('GET', url), headers={'Retry-After': '60'})
    monkeypatch.setattr(providers.httpx, 'get', limited)
    for _ in range(2):
        result = providers.here_flow([14.26, 40.93, 14.28, 40.95])
        assert result['status'] == 'error' and result['features'] == []
    assert len(calls) == 1
    assert providers._health['here']['rateLimited'] is True
    assert providers._health['here']['connected'] is False
