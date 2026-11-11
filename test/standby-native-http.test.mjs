// Actual Node HTTP server tests of method semantics. Vercel's protected
// Preview still requires a separate authenticated HTTP HEAD/OPTIONS check.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createStandbyHandler} from '../api/standby.js';

const clock=Date.parse('2026-11-11T11:00:00.000Z');
const ranking=()=>({
  code:200,name:'douyin',total:25,updateTime:new Date(clock-300000).toISOString(),
  data:Array.from({length:25},(_,i)=>({
    title:'Public '+i,url:'https://example.org/public/'+i
  }))
});
const snap=()=>({
  schema:'hotapi-cloud-snapshot-v1',
  source:'douyin',variant:'hot',capturedAt:new Date(clock-600000).toISOString(),
  payload:ranking()
});
const response=(data,status=200)=>
  new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});

async function withServer(fetchImpl,execute){
  const handler=createStandbyHandler({fetchImpl,clock:()=>clock,
    env:{VERCEL_ENV:'production'}});
  const server=createServer((req,res)=>{
    const u=new URL(req.url,'http://127.0.0.1');
    req.query={...Object.fromEntries(u.searchParams),source:'douyin'};
    Promise.resolve(handler(req,res)).catch(()=>{
      res.statusCode=500;res.end();
    });
  });
  server.listen(0,'127.0.0.1');
  try{
    await once(server,'listening');
    const address=server.address();
    return await execute('http://127.0.0.1:'+address.port);
  }finally{
    server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
  }
}
test('real HTTP GET, HEAD, OPTIONS verify payload/headers and no HEAD body',async()=>{
  const calls=[];
  const fake=async(url,opt)=>{
    calls.push({url,method:opt.method});
    return response(ranking());
  };
  await withServer(fake,async(base)=>{
    const url=base+'/douyin?type=hot&cache=true';
    const get=await fetch(url);
    assert.equal(get.status,200);
    assert.equal((await get.json()).data.length,25);
    assert.equal(get.headers.get('x-hotapi-data-mode'),'upstream');
    const head=await fetch(url,{method:'HEAD'});
    assert.equal(head.status,200);
    assert.equal(await head.text(),'');
    assert.equal(head.headers.get('x-hotapi-data-mode'),'upstream');
    const n=calls.length;
    const options=await fetch(url,{method:'OPTIONS'});
    assert.equal(options.status,204);
    assert.equal(await options.text(),'');
    assert.match(options.headers.get('allow'),/HEAD/);
    assert.equal(options.headers.get('access-control-allow-origin'),'*');
    assert.equal(calls.length,n,'OPTIONS must not call a remote provider');
    assert.deepEqual(calls.map(x=>x.method),['GET','GET']);
  });
});
test('real HTTP HEAD uses same verified stale snapshot as GET after upstream 502',async()=>{
  const calls=[];
  const fake=async(url,opt)=>{
    calls.push({url,method:opt.method});
    return url.includes('hotapi2.wuaishare.cn')?
      response({code:502},502):response(snap());
  };
  await withServer(fake,async(base)=>{
    const url=base+'/douyin?type=hot';
    const head=await fetch(url,{method:'HEAD'});
    assert.equal(head.status,200);
    assert.equal(await head.text(),'');
    assert.equal(head.headers.get('x-hotapi-data-mode'),'offsite-snapshot');
    assert.match(head.headers.get('warning'),/110/);
    assert.ok(Number(head.headers.get('x-hotapi-standby-age-seconds'))>=0);
    const get=await fetch(url);
    const body=await get.json();
    assert.equal(body.standby.active,true);
    assert.equal(body.data.length,25);
    assert.ok(calls.every(x=>x.method==='GET'));
    assert.equal(calls.length,4);
  });
});
test('real HTTP HEAD preserves denial and never uses a cloud bypass for 403',async()=>{
  const calls=[];
  await withServer(async(url,opt)=>{
    calls.push({url,method:opt.method});
    return response({code:403},403);
  },async(base)=>{
    const res=await fetch(base+'/douyin?type=hot',{method:'HEAD'});
    assert.equal(res.status,403);
    assert.equal(await res.text(),'');
    assert.equal(res.headers.get('x-hotapi-data-mode'),null);
    assert.equal(calls.length,1);
  });
});
test('real HTTP POST is 405, with no upstream requests',async()=>{
  let count=0;
  await withServer(async()=>{count++;return response(ranking());},async(base)=>{
    const res=await fetch(base+'/douyin?type=hot',{method:'POST'});
    assert.equal(res.status,405);
    assert.match(res.headers.get('allow'),/GET, HEAD, OPTIONS/);
    assert.equal((await res.json()).message,'public_read_only');
    assert.equal(count,0);
  });
});
