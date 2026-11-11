"""Local dependency loading and small I/O helpers; no shared code changes."""
from pathlib import Path
import csv
import hashlib
import json
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / '.deps'))
import duckdb

def quote(value):
    return "'" + str(value).replace('\\', '/').replace("'", "''") + "'"

def records(con, sql):
    cur = con.execute(sql)
    names = [d[0] for d in cur.description]
    return [dict(zip(names, row)) for row in cur.fetchall()]

def write_json(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2, default=str, allow_nan=False), encoding='utf-8')

def write_csv(path, rows, fields=None):
    fields = fields or list(rows[0])
    with Path(path).open('w', encoding='utf-8-sig', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)

def write_parquet(con, path, rows, types):
    # Explicit types preserve all-null columns and string identifiers.
    tmp = Path(path).with_suffix('.staging.csv')
    write_csv(tmp, rows, list(types))
    schema = '{' + ','.join(f'{quote(k)}:{quote(v)}' for k, v in types.items()) + '}'
    con.execute(f"COPY (SELECT * FROM read_csv({quote(tmp)}, header=true, columns={schema}, nullstr='')) TO {quote(path)} (FORMAT PARQUET, COMPRESSION ZSTD)")
    tmp.unlink()

def digest(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for block in iter(lambda: f.read(8 * 1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()
