"""Trusted deployment policy adapter. No guessed central API or client-authored policy.

A central management agent/deployer may atomically supply DRIP_URBAN_POLICY_FILE.
That file has the same trust boundary as process environment/configuration. The last
accepted revision is retained if delivery goes offline; local HTTP edits cannot clear it.
"""
from __future__ import annotations
import os
from copy import deepcopy
from pathlib import Path
from app.settings import SETTINGS
from app.storage import read_json,atomic_write_json

ACTIONS={"identity.manage","keys.manage","providers.manage","license.manage","updates.manage","users.manage","services.manage","platform.manage"}

def _cache():return SETTINGS.settings_dir/"managed-policy.json"

def validate(document:dict)->dict:
    from .config import EDITABLE
    if not isinstance(document,dict) or document.get("schema")!="drip-urban-policy" or document.get("version")!=1:
        raise ValueError("Policy centrale: schema/versione non valida")
    if not isinstance(document.get("revision"),int) or document["revision"]<1 or not str(document.get("organisation") or "").strip():
        raise ValueError("Policy centrale: organizzazione o revisione mancante")
    locked=document.get("locked",{});denied=document.get("denyActions",[])
    if not isinstance(locked,dict) or any(k not in EDITABLE for k in locked) or not isinstance(denied,list) or any(a not in ACTIONS for a in denied):
        raise ValueError("Policy centrale: impostazioni o azioni sconosciute")
    for key,value in locked.items():
        if key=="authMode" and value not in {"protected","open"} or key=="defaultRole" and value not in {"admin","publisher","editor","viewer"} or key=="licenseEnforcement" and value not in {"soft","strict"}:
            raise ValueError(f"Policy centrale: {key} non valido")
        if key=="sessionHours" and (not isinstance(value,(int,float)) or isinstance(value,bool) or not 1<=value<=168):raise ValueError("Policy centrale: durata sessione non valida")
        if key=="localLogin" and not isinstance(value,bool):raise ValueError("Policy centrale: localLogin deve essere booleano")
        if key in {"platformUrl","fstUrl"} and not str(value).startswith("https://"):raise ValueError("Policy centrale: URL richiede HTTPS")
        if key=="updates" and (not isinstance(value,dict) or value.get("channel","stable") not in {"stable","beta"} or not isinstance(value.get("autoCheck",True),bool)):raise ValueError("Policy centrale: aggiornamenti non validi")
        if key=="identityProviders" and (not isinstance(value,list) or any(not isinstance(p,dict) or not p.get("id") or p.get("issuer") and not str(p["issuer"]).startswith("https://") for p in value)):raise ValueError("Policy centrale: provider non validi")
        if key=="services" and (not isinstance(value,list) or any(not isinstance(s,dict) or not s.get("id") or not s.get("label") or s.get("url") and not str(s["url"]).startswith("https://") for s in value)):raise ValueError("Policy centrale: servizi non validi")
        if key=="roleMapping" and (not isinstance(value,dict) or any(r not in {"admin","publisher","editor","viewer"} for r in value.values())):raise ValueError("Policy centrale: ruoli non validi")
    return deepcopy(document)

def current()->dict|None:
    cached=read_json(_cache(),None)
    path=os.environ.get("DRIP_URBAN_POLICY_FILE")
    if not path:return validate(cached) if cached else None
    supplied=read_json(Path(path),None)
    if supplied is None:
        if cached:return validate(cached)
        raise PermissionError("Policy centrale configurata ma non disponibile; accesso locale bloccato")
    supplied=validate(supplied)
    if cached and supplied["revision"]<cached["revision"]:raise PermissionError("Policy centrale: revisione precedente rifiutata")
    if cached and supplied["revision"]==cached["revision"] and supplied!=cached:raise PermissionError("Policy centrale: una revisione pubblicata è immutabile")
    if supplied!=cached:atomic_write_json(_cache(),supplied)
    return supplied

def metadata(document:dict|None=None)->dict:
    p=document if document is not None else current()
    return {"managed":bool(p),"organisation":p.get("organisation") if p else None,"revision":p.get("revision") if p else None,"lockedKeys":list(p.get("locked",{})) if p else [],"denyActions":p.get("denyActions",[]) if p else [],"transport":"deployment-file" if p else None}

def overlay(cfg:dict)->dict:
    p=current()
    if p:
        for key,value in p.get("locked",{}).items():cfg[key]=deepcopy(value)
    cfg["management"]=metadata(p)
    return cfg

def check_patch(patch:dict)->None:
    p=current()
    if not p:return
    actions={"identityProviders":"identity.manage","authMode":"identity.manage","defaultRole":"identity.manage","roleMapping":"identity.manage","sessionHours":"identity.manage","localLogin":"identity.manage","services":"services.manage","updates":"updates.manage","licenseEnforcement":"license.manage","wms":"providers.manage"}
    if any(actions.get(k) in p.get("denyActions",[]) for k in patch):raise PermissionError("Gestione centrale: modifica locale vietata dalla policy")
    locked=p.get("locked",{})
    forbidden=[k for k,v in patch.items() if k in locked and v!=locked[k]]
    if forbidden:raise PermissionError("Gestione centrale: impostazioni bloccate: "+", ".join(forbidden))

def check_request(path:str)->None:
    p=current()
    if not p:return
    action="platform.manage" if path.startswith("/api/platform/config") else "keys.manage" if path.startswith("/api/platform/keys") else "identity.manage" if path.startswith("/api/auth/oidc") else "users.manage" if path.startswith("/api/auth/users") else "license.manage" if path.startswith("/api/license/") and not path.endswith("/refresh") else "updates.manage" if path.startswith("/api/update/") and not path.endswith("/check") else "providers.manage" if path.startswith("/api/providers/") else None
    if action and action in p.get("denyActions",[]):raise PermissionError("Gestione centrale: azione locale bloccata ("+action+")")
