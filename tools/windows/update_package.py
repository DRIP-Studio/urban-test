"""Validated staged release installation with restoration on failure.

Only called before serving the application. User data is never a release target.
"""
from __future__ import annotations
import hashlib
import os
import shutil
import tempfile
import zipfile
from pathlib import Path, PurePosixPath

PROTECTED = {'.venv', '.git', 'node_modules', '.data', 'data', 'projects', 'settings',
             'user-data', '.cache', '.shots', 'test-results', '__pycache__'}

def install(root: Path, package: Path, sha256: str, backup: Path, data_dir: Path,
            prepare=None, remove=(), require_release=True) -> dict:
    root = root.resolve(); data_dir = data_dir.resolve()
    if hashlib.sha256(package.read_bytes()).hexdigest() != sha256:
        raise ValueError('Impronta SHA-256 non valida')
    with tempfile.TemporaryDirectory(prefix='drip-release-') as temporary:
        stage = Path(temporary) / 'stage'; stage.mkdir()
        files = []; seen = set(); total = 0
        with zipfile.ZipFile(package) as archive:
            for item in archive.infolist():
                name = item.filename; rel = PurePosixPath(name)
                if ('\\' in name or ':' in name or rel.is_absolute() or '..' in rel.parts
                    or '\0' in name or item.flag_bits & 1
                    or (item.external_attr >> 16) & 0o170000 == 0o120000):
                    raise ValueError('Percorso del pacchetto non sicuro')
                if item.is_dir(): continue
                key = name.casefold()
                if key in seen: raise ValueError('Percorso duplicato nel pacchetto')
                seen.add(key)
                target = (root / name).resolve()
                if not target.is_relative_to(root): raise ValueError('Percorso fuori installazione')
                if any(p.casefold() in PROTECTED for p in rel.parts) or target.is_relative_to(data_dir):
                    raise ValueError('Il pacchetto tenta di sostituire dati protetti')
                total += item.file_size
                if total > 2 * 1024**3: raise ValueError('Pacchetto espanso troppo grande')
                destination = stage / name; destination.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(item) as source, destination.open('wb') as output:
                    shutil.copyfileobj(source, output)
                files.append(name)
        if require_release and not {'services/api/app/main.py', 'apps/web/dist/index.html'} <= set(files):
            raise ValueError('Pacchetto incompleto: API o interfaccia mancante')
        removals = []
        for name in remove:
            rel = PurePosixPath(name); target = (root / name).resolve()
            if ('\\' in name or ':' in name or rel.is_absolute() or '..' in rel.parts
                or not target.is_relative_to(root) or target.is_relative_to(data_dir)
                or any(p.casefold() in PROTECTED for p in rel.parts)):
                raise ValueError('Percorso di ripristino non sicuro')
            if name not in files: removals.append(name)
        # Preparation runs before the installation is changed (e.g. dependency check).
        if prepare: prepare(stage)
        backup.parent.mkdir(parents=True, exist_ok=True)
        originals = set()
        with zipfile.ZipFile(backup, 'w', zipfile.ZIP_DEFLATED) as saved:
            for name in [*files, *removals]:
                target = root / name
                if target.is_file(): saved.write(target, name); originals.add(name)
        changed = []
        try:
            for name in files:
                target = root / name; target.parent.mkdir(parents=True, exist_ok=True)
                temporary_target = target.with_name(target.name + '.drip-install')
                try:
                    shutil.copyfile(stage / name, temporary_target)
                    os.replace(temporary_target, target); changed.append(name)
                finally: temporary_target.unlink(missing_ok=True)
            for name in removals:
                (root / name).unlink(missing_ok=True); changed.append(name)
        except Exception as failure:
            errors = []
            with zipfile.ZipFile(backup) as saved:
                for name in reversed(changed):
                    try:
                        target = root / name
                        if name in originals:
                            restore = target.with_name(target.name + '.drip-restore')
                            restore.write_bytes(saved.read(name)); os.replace(restore, target)
                        else: target.unlink(missing_ok=True)
                    except OSError as error: errors.append(f'{name}: {error}')
            if errors: raise RuntimeError('Ripristino incompleto: ' + '; '.join(errors)) from failure
            raise RuntimeError('Aggiornamento fallito; file precedenti ripristinati') from failure
        return {'installedFiles': len(files), 'backup': str(backup),
                'backupSha256': hashlib.sha256(backup.read_bytes()).hexdigest(),
                'changedFiles': files, 'createdFiles': [name for name in files if name not in originals]}
