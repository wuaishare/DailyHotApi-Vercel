import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const packageFile = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const vercel = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
const entrypoint = readFileSync(new URL("../index.js", import.meta.url), "utf8");

assert.equal(packageFile.name, "dailyhot-api-vercel");
assert.equal(packageFile.type, "module");
assert.equal(packageFile.main, "index.js");
assert.ok(packageFile.dependencies?.["dailyhot-api"]);
assert.equal(vercel.version, 2);
assert.ok(vercel.builds?.some(
  (entry) => entry.src === "index.js" && entry.use === "@vercel/node"
), "Vercel builder must remain bound to the actual entrypoint");
assert.ok(vercel.routes?.some(
  (route) => route.src === "/(.*)" && route.dest === "/"
), "The legacy API must retain its catch-all routing contract");
assert.match(entrypoint, /import\s+serveHotApi\s+from\s+["']dailyhot-api["']/);
assert.match(entrypoint, /serveHotApi\s*\(\s*\)/);

// IMPORTANT: This is deliberately an *offline source contract* audit.
// It cannot attest an active Vercel Git webhook, runtime, zone DNS,
// domain ownership or live API health. Those require provider evidence.
console.log(JSON.stringify({
  check: "legacy-vercel-source-contract",
  result: "pass",
  entry: "index.js",
  framework: "@vercel/node",
  package: packageFile.dependencies["dailyhot-api"],
  runtimeDeployed: "unverified",
  githubAutoDeployActive: "unverified",
  customDomainMapped: "unverified"
}));
