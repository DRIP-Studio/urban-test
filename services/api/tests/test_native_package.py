import io,json,zipfile
import pytest
from tests.test_api import fresh_app

def rewrite(data,change):
    out=io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(data)) as original,zipfile.ZipFile(out,"w") as target:
        for info in original.infolist():target.writestr(info.filename,change(info.filename,original.read(info)))
    return out.getvalue()

def test_native_manifest_integrity_v1_migration_and_atomic_rejection(tmp_path):
    client=fresh_app(tmp_path/"data","open")
    pid=client.post('/api/projects',json={"template":"frattamaggiore","name":"Native package"}).json()["id"]
    from app.projects import service
    data=service.export_package(pid)
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        manifest=json.loads(z.read('PACKAGE.json'));assert manifest['schemaVersion']==2 and 'baseline.json.gz' in manifest['files']
    imported=service.import_package(data,'QA');assert imported['id']!=pid and imported['packageVersion']==2
    count=len(service.list_projects())
    corrupted=rewrite(data,lambda name,payload:payload+b' ' if name=='project.json' else payload)
    with pytest.raises(ValueError,match='Integrità'):service.import_package(corrupted,'QA')
    unsupported=rewrite(data,lambda name,payload:json.dumps({**json.loads(payload),'schemaVersion':99}).encode() if name=='PACKAGE.json' else payload)
    with pytest.raises(ValueError,match='versione'):service.import_package(unsupported,'QA')
    assert len(service.list_projects())==count and not list(service.SETTINGS.projects_dir.glob('.import-*'))
    legacy=rewrite(data,lambda name,payload:json.dumps({'format':'drip-urban-project','schemaVersion':1}).encode() if name=='PACKAGE.json' else payload)
    old=service.import_package(legacy,'QA');assert service.get_doc(old['id'],'migration')['packageMigration']['to']==2

def test_native_package_rejects_invalid_nested_operation_schema_before_staging(tmp_path):
    client=fresh_app(tmp_path/"schema-data","open")
    pid=client.post('/api/projects',json={"template":"frattamaggiore","name":"Schema checks"}).json()["id"]
    from app.projects import service
    data=service.export_package(pid)
    legacy=rewrite(data,lambda name,payload:json.dumps({'format':'drip-urban-project','schemaVersion':1}).encode() if name=='PACKAGE.json' else payload)
    bad=rewrite(legacy,lambda name,payload:json.dumps({**json.loads(payload),'operations':[{'id':'bad','type':'batch','payload':{'ops':[{'type':'road.update','payload':'invalid'}]}}]}).encode() if name=='scenarios/scenario-a.json' else payload)
    count=len(service.list_projects())
    with pytest.raises(ValueError,match='Schema operazione'):service.import_package(bad,'QA')
    assert len(service.list_projects())==count and not list(service.SETTINGS.projects_dir.glob('.import-*'))
