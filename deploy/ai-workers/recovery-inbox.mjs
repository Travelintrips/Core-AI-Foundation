import { DatabaseSync } from 'node:sqlite';
export class RecoveryInbox {
 constructor(path) {
  this.db=new DatabaseSync(path);
  this.db.exec(`CREATE TABLE IF NOT EXISTS recovery_inbox (
    dedupe_key TEXT PRIMARY KEY, event_id TEXT NOT NULL, job_id TEXT NOT NULL,
    status TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL,
    delivered_at INTEGER, acked_at INTEGER, conversation_id TEXT);`);
 }
 enqueue(event) {
  if(event?.environment!=='DEV'||!event?.jobId||!event?.eventId||!['COMPLETED','FAILED','BLOCKED','CANCELLED'].includes(event.status)) throw Error('invalid DEV terminal event');
  const key='DEV:'+event.jobId+':terminal';
  this.db.prepare('INSERT OR IGNORE INTO recovery_inbox (dedupe_key,event_id,job_id,status,payload,created_at) VALUES (?,?,?,?,?,?)').run(key,event.eventId,event.jobId,event.status,JSON.stringify(event),Date.now());
  return this.get(key);
 }
 get(key) {
  const r=this.db.prepare('SELECT * FROM recovery_inbox WHERE dedupe_key=?').get(key);return r||null;
 }
 pending() {return this.db.prepare('SELECT * FROM recovery_inbox WHERE acked_at IS NULL ORDER BY created_at ASC').all();}
 markDelivered(key,binding,now=Date.now()) {
  if(binding?.verified!==true||binding?.attestationVerified!==true||binding?.environment!=='DEV'||!binding?.conversationId) return false;
  const r=this.db.prepare('UPDATE recovery_inbox SET delivered_at=?,conversation_id=? WHERE dedupe_key=? AND delivered_at IS NULL').run(now,binding.conversationId,key);
  return r.changes===1;
 }
 ack(key,conversationId,now=Date.now()){
  const r=this.db.prepare('UPDATE recovery_inbox SET acked_at=? WHERE dedupe_key=? AND conversation_id=? AND delivered_at IS NOT NULL AND acked_at IS NULL').run(now,key,conversationId);
  return r.changes===1;
 }
 close(){this.db.close();}
}
