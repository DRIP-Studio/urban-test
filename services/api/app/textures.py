"""Validated, content-addressed project images; exported with the project package."""
from __future__ import annotations
import hashlib
import io
import re
import warnings
from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from PIL import Image
from app.projects import service as ps
from app.storage import atomic_write_bytes

router = APIRouter()

@router.post('/api/projects/{pid}/textures')
async def upload_texture(pid: str, file: UploadFile = File(...)) -> dict:
    try:
        ps.get_meta(pid)
    except ps.NotFound as exc:
        raise HTTPException(404, str(exc)) from exc
    raw = await file.read(20 * 1024 * 1024 + 1)
    if len(raw) > 20 * 1024 * 1024:
        raise HTTPException(413, 'Immagine troppo grande: massimo 20 MB')
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            image = Image.open(io.BytesIO(raw))
            if image.format not in {'PNG', 'JPEG', 'WEBP'} or image.width * image.height > 32_000_000:
                raise ValueError('Formato o dimensioni non supportati')
            image.load()
            output = io.BytesIO()
            image.convert('RGBA').save(output, format='PNG')
            data = output.getvalue()
    except Exception as exc:
        raise HTTPException(400, 'Carica un PNG, JPEG o WebP valido, fino a 32 megapixel') from exc
    tid = 'tex-' + hashlib.sha256(data).hexdigest()[:24]
    atomic_write_bytes(ps.project_dir(pid) / 'textures' / f'{tid}.png', data)
    return {'id': tid, 'width': image.width, 'height': image.height, 'sizeBytes': len(data)}

@router.get('/api/projects/{pid}/textures/{tid}')
def texture(pid: str, tid: str) -> FileResponse:
    try:
        ps.get_meta(pid)
    except ps.NotFound as exc:
        raise HTTPException(404, str(exc)) from exc
    if not re.fullmatch(r'tex-[a-f0-9]{24}', tid):
        raise HTTPException(404)
    path = ps.project_dir(pid) / 'textures' / f'{tid}.png'
    if not path.is_file():
        raise HTTPException(404)
    return FileResponse(path, media_type='image/png', headers={'Cache-Control': 'private, max-age=31536000, immutable'})
