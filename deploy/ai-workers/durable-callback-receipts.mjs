import { DatabaseSync } from 'node:sqlite';

// DEV-only atomic callback receipt claiming. Must be called after worker authentication
// and correlation verification and before processing callback side effects.
export class DurableCallbackReceipts {
 constructor(path) {
  this.db=new DatabaseSync(path);
  this.db.exec('CREATE TABLE IF NOT EXISTS dev_callback_receipts (command_id TEXT PRIMARY KEY, callback_id TEXT NOT NULL, result_id TEXT NOT NULL, created_at INTEGER NOT NULL)');
 }
 claim({environment,commandId,callbackId,resultId,authenticated,correlationVerified}) {
  if(environment!=='DEV'||authenticated!==true||correlationVerified!==true||
     !commandId||!callbackId||!resultId) return {accepted:false,reason:'invalid_or_unverified'};
  const outcome=this.db.prepare('INSERT OR IGNORE INTO dev_callback_receipts(command_id,callback_id,result_id,created_at) VALUES(?,?,?,?)')
    .run(commandId,callbackId,resultId,Date.now());
  if(outcome.changes===1) return {accepted:true,reason:'first_receipt'};
  const prior=this.db.prepare('SELECT callback_id,result_id FROM dev_callback_receipts WHERE command_id=?').get(commandId);
  return {accepted:false,reason:prior?.callback_id===callbackId&&prior?.result_id===resultId?'duplicate_callback':'conflicting_callback'};
 }
 close(){this.db.close();}
}
