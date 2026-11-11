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
  assert.match(wf, /gh release upload "\$tag" "\$snapshot" --clobber/);
});
