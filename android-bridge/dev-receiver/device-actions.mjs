// DEV-only, allowlisted device actions. Never a shell/ADB/Accessibility command surface.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export const ALLOWED_URL_HOSTS = Object.freeze(['github.com', 'www.github.com', 'dev-ai-task.cstlogistic.co.id']);
export const ALLOWED_APPS = Object.freeze(['com.github.android', 'com.openai.chatgpt', 'com.android.chrome']);
const ACTION_FILE = 'device-job-actions.json';
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
}

export function normalizeDeviceAction(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !['kind', 'target'].includes(key))) throw Error('Invalid action');
  const kind = value.kind;
  const target = value.target === undefined ? '' : value.target;
  if (typeof target !== 'string' || target.length > 600 || /[\x00-\x1f\x7f]/.test(target)) throw Error('Invalid target');
  if (kind === 'OPEN_URL') {
    if (!/^https:\/\//i.test(target) || /[\s\\]/.test(target)) throw Error('HTTPS URL required');
    let url;
    try { url = new URL(target); } catch { throw Error('Malformed URL'); }
    if (url.protocol !== 'https:' || url.username || url.password ||
        !ALLOWED_URL_HOSTS.includes(url.hostname) || url.port) throw Error('URL host is not allowlisted');
    return {kind, target: url.href};
  }
  if (kind === 'OPEN_APP') {
    if (!ALLOWED_APPS.includes(target)) throw Error('App is not allowlisted');
    return {kind, target};
  }
  if (kind === 'DEVICE_STATUS' && target === '') return {kind, target: ''};
  throw Error('Unsupported action');
}

export function verifiedDeviceAction(record, jobId, deviceId, now = Date.now()) {
  if (!UUID.test(jobId) || !record || typeof record !== 'object' ||
      record.jobId !== jobId || record.deviceId !== deviceId ||
      !Number.isSafeInteger(record.expiresAt) || record.expiresAt <= now ||
      record.expiresAt > now + 60 * 60 * 1000) return null;
  try {
    const normalized = normalizeDeviceAction(record.action);
    if (JSON.stringify(normalized) !== JSON.stringify(record.action)) return null;
    return normalized;
  } catch { return null; }
}

export function loadDeviceActions(dir) {
  const entries = readJson(path.join(dir, ACTION_FILE));
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) throw Error('Invalid DEV action registry');
  return entries;
}

export function saveDeviceAction(dir, jobId, deviceId, input, now = Date.now()) {
  if (!UUID.test(jobId) || !/^[a-zA-Z0-9_-]{3,48}$/.test(deviceId)) throw Error('Invalid job/device');
  const action = normalizeDeviceAction(input);
  const registryFile = path.join(dir, 'device-registry.json');
  const registry = readJson(registryFile);
  if (registry[deviceId]?.active !== true) throw Error('Device not actively paired');
  const file = path.join(dir, ACTION_FILE);
  const actions = loadDeviceActions(dir);
  if (actions[jobId]) throw Error('Action already registered');
  for (const [id, entry] of Object.entries(actions))
    if (!entry || !Number.isSafeInteger(entry.expiresAt) || entry.expiresAt <= now) delete actions[id];
  if (Object.keys(actions).length >= 256) throw Error('DEV action registry is full');
  const record = {jobId, deviceId, action, expiresAt: now + 60 * 60 * 1000, createdAt: new Date(now).toISOString()};
  actions[jobId] = record;
  const temporary = file + '.' + process.pid + '.' + crypto.randomUUID() + '.tmp';
  try {
    fs.writeFileSync(temporary, JSON.stringify(actions), {flag: 'wx', mode: 0o600});
    const owner = fs.statSync(registryFile);
    fs.chownSync(temporary, owner.uid, owner.gid);
    fs.renameSync(temporary, file);
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch {}
    throw error;
  }
  return record;
}
