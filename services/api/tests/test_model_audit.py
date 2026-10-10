import json,struct
import pytest
from app.model_audit import audit_model

def glb(doc):
    payload=json.dumps(doc).encode();payload+=b' '*((-len(payload))%4)
    return b'glTF'+struct.pack('<II',2,20+len(payload))+struct.pack('<II',len(payload),0x4e4f534a)+payload

def test_measures_geometry_and_rejects_corrupt_import():
    doc={'asset':{'version':'2.0'},'accessors':[{'count':900000,'min':[0,0,0],'max':[1,1,1]}],'meshes':[{'primitives':[{'attributes':{'POSITION':0}}]}],'materials':[{}]}
    result=audit_model(glb(doc),'.glb');assert result['triangles']==300000 and result['materialCount']==1 and result['warnings']
    with pytest.raises(ValueError,match='lunghezza'):audit_model(glb(doc)[:-4],'.glb')
    with pytest.raises(ValueError,match='Texture esterna'):audit_model(glb({**doc,'images':[{'uri':'https://example.test/image.png'}]}),'.glb')
    with pytest.raises(ValueError,match='ciclica'):audit_model(glb({**doc,'nodes':[{'children':[0]}]}),'.glb')
    with pytest.raises(ValueError,match='Accessor|accessor'):audit_model(glb({**doc,'accessors':[]}),'.glb')

    with pytest.raises(ValueError,match='BufferView'):audit_model(glb({**doc,'accessors':[{'count':3,'bufferView':999}]}),'.glb')
    with pytest.raises(ValueError,match='mesh inesistente'):audit_model(glb({**doc,'nodes':[{'mesh':999}]}),'.glb')
