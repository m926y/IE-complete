import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
class Storage {values=new Map();getItem(k){return this.values.get(k)??null}setItem(k,v){this.values.set(k,String(v))}removeItem(k){this.values.delete(k)}clear(){this.values.clear()}}
test('complete device conversations survive logout, new sessions, time and account switching',async()=>{
 globalThis.localStorage=new Storage();globalThis.sessionStorage=new Storage();globalThis.window=new EventTarget();
 const source=await readFile(new URL('../src/ai-conversation-store.ts',import.meta.url),'utf8');
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 const store=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
 const messages=Array.from({length:60},(_,i)=>({role:i%2?'assistant':'user',content:'完整原文'+i+'字'.repeat(500),actionPlans:i===59?[{id:'plan-preserved',rows:[{vehicle:'车辆96'}],expires_at:'2000-01-01',state:'pending'}]:undefined,artifacts:[{id:'report'}],cards:[{ref:'evidence'}],drafts:[{route:'training'}],attachments:[{name:'材料.md'}],citations:['来源'],audit:{issues:['核查记录']}}));
 assert.equal(store.saveActiveMessages('admin',messages),true);
 sessionStorage.clear();const restored=store.readConversations('admin');assert.deepEqual(restored.items[0].messages,JSON.parse(JSON.stringify(messages)));assert.equal(restored.items[0].messages.length,60);
 store.saveActiveMessages('officer',[{role:'user',content:'另一账号'}]);assert.equal(store.readConversations('admin').items[0].messages.length,60);assert.equal(store.readConversations('officer').items[0].messages[0].content,'另一账号');
 const next={active:'new-chat',items:restored.items};store.writeConversations('admin',next);store.saveActiveMessages('admin',[]);assert.equal(store.readConversations('admin').items.length,2);assert.equal(store.readConversations('admin').items.find(t=>t.id===restored.active).messages.length,60);
 store.saveActiveMessages('admin',messages,restored.active);assert.equal(store.readConversations('admin').active,'new-chat');assert.equal(store.readConversations('admin').items.find(t=>t.id===restored.active).messages.length,60);
 sessionStorage.setItem('claw_ai_threads_legacy',JSON.stringify(restored));assert.equal(store.readConversations('legacy').items[0].messages[59].actionPlans[0].id,'plan-preserved');sessionStorage.clear();assert.equal(store.readConversations('legacy').items[0].messages.length,60);
 const before=localStorage.getItem('claw_ai_history_v2_admin');let warned=false;window.addEventListener('claw:chat-storage-error',()=>warned=true);localStorage.setItem=()=>{throw Error('quota')};assert.equal(store.saveActiveMessages('admin',messages),false);assert(warned);assert.equal(localStorage.getItem('claw_ai_history_v2_admin'),before);
});
