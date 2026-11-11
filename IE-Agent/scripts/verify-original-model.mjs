import {DatabaseSync} from 'node:sqlite';
import {createScoringEngine} from '../server/scoring-engine.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const root=new URL('../',import.meta.url),db=new DatabaseSync(new URL('var/platform.sqlite',root));
try{
 const frozen=JSON.parse(await readFile(new URL('scripts/scoring_source/scoring_frozen.json',root),'utf8')),s=createScoringEngine(db,frozen).state();
 assert.deepEqual(s.weights,s.baseline_weights);assert.equal(s.model_config.window_days,14);assert.equal(s.model_config.half_life_days,14);assert.equal(s.model_config.exposure_units,undefined);
 const checked={};
 for(const table of ['score_snapshots','score_history','deduction_ledger','review_queue','evaluation_rules']){
  const original=db.prepare('SELECT row_json FROM scoring_version_rows WHERE version_id=? AND table_name=? ORDER BY row_no').all('original',table).map(r=>JSON.parse(r.row_json)),live=db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all();assert.equal(live.length,original.length);
  for(let i=0;i<original.length;i++)for(const [k,v]of Object.entries(original[i]))if(k!=='source_version')assert.equal(live[i][k],v,table+' row '+i+' '+k);
  checked[table]=live.length;
 }
 const result={restored:true,active_version:s.active_version,weights:s.weights,checked,checked_at:new Date().toISOString()};await writeFile(new URL('var/model-final-verification.json',root),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{db.close();}
