export type Message={role:'user'|'assistant';content:string;restored?:boolean;err?:string};
export type Conversation={id:string;title:string;updated:number;messages:Message[]};
export type Saved={active:string;items:Conversation[]};
const key=(user:string)=>'claw_ai_history_v2_'+user;
export function writeConversations(user:string,saved:Saved):boolean{
 try{localStorage.setItem(key(user),JSON.stringify(saved));return true}catch{window.dispatchEvent(new Event('claw:chat-storage-error'));return false}
}
export function readConversations(user:string):Saved{
 try{const saved=JSON.parse(localStorage.getItem(key(user))||'null');if(saved&&Array.isArray(saved.items))return saved}catch{}
 // Migrate complete tab history before falling back to the legacy two-hour summaries.
 try{const saved=JSON.parse(sessionStorage.getItem('claw_ai_threads_'+user)||'null');if(saved&&Array.isArray(saved.items)){writeConversations(user,saved);return saved}}catch{}
 let messages:Message[]=[];
 try{messages=JSON.parse(sessionStorage.getItem('claw_ai_msgs_'+user)||'[]');if(!Array.isArray(messages))messages=[]}catch{}
 if(!messages.length)try{const old=JSON.parse(localStorage.getItem('claw_ai_long_'+user)||'null');messages=(old?.items||[]).map((m:{r:string;x:string})=>({role:m.r==='assistant'?'assistant':'user',content:String(m.x),restored:true}))}catch{}
 const active=messages.length?crypto.randomUUID():'';
 const saved:Saved={active,items:messages.length?[{id:active,title:messages.find(m=>m.role==='user')?.content.slice(0,28)||'历史会话',updated:Date.now(),messages}]:[]};
 if(messages.length)writeConversations(user,saved);
 return saved;
}
export function saveActiveMessages(user:string,messages:Message[],conversationId?:string):boolean{
 const saved=readConversations(user),id=conversationId||saved.active||crypto.randomUUID();
 const current={id,title:messages.find(m=>m.role==='user')?.content.slice(0,28)||'新会话',updated:Date.now(),messages};
 return writeConversations(user,{active:saved.active||id,items:[current,...saved.items.filter(t=>t.id!==id)]});
}
