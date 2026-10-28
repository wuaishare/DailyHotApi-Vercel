import test from "node:test";
import assert from "node:assert/strict";
import { TARGETS, PATHS, checkResponse } from "../ops/smoke-hotapi.mjs";

test("only known public hosts and routes are monitored", () => {
  assert.deepEqual(Object.values(TARGETS), [
    "https://hotapi.wuaishare.cn",
    "https://hotapi2.wuaishare.cn",
  ]);
  assert.equal(PATHS.length, 3);
});
test("identity requires explicit Vercel edge and does not attest upstream", () => {
  const good = {
    service: "hotapi", kind: "vercel-edge-gateway",
    productionDomain: "hotapi.wuaishare.cn", upstreamHealthAttested: false,
  };
  assert.equal(checkResponse("/_hotapi-gateway/health.json", good, {"x-vercel-id":"hkg1:sample"}), "vercel-edge-gateway");
  assert.throws(() => checkResponse("/_hotapi-gateway/health.json", good), /Vercel edge ID/);
  assert.throws(() => checkResponse("/_hotapi-gateway/health.json", { ...good, upstreamHealthAttested: true }, {"x-vercel-id":"abc"}), /wrong gateway identity/);
});
test("route directory needs consistent nonempty data", () => {
  const routes = Array.from({length: 105}, (_,i) => ({name:"r"+i}));
  assert.equal(checkResponse("/all", {code:200, routes, count:105}), "105 routes");
  assert.throws(() => checkResponse("/all", {code:200, routes, count:1}), /incomplete/);
  assert.throws(() => checkResponse("/all", {code:200, routes:[], count:0}), /incomplete/);
});
test("rank responses must carry actual rows", () => {
  assert.equal(checkResponse("/artificialanalysis?type=models", {code:200, data:[{title:"sample"}], total:1}), "1 rows");
  assert.throws(() => checkResponse("/ai-topic?type=all", {code:200, data:[], total:100}), /missing/);
  assert.throws(() => checkResponse("/ai-topic?type=all", {code:403, data:[{}], total:1}), /not 200/);
  assert.throws(() => checkResponse("/ai-topic?type=all", "<html>403</html>"), /non-object/);
});
