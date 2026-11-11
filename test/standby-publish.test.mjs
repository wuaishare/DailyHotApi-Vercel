import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root=fileURLToPath(new URL('../',import.meta.url));
const script=fileURLToPath(new URL('../ops/publish-standby-release.sh',import.meta.url));
const now=Date.now();
const sample=(source,variant,ageMin,captureMin)=>({
  schema:'hotapi-cloud-snapshot-v1',source,variant,
  capturedAt:new Date(now-captureMin*60000).toISOString(),
  payload:{code:200,name:source,total:25,
    updateTime:new Date(now-ageMin*60000).toISOString(),
    data:Array.from({length:25},(_,i)=>({title:'Authentic ranked item '+i}))},
});

function runFakePublisher({branch='refs/heads/master',event='schedule',failDownload=false,releaseExists=true}={}) {
  const dir=mkdtempSync(join(tmpdir(),'hotapi-release-sandbox-'));
  const bin=join(dir,'bin'), incoming=join(dir,'hotapi-standby'), old=join(dir,'previous');
  mkdirSync(bin);mkdirSync(incoming);mkdirSync(old);
  const ghLog=join(dir,'gh.log'), summary=join(dir,'summary');
  const stage=(name,source,variant,newAge,newCapture,oldAge,oldCapture)=>{
    writeFileSync(join(incoming,name),JSON.stringify(sample(source,variant,newAge,newCapture)));
    writeFileSync(join(old,name),JSON.stringify(sample(source,variant,oldAge,oldCapture)));
  };
  stage('douyin-hot.json','douyin','hot',10,1,20,6);
  stage('baidu-realtime.json','baidu','realtime',10,1,5,2);
  const fakeGh=`#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path');
const [group,verb,...args]=process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_GH_LOG,[group,verb,...args].join(' ')+'\\n');
if(group!=='release')process.exit(7);
if(verb==='view')process.exit(process.env.FAKE_HAS_RELEASE==='1'?0:1);
if(verb==='create')process.exit(0);
if(verb==='download'){
  if(process.env.FAKE_FAIL_DOWNLOAD==='1')process.exit(7);
  const dir=args[args.indexOf('--dir')+1];
  fs.mkdirSync(dir,{recursive:true});
  for(const file of fs.readdirSync(process.env.FAKE_PREV_DIR))
    fs.copyFileSync(path.join(process.env.FAKE_PREV_DIR,file),path.join(dir,file));
  process.exit(0);
}
if(verb==='upload')process.exit(0);
process.exit(9);
`;
  writeFileSync(join(bin,'gh'),fakeGh,{mode:0o755});
  const env={...process.env,PATH:bin+':'+process.env.PATH,
    GH_REPO:'wuaishare/DailyHotApi-Vercel',GH_TOKEN:'fake-unit-test-only',
    GITHUB_REPOSITORY:'wuaishare/DailyHotApi-Vercel',
    GITHUB_REF:branch,GITHUB_EVENT_NAME:event,RUNNER_TEMP:dir,
    GITHUB_SHA:'0123456789abcdef0123456789abcdef01234567',
    GITHUB_STEP_SUMMARY:summary,FAKE_GH_LOG:ghLog,FAKE_PREV_DIR:old,
    FAKE_HAS_RELEASE:releaseExists?'1':'0',FAKE_FAIL_DOWNLOAD:failDownload?'1':'0'};
  const result=spawnSync('bash',[script],{cwd:root,env,encoding:'utf8',timeout:30000});
  const calls=readFileSync(ghLog,{encoding:'utf8',flag:'a+'});
  const writtenSummary=readFileSync(summary,{encoding:'utf8',flag:'a+'});
  rmSync(dir,{recursive:true,force:true});
  return {result,calls,summary:writtenSummary};
}

test('scheduled publication updates newer asset and preserves older candidate',()=>{
  const {result,calls,summary}=runFakePublisher();
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/PUBLISHED douyin-hot.json/);
  assert.match(result.stdout,/PRESERVED baidu-realtime.json/);
  assert.match(calls,/release download cloud-standby-v1/);
  assert.match(calls,/release upload cloud-standby-v1 .*douyin-hot.json/);
  assert.doesNotMatch(calls,/release upload cloud-standby-v1 .*baidu-realtime.json/);
  assert.match(summary,/updated=1 preserved=1/);
});
test('failed download of prior known-good Release fails closed without upload',()=>{
  const {result,calls}=runFakePublisher({failDownload:true});
  assert.notEqual(result.status,0);
  assert.match(calls,/release download cloud-standby-v1/);
  assert.doesNotMatch(calls,/release upload/);
});
test('non-default branch or PR event cannot call privileged publisher',()=>{
  for(const options of [{branch:'refs/heads/feature'},{event:'pull_request'}]){
    const {result,calls}=runFakePublisher(options);
    assert.equal(result.status,2);
    assert.match(result.stderr,/restricted to default-branch/);
    assert.equal(calls,'');
  }
});
