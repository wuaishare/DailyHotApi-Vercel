import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {SOURCE_VARIANTS} from '../lib/standby-core.js';
import {CLOUD_DIRECT_SCHEMA,inspectCloudDirectCandidate}
  from '../lib/cloud-direct-admission.js';
const now=Date.parse('2026-11-11T12:00:00.000Z');
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const rows=()=>Array.from({length:25},(_,i)=>({
  title:'Public title '+i,url:'https://example.org/public/'+i
}));
const fixture=(source='douyin',when=new Date(now-600000).toISOString(),data=rows())=>{
 const variant=SOURCE_VARIANTS[source];
 return {schema:CLOUD_DIRECT_SCHEMA,source,variant,capturedAt:when,
  sourcePublishedAt:null,
  rankDigest:hash(['hotapi-rank-v1',source,variant,
    data.map((x,i)=>[i+1,x.title])]),
  linkDigest:hash(['hotapi-link-v1',source,variant,
    data.map((x,i)=>[i+1,x.url])]),
  payload:{code:200,name:source,total:data.length,data}};
};
const read=(x,s=x?.source,v=x?.variant,t=now)=>inspectCloudDirectCandidate(x,s,v,t);
test('independent known producer digest values and first-party public fields',()=>{
 const x=fixture();
 assert.equal(x.rankDigest,'14d3c0a3c6410e152cb875f340ab80da75c16ac5adee52f9b84c0b30e8928f86');
 assert.equal(x.linkDigest,'ce7755fa12e7422872e349687dff36bf5431ad0d18fd25de4e976ba8ec6ad38f');
 const checked=read(x);
 assert.equal(checked.rows,25);
 assert.equal(checked.bytes,Buffer.byteLength(JSON.stringify(x),'utf8'));
 assert.equal(Object.hasOwn(checked,'generationId'),false);
 assert.ok(Object.isFrozen(checked));
});
test('all seven approved variants work, and cross-source injection fails',()=>{
 assert.equal(Object.keys(SOURCE_VARIANTS).length,7);
 for(const [name,type] of Object.entries(SOURCE_VARIANTS)){
  assert.equal(read(fixture(name),name,type).source,name);
  assert.equal(read(fixture(name),name,'wrong'),null);
 }
 assert.equal(read(fixture(),'xiaohongshu','hot'),null);
 assert.equal(read(fixture(),'baidu','realtime'),null);
});
test('observation is never a forged official publication or old household snapshot',()=>{
 const x=fixture();
 for(const mutation of [
  o=>{o.sourcePublishedAt=o.capturedAt;},
  o=>{o.payload.updateTime=o.capturedAt;},
  o=>{o.schema='hotapi-cloud-snapshot-v1';},
  o=>{o.generationId=1;},
  o=>{o.payload.secret='SECRET';},
  o=>{o.payload.data[0].cookie='SECRET';}
 ]){const y=structuredClone(x);mutation(y);assert.equal(read(y),null);}
});
test('independently recomputes ranking and link digests',()=>{
 const x=fixture();
 for(const mutate of [
  y=>{y.payload.data[0].title='Altered title';},
  y=>{[y.payload.data[0],y.payload.data[1]]=[y.payload.data[1],y.payload.data[0]];},
  y=>{y.payload.data[0].url+='?utm_source=attacker';},
  y=>{y.rankDigest='0'.repeat(64);}
 ]){const y=structuredClone(x);mutate(y);assert.equal(read(y),null);}
});
test('URL, normalized title, hidden fields, sparse rows and totals are rejected',()=>{
 const x=fixture();
 for(const mutate of [
  y=>{y.payload.data[0].url='http://localhost/';},
  y=>{y.payload.data[0].url='https://u:p@example.org/';},
  y=>{y.payload.data[0].title='  Public title  ';},
  y=>{delete y.payload.data[0];},
  y=>{y.payload.total=24;},
  y=>{y.payload.code=201;},
  y=>{y.linkDigest='A'.repeat(64);},
  y=>{y.payload.data=[];y.payload.total=0;}
 ]){const y=structuredClone(x);mutate(y);assert.equal(read(y),null);}
});
test('future, stale, noncanonical timestamps and bad clock are rejected',()=>{
 const x=fixture();
 for(const capturedAt of [
  '2026-11-11T12:02:01.000Z','2026-11-11T08:59:59.000Z',
  '2026-11-11T11:55:00Z','2026-02-30T11:55:00.000Z'
 ])assert.equal(read({...x,capturedAt}),null);
 assert.ok(read({...x,capturedAt:'2026-11-11T12:02:00.000Z'}));
 assert.ok(read({...x,capturedAt:'2026-11-11T09:00:00.000Z'}));
 assert.equal(read(x,undefined,undefined,NaN),null);
});
test('UTF-8 true byte budget, even when item count is legitimate',()=>{
 const data=Array.from({length:200},(_,i)=>({
  title:'文'.repeat(497)+String(i),
  url:'https://example.org/'+'x'.repeat(4000)
 }));
 const x=fixture('weibo',new Date(now).toISOString(),data);
 assert.ok(Buffer.byteLength(JSON.stringify(x),'utf8')>1024*1024);
 assert.equal(read(x),null);
});
test('not connected to production API or household Release writer',()=>{
 const gateway=readFileSync(new URL('../api/standby.js',import.meta.url),'utf8');
 const writer=readFileSync(new URL('../ops/publish-standby-release.sh',import.meta.url),'utf8');
 assert.ok(!gateway.includes('cloud-direct-admission'));
 assert.ok(!writer.includes('cloud-direct-admission'));
 assert.ok(!writer.includes(CLOUD_DIRECT_SCHEMA));
});
