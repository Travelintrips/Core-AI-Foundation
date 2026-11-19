'use strict';
// Isolated strict JSON decoder: rejects duplicate keys, including nested keys.
function parseUniqueJson(raw){
 if(typeof raw!=='string'||raw.length>4000000)throw Error('SSE_JSON_INVALID');
 let i=0;const n=raw.length;
 const skip=()=>{while(i<n&&/\s/.test(raw[i]))i++};
 const quoted=()=>{
  if(raw[i]!=='"')throw Error('SSE_JSON_INVALID');
  const begin=i++;
  while(i<n){
   if(raw[i]==='\\'){i+=2;continue}
   if(raw[i++]==='"'){
    try{return JSON.parse(raw.slice(begin,i))}catch{throw Error('SSE_JSON_INVALID')}
   }
  }
  throw Error('SSE_JSON_INVALID');
 };
 const value=(depth)=>{
  if(depth>64)throw Error('SSE_JSON_DEPTH_INVALID');
  skip();
  const ch=raw[i];
  if(ch==='{' ){
   i++;skip();const keys=new Set();
   if(raw[i]==='}'){i++;return}
   for(;;){
    skip();const k=quoted();
    if(keys.has(k))throw Error('SSE_JSON_DUPLICATE_KEY');
    keys.add(k);skip();if(raw[i++]!==':')throw Error('SSE_JSON_INVALID');
    value(depth+1);skip();
    const end=raw[i++];
    if(end==='}')return;
    if(end!==',')throw Error('SSE_JSON_INVALID');
   }
  }
  if(ch==='['){
   i++;skip();if(raw[i]===']'){i++;return}
   for(;;){value(depth+1);skip();const end=raw[i++];if(end===']')return;if(end!==',')throw Error('SSE_JSON_INVALID')}
  }
  if(ch==='"'){quoted();return}
  const m=raw.slice(i).match(/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/);
  if(!m)throw Error('SSE_JSON_INVALID');
  i+=m[0].length;
 };
 try{
  value(0);skip();if(i!==n)throw Error('SSE_JSON_INVALID');
  const result=JSON.parse(raw);
  if(result===null||typeof result!=='object'||Array.isArray(result))throw Error('SSE_EVENT_NOT_OBJECT');
  return result;
 }catch(e){
  if(/^SSE_/.test(String(e.message)))throw e;
  throw Error('SSE_JSON_INVALID');
 }
}
module.exports={parseUniqueJson};
