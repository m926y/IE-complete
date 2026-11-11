import {mkdir,writeFile,readFile,stat,open} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {resolve,extname} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);
const types={'.mp4':'video/mp4','.webm':'video/webm','.mov':'video/quicktime','.pdf':'application/pdf','.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','.doc':'application/msword','.md':'text/markdown','.txt':'text/plain','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'};
export function createLearningAssets(root){
 return {
 async upload(request){
  const name=decodeURIComponent(String(request.headers['x-file-name']||'')),extension=extname(name).toLowerCase(),type=types[extension];
  if(!type)throw new Error('file_type_not_supported');
  const max=type.startsWith('video/')?100*1024*1024:20*1024*1024;
  const chunks=[];let size=0;for await(const chunk of request){size+=chunk.length;if(size>max)throw new Error('file_too_large');chunks.push(chunk)}
  if(!size)throw new Error('file_empty');
  const bytes=Buffer.concat(chunks),id=randomBytes(16).toString('hex');await mkdir(root,{recursive:true});
  await writeFile(resolve(root,id),bytes);let text='';
  if(['.md','.txt'].includes(extension))text=bytes.toString('utf8');
  if(['.pdf','.docx'].includes(extension)){
   const python=process.env.PYTHON||'python';
   try{const result=await run(python,['scripts/extract-learning-document.py',resolve(root,id),extension],{maxBuffer:1024*1024,timeout:30000,windowsHide:true});text=result.stdout}catch{}
  }
  const meta={id,name:name.slice(0,180),type,size,text:text.slice(0,20000),url:'/api/learning-assets/'+id};await writeFile(resolve(root,id+'.json'),JSON.stringify(meta));return meta;
 },
 async meta(id){return JSON.parse(await readFile(resolve(root,id+'.json'),'utf8'))},
 async send(id,request,response){const meta=await this.meta(id),file=resolve(root,id),info=await stat(file);let start=0,end=info.size-1,status=200;
  if(request.headers.range){const m=/^bytes=(\d+)-(\d*)$/.exec(request.headers.range);if(!m){response.writeHead(416);return response.end()}start=Number(m[1]);end=m[2]?Math.min(Number(m[2]),end):end;if(start>end||start>=info.size){response.writeHead(416,{'content-range':'bytes */'+info.size});return response.end()}status=206}
  response.writeHead(status,{'content-type':meta.type,'content-length':end-start+1,'accept-ranges':'bytes','x-content-type-options':'nosniff','cache-control':'private, max-age=300','content-disposition':`inline; filename*=UTF-8''${encodeURIComponent(meta.name)}`,...status===206?{'content-range':`bytes ${start}-${end}/${info.size}`}:{}});
  const handle=await open(file,'r');handle.createReadStream({start,end,autoClose:true}).pipe(response);
 }
 };
}
