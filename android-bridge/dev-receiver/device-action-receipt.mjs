// DEV-only user-attested receipt for an allowlisted Android foreground action.
// Receipt proves an authenticated paired device submitted a user confirmation;
// it does NOT independently prove that the target web page rendered.
import fs from 'node:fs';
import path from 'node:path';
import {loadDeviceActions, verifiedDeviceAction} from './device-actions.mjs';
import {siteForUrl} from './phone-site-catalog.mjs';

export const CONFIRMATION = 'USER_CONFIRMED_VISIBLE';
export const ACTION_REPORT_SOURCE = 'user-confirmed-device-action';
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
function read(file) {
  try { return JSON.parse(fs.readFileSync(file,'utf8')); }
  catch(error) { if (error.code === 'ENOENT') return {}; throw error; }
}
export function confirmedSummary(action) {
  const site=action?.kind==='OPEN_URL'?siteForUrl(action.target):null;
  if (!site) throw Error('Unsupported user-confirmed device action');
  return 'Z Fold4 DEV: user confirmed '+site.label+' was visible on the phone after Android OPEN_URL. This is user-attested, not independent page verification.';
}
export function validateActionReceipt(directory, jobId, claims, message, now=Date.now()) {
  if (!UUID.test(jobId) || !claims || typeof claims.deviceId !== 'string' ||
      !/^zfold4-paired-dev-[0-9]{2}$/.test(claims.deviceId)) throw Error('Invalid device binding');
  if (message?.source !== ACTION_REPORT_SOURCE ||
      message?.userConfirmation !== CONFIRMATION ||
      !message.deviceAction || typeof message.deviceAction !== 'object' ||
      Array.isArray(message.deviceAction) ||
      Object.keys(message.deviceAction).sort().join(',') !== 'kind,target') {
    throw Error('Missing explicit device action confirmation');
  }
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
    resultSummary:confirmedSummary(action),
    source:ACTION_REPORT_SOURCE,
    deviceId:claims.deviceId,
    deviceAction:action,
    evidence:CONFIRMATION,
  };
}
