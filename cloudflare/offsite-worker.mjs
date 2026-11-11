// Independent Cloudflare last-good reader; NEVER contacts the home API,
// writes Release or obtains provider credentials. Staging only.
import {dashboardHtml} from './dashboard.js';
import seeds from '../lib/standby-seed.js';
import {SOURCE_VARIANTS,choosePublicVariant,validSnapshot,
 snapshotUrl,snapshotAgeSeconds,MAX_BODY_BYTES} from '../lib/standby-core.js';
const common={
 'Content-Type':'application/json; charset=utf-8',
 'X-Content-Type-Options':'nosniff','Access-Control-Allow-Origin':'*',
 'Access-Control-Allow-Methods':'GET, HEAD, OPTIONS',
 'Access-Control-Allow-Headers':'Content-Type',
 'Access-Control-Expose-Headers':'X-HotAPI-Data-Mode, X-HotAPI-Standby-Age-Seconds, X-HotAPI-Standby-Captured-At'
};
const send=(status,body,method,headers={})=>new Response(
 method==='HEAD'||status===204?null:JSON.stringify(body),
 {status,headers:{...common,'Cache-Control':status===200?
   'public, max-age=30, s-maxage=30':'no-store',...headers}});
async function boundedJson(response){
 if(response.status!==200||!response.body)return null;
 const raw=response.headers.get('content-length');
 if(raw!==null&&(!Number.isSafeInteger(Number(raw))||
   Number(raw)<0||Number(raw)>MAX_BODY_BYTES))return null;
 const reader=response.body.getReader();
 let total=0;const chunks=[];
 try{
  for(;;){
   const x=await reader.read();if(x.done)break;
   total+=x.value.byteLength;
   if(total>MAX_BODY_BYTES){void reader.cancel().catch(()=>{});return null;}
   chunks.push(x.value);
  }
  const bytes=new Uint8Array(total);let p=0;
  for(const c of chunks){bytes.set(c,p);p+=c.length;}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch{return null;}
 }catch{return null;}finally{reader.releaseLock();}
}
export function createOffsiteWorker({fetchImpl=globalThis.fetch,
 seed=seeds,clock=()=>Date.now(),timeoutMs=3000}={}){
 return async request=>{
  const url=new URL(request.url),method=request.method;
  if(url.pathname==='/'&&(method==='GET'||method==='HEAD'))
   return new Response(method==='HEAD'?null:dashboardHtml,{
    status:200,headers:{
     'Content-Type':'text/html; charset=utf-8',
     'Cache-Control':'public, max-age=60',
     'X-Content-Type-Options':'nosniff',
     'Referrer-Policy':'no-referrer',
     'Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
    }});
  if(url.pathname==='/health'&&method==='GET')
   return send(200,{ok:true,service:'wuaihot-offsite-standby',
    availability:'historical-public-snapshots-only',
    householdIndependent:true,liveProviderCollector:false},method);
  if(method==='OPTIONS')return send(204,null,method,{
    Allow:'GET, HEAD, OPTIONS','Access-Control-Max-Age':'86400'});
  if(method!=='GET'&&method!=='HEAD')return send(405,
    {code:405,message:'read_only_standby'},method,{Allow:'GET, HEAD, OPTIONS'});
  if(request.headers.has('authorization')||request.headers.has('cookie'))
   return send(403,{code:403,message:'public_only_no_credentials'},method);
  const path=/^\/([a-z-]+)\/?$/.exec(url.pathname),source=path?.[1];
  if(!source||!Object.hasOwn(SOURCE_VARIANTS,source)||
    url.searchParams.getAll('type').length>1||
    choosePublicVariant(source,url.searchParams.get('type')??undefined)===null)
   return send(404,{code:404,message:'unknown_public_source_variant'},method);
  const variant=SOURCE_VARIANTS[source],name=source+'-'+variant+'.json';
  let doc=null,origin='github-release';
  try{
   const r=await fetchImpl(snapshotUrl(source,variant),{
    method:'GET',redirect:'follow',
    headers:{Accept:'application/json',
      'User-Agent':'wuaihot-independent-cloudflare-standby/1.0'},
    signal:AbortSignal.timeout(timeoutMs)});
   const found=await boundedJson(r);
   if(validSnapshot(found,source,variant,clock()))doc=found;
  }catch{}
  if(!doc&&validSnapshot(seed[name],source,variant,clock())){
   doc=seed[name];origin='bundled-seed';
  }
  if(!doc)return send(503,{
   code:503,message:'verified_offsite_snapshots_unavailable'
  },method,{'Retry-After':'60'});
  const age=snapshotAgeSeconds(doc,clock());
  return send(200,{...doc.payload,standby:{
   active:true,mode:'offsite-snapshot',origin,
   capturedAt:doc.capturedAt,ageSeconds:age,
   sourceUpdatedAt:doc.payload.updateTime??null,
   message:'Historical snapshot; not live new rankings.'
  }},method,{
   'X-HotAPI-Data-Mode':'offsite-snapshot',
   'X-HotAPI-Standby-Age-Seconds':String(age),
   'X-HotAPI-Standby-Captured-At':doc.capturedAt,
   Warning:'110 - "Response is Stale"'
  });
 };
}
const handler=createOffsiteWorker();
export default {fetch(request){return handler(request);}};
