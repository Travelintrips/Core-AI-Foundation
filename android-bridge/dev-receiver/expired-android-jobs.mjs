// DEV-only: identify queue records whose browser action authorization has expired.
// Never renew immutable action permissions or convert protected navigation to generic jobs.
import {verifiedDeviceAction} from './device-actions.mjs';
import {ACTION_TITLE_PREFIX} from './phone-site-catalog.mjs';
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export function expiredAndroidJobs(rows,actions,now=Date.now()){
 return rows.filter(r=>r.source==='OPENCLAW'&&r.status==='QUEUED'&&uuid.test(r.id||'')&&
 /^android-dev:[a-zA-Z0-9_-]{3,48}$/.test(r.source_session_id||'')&&
 (r.title==='Z Fold4 DEV OPEN_APP Custom'||typeof r.title==='string'&&r.title.startsWith(ACTION_TITLE_PREFIX))&&
 !!actions[r.id]&&!verifiedDeviceAction(actions[r.id],r.id,r.source_session_id.slice(12),now))
 .map(r=>r.id);
}
