// DEV-only receipts for explicit phone-scoped actions.
// The paired handset may report an Android launch intent, but that is NOT
// independent evidence that a web page was rendered.
import fs from 'node:fs';
import path from 'node:path';
import {loadDeviceActions, verifiedDeviceAction, normalizeDeviceAction} from './device-actions.mjs';
import {siteForUrl} from './phone-site-catalog.mjs';

export const CONFIRMATION = 'USER_CONFIRMED_VISIBLE';
export const ACTION_REPORT_SOURCE = 'user-confirmed-device-action';
export const DISPATCHED = 'ANDROID_INTENT_DISPATCHED';
export const AUTO_REPORT_SOURCE = 'device-intent-dispatched';
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
function read(file) {
  try { return JSON.parse(fs.readFileSync(file,'utf8')); }
  catch(error) { if (error.code === 'ENOENT') return {}; throw error; }
}
function siteForAction(action) {
  const normalized=normalizeDeviceAction(action);
  if(normalized.kind==='OPEN_APP') return {label:'Android application '+normalized.target};
  if(normalized.kind!=='OPEN_URL')throw Error('Unsupported phone action');
  const site=siteForUrl(normalized.target);
  return site||{label:'public HTTPS site '+new URL(normalized.target).hostname};
}
export function confirmedSummary(action) {
  const site=siteForAction(action);
  return 'Z Fold4 DEV: user confirmed '+site.label+' was visible on the phone after Android '+action.kind+'. This is user-attested, not independent page verification.';
}
export function dispatchedSummary(action) {
  const site=siteForAction(action);
  return 'Z Fold4 DEV: Android dispatched a foreground launch intent for '+site.label+'. Successful app/page rendering or login was NOT independently verified; no taps or account changes performed.';
}
export function validateActionReceipt(directory, jobId, claims, message, now=Date.now()) {
  if (!UUID.test(jobId) || !claims || typeof claims.deviceId !== 'string' ||
      !/^zfold4-paired-dev-[0-9]{2}$/.test(claims.deviceId)) throw Error('Invalid device binding');
  if (!message?.deviceAction || typeof message.deviceAction !== 'object' ||
      Array.isArray(message.deviceAction) ||
      Object.keys(message.deviceAction).sort().join(',') !== 'kind,target') {
    throw Error('Missing assigned action');
  }
  const manual=message.source === ACTION_REPORT_SOURCE && message.userConfirmation === CONFIRMATION &&
    message.deviceOutcome === undefined;
  const automatic=message.source === AUTO_REPORT_SOURCE && message.deviceOutcome === DISPATCHED &&
    message.userConfirmation === undefined;
  if (!manual && !automatic) throw Error('Missing valid evidence type');

  const registry=read(path.join(directory,'device-registry.json'));
  const grants=read(path.join(directory,'device-job-grants.json'));
  const grant=grants[jobId];
  if (registry[claims.deviceId]?.active !== true ||
      grant?.deviceId !== claims.deviceId || grant?.active !== true ||
      !Number.isSafeInteger(grant.expiresAt) || grant.expiresAt<=now)
    throw Error('No valid paired device job grant');
  const actions=loadDeviceActions(directory);
  const action=verifiedDeviceAction(actions[jobId],jobId,claims.deviceId,now);
  if (!action || action.kind !== message.deviceAction.kind ||
      action.target !== message.deviceAction.target) throw Error('Action not assigned to device');
  return {
    resultSummary:manual?confirmedSummary(action):dispatchedSummary(action),
    source:manual?ACTION_REPORT_SOURCE:AUTO_REPORT_SOURCE,
    deviceId:claims.deviceId,
    deviceAction:action,
    evidence:manual?CONFIRMATION:DISPATCHED,
  };
}
