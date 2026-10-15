// DEV only: the verified consumer writes a durable marker AFTER the job ACK
// is accepted. The phone broker skips completed grants so multiple jobs for
// the same paired Z Fold4 can progress without a new pairing or a 1h wait.
// Neither a Chrome intent nor an unverified intake receipt creates a marker.
import fs from 'node:fs';
import path from 'node:path';

const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export function completedJobPath(directory,jobId) {
  if(typeof directory!=='string'||!directory||!UUID.test(jobId||''))
    throw Error('Invalid DEV job marker');
  return path.join(directory,'.android-ack-completed-'+jobId.toLowerCase());
}
export function isCompletedJob(directory,jobId) {
  return fs.existsSync(completedJobPath(directory,jobId));
}
export function markCompletedJob(directory,jobId) {
  const file=completedJobPath(directory,jobId);
  try {
    fs.writeFileSync(file,jobId.toLowerCase()+'\n',{flag:'wx',mode:0o600});
  } catch(error) {
    if(error.code!=='EEXIST')throw error;
  }
  return file;
}
