import {useEffect,useState} from 'react';
import './ai-conversations.css';
import {readConversations,writeConversations} from './ai-conversation-store';
import type {Message} from './ai-conversation-store';
export {readConversations} from './ai-conversation-store';
export function ConversationSidebar({user,messages,onSelect,busy,mobile=false,onDismiss}:{user:string;messages:Message[];onSelect:(messages:Message[])=>void;busy:boolean;mobile?:boolean;onDismiss?:()=>void}){
 const [query,setQuery]=useState('');
 const [saved,setSaved]=useState(()=>{const value=readConversations(user);if(!value.active)value.active=crypto.randomUUID();return value});
 useEffect(()=>{setSaved(previous=>{const current={id:previous.active,title:messages.find(m=>m.role==='user')?.content.slice(0,28)||'新会话',updated:Date.now(),messages};const next={active:previous.active,items:[current,...previous.items.filter(t=>t.id!==previous.active)]};writeConversations(user,next);return next})},[messages,user]);
 function select(id:string){if(busy||id===saved.active)return;const thread=saved.items.find(t=>t.id===id);if(!thread)return;const next={...saved,active:id};setSaved(next);writeConversations(user,next);onSelect(thread.messages.map(m=>({...m,restored:true})));onDismiss?.()}
 function create(){if(busy)return;const next={...saved,active:crypto.randomUUID()};setSaved(next);writeConversations(user,next);onSelect([]);onDismiss?.()}
 useEffect(()=>{if(!mobile)return;const h=()=>create();window.addEventListener("claw:driver-new-chat",h);return()=>window.removeEventListener("claw:driver-new-chat",h)},[mobile,busy,saved]);
 return <aside className="ai-conversations" aria-label="助手会话">{mobile&&<input className="mobile-chat-search" aria-label="搜索历史会话" placeholder="搜索会话" value={query} onChange={e=>setQuery(e.target.value)}/>}<button className="btn primary" disabled={busy} onClick={create}>＋ 新建会话</button><h4>历史会话</h4>{saved.items.filter(t=>t.messages.length&&t.title.includes(query)).map(t=><button className={'ai-thread '+(t.id===saved.active?'active':'')} disabled={busy} aria-pressed={t.id===saved.active} key={t.id} onClick={()=>select(t.id)}><span>{t.title.startsWith("AI04 三种管理路径")?"车辆处置方案":t.title}</span><small>{new Date(t.updated).toLocaleDateString('zh-CN')}</small></button>)}{!saved.items.some(t=>t.messages.length)&&<p>暂无历史会话</p>}</aside>
}
