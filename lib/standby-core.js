// Only explicitly approved, already-public ranking endpoints have cloud standby.
// Do not widen to authentication, private data, or unverified provider variants.
export const SOURCE_VARIANTS = Object.freeze({
  douyin: 'hot',
  baidu: 'realtime',
  kuaishou: 'hot',
  weibo: 'hot',
  toutiao: 'hot',
  'qq-news': 'hot',
  'netease-news': 'hot',
});
export const UPSTREAM = 'https://hotapi2.wuaishare.cn';
export const RELEASE_TAG = 'cloud-standby-v1';
export const RELEASE_ORIGIN = 'https://github.com/wuaishare/DailyHotApi-Vercel/releases/download/' + RELEASE_TAG;
export const MIN_ROWS = 10;
export const MAX_BODY_BYTES = 1024 * 1024;
export const MAX_CAPTURE_FUTURE_MS = 2 * 60 * 1000;
export const MAX_SEED_AGE_MS = 10 * 365 * 24 * 3600 * 1000;
const exactSource = (value) => typeof value === 'string' &&
  Object.hasOwn(SOURCE_VARIANTS, value);

export function choosePublicVariant(source, requestedType) {
  if (!exactSource(source) || Array.isArray(requestedType)) return null;
  const wanted = requestedType === undefined || requestedType === '' ?
    SOURCE_VARIANTS[source] : requestedType;
  return wanted === SOURCE_VARIANTS[source] ? wanted : null;
}
export function assetName(source, variant) {
  if (choosePublicVariant(source, variant) === null) return null;
  return source + '-' + variant + '.json';
}
export function snapshotUrl(source, variant) {
  const name = assetName(source, variant);
  return name ? RELEASE_ORIGIN + '/' + name : null;
}
export function validPublicPayload(source, value) {
  if (!exactSource(source) || !value || Array.isArray(value) ||
      typeof value !== 'object' || value.code !== 200 ||
      !Array.isArray(value.data) || value.data.length < MIN_ROWS ||
      value.data.length > 250 || !value.data.slice(0, MIN_ROWS)
        .every(x => x && typeof x.title === 'string' &&
          x.title.trim().length > 0 && x.title.length < 800)) return false;
  if (value.updateTime !== undefined && !Number.isFinite(Date.parse(value.updateTime))) return false;
  return true;
}
export function validSnapshot(value, source, variant, now = Date.now()) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    value.schema !== 'hotapi-cloud-snapshot-v1' || value.source !== source ||
    value.variant !== variant || !validPublicPayload(source, value.payload)) return false;
  const captured = Date.parse(value.capturedAt);
  if (!Number.isFinite(captured) || captured > now + MAX_CAPTURE_FUTURE_MS ||
    now - captured > MAX_SEED_AGE_MS) return false;
  const update = value.payload.updateTime;
  if (update !== undefined && Date.parse(update) > now + MAX_CAPTURE_FUTURE_MS) return false;
  return true;
}
export function snapshotAgeSeconds(value, now = Date.now()) {
  return Math.max(0, Math.floor((now - Date.parse(value.capturedAt)) / 1000));
}
export function sanitizeUpstreamPathQuery(input, source) {
  const u = new URL(input, 'https://hotapi.wuaishare.cn');
  const params = new URLSearchParams(u.search);
  params.delete('source'); // injected by the fixed Vercel route, never forward
  params.delete('standby_source');
  params.delete('__standby_fault'); // Preview-only integration switch never reaches bt1.
  const q = params.toString();
  return UPSTREAM + '/' + source + (q ? '?' + q : '');
}
