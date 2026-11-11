// Pure, unconnected reader of FUTURE independently captured public rankings.
// Never a publisher, official source watermark, signed receipt or generation.
import {createHash} from 'node:crypto';
import {SOURCE_VARIANTS, MAX_BODY_BYTES} from './standby-core.js';
export const CLOUD_DIRECT_SCHEMA='hotapi-cloud-direct-observation-v1';
const FUTURE_MS=2*60*1000, FRESH_MS=3*60*60*1000;
const SHA=/^[a-f0-9]{64}$/;
const UTC=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const isObject=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const keys=(v,n)=>isObject(v)&&Object.keys(v).length===n.length&&
  n.every(k=>Object.hasOwn(v,k));
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const validUrl=x=>{
  if(typeof x!=='string'||x.length>4096)return false;
  try{const u=new URL(x);return u.protocol==='https:'&&!!u.hostname&&
    !u.username&&!u.password;}catch{return false;}
};
// Null = refusal. No mutation, remote I/O, write authority or Release reads.
export function inspectCloudDirectCandidate(v,source,variant,now=Date.now()){
  if(!Number.isSafeInteger(now)||now<0||now>8.64e15 ||
     !Object.hasOwn(SOURCE_VARIANTS,source)||
     SOURCE_VARIANTS[source]!==variant)return null;
  if(!keys(v,['schema','source','variant','capturedAt',
      'sourcePublishedAt','rankDigest','linkDigest','payload'])||
     v.schema!==CLOUD_DIRECT_SCHEMA||v.source!==source||
     v.variant!==variant||v.sourcePublishedAt!==null||
     typeof v.rankDigest!=='string'||!SHA.test(v.rankDigest)||
     typeof v.linkDigest!=='string'||!SHA.test(v.linkDigest))return null;
  const at=v.capturedAt;
  if(typeof at!=='string'||!UTC.test(at))return null;
  const time=Date.parse(at);
  if(!Number.isFinite(time)||new Date(time).toISOString()!==at||
     time>now+FUTURE_MS||now-time>FRESH_MS)return null;
  const payload=v.payload;
  if(!keys(payload,['code','name','total','data'])||
     payload.code!==200||payload.name!==source||
     !Array.isArray(payload.data)||payload.data.length<10||
     payload.data.length>200||payload.total!==payload.data.length)return null;
  const ranked=[],links=[];
  for(let i=0;i<payload.data.length;i++){
    if(!Object.hasOwn(payload.data,i))return null;
    const item=payload.data[i];
    if(!keys(item,['title','url'])||typeof item.title!=='string'||
       item.title.length>500||!validUrl(item.url))return null;
    const normalized=item.title.normalize('NFKC').replace(/\s+/gu,' ').trim();
    if(!normalized||normalized!==item.title)return null;
    ranked.push([i+1,normalized]);
    links.push([i+1,item.url]);
  }
  if(v.rankDigest!==hash(['hotapi-rank-v1',source,variant,ranked])||
     v.linkDigest!==hash(['hotapi-link-v1',source,variant,links]))return null;
  let bytes;
  try{bytes=Buffer.byteLength(JSON.stringify(v),'utf8');}catch{return null;}
  if(bytes>MAX_BODY_BYTES)return null;
  return Object.freeze({source,variant,capturedAt:at,rows:payload.data.length,
    rankDigest:v.rankDigest,linkDigest:v.linkDigest,bytes});
}
