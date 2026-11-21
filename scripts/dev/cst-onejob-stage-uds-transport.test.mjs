import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,mkdtempSync,rmSync} from "node:fs";
import {createServer} from "node:net";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import {createPinnedCstOneJobPgConnection} from "../../lib/db/src/cstOneJobPinnedSupabaseCa.ts";
import {makeOneJobUnixSocketStream} from "../../lib/db/src/cstOneJobDevSocketTransport.ts";

const src=readFileSync(new URL("../../artifacts/api-server/src/lib/cstOneJobStagingDatabase.ts",import.meta.url),"utf8");
const exportsFile=readFileSync(new URL("../../lib/db/src/index.ts",import.meta.url),"utf8");
const CA=fileURLToPath(new URL("./fixtures/supabase-root-2021-public-qa.crt",import.meta.url));
const host="aws-1-ap-southeast-2.pooler.supabase.com";
const ref="xssrfshdrtdfupgqwfdw";
const fake="synthetic-no-live-database-password";
const url="postgresql://cst_team_model_pilot_stage_login."+ref+":"+fake+"@"+host+":6543/postgres?sslmode=verify-full";

test("dedicated stage pool has only fail-closed socket transport",()=>{
 assert.match(src,/CST_DEV_ONEJOB_STAGE_SOCKET_TRANSPORT_ENABLED!=="true"/);
 assert.match(src,/ONEJOB_STAGING_SOCKET_TRANSPORT_NOT_AUTHORIZED/);
 assert.match(src,/CREDENTIALS_DIRECTORY!=="/);
 assert.match(src,/makeOneJobUnixSocketStream\(\)/);
 assert.match(src,/stream:makeOneJobUnixSocketStream\(\)/);
 assert.match(exportsFile,/export \{makeOneJobUnixSocketStream, CST_ONEJOB_DEV_SOCKET_PATH\}/);
 assert.doesNotMatch(src,/rejectUnauthorized:false|sslmode=disable|socketPath=process.env/);
});
test("pinned stage DSN retains dedicated role, real pooler hostname and TLS CA",()=>{
 const pinned=createPinnedCstOneJobPgConnection(url,"cst_team_model_pilot_stage_login",CA);
 assert.equal(pinned.host,host);
 assert.equal(pinned.port,6543);
 assert.equal(pinned.user,"cst_team_model_pilot_stage_login."+ref);
 assert.equal(pinned.ssl.rejectUnauthorized,true);
 assert.equal(pinned.ssl.servername,host);
 assert.ok(pinned.ssl.ca.byteLength>500);
 assert.throws(()=>createPinnedCstOneJobPgConnection(url.replace(ref,"nzdweipzckfszczzqtuw"),"cst_team_model_pilot_stage_login",CA));
});
test("staging pg SSLRequest and TLS SNI traverse synthetic Unix socket only",async()=>{
 const requirePg=createRequire(new URL("../../lib/db/package.json",import.meta.url));
 const pg=requirePg("pg");
 const dir=mkdtempSync(join(tmpdir(),"stage-uds-candidate-"));
 const path=join(dir,"mock.sock");
 let sslRequest=false,clientHello=false,sni=false;
 const server=createServer(socket=>{
  socket.once("data",data=>{
   sslRequest=data.length===8 && data.readUInt32BE(4)===80877103;
   if(!sslRequest){socket.destroy();return;}
   socket.write(Buffer.from("S"));
   socket.once("data",data=>{
    clientHello=data[0]===22;
    sni=data.includes(Buffer.from(host));
    socket.destroy();
   });
  });
 });
 try{
  await new Promise((resolve,reject)=>{server.once("error",reject);server.listen(path,resolve)});
  const pinned=createPinnedCstOneJobPgConnection(url,"cst_team_model_pilot_stage_login",CA);
  const pool=new pg.Pool({...pinned,stream:makeOneJobUnixSocketStream(path),max:1,connectionTimeoutMillis:1200});
  try{await assert.rejects(pool.query("SELECT 1"))}finally{await pool.end()}
  assert.equal(sslRequest,true);assert.equal(clientHello,true);assert.equal(sni,true);
 }finally{await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true})}
});
test("missing socket rejects without direct TCP fallback",async()=>{
 const requirePg=createRequire(new URL("../../lib/db/package.json",import.meta.url));
 const pg=requirePg("pg");
 const dir=mkdtempSync(join(tmpdir(),"stage-uds-missing-"));
 try{
  const pinned=createPinnedCstOneJobPgConnection(url,"cst_team_model_pilot_stage_login",CA);
  const pool=new pg.Pool({...pinned,stream:makeOneJobUnixSocketStream(join(dir,"absent.sock")),max:1,connectionTimeoutMillis:900});
  try{await assert.rejects(pool.query("SELECT 1"),e=>e?.code==="ENOENT"||/ENOENT/.test(String(e?.message)))}finally{await pool.end()}
 }finally{rmSync(dir,{recursive:true,force:true})}
});
