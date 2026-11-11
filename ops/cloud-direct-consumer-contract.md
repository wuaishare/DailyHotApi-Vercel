# Stage 2 cloud-direct consumer admission — experimental

This deterministic, unconnected Node 22 verifier checks the public candidate
envelope produced by private DailyHotApi Draft PR #11. It does not alter
Vercel routes, GitHub Releases, the public API, credentials or storage.

Source publication time remains unverified: sourcePublishedAt must be null.
The canonical capturedAt is only when the cloud runner observed content.
No payload.updateTime or fake official generation may be inserted.

The verifier accepts exactly seven approved sources and variants, exactly
public title/url rows, valid HTTPS links, 10–200 rows, matching independently
recomputed rank/link digests, canonical UTC timestamp within 3 hours
(with 2 minutes future skew) and up to 1MiB actual UTF-8 JSON bytes.

Stage 1 historical household snapshot release assets are a different format
and must remain unchanged. This code is deliberately not imported by the
production API; a separately reviewed Owner-approved publisher and durable
per-source atomic sequence + provenance + real readback + backout is required.

All tests are synthetic, offline, and require no production secrets.
