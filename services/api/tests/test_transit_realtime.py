import httpx
from contextlib import contextmanager
from tests.test_api import fresh_app

def test_real_protobuf_feed_exposes_age_and_rejects_invalid_coordinates(tmp_path, monkeypatch):
    fresh_app(tmp_path, 'open')
    from app import transit
    from google.transit import gtfs_realtime_pb2
    feed=gtfs_realtime_pb2.FeedMessage()
    feed.header.gtfs_realtime_version='2.0'
    feed.header.timestamp=1
    for label,lat in [('valid',40.94),('invalid',999)]:
        entity=feed.entity.add();entity.id=label
        entity.vehicle.position.latitude=lat;entity.vehicle.position.longitude=14.27
        entity.vehicle.timestamp=1
    class Client:
        def __init__(self, **kwargs):pass
        def __enter__(self):return self
        def __exit__(self,*args):pass
        @contextmanager
        def stream(self,method,url):
            yield httpx.Response(200,content=feed.SerializeToString(),request=httpx.Request(method,url))
    monkeypatch.setattr(transit.httpx,'Client',Client)
    result=transit.realtime_vehicles('https://operator.test/feed.pb')
    assert [v['id'] for v in result['vehicles']]==['valid']
    assert result['freshness']=='stale' and result['ageS']>300
    assert result['retrievedAt'] and result['feedTimestamp']==1
