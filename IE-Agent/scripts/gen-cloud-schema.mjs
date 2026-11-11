// 从 var/platform.sqlite 的 sqlite_master 生成 QW Pages Supabase 幂等建表 SQL
// 规则：表名/索引名不加 schema 前缀；去 FOREIGN KEY/CHECK/DEFAULT/STRICT/WITHOUT ROWID；
// 类型映射 INTEGER→BIGINT、REAL→DOUBLE PRECISION、BLOB→BYTEA、其余→TEXT；保留 PRIMARY KEY/NOT NULL/UNIQUE
import { DatabaseSync } from 'node:sqlite';
import { writeFileSync } from 'node:fs';

const db = new DatabaseSync('var/platform.sqlite', { readOnly: true });
const tables = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
const indexes = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL ORDER BY name").all();

function mapTypes(sql) {
  return sql
    .replace(/\bINTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT\b/gi, 'BIGINT PRIMARY KEY')
    .replace(/\bINTEGER\b/gi, 'BIGINT')
    .replace(/\bREAL\b/gi, 'DOUBLE PRECISION')
    .replace(/\bBLOB\b/gi, 'BYTEA')
    .replace(/\bBOOLEAN\b/gi, 'SMALLINT')
    .replace(/\bNUMERIC\b/gi, 'NUMERIC')
    .replace(/\bDATETIME\b/gi, 'TEXT')
    .replace(/\bVARCHAR\s*\(\s*\d+\s*\)/gi, 'TEXT')
    .replace(/\bTEXT\b/gi, 'TEXT');
}
function clean(sql) {
  let s = sql;
  // 去掉表级 FOREIGN KEY / CHECK / UNIQUE(...) 约束行（列级 UNIQUE 保留）
  s = s.replace(/,?\s*FOREIGN\s+KEY\s*\([^)]*\)\s*REFERENCES\s+[^\n,)]+(\([^)]*\))?/gi, '');
  s = s.replace(/,?\s*CHECK\s*\((?:[^()]*|\([^()]*\))*\)/gi, '');
  s = s.replace(/,?\s*UNIQUE\s*\([^)]*\)/gi, '');
  // 去掉列级 DEFAULT ... （到逗号或右括号前，简化：常见字面量与函数）
  s = s.replace(/\s+DEFAULT\s+(?:'[^']*'|"[^"]*"|-?\d+(?:\.\d+)?|\(?\w+\([^)]*\)\)?)/gi, '');
  s = s.replace(/\)\s*STRICT\b/gi, ')');
  s = s.replace(/\bSTRICT\s*,/gi, ',');
  s = s.replace(/\)\s*WITHOUT\s+ROWID\b/gi, ')');
  return s;
}

const out = [];
out.push('-- 由 scripts/gen-cloud-schema.mjs 自动生成；QW Pages Supabase 租户 schema，幂等');
for (const t of tables) {
  let sql = clean(mapTypes(t.sql));
  sql = sql.replace(/^CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?["']?(\w+)["']?/i, 'CREATE TABLE IF NOT EXISTS "$2"');
  // 列名加引号防保留字
  sql = sql.replace(/([\n,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s+(TEXT|BIGINT|DOUBLE PRECISION|BYTEA|SMALLINT|NUMERIC)/gi, '$1"$2" $3');
  out.push(sql + ';');
}
for (const ix of indexes) {
  let sql = ix.sql.replace(/^CREATE\s+(UNIQUE\s+)?INDEX\s+(IF\s+NOT\s+EXISTS\s+)?["']?(\w+)["']?\s+ON\s+["']?(\w+)["']?/i, 'CREATE $1INDEX IF NOT EXISTS "$3" ON "$4"');
  sql = mapTypes(sql);
  out.push(sql + ';');
}
writeFileSync('cloud-schema.sql', out.join('\n') + '\n');
console.log('tables:', tables.length, 'indexes:', indexes.length, '→ cloud-schema.sql');
db.close();
