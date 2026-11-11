import test from 'node:test';
import assert from 'node:assert/strict';
import seeds from '../lib/standby-seed.js';
import {SOURCE_VARIANTS,snapshotUrl} from '../lib/standby-core.js';
import {createOffsiteWorker} from '../cloudflare/offsite-worker.mjs';
const now=Date.parse('2026-11-11T14:00:00.000Z');
const sample=src=>seeds[src+'-'+SOURCE_VARIANTS[src]+'.json'];
const request=(path,method='GET',headers)=>new Request(
 'https://wuaihot-offsite-standby.wpzyh.workers.dev'+path,{method,headers});
const json=(doc,status=200)=>new Response(JSON.stringify(doc),{
 status,headers:{'Content-Type':'application/json'}});
test('seven public release asset URLs are fixed and household-independent',async()=>{
 let urls=[];
 const h=createOffsiteWorker({clock:()=>now,fetchImpl:async url=>{
  urls.push(url);
  const name=Object.keys(SOURCE_VARIANTS).find(x=>url===snapshotUrl(x,SOURCE_VARIANTS[x]));
  return json(sample(name));
 }});
 for(const [src,variant] of Object.entries(SOURCE_VARIANTS)){
  const r=await h(request('/'+src+'?type='+variant));
  assert.equal(r.status,200,src);
  const b=await r.json();
  assert.equal(b.standby.origin,'github-release');
  assert.equal(b.standby.active,true);
  assert.ok(b.data.length>=10);
  assert.equal(r.headers.get('x-hotapi-data-mode'),'offsite-snapshot');
  assert.match(r.headers.get('warning'),/110/);
 }
 assert.equal(urls.length,7);
 assert.ok(urls.every(x=>x.startsWith(
 'https://github.com/wuaishare/DailyHotApi-Vercel/releases/download/')));
});
test('remote failures and invalid remote content use last-good bundled seed',async()=>{
 for(const fail of [async()=>json({},502),async()=>{throw Error('offline')},
   async()=>json({code:200,data:[{title:'invalid'}]})]){
  const h=createOffsiteWorker({clock:()=>now,fetchImpl:fail});
  const r=await h(request('/baidu?type=realtime'));
  assert.equal(r.status,200);
  const b=await r.json();
  assert.equal(b.standby.origin,'bundled-seed');
  assert.ok(b.standby.ageSeconds>=0);
  assert.equal(b.standby.sourceUpdatedAt,sample('baidu').payload.updateTime);
 }
});
test('bad routes variants and private credentials do not fetch upstream',async()=>{
 let count=0;const h=createOffsiteWorker({clock:()=>now,fetchImpl:async()=>{
  count++;return json(sample('douyin'));}});
 for(const url of ['/xiaohongshu','/baidu?type=hot','/douyin?type=hot&type=hot',
 '/all','/admin','/http://malicious.example']){
  assert.equal((await h(request(url))).status,404,url);
 }
 for(const headers of [{Authorization:'Bearer fake'},{Cookie:'auth=x'}]){
  assert.equal((await h(request('/douyin','GET',headers))).status,403);
 }
 assert.equal(count,0);
});
test('HEAD GET OPTIONS POST methods remain safe and health is honestly historical',async()=>{
 let count=0;const h=createOffsiteWorker({clock:()=>now,fetchImpl:async()=>{count++;return json(sample('douyin'));}});
 const head=await h(request('/douyin','HEAD'));
 assert.equal(head.status,200);assert.equal(await head.text(),'');
 assert.equal((await h(request('/douyin','OPTIONS'))).status,204);
 assert.equal((await h(request('/douyin','POST'))).status,405);
 const health=await (await h(request('/health'))).json();
 assert.equal(health.liveProviderCollector,false);
 assert.equal(health.householdIndependent,true);
 assert.equal(count,1);
});
test('overlong or future remote document never supplants verified seed',async()=>{
 for(const out of [new Response('x'.repeat(1024*1024+2)),
  json({...sample('douyin'),capturedAt:'2999-01-01T00:00:00.000Z'})]){
  const h=createOffsiteWorker({clock:()=>now,fetchImpl:async()=>out.clone()});
  assert.equal((await (await h(request('/douyin'))).json()).standby.origin,'bundled-seed');
 }
});
test('no public data source or verified seed must fail rather than invent freshness',async()=>{
 const h=createOffsiteWorker({clock:()=>now,seed:{},fetchImpl:async()=>json({},502)});
 assert.equal((await h(request('/douyin'))).status,503);
});

test('human-friendly standby landing page is static and visibly historical',async()=>{
 const h=createOffsiteWorker({clock:()=>now,fetchImpl:async()=>{throw Error('should-not-fetch');}});
 const r=await h(request('/'));
 assert.equal(r.status,200);
 const html=await r.text();
 assert.match(html,/吾爱热榜 · 云端应急看板/);
 assert.match(html,/历史快照，不是实时热搜/);
 assert.match(html,/grid-template-columns/);
 assert.match(html,/netease-news/);
 assert.match(r.headers.get('content-security-policy'),/frame-ancestors 'none'/);
 const head=await h(request('/','HEAD'));
 assert.equal(head.status,200);
 assert.equal(await head.text(),'');
});
