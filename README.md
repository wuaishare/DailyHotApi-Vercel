# HotAPI · Vercel Gateway

Official hostname: **`hotapi.wuaishare.cn`**. Vercel project: **`hotapi`**.

This repository defines the edge-facing **gateway**, not an independently running scraper. It forwards the incoming URL path and query to the maintained `hotapi2.wuaishare.cn` service (currently bt1), preserving the modern API routes. No legacy `dailyhot-api@2.0.6` process, build script, or stale response data is used. **If bt1 or hotapi2 is down, this gateway is also down.**

## Deploy and verify

- Production branch: `master`; review isolated PRs and test the Vercel Preview first.
- Deploy `master` through the Vercel Git integration; verify the exact deployment SHA and promotion before changing Cloudflare DNS.
- Test `/`, `/all`, `/artificialanalysis?type=models`, and other important routes against the known-good `hotapi2` source. Confirm query strings, JSON payload freshness, status codes and response headers.
- Static marker: `/_hotapi-gateway/health.json` identifies the gateway deployment even if the upstream is failing; this is **not** an upstream health check.
- Cloudflare's current DNS/Origin Rules must be inspected and changed to the Vercel target for `hotapi.wuaishare.cn`. Adding a Vercel project domain alone does not switch traffic.
- Keep `hotapi2` on bt1 unchanged until the gateway has passed cross-device production acceptance and rollback is available.

## Verified production configuration (2026-10-28)

- Official DNS: Cloudflare **DNS only** (gray cloud), `hotapi.wuaishare.cn CNAME c6911e08ed0da18f.vercel-dns-017.com`. Vercel `get_domain_config` reported `misconfigured=false` and `configuredBy=CNAME`.
- Verified production baseline: commit `45dfeccb7430b7cf5a3b6fe7abae33e6a0bb3915`; project `hotapi` (`prj_kr9nUtKfm6Ap4WBFx9B6a4vyxT1k`); Vercel deployment `dpl_GiEueuAjqPssidN1vVsShkWbjcDu`, `READY`.
- A separate Let's Encrypt certificate for `hotapi.wuaishare.cn` was verified from independent bt1 egress on 2026-10-28. Locally observed `198.18.x.x` addresses on M4/MBP are local DNS/proxy artifacts, **not** Vercel's publicly assigned IPs.
- Independent bt1 checks of the public domain and Vercel default domain showed HTTP 200 / strict TLS. Live gateway identity, 179-route catalog, AA model leaderboard and AI topic leaderboard also returned usable data from M4 and MBP.
- **2026-10-28 geographic CC false-positive fix:** US GitHub Action runs `40649331578`, `40650292999`, `40651097825` had 403 on API endpoints. bt1 temporary privacy-preserving access log proved `upstream=-`, `trusted=1`, status 403: rejected before Node even though the Cloudflare source was authorized. Baota WAF `DailyHotApi.cc.countrys` contained 230 geographic browser-challenge targets including the US, making noninteractive API requests fail. The sole change was setting this one site's geographic challenge list to `{}`, leaving WAF enabled, per-IP CC rate policy **60 requests / 60 seconds**, other security filters, and Cloudflare source validation intact. Original site.json SHA256 `f176e10abdac31e01013ada7210c3eb28127eab3710605c87582a4694407d7a8`, full rollback backup on bt1: `/root/btwaf-site-backups/site.json.20261028T074132Z.before-hotapi-geo-cc`. JSON comparison proved no change to the other 79 sites; Nginx syntax/reload and bt1 APIs passed. Temporary Nginx diagnostics were removed. Postfix GitHub US runner results: `40651971348` and production-master `40652230947` both **7/7 PASS at first attempt** (179 routes, 272 AA models, 180 AI topic entries). One intermediate Vercel `/all` request had two 15s timeouts: keep monitoring this distinct availability risk. Do not disable WAF/CC or trust forged client-IP headers to hide instability.
- Legacy `dailyhotapi.wuaishare.cn` remains a separately misconfigured Cloudflare entry (sporadic 502/403). **Do not advertise it**. After verifying historical usage, convert it to an intentional canonical redirect or retire it without affecting the now-healthy `hotapi` route.

### Repeatable availability tests

```bash
node --test test/*.test.mjs
node ops/smoke-hotapi.mjs
```

The credential-free smoke command checks the Vercel marker, gateway and upstream `/all`, Artificial Analysis and AI-topic routes using strict HTTPS and real JSON payload assertions. It records response status, Cloudflare Ray and Vercel edge ID on failures. A failed first attempt is retried once; recovered transients are reported distinctly and repeated failures make the command fail.

A best-effort GitHub Actions scheduled smoke (`.github/workflows/hotapi-public-smoke.yml`) runs every three hours plus manual dispatch. GitHub scheduled Actions are not guaranteed to fire at a specific time and are **not** a substitute for a dedicated external uptime monitor.

## Safeguards

The rewrite target is a **single hard-coded HTTPS host**. There is no user-supplied target, no proxy credential forwarding code, no artificial caching, no credentials in this repository, and no service or DNS mutation by the test scripts. Existing frontend readers should continue using `hotapi2` until the new domain is accepted. Verify CDN/WAF forward-header provenance separately; never trust caller-provided real-IP headers for authentication.
