// Authorized VPS-only DEV operator tool. Never expose through HTTP.
import {saveDeviceAction} from './device-actions.mjs';
const [jobId, deviceId, kind, target = ''] = process.argv.slice(2);
const dir = process.env.BRIDGE_DEVICE_SPOOL_DIR || '/var/lib/openclaw-android-bridge-dev';
try {
  const record = saveDeviceAction(dir, jobId, deviceId, {kind, target});
  console.log(JSON.stringify({jobId:record.jobId,deviceId:record.deviceId,action:record.action,expiresAt:record.expiresAt}));
} catch (err) {
  console.error('DEV action rejected:', err.message);
  process.exitCode = 1;
}
