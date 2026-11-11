// AI 聊天附件存储：接收用户上传的表格/文档，解析为纯文本（表格另存结构化行），
// 供 handleAiChat 注入上下文及 prepare_account_import_from_upload / prepare_course_from_upload 工具消费。
// 与 learning-assets 同构：原始流式接收 + x-file-name 头 + var/ 本地存储；24h TTL 惰性清理。
// 附件仅属于上传者本人会话，工具执行仍按角色门禁（agentStaff 等）另行校验。
import {mkdir,writeFile,readFile,unlink,readdir} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {resolve,extname} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);

const KINDS={'.xlsx':'sheet','.csv':'sheet','.docx':'document','.pdf':'document','.pptx':'slides','.html':'webpage','.htm':'webpage','.md':'markdown','.txt':'text'};
const KIND_LABELS={sheet:'表格',document:'文档',slides:'幻灯片',webpage:'网页',markdown:'Markdown',text:'纯文本'};
const LEGACY_HINTS={'.doc':'请将 .doc 另存为 .docx 后上传','.ppt':'请将 .ppt 另存为 .pptx 后上传','.xls':'请将 .xls 另存为 .xlsx 后上传'};
export const AI_UPLOAD_EXTENSIONS=Object.keys(KINDS);
const TEXT_CAP=40000;
const MAX_BYTES=20*1024*1024;
const TTL_MS=24*3600*1000;
const ROW_CAP=300;
const COL_CAP=20;
const ID_RE=/^aiu-[a-f0-9]{24}$/;

function fail(code,detail){const e=new Error(code);e.code=code;if(detail)e.detail=detail;return e}

// CSV 解析：与前端 csvCells 同语义（仅取值，不执行任何公式/宏）
export function csvRows(text){
  const rows=[];let row=[],cell='',quoted=false;
  const s=String(text).replace(/^\ufeff/,'');
  for(let i=0;i<s.length;i++){
    const c=s[i];
    if(c==='"'){if(quoted&&s[i+1]==='"'){cell+='"';i++}else quoted=!quoted}
    else if(c===','&&!quoted){row.push(cell);cell=''}
    else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&s[i+1]==='\n')i++;row.push(cell);rows.push(row);row=[];cell=''}
    else cell+=c;
  }
  if(quoted)throw fail('csv_quote_invalid');
  if(cell||row.length){row.push(cell);rows.push(row)}
  return rows.slice(0,ROW_CAP).map(r=>r.slice(0,COL_CAP).map(v=>String(v??'').trim()));
}

function htmlToText(html){
  let s=String(html)
    .replace(/<!--[\s\S]*?-->/g,' ')
    .replace(/<script[\s\S]*?<\/script>/gi,' ')
    .replace(/<style[\s\S]*?<\/style>/gi,' ')
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6]|\/section|\/article|\/td)\s*\/?>/gi,'\n')
    .replace(/<[^>]+>/g,' ');
  s=s.replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&quot;/gi,'"').replace(/&#0?39;/gi,"'").replace(/&#(\d+);/g,(m,d)=>{try{return String.fromCodePoint(Number(d))}catch{return m}});
  return s.split('\n').map(l=>l.replace(/[ \t\r]+/g,' ').trim()).filter(Boolean).join('\n');
}

export function createAiUploads(root){
  async function sweep(){
    try{
      for(const f of await readdir(root)){
        if(!f.endsWith('.json'))continue;
        try{
          const meta=JSON.parse(await readFile(resolve(root,f),'utf8'));
          if(meta.expires_at&&meta.expires_at<new Date().toISOString()){
            await unlink(resolve(root,f)).catch(()=>{});
            await unlink(resolve(root,String(meta.id))).catch(()=>{});
          }
        }catch{}
      }
    }catch{}
  }
  return {
    async upload(request,user){
      const name=decodeURIComponent(String(request.headers['x-file-name']||'')).slice(0,180);
      const extension=extname(name).toLowerCase();
      if(LEGACY_HINTS[extension])throw fail('legacy_format_not_supported',LEGACY_HINTS[extension]);
      const kind=KINDS[extension];
      if(!kind)throw fail('file_type_not_supported');
      const chunks=[];let size=0;
      for await(const chunk of request){size+=chunk.length;if(size>MAX_BYTES)throw fail('file_too_large');chunks.push(chunk)}
      if(!size)throw fail('file_empty');
      const bytes=Buffer.concat(chunks);
      await mkdir(root,{recursive:true});
      await sweep();
      const id='aiu-'+randomBytes(12).toString('hex');
      await writeFile(resolve(root,id),bytes);
      let text='',rows=null;
      try{
        if(extension==='.md'||extension==='.txt')text=bytes.toString('utf8');
        else if(extension==='.csv'){text=bytes.toString('utf8');rows=csvRows(text)}
        else if(extension==='.html'||extension==='.htm')text=htmlToText(bytes.toString('utf8'));
        else{
          const python=process.env.PYTHON||process.env.MODEL_PYTHON||'python';
          let result;
          try{
            result=await run(python,['scripts/extract-ai-upload.py',resolve(root,id),extension],{maxBuffer:16*1024*1024,timeout:45000,windowsHide:true});
          }catch(e){
            const detail=String(e?.stderr||e?.message||'').slice(0,200);
            if(/Cannot find module|No module named|ModuleNotFoundError/i.test(detail))throw fail('extract_dependency_missing',detail);
            throw fail('extract_failed',detail);
          }
          let parsed;
          try{parsed=JSON.parse(result.stdout)}catch{throw fail('extract_failed')}
          text=String(parsed.text||'');
          if(extension==='.xlsx'&&Array.isArray(parsed.rows))rows=parsed.rows.slice(0,ROW_CAP).map(r=>Array.isArray(r)?r.slice(0,COL_CAP).map(v=>String(v??'')):[]);
        }
      }catch(e){
        await unlink(resolve(root,id)).catch(()=>{});
        throw e;
      }
      text=text.replace(/\r\n/g,'\n').slice(0,TEXT_CAP);
      const truncated=bytes.length>0&&(kind==='sheet'?(rows&&rows.length>=ROW_CAP):text.length>=TEXT_CAP);
      if(!text.trim()&&!(rows&&rows.length))throw fail('extract_empty');
      const now=new Date();
      const meta={id,owner_user_id:String(user?.user_id||''),name,kind,kind_label:KIND_LABELS[kind]||kind,extension,size,chars:text.length,truncated:Boolean(truncated),text,rows,created_at:now.toISOString(),expires_at:new Date(now.getTime()+TTL_MS).toISOString()};
      await writeFile(resolve(root,id+'.json'),JSON.stringify(meta));
      return meta;
    },
    async get(id,user){
      if(!ID_RE.test(String(id||'')))throw fail('attachment_not_found');
      let meta;
      try{meta=JSON.parse(await readFile(resolve(root,String(id)+'.json'),'utf8'))}catch{throw fail('attachment_not_found')}
      if(meta.owner_user_id!==String(user?.user_id||''))throw fail('attachment_forbidden');
      if(meta.expires_at<new Date().toISOString()){
        await unlink(resolve(root,String(id)+'.json')).catch(()=>{});
        await unlink(resolve(root,String(id))).catch(()=>{});
        throw fail('attachment_expired');
      }
      return meta;
    },
    publicMeta(meta){
      return {upload_id:meta.id,name:meta.name,kind:meta.kind,kind_label:meta.kind_label,chars:meta.chars,truncated:meta.truncated,rows:meta.rows?meta.rows.length:null,expires_at:meta.expires_at};
    }
  };
}

// 账号表映射：与前端 accountRows() 同规则（表头白名单、角色中英映射、行数上限），
// 服务端为权威校验，前端解析仅用于既有独立导入通道。
const ACCOUNT_HEADER_ALIASES={'用户名':'username','账号':'username','username':'username','显示名':'display_name','姓名':'display_name','display_name':'display_name','角色':'role','role':'role','对应车辆':'vehicle','车辆':'vehicle','车辆编号':'vehicle','vehicle':'vehicle'};
const ACCOUNT_ROLE_ALIASES={'司机':'driver','安全员':'safety_officer','安全管理员':'safety_admin','队长':'team_leader'};
export function sheetToAccountRows(rows){
  const clean=(Array.isArray(rows)?rows:[]).filter(r=>Array.isArray(r)&&r.some(c=>c!==null&&c!==undefined&&String(c).trim()!==''));
  if(clean.length<2)throw fail('account_table_too_short','请上传1–200行账号数据，另加一行表头');
  if(clean.length>201)throw fail('account_table_too_long','请上传1–200行账号数据，另加一行表头');
  // 容错：表格解析器可能把行填充到固定列数，先裁掉表头尾部的全空列
  const headerRow=clean[0];
  let cols=headerRow.length;
  while(cols>0&&(headerRow[cols-1]===null||headerRow[cols-1]===undefined||String(headerRow[cols-1]).trim()===''))cols--;
  const headers=headerRow.slice(0,cols).map(c=>ACCOUNT_HEADER_ALIASES[String(c??'').replace(/^\ufeff/,'').trim().toLowerCase()]);
  if(![3,4].includes(headers.length)||new Set(headers).size!==headers.length||headers.some(h=>!h)||!['username','display_name','role'].every(h=>headers.includes(h)))
    throw fail('account_table_header_invalid','表头须包含：用户名、显示名、角色；可添加对应车辆，不要上传密码列。');
  return clean.slice(1).map((r,i)=>{
    if(r.slice(cols).some(v=>v!=null&&String(v).trim()!==''))throw fail('account_table_extra_columns','第'+(i+2)+'行存在多余列，请使用账号模板');
    const o=Object.fromEntries(headers.map((h,k)=>[h,String(r[k]??'').trim()]));
    o.role=ACCOUNT_ROLE_ALIASES[o.role]||o.role||'driver';
    return o;
  });
}
