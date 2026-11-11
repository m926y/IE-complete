// 导出云端 seed：从本地业务库抽取精简版云端需要的表 → cloud-seed/<table>.json.gz + manifest.json
// 仅本地运行；产物经 prepare-publish 打入发布包，由云端首启幂等自导入（node:zlib 解压）
// scoring_version_rows 仅本地重算/归档使用（scoring-engine），云端不读，不迁移
import {DatabaseSync} from 'node:sqlite';
import {writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {join,dirname} from 'node:path';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const out=join(root,'cloud-seed');
await mkdir(out,{recursive:true});
const TABLES=[
 'data_metadata','operation_config','evaluation_rules','scoring_versions','scoring_designs',
 'app_users','drivers','vehicle_labels','user_bindings','driver_duty_history',
 'score_snapshots','score_history','risk_snapshots','deduction_ledger','review_queue',
 'training_courses','training_tasks','training_delivery_outbox','notification_events',
 'alerts','alert_evidence','alert_deliveries','risk_cases','risk_replay_sessions',
];
const db=new DatabaseSync(join(root,'var/platform.sqlite'),{readOnly:true});
const manifest={version:1,generated_at:new Date().toISOString(),tables:[]};
let totalGz=0;
for(const t of TABLES){
  const rows=db.prepare('SELECT * FROM '+t).all();
  const json=JSON.stringify(rows);
  const gz=gzipSync(Buffer.from(json,'utf8'),{level:9});
  await writeFile(join(out,t+'.json.gz'),gz);
  totalGz+=gz.length;
  manifest.tables.push({table:t,rows:rows.length,sha256:createHash('sha256').update(json).digest('hex')});
  console.log(t.padEnd(26),String(rows.length).padStart(6),(json.length/1024).toFixed(0)+'KB → '+(gz.length/1024).toFixed(0)+'KB gz');
}
manifest.seed_hash=createHash('sha256').update(manifest.tables.map(x=>x.table+':'+x.sha256).join('|')).digest('hex').slice(0,16);
await writeFile(join(out,'manifest.json'),JSON.stringify(manifest,null,1));
console.log('seed_hash:',manifest.seed_hash,'tables:',manifest.tables.length,'total gz:',(totalGz/1024/1024).toFixed(1)+'MB');
db.close();
