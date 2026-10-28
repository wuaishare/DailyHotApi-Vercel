#!/usr/bin/env node
/**
 * Public, credential-free HotAPI smoke check. Works on a laptop and in Actions.
 * This gateway still depends on the maintained hotapi2 backend on bt1.
 * A READY Vercel deployment or a 200 static health marker is not API health.
 */
import { appendFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

export const TARGETS = Object.freeze({
  gateway: "https://hotapi.wuaishare.cn",
  upstream: "https://hotapi2.wuaishare.cn",
});
export const PATHS = Object.freeze([
  "/all",
  "/artificialanalysis?type=models",
  "/ai-topic?type=all",
]);

export function checkResponse(path, value, headers = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("non-object JSON payload");
  }
  if (path === "/_hotapi-gateway/health.json") {
    if (value.service !== "hotapi" || value.kind !== "vercel-edge-gateway" ||
        value.productionDomain !== "hotapi.wuaishare.cn" ||
        value.upstreamHealthAttested !== false) {
      throw new Error("wrong gateway identity marker");
    }
    if (!headers["x-vercel-id"]) throw new Error("Vercel edge ID missing");
    return "vercel-edge-gateway";
  }
  if (value.code !== 200) throw new Error("API JSON code not 200");
  if (path === "/all") {
    if (!Array.isArray(value.routes) || value.routes.length < 100 ||
        value.count !== value.routes.length) {
      throw new Error("route catalog incomplete");
    }
    return String(value.count) + " routes";
  }
  if (!Array.isArray(value.data) || value.data.length === 0 ||
      !Number.isInteger(value.total) || value.total < 1) {
    throw new Error("rank data missing");
  }
  return String(value.total) + " rows";
}

/** Classify an error from safe response signatures; never print or store raw bodies. */
export function classifyErrorBody(body, cfMitigated = "") {
  const text = String(body || "").slice(0, 4096).toLowerCase();
  if (cfMitigated === "challenge" || text.includes("/cdn-cgi/challenge-platform") ||
      text.includes("cf-chl")) return "cloudflare-challenge";
  if (text.includes("btwaf") || text.includes("宝塔防火墙")) return "btwaf-intercept";
  if (text.includes("<h1>403 forbidden</h1>") || text.includes("<title>403 forbidden</title>"))
    return "nginx-style-403";
  if (text.trimStart().startsWith("{")) return "json-error";
  return "unclassified";
}

async function fetchOne(base, path, expectVercel) {
  const response = await fetch(base + path, {
    signal: AbortSignal.timeout(15000),
    headers: { accept: "application/json", "user-agent": "hotapi-gateway-smoke/1.0" },
    redirect: "error",
  });
  const diagnostic = [
    "status=" + response.status,
    "server=" + (response.headers.get("server") || "-"),
    "cfRay=" + (response.headers.get("cf-ray") || "-"),
    "vercelId=" + (response.headers.get("x-vercel-id") || "-"),
  ].join(" ");
  if (!response.ok) {
    const body = await response.text();
    const mitigated = response.headers.get("cf-mitigated") || "-";
    const fingerprint = createHash("sha256").update(body).digest("hex").slice(0, 12);
    // No raw response body, cookies, secrets, or visitor addresses in logs.
    throw new Error(diagnostic +
      " cfMitigated=" + mitigated +
      " contentType=" + (response.headers.get("content-type") || "-") +
      " bodyType=" + classifyErrorBody(body, mitigated) +
      " bodyBytes=" + Buffer.byteLength(body) +
      " bodySha256=" + fingerprint);
  }
  if (!(response.headers.get("content-type") || "").includes("json")) {
    throw new Error("non-JSON content-type " + diagnostic);
  }
  const payload = await response.json();
  const summary = checkResponse(path, payload, {
    "x-vercel-id": response.headers.get("x-vercel-id"),
  });
  if (expectVercel && !response.headers.get("x-vercel-id")) {
    throw new Error("request bypassed Vercel edge: " + diagnostic);
  }
  return summary;
}

async function probe(label, base, path, expectVercel) {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const result = await fetchOne(base, path, expectVercel);
      return { label, path, result, attempts: attempt, ok: true };
    } catch (error) {
      lastError = String(error?.message || error).slice(0, 300);
      if (attempt === 1) await delay(700);
    }
  }
  return { label, path, error: lastError, attempts: 2, ok: false };
}

export async function run() {
  const checks = [
    ["gateway", TARGETS.gateway, "/_hotapi-gateway/health.json", true],
    ...PATHS.flatMap(path => [
      ["gateway", TARGETS.gateway, path, true],
      ["upstream", TARGETS.upstream, path, false],
    ]),
  ];
  const results = [];
  for (const [label, base, path, expectVercel] of checks) {
    const result = await probe(label, base, path, expectVercel);
    results.push(result);
    console.log((result.ok ? "PASS" : "FAIL") + " " + label + " " +
      path + " " + (result.result || result.error) + " attempts=" + result.attempts);
    if (result.ok && result.attempts > 1) {
      console.warn("TRANSIENT_RECOVERY " + label + " " + path);
    }
  }
  const failures = results.filter(r => !r.ok);
  const warnings = results.filter(r => r.ok && r.attempts > 1);
  const summary = [
    "## HotAPI production smoke",
    "",
    "Gateway is a Vercel rewrite to the bt1 hotapi2 backend; not an independent collector.",
    "",
    "| Surface | Path | Result | Attempts |",
    "| --- | --- | --- | --- |",
    ...results.map(r => "| " + r.label + " | \`" + r.path + "\` | " +
      (r.ok ? "PASS " + r.result : "FAIL " + r.error.replaceAll("|", "/")) +
      " | " + r.attempts + " |"),
    "",
    "Persistent failures: " + failures.length + "; recovered transients: " + warnings.length,
    "",
  ].join("\n");
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  if (warnings.length && process.env.GITHUB_ACTIONS) {
    console.warn("::warning::HotAPI transient failures recovered on retry (" + warnings.length + ")");
  }
  if (failures.length) process.exitCode = 1;
  return { failures: failures.length, warnings: warnings.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch(error => {
    console.error("SMOKE_UNEXPECTED_FAILURE", error);
    process.exitCode = 1;
  });
}
