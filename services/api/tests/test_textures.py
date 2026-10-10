import io
import zipfile
from PIL import Image
from tests.test_api import fresh_app

def test_texture_validation_deduplication_and_package_roundtrip(tmp_path):
    client = fresh_app(tmp_path, 'open')
    pid = client.post('/api/projects', json={'template': 'frattamaggiore', 'name': 'Textures'}).json()['id']
    png = io.BytesIO(); Image.new('RGB', (32, 16), '#426599').save(png, format='PNG')
    data = png.getvalue()
    def upload(): return client.post(f'/api/projects/{pid}/textures', files={'file': ('facade.png', data, 'image/png')})
    first = upload(); assert first.status_code == 200
    tid = first.json()['id']; assert upload().json()['id'] == tid
    assert client.get(f'/api/projects/{pid}/textures/{tid}').headers['content-type'] == 'image/png'
    assert client.post(f'/api/projects/{pid}/textures', files={'file': ('bad.png', b'not an image', 'image/png')}).status_code == 400
    from app.projects import service as ps
    package = ps.export_package(pid)
    assert f'textures/{tid}.png' in zipfile.ZipFile(io.BytesIO(package)).namelist()
    restored = ps.import_package(package, 'test')
    assert client.get(f'/api/projects/{restored["id"]}/textures/{tid}').status_code == 200
