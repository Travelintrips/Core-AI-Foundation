import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
const SCRIPT=join(dirname(fileURLToPath(import.meta.url)),'durable-ledger.py');
export function createDurableStore({dbPath,python='python3'}){
 if(typeof dbPath!=='string'||!dbPath.startsWith('/'))throw Error('ABSOLUTE_DEV_DB_PATH_REQUIRED');
 return (action,fields)=>{
  const output=execFileSync(python,[SCRIPT,dbPath,action],{input:JSON.stringify(fields),encoding:'utf8',timeout:6000,maxBuffer:4096});
  return JSON.parse(output);
 };
}
