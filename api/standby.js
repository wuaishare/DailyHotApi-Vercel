import seedSnapshots from '../lib/standby-seed.js';
import {
  SOURCE_VARIANTS, choosePublicVariant, validPublicPayload, validSnapshot,
  snapshotUrl, snapshotAgeSeconds, sanitizeUpstreamPathQuery, MAX_BODY_BYTES,
} from '../lib/standby-core.js';

const UPSTREAM_TIMEOUT_MS = 4000;
const OFFSITE_TIMEOUT_MS = 3000;
const JSON_TYPE = 'application/json; charset=utf-8';
const setCommonHeaders = (res) => {
  res.setHeader('Content-Type', JSON_TYPE);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Expose-Headers',
    'X-HotAPI-Data-Mode, X-HotAPI-Standby-Age-Seconds, X-HotAPI-Standby-Captured-At');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
};
const send = (res, status, json, head = false) => {
  res.statusCode = status;
  res.end(head ? '' : JSON.stringify(json));
};
// Bound streamed bytes before allocation; Content-Length can be absent or false.
const parseBoundedJson = async (response) => {
  const advertised = response.headers.get('content-length');
  if (advertised !== null) {
    const size = Number(advertised);
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_BODY_BYTES) {
      await response.body?.cancel().catch(() => {});
      return null;
    }
  }
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(Buffer.from(value));
    }
    try { return JSON.parse(Buffer.concat(chunks, bytes).toString('utf8')); }
    catch { return null; }
  } catch { return null; }
  finally { reader.releaseLock(); }
};

export function createStandbyHandler({
  fetchImpl = globalThis.fetch, seed = seedSnapshots,
  clock = () => Date.now(), upstreamTimeoutMs = UPSTREAM_TIMEOUT_MS,
  offsiteTimeoutMs = OFFSITE_TIMEOUT_MS,
  env = process.env,
} = {}) {
  return async (req, res) => {
    setCommonHeaders(res);
    const source = req.query?.source;
    if (typeof source !== 'string' || !Object.hasOwn(SOURCE_VARIANTS, source)) {
      res.setHeader('Cache-Control', 'no-store');
      return send(res, 404, {code:404, message:'unknown_public_source'});
    }
    if (req.method === 'OPTIONS') {
      res.setHeader('Allow', 'GET, HEAD, OPTIONS');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return send(res, 204, {}, true);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD, OPTIONS');
      res.setHeader('Cache-Control', 'no-store');
      return send(res, 405, {code:405, message:'public_read_only'});
    }
    const head = req.method === 'HEAD';
    const rawType = req.query?.type;
    const variant = choosePublicVariant(source, rawType);
    const path = sanitizeUpstreamPathQuery(req.url || '/', source);

    // The live source retains precedence; do not forward bearer tokens,
    // cookies, arbitrary client URLs or untrusted forwarded-IP headers.
    let upstreamResponse;
    const requestedPreviewFault = req.query?.__standby_fault;
    const previewFaultMode = env.VERCEL_ENV === 'preview' &&
      env.HOTAPI_STANDBY_PREVIEW_FAULT === '1' &&
      ['upstream-502','all-remote-502','upstream-403'].includes(requestedPreviewFault)
        ? requestedPreviewFault : null;
    const previewFaultSimulation = previewFaultMode !== null;
    if (previewFaultSimulation) {
      // Test-only switch: exact branch-scoped Preview env + explicit header.
      // Vercel Production and Development cannot enter this path.
      upstreamResponse = {status:previewFaultMode === 'upstream-403' ? 403 : 502};
    }
    try {
      if (!previewFaultSimulation) upstreamResponse = await fetchImpl(path, {
        method: head ? 'HEAD' : 'GET',
        headers: {Accept:'application/json', 'User-Agent':'hotapi-cloud-standby/1.0'},
        redirect: 'manual', signal: AbortSignal.timeout(upstreamTimeoutMs),
      });
    } catch { /* A network error is not a fabricated content response. */ }

    if (upstreamResponse && upstreamResponse.status === 200) {
      if (head) {
        res.setHeader('X-HotAPI-Data-Mode', 'upstream');
        res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=30');
        return send(res, 200, {}, true);
      }
      const body = await parseBoundedJson(upstreamResponse).catch(() => null);
      if (body && (variant === null || validPublicPayload(source, body))) {
        res.setHeader('X-HotAPI-Data-Mode', 'upstream');
        res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=30');
        return send(res, 200, body);
      }
    } else if (upstreamResponse &&
      upstreamResponse.status >= 400 && upstreamResponse.status < 500) {
      // 400/401/403/404/429 are explicit denials, not infrastructure outages.
      // Never bypass authorization or deliberately removed provider variants.
      res.setHeader('Cache-Control', 'no-store');
      return send(res, upstreamResponse.status, {
        code: upstreamResponse.status, message:'upstream_refused_public_request',
      }, head);
    } else if (upstreamResponse && upstreamResponse.status >= 300 &&
      upstreamResponse.status < 400) {
      res.setHeader('Cache-Control', 'no-store');
      return send(res, 502, {code:502, message:'unexpected_upstream_redirect'}, head);
    }

    // No cloud fallback for unapproved source variants or any caller-supplied
    // credential. Standby consists solely of verified public ranking rows.
    if (variant === null || req.headers?.authorization) {
      res.setHeader('Cache-Control', 'no-store');
      return send(res, 503, {code:503, message:'no_authorized_standby_variant'}, head);
    }

    const name = source + '-' + variant + '.json';
    let snapshot = null;
    if (previewFaultMode !== 'all-remote-502') {
      try {
        const response = await fetchImpl(snapshotUrl(source, variant), {
          method:'GET', headers:{Accept:'application/json',
            'User-Agent':'hotapi-cloud-standby/1.0'},
          redirect:'follow', signal:AbortSignal.timeout(offsiteTimeoutMs),
        });
        if (response.ok) {
          const candidate = await parseBoundedJson(response);
          if (validSnapshot(candidate, source, variant, clock())) snapshot = candidate;
        }
      } catch { /* An unreachable GitHub asset must not erase the bundled seed. */ }
    }
    if (!snapshot && validSnapshot(seed[name], source, variant, clock())) {
      snapshot = seed[name];
    }
    if (!snapshot) {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Retry-After', '60');
      return send(res, 503, {code:503, message:'upstream_and_offsite_snapshot_unavailable'}, head);
    }
    const ageSeconds = snapshotAgeSeconds(snapshot, clock());
    res.setHeader('X-HotAPI-Data-Mode', 'offsite-snapshot');
    res.setHeader('X-HotAPI-Standby-Age-Seconds', String(ageSeconds));
    res.setHeader('X-HotAPI-Standby-Captured-At', snapshot.capturedAt);
    res.setHeader('Warning', '110 - "Response is Stale"');
    res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=30');
    return send(res, 200, {
      ...snapshot.payload,
      standby: {
        active:true, mode:'offsite-snapshot', capturedAt:snapshot.capturedAt,
        ageSeconds, sourceUpdatedAt:snapshot.payload.updateTime || null,
        message:'Backup snapshot from before the upstream outage; not live data.',
      },
    }, head);
  };
}

export default createStandbyHandler();
