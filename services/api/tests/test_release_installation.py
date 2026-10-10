import hashlib
import importlib.util
import zipfile
from pathlib import Path
import pytest

spec = importlib.util.spec_from_file_location('release_installer', Path(__file__).resolve().parents[3] / 'tools/windows/update_package.py')
installer = importlib.util.module_from_spec(spec); spec.loader.exec_module(installer)

def package(tmp, extra=None):
    path = tmp / 'release.zip'
    with zipfile.ZipFile(path, 'w') as z:
        z.writestr('services/api/app/main.py', 'new API')
        z.writestr('apps/web/dist/index.html', 'new UI')
        for name, value in (extra or {}).items(): info = zipfile.ZipInfo(); info.filename = name; z.writestr(info, value)
    return path, hashlib.sha256(path.read_bytes()).hexdigest()

def test_install_and_restore_mid_install_failure(tmp_path, monkeypatch):
    root = tmp_path / 'installation'; root.mkdir()
    api = root / 'services/api/app/main.py'; api.parent.mkdir(parents=True); api.write_text('old API')
    data = root / '.data'; data.mkdir(); (data / 'project.json').write_text('user data')
    pkg, digest = package(tmp_path)
    replace = installer.os.replace
    def fail_ui(source, target):
        if str(source).endswith('index.html.drip-install'): raise OSError('simulated disk failure')
        return replace(source, target)
    monkeypatch.setattr(installer.os, 'replace', fail_ui)
    with pytest.raises(RuntimeError, match='ripristinati'):
        installer.install(root, pkg, digest, tmp_path / 'backup.zip', data)
    assert api.read_text() == 'old API' and (data / 'project.json').read_text() == 'user data'
    assert not (root / 'apps/web/dist/index.html').exists()
    monkeypatch.setattr(installer.os, 'replace', replace)
    result = installer.install(root, pkg, digest, tmp_path / 'backup2.zip', data)
    assert result['installedFiles'] == 2 and api.read_text() == 'new API'

@pytest.mark.parametrize('name', ['../escape.py', 'C:/escape.py', '.data/projects/secret', '.venv/lib/file'])
def test_reject_before_mutation(tmp_path, name):
    root = tmp_path / 'installation'; root.mkdir()
    pkg, digest = package(tmp_path, {name: 'bad'})
    with pytest.raises(ValueError): installer.install(root, pkg, digest, tmp_path / 'backup.zip', root / '.data')
    assert not list(root.iterdir())


def test_requested_rollback_restores_old_files_and_removes_only_release_creations(tmp_path):
    root=tmp_path/"installation";root.mkdir()
    api=root/"services/api/app/main.py";api.parent.mkdir(parents=True);api.write_text("old API")
    data=root/".data";data.mkdir();(data/"project.json").write_text("saved project")
    pkg,digest=package(tmp_path,{"apps/new-file.txt":"release addition"})
    backup=tmp_path/"previous.zip"
    receipt=installer.install(root,pkg,digest,backup,data)
    installer.install(root,backup,receipt["backupSha256"],tmp_path/"rollback-backup.zip",data,
                      remove=receipt["createdFiles"],require_release=False)
    assert api.read_text()=="old API" and not (root/"apps/new-file.txt").exists()
    assert not (root/"apps/web/dist/index.html").exists() and (data/"project.json").read_text()=="saved project"
