import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SOURCE_VARIANTS} from '../lib/standby-core.js';
import {replacementDecision} from '../ops/compare-release-snapshot.mjs';

const now=Date.parse('2026-11-11T12:00:00Z');
const snapshot=(ageMin=10,captureMin=1,source='douyin')=>({
  schema:'hotapi-cloud-snapshot-v1',source,variant:SOURCE_VARIANTS[source],
  capturedAt:new Date(now-captureMin*60000).toISOString(),
  payload:{code:200,name:source,total:25,
    updateTime:new Date(now-ageMin*60000).toISOString(),
    data:Array.from({length:25},(_,i)=>({title:'Valid headline '+i}))},
});

test('new source timestamp replaces prior verified older Release asset',()=>{
  assert.equal(replacementDecision('douyin','hot',snapshot(10,1),snapshot(25,20),now),'PUBLISH');
  assert.equal(replacementDecision('douyin','hot',snapshot(10,1),null,now),'PUBLISH');
});
test('cached older/equal source update never rewrites a last-good snapshot',()=>{
  assert.equal(replacementDecision('douyin','hot',snapshot(30,1),snapshot(10,5),now),'KEEP');
  assert.equal(replacementDecision('douyin','hot',snapshot(10,1),snapshot(10,5),now),'KEEP');
  assert.equal(replacementDecision('douyin','hot',snapshot(5,10),snapshot(15,1),now),'KEEP');
});
test('invalid old asset can be repaired, but new invalid or stale snapshots fail closed',()=>{
  assert.equal(replacementDecision('douyin','hot',snapshot(),{...snapshot(15,10),source:'weibo'},now),'PUBLISH');
  assert.throws(()=>replacementDecision('douyin','hot',{...snapshot(),source:'weibo'},null,now),/unverified_incoming_snapshot/);
  assert.throws(()=>replacementDecision('douyin','hot',snapshot(200,1),null,now),/incoming_snapshot_not_fresh/);
  assert.throws(()=>replacementDecision('douyin','hot',snapshot(-5,1),null,now),/unverified_incoming_snapshot/);
  assert.throws(()=>replacementDecision('douyin','realtime',snapshot(),null,now),/unapproved_release_asset/);
});
test('scheduled publisher compares existing Release and never downgrades source time',()=>{
  const wf=readFileSync(new URL('../.github/workflows/hotapi-offsite-standby.yml',import.meta.url),'utf8');
  const publisher=readFileSync(new URL('../ops/publish-standby-release.sh',import.meta.url),'utf8');
  assert.ok(wf.includes('run: bash ops/publish-standby-release.sh'));
  assert.ok(publisher.includes("gh release download \"$tag\" --pattern '*.json'"));
  assert.ok(publisher.includes('verdict="$(node ops/compare-release-snapshot.mjs'));
  assert.ok(publisher.includes('if [[ "$verdict" == KEEP ]]'));
  assert.ok(publisher.includes('if [[ "$verdict" != PUBLISH ]]'));
  assert.ok(publisher.includes('gh release upload "$tag" "$snapshot" --clobber'));
  assert.ok(publisher.includes('GITHUB_EVENT_NAME'));
  assert.ok(publisher.includes('refs/heads/master'));
});
