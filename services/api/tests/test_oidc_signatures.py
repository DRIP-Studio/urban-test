import time
import pytest
import jwt
from cryptography.hazmat.primitives.asymmetric import rsa
from tests.test_api import fresh_app

@pytest.fixture
def verifier(tmp_path,monkeypatch):
    fresh_app(tmp_path,"protected")
    from app.platform import auth
    key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
    class Client:
        def get_signing_key_from_jwt(self,token):
            class Key:
                pass
            k=Key();k.key=key.public_key();return k
    monkeypatch.setitem(auth._jwks_clients,"https://issuer.test/jwks",Client())
    return auth,key,{"issuer":"https://issuer.test","clientId":"urban"},{"jwks_uri":"https://issuer.test/jwks"}

def test_signed_oidc_and_bound_access(verifier):
    auth,key,p,meta=verifier;now=int(time.time());claims={"iss":p["issuer"],"sub":"user","aud":"urban","iat":now,"exp":now+300}
    token=jwt.encode(claims,key,algorithm="RS256");assert auth.verify_oidc_jwt(token,p,meta)["sub"]=="user"
    access=jwt.encode({**claims,"aud":"account","azp":"urban"},key,algorithm="RS256");assert auth.verify_oidc_jwt(access,p,meta,access=True)["azp"]=="urban"
    for change in [{"iss":"https://attacker.test"},{"aud":"other"},{"exp":now-120},{"aud":["urban","other"],"azp":"other"}]:
        with pytest.raises(PermissionError):auth.verify_oidc_jwt(jwt.encode({**claims,**change},key,algorithm="RS256"),p,meta)

def test_unsigned_and_forged_signature_cannot_grant_admin(verifier):
    auth,key,p,meta=verifier;claims={"iss":p["issuer"],"sub":"attacker","aud":"urban","iat":int(time.time()),"exp":int(time.time())+300,"roles":["admin"]}
    with pytest.raises(PermissionError):auth.verify_oidc_jwt(jwt.encode(claims,"",algorithm="none"),p,meta)
    other=rsa.generate_private_key(public_exponent=65537,key_size=2048)
    with pytest.raises(PermissionError):auth.verify_oidc_jwt(jwt.encode(claims,other,algorithm="RS256"),p,meta)
