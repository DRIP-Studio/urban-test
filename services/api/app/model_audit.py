"""Measured budgets and structural validation for self-contained glTF 2.0."""
import base64
import io
import json
import math
import struct
from PIL import Image


def audit_model(raw: bytes, ext: str) -> dict:
    binary = b""
    if ext == ".glb":
        if len(raw) < 20 or struct.unpack_from("<4sII", raw)[0:2] != (b"glTF", 2) or struct.unpack_from("<I", raw, 8)[0] != len(raw):
            raise ValueError("Header/versione/lunghezza GLB non validi")
        offset, chunks = 12, []
        while offset < len(raw):
            if offset + 8 > len(raw):
                raise ValueError("Chunk GLB incompleto")
            length, kind = struct.unpack_from("<II", raw, offset)
            offset += 8
            if length % 4 or offset + length > len(raw):
                raise ValueError("Chunk GLB fuori file o disallineato")
            chunks.append((kind, raw[offset:offset + length]))
            offset += length
        if not chunks or chunks[0][0] != 0x4E4F534A or len(chunks) > 2 or len(chunks) == 2 and chunks[1][0] != 0x004E4942:
            raise ValueError("Chunk JSON/BIN GLB non validi")
        doc = json.loads(chunks[0][1])
        binary = chunks[1][1] if len(chunks) > 1 else b""
    else:
        doc = json.loads(raw)
    if not isinstance(doc, dict) or doc.get("asset", {}).get("version") != "2.0":
        raise ValueError("Modello richiede glTF 2.0")
    buffers = []
    for index, buf in enumerate(doc.get("buffers", [])):
        uri = buf.get("uri")
        if uri:
            if not uri.startswith("data:") or ";base64," not in uri:
                raise ValueError("Buffer esterno: esporta GLB autonomo")
            value = base64.b64decode(uri.split(",", 1)[1], validate=True)
        elif index == 0 and ext == ".glb":
            value = binary
        else:
            raise ValueError("Buffer del modello mancante")
        if type(buf.get("byteLength")) is not int or not 0 <= buf["byteLength"] <= len(value):
            raise ValueError("Dimensione buffer non valida")
        buffers.append(value)
    views = doc.get("bufferViews", [])
    for view in views:
        index, start, length = view.get("buffer"), view.get("byteOffset", 0), view.get("byteLength")
        if type(index) is not int or not 0 <= index < len(buffers) or type(start) is not int or start < 0 or type(length) is not int or length < 0 or start + length > len(buffers[index]):
            raise ValueError("BufferView fuori buffer")
    accessors = doc.get("accessors", [])
    for accessor in accessors:
        if type(accessor.get("count")) is not int or not 0 <= accessor["count"] <= 50_000_000:
            raise ValueError("Conteggio accessor non valido")
        if "bufferView" in accessor and (type(accessor["bufferView"]) is not int or not 0 <= accessor["bufferView"] < len(views)):
            raise ValueError("Accessor riferisce BufferView inesistente")
        if any(not isinstance(v, (int, float)) or not math.isfinite(v) for key in ("min", "max") for v in accessor.get(key, [])):
            raise ValueError("Bounding box non finita")
    triangles, primitives = 0, 0
    for mesh in doc.get("meshes", []):
        for primitive in mesh.get("primitives", []):
            primitives += 1
            attributes = primitive.get("attributes", {})
            if type(attributes.get("POSITION")) is not int or not 0 <= attributes["POSITION"] < len(accessors):
                raise ValueError("Primitive senza accessor POSITION valido")
            if any(type(index) is not int or not 0 <= index < len(accessors) for index in attributes.values()):
                raise ValueError("Attributo mesh riferisce accessor inesistente")
            if "material" in primitive and (type(primitive["material"]) is not int or not 0 <= primitive["material"] < len(doc.get("materials", []))):
                raise ValueError("Materiale della primitive inesistente")
            index = primitive.get("indices", primitive.get("attributes", {}).get("POSITION"))
            if type(index) is not int or not 0 <= index < len(accessors):
                raise ValueError("Primitive senza accessor valido")
            count, mode = accessors[index]["count"], primitive.get("mode", 4)
            triangles += count // 3 if mode == 4 else max(0, count - 2) if mode in (5, 6) else 0
    nodes = doc.get("nodes", [])
    visited, active = set(), set()

    def visit(index):
        if type(index) is not int or not 0 <= index < len(nodes) or index in active:
            raise ValueError("Gerarchia nodi glTF non valida o ciclica")
        if index in visited:
            return
        active.add(index)
        node = nodes[index]
        if "mesh" in node and (type(node["mesh"]) is not int or not 0 <= node["mesh"] < len(doc.get("meshes", []))):
            raise ValueError("Nodo riferisce mesh inesistente")
        for key, size in (("translation", 3), ("rotation", 4), ("scale", 3), ("matrix", 16)):
            if key in node and (not isinstance(node[key], list) or len(node[key]) != size or any(not isinstance(v, (int, float)) or not math.isfinite(v) for v in node[key])):
                raise ValueError("Trasformazione nodo non valida")
        for child in node.get("children", []):
            visit(child)
        active.remove(index)
        visited.add(index)

    for index in range(len(nodes)):
        visit(index)
    textures = []
    for image in doc.get("images", []):
        if "uri" in image:
            uri = image["uri"]
            if not uri.startswith("data:image/") or ";base64," not in uri:
                raise ValueError("Texture esterna: incorpora le immagini nel GLB")
            payload = base64.b64decode(uri.split(",", 1)[1], validate=True)
        elif type(image.get("bufferView")) is int and 0 <= image["bufferView"] < len(views):
            view = views[image["bufferView"]]
            start = view.get("byteOffset", 0)
            payload = buffers[view["buffer"]][start:start + view["byteLength"]]
        else:
            raise ValueError("Texture senza dati incorporati")
        try:
            with Image.open(io.BytesIO(payload)) as decoded:
                w, h = decoded.size
                if w > 16384 or h > 16384 or w * h > 64_000_000:
                    raise ValueError("Texture oltre budget 16k/64 megapixel")
                decoded.verify()
        except (OSError, Image.DecompressionBombError) as exc:
            raise ValueError("Texture non decodificabile (PNG/JPEG/WebP supportati)") from exc
        textures.append({"width": w, "height": h, "bytes": len(payload)})
    warnings = []
    if triangles > 250000:
        warnings.append(f"{triangles:,} triangoli: preferire LOD per istanze numerose")
    if len(doc.get("materials", [])) > 128:
        warnings.append("Oltre 128 materiali: aumentano draw call e costo caricamento")
    if any(max(t["width"], t["height"]) > 4096 for t in textures):
        warnings.append("Texture oltre 4k: ridurre per qualità editor")
    if len(raw) > 20 * 1024 * 1024:
        warnings.append("Asset oltre 20 MB: caricamento e istanze da verificare nel Twin")
    return {"triangles": triangles, "primitives": primitives, "materialCount": len(doc.get("materials", [])), "textures": textures, "nodeCount": len(nodes), "orientation": "glTF Y-up; trasformazioni dei nodi", "warnings": warnings, "method": "Conteggi dagli accessor e immagini incorporate decodificate; non validazione completa Khronos"}
