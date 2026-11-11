// One-off local account cleanup. Dry run by default; --apply creates a SQLite backup first.
import {DatabaseSync, backup} from 'node:sqlite';
import {mkdir, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';

const apply=process.argv.includes('--apply');
const root=new URL('../',import.meta.url);
const db=new DatabaseSync(fileURLToPath(new URL('var/platform.sqlite',root)),{readOnly:!apply});
try {
  db.exec('PRAGMA busy_timeout=5000');
  const plan=()=>db.prepare(`SELECT u.user_id,u.username,u.driver_id,u.account_status,d.gpsno,
    (SELECT s.risk_level FROM score_snapshots s WHERE s.gpsno=d.gpsno ORDER BY s.as_of_date DESC,s.score_id DESC LIMIT 1) grade
    FROM app_users u LEFT JOIN drivers d ON d.driver_id=u.driver_id WHERE u.role='driver' ORDER BY u.user_id`).all();
  const rows=plan(), kept=rows.filter(r=>['C','D'].includes(r.grade)), removed=rows.filter(r=>!['C','D'].includes(r.grade));
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  console.log(JSON.stringify({apply,driver_accounts:rows.length,keep:kept.length,remove:removed.length,keep_by_grade:{C:kept.filter(r=>r.grade==='C').length,D:kept.filter(r=>r.grade==='D').length}},null,2));
  if(apply&&removed.length){
    const dir=new URL(`var/backups/cd-accounts-${stamp}/`,root);await mkdir(dir,{recursive:true});
    await backup(db,fileURLToPath(new URL('platform.sqlite',dir)));
    db.exec('BEGIN IMMEDIATE');
    try{
      // Re-read after taking the write lock in case a binding or grade changed during backup.
      const current=plan(), victims=current.filter(r=>!['C','D'].includes(r.grade)), at=new Date().toISOString();
      for(const r of victims){
        db.prepare('DELETE FROM app_sessions WHERE user_id=?').run(r.user_id);
        db.prepare("UPDATE user_bindings SET account_status='disabled',effective_end=?,updated_at=? WHERE user_id=? AND effective_end IS NULL").run(at,at,r.user_id);
        db.prepare('DELETE FROM app_users WHERE user_id=? AND role=\'driver\'').run(r.user_id);
        db.prepare("INSERT INTO audit_logs(audit_id,actor_id,actor_role,action,entity_type,entity_id,old_status,new_status,occurred_at,request_id,detail_json) VALUES(?,?,'safety_admin','account.delete','app_user',?,?,'deleted',?,?,?)").run('audit-'+randomUUID(),'local-owner',r.user_id,r.account_status,at,'retain-cd-'+stamp,JSON.stringify({reason:'retain_bound_cd_vehicle_drivers',vehicle_grade:r.grade||null}));
      }
      const report={at,removed_count:victims.length,remaining_driver_count:current.length-victims.length,removed:victims.map(({user_id,username,driver_id,grade})=>({user_id,username,driver_id,grade}))};
      await writeFile(new URL('cleanup-report.json',dir),JSON.stringify(report,null,2)+'\n');
      db.exec('COMMIT');console.log('Backup and cleanup report: '+fileURLToPath(dir));
    }catch(e){db.exec('ROLLBACK');throw e;}
  }
}finally{db.close();}
