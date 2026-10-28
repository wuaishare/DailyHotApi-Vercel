import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const config = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const health = JSON.parse(readFileSync(new URL("../public/_hotapi-gateway/health.json", import.meta.url), "utf8"));

test("only one fixed HTTPS origin; no untrusted redirect or dynamic forwarding", () => {
  assert.deepEqual(config.rewrites, [{ source: "/:path*", destination: "https://hotapi2.wuaishare.cn/:path*" }]);
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
