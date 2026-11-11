"""Restore the checked release dataset without overwriting an existing business database."""
import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import urllib.request
import zipfile


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bundle', type=Path, help='Use an already downloaded data ZIP')
    parser.add_argument('--target', type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    root = args.target.resolve()
    manifest = json.loads((Path(__file__).resolve().parents[1] / 'data/release-manifest.json').read_text(encoding='utf-8'))
    bundle = manifest['bundle']
    root.mkdir(parents=True, exist_ok=True)
    existing_db = root / 'var/platform.sqlite'
    pristine = manifest['files']['var/platform.sqlite']['sha256']
    if existing_db.exists() and digest(existing_db) != pristine:
        raise SystemExit('Existing business database differs from release seed. Use a new directory; no data was replaced.')
    if args.bundle:
        archive = args.bundle.resolve()
    else:
        cache = root / '.data-downloads'
        cache.mkdir(exist_ok=True)
        archive = cache / bundle['name']
        if not archive.exists() or digest(archive) != bundle['sha256']:
            partial = archive.with_suffix('.download')
            request = urllib.request.Request(bundle['url'], headers={'User-Agent': 'IE-Agent-Data-Installer'})
            print('Downloading verified data bundle ...', flush=True)
            with urllib.request.urlopen(request, timeout=60) as response, partial.open('wb') as dest:
                shutil.copyfileobj(response, dest, 1024 * 1024)
            if digest(partial) != bundle['sha256']:
                partial.unlink()
                raise SystemExit('Downloaded bundle checksum mismatch; installation stopped.')
            os.replace(partial, archive)
    if archive.stat().st_size != bundle['bytes'] or digest(archive) != bundle['sha256']:
        raise SystemExit('Bundle checksum or size mismatch; no extraction performed.')
    with zipfile.ZipFile(archive) as z:
        names = {member.filename for member in z.infolist() if not member.is_dir()}
        if names != set(manifest['files']):
            raise SystemExit('Unexpected bundle members; installation stopped.')
        for member in z.infolist():
            if member.is_dir():
                continue
            rel = PurePosixPath(member.filename)
            target = (root / Path(*rel.parts)).resolve()
            if rel.is_absolute() or '..' in rel.parts or not target.is_relative_to(root) or stat.S_ISLNK(member.external_attr >> 16):
                raise SystemExit('Unsafe archive path rejected.')
            expected = manifest['files'][member.filename]
            if target.exists():
                if digest(target) != expected['sha256']:
                    raise SystemExit('Existing file differs; preserved: ' + str(target))
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            temporary = target.with_suffix(target.suffix + '.installing')
            with z.open(member) as source, temporary.open('wb') as dest:
                shutil.copyfileobj(source, dest, 1024 * 1024)
            if temporary.stat().st_size != expected['bytes'] or digest(temporary) != expected['sha256']:
                temporary.unlink()
                raise SystemExit('Extracted file checksum mismatch: ' + member.filename)
            os.replace(temporary, target)
    history = root / 'var/history.sqlite'
    if history.exists():
        if digest(history) != manifest['history']['sha256']:
            raise SystemExit('Existing history database differs; preserved.')
    else:
        temporary = history.with_suffix('.installing')
        print('Restoring complete history database ...', flush=True)
        with gzip.open(root / 'var/history.sqlite.gz', 'rb') as source, temporary.open('wb') as dest:
            shutil.copyfileobj(source, dest, 1024 * 1024)
        if digest(temporary) != manifest['history']['sha256']:
            temporary.unlink()
            raise SystemExit('History checksum mismatch.')
        os.replace(temporary, history)
    print('Data restored: 500 vehicles, 3,152,654 events, 4,000 historical scores, 16 courses.')
    print('Next: npm ci, npm run setup:local, npm run build, npm run start:local')


if __name__ == '__main__':
    main()
