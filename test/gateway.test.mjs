import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const config = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const health = JSON.parse(readFileSync(new URL("../public/_hotapi-gateway/health.json", import.meta.url), "utf8"));

test("seven fixed public standby routes; all remaining paths preserve the sole approved upstream", () => {
  assert.equal(config.rewrites.length, 8);
  for (const source of ['douyin','baidu','kuaishou','weibo','toutiao','qq-news','netease-news']) {
    assert.deepEqual(config.rewrites.find(r=>r.source==='/' + source),
      {source:'/' + source,destination:'/api/standby?source=' + source});
  }
  assert.deepEqual(config.rewrites.at(-1),
    { source: "/:path*", destination: "https://hotapi2.wuaishare.cn/:path*" });
  assert.equal(config.version, 2);
  assert.equal(config.builds, undefined);
  assert.equal(config.routes, undefined);
  assert.equal(config.redirects, undefined);
  assert.equal(config.headers, undefined);
});
test("no legacy backend dependencies or process", () => {
  assert.equal(pkg.name, "hotapi");
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
  assert.equal(pkg.scripts.build, undefined);
  assert.equal(pkg.scripts.start, undefined);
});
test("gateway identity marker does not claim origin health", () => {
  assert.equal(health.service, "hotapi");
  assert.equal(health.kind, "vercel-edge-gateway");
  assert.equal(health.upstreamHealthAttested, false);
  assert.equal(health.productionDomain, "hotapi.wuaishare.cn");
});


test("offsite cloud capture PR runs read-only; only master schedule/dispatch may upload Release assets", () => {
  const wf = readFileSync(new URL("../.github/workflows/hotapi-offsite-standby.yml", import.meta.url), "utf8");
  assert.match(wf, /pull_request:\s*\n\s+paths:/);
  assert.match(wf, /permissions:\s*\n\s{2}contents: read/);
  assert.match(wf, /verify-pr-cloud-capture:\s*\n\s+if: github.event_name == 'pull_request'\s*\n\s+permissions:\s*\n\s+contents: read/);
  assert.match(wf, /persist-credentials: false/);
  assert.match(wf, /github.ref == 'refs\/heads\/master'/);
  assert.match(wf, /github.event_name == 'schedule' \|\| github.event_name == 'workflow_dispatch'/);
  assert.match(wf, /refresh-public-snapshots:[\s\S]*?permissions:\s*\n\s+contents: write/);
  const publisher=readFileSync(new URL("../ops/publish-standby-release.sh",import.meta.url),"utf8");
  assert.ok(wf.includes('run: bash ops/publish-standby-release.sh'));
  assert.ok(publisher.includes('gh release upload "$tag" "$snapshot" --clobber'));
  assert.ok(publisher.includes("gh release download \"$tag\" --pattern '*.json'"));
  assert.ok(publisher.includes("refs/heads/master"));
});

test("PR cloud capture requires all seven; scheduled Release preserves partial verified subset",()=>{
  const wf=readFileSync(new URL("../.github/workflows/hotapi-offsite-standby.yml",import.meta.url),"utf8");
  assert.ok(wf.includes('run: node ops/capture-standby.mjs --out-dir "$RUNNER_TEMP/hotapi-standby" --require-all'));
  assert.match(wf,/name: Capture verified live public rankings\s*\n\s*run: node ops\/capture-standby\.mjs --out-dir "\$RUNNER_TEMP\/hotapi-standby"\s*\n/);
});

test("cloud PR validates real public Release readback without write credentials",()=>{
  const wf=readFileSync(new URL("../.github/workflows/hotapi-offsite-standby.yml",import.meta.url),"utf8");
  assert.ok(wf.includes('name: Read-only comparison with real public Release snapshots'));
  assert.ok(wf.includes('curl --fail --silent --show-error --location'));
  assert.ok(wf.includes('https://github.com/wuaishare/DailyHotApi-Vercel/releases/download/cloud-standby-v1/'));
  assert.ok(wf.includes('decision="$(node ops/compare-release-snapshot.mjs'));
  assert.ok(wf.includes('DRYRUN_ADMISSION $name $decision'));
  const pr=wf.slice(wf.indexOf('  verify-pr-cloud-capture:'),wf.indexOf('  refresh-public-snapshots:'));
  assert.ok(pr.includes('contents: read'));
  assert.ok(!pr.includes('GH_TOKEN:'));
  assert.ok(!pr.includes('gh release upload'));
});
