#!/usr/bin/env node
// Admission gate for an already verified public snapshot. Prevent a transient
// upstream cache rollback from overwriting newer public Release content.
import {readFile, stat} from 'node:fs/promises';
import {basename, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {
  SOURCE_VARIANTS, assetName, validSnapshot, MAX_BODY_BYTES, MAX_CAPTURE_FUTURE_MS,
} from '../lib/standby-core.js';
import {MAX_SOURCE_AGE_MS} from './capture-standby.mjs';

export function replacementDecision(source, variant, incoming, previous, now=Date.now()) {
  if (!Object.hasOwn(SOURCE_VARIANTS, source) ||
      SOURCE_VARIANTS[source] !== variant) throw new Error('unapproved_release_asset');
  if (!validSnapshot(incoming, source, variant, now))
    throw new Error('unverified_incoming_snapshot');
  const update = Date.parse(incoming.payload?.updateTime);
  const captured = Date.parse(incoming.capturedAt);
  if (!Number.isFinite(update) || update > now + MAX_CAPTURE_FUTURE_MS ||
      now - update > MAX_SOURCE_AGE_MS ||
      !Number.isFinite(captured) || now - captured > MAX_SOURCE_AGE_MS)
    throw new Error('incoming_snapshot_not_fresh');
  if (!previous || !validSnapshot(previous, source, variant, now)) return 'PUBLISH';
  const priorUpdate = Date.parse(previous.payload?.updateTime);
  if (Number.isFinite(priorUpdate) && update <= priorUpdate) return 'KEEP';
  if (captured <= Date.parse(previous.capturedAt)) return 'KEEP';
  return 'PUBLISH';
}

async function readBoundedFile(path, {allowMissing=false, allowInvalid=false}={}) {
  let info;
  try { info=await stat(path); }
  catch(error) {
    if (allowMissing && error?.code === 'ENOENT') return null;
    throw error;
  }
  if (!info.isFile() || info.size < 2 || info.size > MAX_BODY_BYTES) {
    if (allowInvalid) return null;
    throw new Error('invalid_snapshot_asset_size');
  }
  const raw=await readFile(path, 'utf8');
  try { return JSON.parse(raw); }
  catch(error) {
    if (allowInvalid) return null;
    throw new Error('incoming_snapshot_invalid_json', {cause:error});
  }
}

async function run(argv) {
  if (argv.length !== 2) throw new Error('usage: compare-release-snapshot.mjs INCOMING PREVIOUS');
  const [incomingPath, previousPath]=argv;
  const file=basename(incomingPath);
  if (basename(previousPath) !== file) throw new Error('asset_name_mismatch');
  const approved=Object.entries(SOURCE_VARIANTS).find(([source,variant]) =>
    assetName(source, variant) === file);
  if (!approved) throw new Error('unapproved_release_asset_name');
  const incoming=await readBoundedFile(incomingPath);
  const previous=await readBoundedFile(previousPath,
    {allowMissing:true, allowInvalid:true});
  process.stdout.write(replacementDecision(approved[0],approved[1],incoming,previous)+'\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  run(process.argv.slice(2)).catch(error=>{
    console.error('RELEASE_ADMISSION_FAILED '+String(error?.message || error));
    process.exitCode=1;
  });
}
