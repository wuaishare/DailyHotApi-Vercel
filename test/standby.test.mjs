import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStandbyHandler} from '../api/standby.js';
import deployedSeed from '../lib/standby-seed.js';
import {
  SOURCE_VARIANTS, choosePublicVariant, snapshotUrl, validPublicPayload,
  validSnapshot, sanitizeUpstreamPathQuery,
} from '../lib/standby-core.js';
import {captureAll, captureSource, captureExitCode} from '../ops/capture-standby.mjs';

const current = Date.parse('2026-11-11T01:00:00Z');
const body = (source = 'douyin') => ({
  code:200,name:source,total:25,updateTime:new Date(current-600000).toISOString(),
  data:Array.from({length:25},(_,i)=>({id:String(i+1),title:'Ranked headline '+i,
    url:'https://example.org/topic/'+(i+1)})),
});
const makeSnapshot = (source = 'douyin') => ({
  schema:'hotapi-cloud-snapshot-v1',source,variant:SOURCE_VARIANTS[source],
  capturedAt:new Date(current-300000).toISOString(),payload:body(source),
});
const reply = (json,status=200,ctype='application/json') =>
  new Response(typeof json==='string'?json:JSON.stringify(json),
    {status,headers:{'content-type':ctype}});
const request = (source='douyin',type='hot', headers={}) => ({
  method:'GET',url:'/api/standby?source='+source+'&type='+type+'&cache=true',
  query:{source,type,cache:'true'},headers,
});
const run = async (handler, req=request()) => {
  const headers=new Map();
  const res={statusCode:200,setHeader:(k,v)=>headers.set(k.toLowerCase(),v),
    end(v){this.body=v}};
  await handler(req,res);
  return {status:res.statusCode,headers,body:res.body,
    json:res.body?JSON.parse(res.body):null};
};

test('only 7 exact public sources and known variants permit cloud fallback',()=>{
  assert.equal(Object.keys(SOURCE_VARIANTS).length,7);
  assert.equal(choosePublicVariant('douyin','hot'),'hot');
  assert.equal(choosePublicVariant('baidu','realtime'),'realtime');
  assert.equal(choosePublicVariant('baidu','hot'),null);
  assert.equal(choosePublicVariant('xiaohongshu','hot'),null);
  assert.equal(choosePublicVariant('../douyin','hot'),null);
  assert.equal(choosePublicVariant('douyin',['hot','evil']),null);
  assert.equal(snapshotUrl('douyin','hot'),
    'https://github.com/wuaishare/DailyHotApi-Vercel/releases/download/cloud-standby-v1/douyin-hot.json');
  assert.equal(snapshotUrl('xiaohongshu','hot'),null);
  assert.equal(sanitizeUpstreamPathQuery(request().url,'douyin'),
    'https://hotapi2.wuaishare.cn/douyin?type=hot&cache=true');
  assert.equal(sanitizeUpstreamPathQuery('/douyin?type=hot&__standby_fault=all-remote-502&cache=true','douyin'),
    'https://hotapi2.wuaishare.cn/douyin?type=hot&cache=true');
});
test('gateway routes cover approved sources but retain all other original upstream rewrites',()=>{
  const cfg=JSON.parse(readFileSync(new URL('../vercel.json',import.meta.url)));
  assert.equal(cfg.version,2);
  assert.equal(cfg.rewrites.length,8);
  for(const [source] of Object.entries(SOURCE_VARIANTS)){
    assert.deepEqual(cfg.rewrites.find(x=>x.source==='/'+source),
      {source:'/'+source,destination:'/api/standby?source='+source});
  }
  assert.deepEqual(cfg.rewrites.at(-1),
    {source:'/:path*',destination:'https://hotapi2.wuaishare.cn/:path*'});
  assert.ok(!cfg.rewrites.some(x=>x.source.includes('xiaohongshu')));
  assert.equal(cfg.builds,undefined);
});
test('the seven bundled emergency snapshots are authentic schema-valid real API captures',()=>{
  assert.equal(Object.keys(deployedSeed).length,7);
  const actualCapturedAt = Date.now();
  for(const [source,variant] of Object.entries(SOURCE_VARIANTS)){
    const s=deployedSeed[source+'-'+variant+'.json'];
    assert.ok(validSnapshot(s,source,variant,actualCapturedAt),source);
    assert.ok(s.payload.data.length>=15,source);
    assert.ok(s.payload.data.slice(0,15).every(x=>typeof x.title==='string' && x.title.trim()),source);
  }
});
test('upstream healthy is preferred, response contract retained, no cloud read',async()=>{
  const calls=[];
  const handler=createStandbyHandler({clock:()=>current,fetchImpl:async(url,options)=>{
    calls.push({url,options});return reply(body())}});
  const res=await run(handler);
  assert.equal(res.status,200);
  assert.equal(res.json.data.length,25);
  assert.equal(res.json.standby,undefined);
  assert.equal(res.headers.get('x-hotapi-data-mode'),'upstream');
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,'https://hotapi2.wuaishare.cn/douyin?type=hot&cache=true');
  assert.equal(calls[0].options.headers.Authorization,undefined);
  assert.equal(calls[0].options.headers.Cookie,undefined);
});
test('preview-only explicit fault headers exercise release, bundle and denial paths; production cannot',async()=>{
  const calls=[];
  const env={VERCEL_ENV:'preview',HOTAPI_STANDBY_PREVIEW_FAULT:'1'};
  const preview=createStandbyHandler({clock:()=>current,env,fetchImpl:async(url)=>{calls.push(url);return reply(makeSnapshot())}});
  const req={...request(),url:'/api/standby?source=douyin&type=hot&__standby_fault=upstream-502',query:{source:'douyin',type:'hot',__standby_fault:'upstream-502'}};
  const result=await run(preview,req);
  assert.equal(result.status,200);
  assert.equal(result.headers.get('x-hotapi-data-mode'),'offsite-snapshot');
  assert.equal(calls.length,1);
  assert.match(calls[0],/github.com/);
  calls.length=0;
  const bundle=await run(preview,{...req,url:'/api/standby?source=douyin&type=hot&__standby_fault=all-remote-502',query:{source:'douyin',type:'hot',__standby_fault:'all-remote-502'}});
  assert.equal(bundle.status,200);
  assert.equal(bundle.headers.get('x-hotapi-data-mode'),'offsite-snapshot');
  assert.equal(bundle.json.standby.active,true);
  assert.equal(bundle.json.data.length,50);
  assert.equal(calls.length,0); // neither bt1 nor GitHub was contacted
  const denied=await run(preview,{...req,url:'/api/standby?source=douyin&type=hot&__standby_fault=upstream-403',query:{source:'douyin',type:'hot',__standby_fault:'upstream-403'}});
  assert.equal(denied.status,403);
  assert.equal(denied.headers.has('x-hotapi-data-mode'),false);
  assert.equal(calls.length,0); // explicit 403 never bypasses via a snapshot
  for(const safeEnv of [{VERCEL_ENV:'production',HOTAPI_STANDBY_PREVIEW_FAULT:'1'},{VERCEL_ENV:'preview',HOTAPI_STANDBY_PREVIEW_FAULT:'0'},{VERCEL_ENV:'preview'}]){
    let count=0;
    const handler=createStandbyHandler({env:safeEnv,clock:()=>current,fetchImpl:async()=>{count++;return reply(body())}});
    const r=await run(handler,req);
    assert.equal(r.status,200);
    assert.equal(r.headers.get('x-hotapi-data-mode'),'upstream');
    assert.equal(count,1);
  }
});
test('bt1 blackout: cloud release snapshot returns verified stale data with honest metadata',async()=>{
  const urls=[];
  const handler=createStandbyHandler({clock:()=>current,
    fetchImpl:async(url)=>{urls.push(url);return urls.length===1?
      reply({code:502},502):reply(makeSnapshot())}});
  const res=await run(handler);
  assert.equal(res.status,200);
  assert.equal(res.json.data.length,25);
  assert.equal(res.json.standby.active,true);
  assert.equal(res.json.standby.mode,'offsite-snapshot');
  assert.equal(res.json.standby.ageSeconds,300);
  assert.equal(res.headers.get('x-hotapi-data-mode'),'offsite-snapshot');
  assert.match(res.headers.get('warning'),/Stale/);
  assert.match(urls[1],/github.com\/wuaishare\/DailyHotApi-Vercel\/releases\/download\/cloud-standby-v1\/douyin-hot.json/);
});
test('both home and Release inaccessible: verified bundled seed still works',async()=>{
  const seed={'douyin-hot.json':makeSnapshot()};
  const handler=createStandbyHandler({seed,clock:()=>current,fetchImpl:async()=>{
    throw new TypeError('power outage or remote failure')}});
  const res=await run(handler);
  assert.equal(res.status,200);
  assert.equal(res.json.data[0].title,'Ranked headline 0');
  assert.equal(res.json.standby.mode,'offsite-snapshot');
});
test('streamed oversized JSON without Content-Length is cancelled before fallback',async()=>{
  let pulls=0, cancels=0, calls=0;
  const stream=new ReadableStream({
    pull(controller){
      pulls++;
      controller.enqueue(new Uint8Array(128*1024).fill(120));
    },
    cancel(){cancels++},
  });
  const handler=createStandbyHandler({clock:()=>current,fetchImpl:async()=>{
    calls++;
    if(calls===1) return new Response(stream,{status:200,
      headers:{'content-type':'application/json'}});
    return reply(makeSnapshot());
  }});
  const res=await run(handler);
  assert.equal(res.status,200);
  assert.equal(res.json.standby.active,true);
  assert.equal(res.headers.get('x-hotapi-data-mode'),'offsite-snapshot');
  assert.equal(calls,2);
  assert.equal(cancels,1);
  assert.ok(pulls<=12, 'never read the unlimited chunked stream');
});
test('dishonest oversized Content-Length is rejected before reading body',async()=>{
  let pulls=0, calls=0;
  const stream=new ReadableStream({
    pull(controller){
      pulls++;
      controller.enqueue(new Uint8Array(128));
    },
  });
  const handler=createStandbyHandler({clock:()=>current,fetchImpl:async()=>{
    calls++;
    if(calls===1) return new Response(stream,{status:200,headers:{
      'content-type':'application/json','content-length':'1048577'}});
    return reply(makeSnapshot());
  }});
  const res=await run(handler);
  assert.equal(res.status,200);
  assert.equal(res.json.standby.active,true);
  assert.equal(calls,2);
  assert.ok(pulls<=1,'large declared body was never consumed');
});
test('failed cloud and bundled seed => explicit 503, never fabricate rank rows',async()=>{
  const h=createStandbyHandler({seed:{},clock:()=>current,fetchImpl:async()=>reply({error:true},503)});
  const r=await run(h);
  assert.equal(r.status,503);
  assert.equal(r.json.code,503);
  assert.equal(r.headers.get('retry-after'),'60');
});
test('explicit upstream denials never fetch cloud backup',async()=>{
  for(const status of [400,401,403,404,429]){
    let n=0;
    const handler=createStandbyHandler({clock:()=>current,
      fetchImpl:async()=>{n++;return reply({code:status},status)}});
    const res=await run(handler);
    assert.equal(res.status,status);
    assert.equal(n,1);
    assert.equal(res.headers.has('x-hotapi-data-mode'),false);
  }
});
test('unapproved variants, credentials and arbitrary sources never use cloud snapshot',async()=>{
  for(const input of [request('baidu','hot'),request('xiaohongshu','hot'),
    request('douyin','challenge'),request('douyin','hot',{authorization:'Bearer no'})]){
    let n=0;
    const r=await run(createStandbyHandler({clock:()=>current,
      fetchImpl:async()=>{n++;return reply({code:502},502)}}),input);
    assert.equal(r.status,input.query.source==='xiaohongshu'?404:503);
    assert.equal(n,input.query.source==='xiaohongshu'?0:1);
  }
});
test('corrupted/off-source Github asset is rejected, seed if valid',async()=>{
  const poisoned={...makeSnapshot(),source:'other'};
  const handler=createStandbyHandler({clock:()=>current,
    seed:{'douyin-hot.json':makeSnapshot()},
    fetchImpl:async(url)=>url.startsWith('https://hotapi2')?
      reply({code:502},502):reply(poisoned)});
  const r=await run(handler);
  assert.equal(r.status,200);
  assert.equal(r.json.standby.active,true);
  assert.equal(validSnapshot(poisoned,'douyin','hot',current),false);
});
test('invalid poison without fallback becomes 503, not silent green',async()=>{
  const invalid={...makeSnapshot(),payload:{...body(),data:[{title:'short'}]}};
  assert.equal(validSnapshot(invalid,'douyin','hot',current),false);
  const handler=createStandbyHandler({clock:()=>current,seed:{},
    fetchImpl:async(url)=>url.startsWith('https://hotapi2')?
      reply({code:502},502):reply(invalid)});
  assert.equal((await run(handler)).status,503);
});
test('tail rows are validated, not just first ten ranked headlines',async()=>{
  const corrupted={...body(),data:body().data.map((item,i)=>
    i===24?{...item,title:'   '}:item)};
  assert.equal(validPublicPayload('douyin',corrupted),false);
  let calls=0;
  const h=createStandbyHandler({clock:()=>current,fetchImpl:async()=>{
    calls++;
    return calls===1?reply(corrupted):reply(makeSnapshot());
  }});
  const res=await run(h);
  assert.equal(calls,2);
  assert.equal(res.status,200);
  assert.equal(res.headers.get('x-hotapi-data-mode'),'offsite-snapshot');
  assert.equal(res.json.standby.active,true);
});
test('upstream 200 preserves data but discloses stale or unverified times',async()=>{
  for(const [updated,expected,warning,seconds] of [
    [new Date(current-4*3600000).toISOString(),'stale','110',14400],
    [undefined,'unverified','199',null],
    [new Date(current+5*60000).toISOString(),'future','199',null],
    [new Date(current-600000).toISOString(),'recent',null,600],
  ]){
    let calls=0;
    const payload={...body(),updateTime:updated};
    const h=createStandbyHandler({clock:()=>current,fetchImpl:async()=>{
      calls++;return reply(payload);
    }});
    const res=await run(h);
    assert.equal(res.status,200);
    assert.equal(calls,1,'stale upstream is kept, not replaced with older cloud data');
    assert.equal(res.headers.get('x-hotapi-data-mode'),'upstream');
    assert.equal(res.headers.get('x-hotapi-upstream-freshness'),expected);
    assert.equal(res.json.standby,undefined);
    if(warning) assert.ok(res.headers.get('warning')?.startsWith(warning+' '));
    else assert.equal(res.headers.has('warning'),false);
    if(seconds!==null)
      assert.equal(res.headers.get('x-hotapi-upstream-data-age-seconds'),String(seconds));
    else assert.equal(res.headers.has('x-hotapi-upstream-data-age-seconds'),false);
    assert.match(res.headers.get('access-control-expose-headers'),/X-HotAPI-Upstream-Freshness/);
  }
});
test('empty, too short, or missing-title data cannot become a capture',async()=>{
  assert.equal(validPublicPayload('douyin',body()),true);
  assert.equal(validPublicPayload('douyin',{...body(),data:[]}),false);
  assert.equal(validPublicPayload('douyin',{...body(),data:[{title:'x'}]}),false);
  assert.equal(validPublicPayload('douyin',{...body(),data:Array(25).fill({title:''})}),false);
});
test('snapshot capture rejects stale upstream and ensures actual metadata',async()=>{
  const good=await captureSource('douyin',{now:()=>current,
    fetchImpl:async()=>reply(body())});
  assert.equal(good.schema,'hotapi-cloud-snapshot-v1');
  assert.equal(good.source,'douyin');
  assert.equal(validSnapshot(good,'douyin','hot',current),true);
  const bad={...body(),updateTime:new Date(current-3600000*4).toISOString()};
  await assert.rejects(captureSource('douyin',{now:()=>current,
    fetchImpl:async()=>reply(bad)}),/not_fresh/);
  await assert.rejects(captureSource('xiaohongshu',{now:()=>current,
    fetchImpl:async()=>reply(body())}),/not_approved/);
});
test('cloud capture cancels an unlimited chunked body at the shared 1 MiB boundary',async()=>{
  let pulls=0, cancels=0;
  const stream=new ReadableStream({
    pull(controller){
      pulls++;
      controller.enqueue(new Uint8Array(128*1024).fill(120));
    },
    cancel(){cancels++},
  });
  await assert.rejects(captureSource('douyin',{now:()=>current,
    fetchImpl:async()=>new Response(stream,{status:200,headers:{
      'content-type':'application/json',
    }})}),/invalid_or_oversized/);
  assert.equal(cancels,1);
  assert.ok(pulls<=12, 'cannot read or buffer the unbounded upstream body');
});
test('seed generation requires all sources valid; no partial seed overwrite',async()=>{
  const tmp=mkdtempSync(join(tmpdir(),'hotapi-standby-qa-'));
  try {
    await assert.rejects(captureAll({outDir:tmp,seedFile:join(tmp,'seed.js'),now:()=>current,
      fetchImpl:async(url)=>url.includes('/weibo')?reply({code:500},500):reply(body())}),
    /incomplete bundled fallback seed/);
  }finally{rmSync(tmp,{recursive:true,force:true})}
});
test('public fallback is read-only, no HTTP method override or dynamic source',async()=>{
  const calls=[];
  const h=createStandbyHandler({clock:()=>current,fetchImpl:async(url)=>{
    calls.push(url);return reply(body())}});
  const preflight=await run(h,{...request(),method:'OPTIONS'});
  assert.equal(preflight.status,204);
  assert.equal(preflight.headers.get('access-control-allow-methods'),'GET, HEAD, OPTIONS');
  assert.equal(calls.length,0);
  const rejected=await run(h,{...request(),method:'POST'});
  assert.equal(rejected.status,405);
  assert.equal(rejected.headers.get('allow'),'GET, HEAD, OPTIONS');
  assert.equal(calls.length,0);
  const no=await run(h,{...request(),query:{source:'../../admin'}});
  assert.equal(no.status,404);
  assert.equal(calls.length,0);
});

test('PR dry run fails on partial provider outage; scheduled refresh preserves verified subset',()=>{
  const all={approved:7,written:7,skipped:[]};
  const partial={approved:7,written:6,skipped:['weibo']};
  const none={approved:7,written:0,skipped:Object.keys(SOURCE_VARIANTS)};
  assert.equal(captureExitCode(all,{requireAll:true}),0);
  assert.equal(captureExitCode(all),0);
  assert.equal(captureExitCode(partial,{requireAll:true}),1);
  assert.equal(captureExitCode(partial),0);
  assert.equal(captureExitCode(none,{requireAll:true}),1);
  assert.equal(captureExitCode(none),1);
});
