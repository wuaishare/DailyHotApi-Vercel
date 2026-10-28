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

## Safeguards

The rewrite target is a **single hard-coded HTTPS host**. There is no user-supplied target, no proxy credential forwarding code, no artificial caching, no credentials in this repository, and no service or DNS mutation by the test scripts. Existing frontend readers should continue using `hotapi2` until the new domain is accepted. Verify CDN/WAF forward-header provenance separately; never trust caller-provided real-IP headers for authentication.
