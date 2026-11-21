/**
 * Exact-project CST-DEV one-job staging database preflight.
 *
 * Existing stage credentials may be injected from an already encrypted
 * systemd service credential, with the LOGICAL name "database-url". This
 * name is embedded into the encrypted envelope; the host ciphertext may
 * have a different filename. The live shared Core runtime has neither
 * this systemd unit nor its CREDENTIALS_DIRECTORY and remains denied.
 *
 * No password, DSN, credential bytes or Linux filesystem path is returned
 * by reviewCstOneJobStageDatabaseConfig. The dedicated staging connection
 * must never fall back to the common Core AI database pool.
 */
import {
 constants,openSync,closeSync,readFileSync,fstatSync,lstatSync,realpathSync
} from "node:fs";

export const CST_ONEJOB_DEV_PROJECT="xssrfshdrtdfupgqwfdw";
export const CST_ONEJOB_STAGE_LOGIN="cst_team_model_pilot_stage_login";
export const CST_ONEJOB_STAGE_WRITER="cst_team_model_pilot_writer";
export const CST_ONEJOB_STAGE_URL_KEY="CST_DEV_ONEJOB_STAGE_DATABASE_URL";
export const CST_ONEJOB_STAGE_CREDENTIAL_NAME="database-url";
export const CST_ONEJOB_STAGE_UNIT="cst-onejob-owner-stage.service";
export const CST_ONEJOB_STAGE_CREDENTIAL_DIRECTORY=
 "/run/credentials/"+CST_ONEJOB_STAGE_UNIT;
export const CST_ONEJOB_STAGE_CREDENTIAL_FILE=
 CST_ONEJOB_STAGE_CREDENTIAL_DIRECTORY+"/"+CST_ONEJOB_STAGE_CREDENTIAL_NAME;

function validCredentialText(value:string):boolean{
 return value.length>32 && value.length<=2048 &&
   !/[\0\r\n]/.test(value);
}

/**
 * Strict protected file descriptor access (used by systemd credential
 * injection). The path parameter is NOT read from HTTP or user input.
 * Runtime builds it from a single exact, source-pinned unit directory.
 */
export function readCstOneJobProtectedCredentialFile(path:string):string{
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const st=fstatSync(fd);
  if(!st.isFile()||st.nlink!==1||st.size<32||st.size>2050||
     (st.mode&0o022)!==0||(st.mode&0o004)!==0||
     (st.uid!==0&&st.uid!==process.getuid?.()))
    throw Error("ONEJOB_STAGE_CREDENTIAL_FILE_UNSAFE");
  const value=readFileSync(fd,{encoding:"utf8"}).trim();
  if(!validCredentialText(value))
    throw Error("ONEJOB_STAGE_CREDENTIAL_CONTENT_INVALID");
  return value;
 }finally{closeSync(fd)}
}

type CredentialReader=(path:string)=>string;
export function safeCstOneJobSystemdCredentialDirectory(path:string):boolean{
 try{
  const stat=lstatSync(path);
  return stat.isDirectory()&&!stat.isSymbolicLink()&&
    (stat.mode&0o022)===0&&realpathSync(path)===path;
 }catch{return false}
}
/**
 * Resolve the only dedicated credential source. A systemd credential is
 * preferable to placing a secret URL in an environment variable.
 * Both at once, wrong systemd unit path and failed reads are DENIED.
 *
 * Reader injection exists only for synthetic unit QA; production calls
 * the default protected file descriptor implementation.
 */
export function resolveCstOneJobStageDatabaseCredential(
 env:NodeJS.ProcessEnv,
 readCredential:CredentialReader=readCstOneJobProtectedCredentialFile,
 safeDirectory:(path:string)=>boolean=safeCstOneJobSystemdCredentialDirectory
):{value:string|null;blocker:string|null}{
 const envUrl=env[CST_ONEJOB_STAGE_URL_KEY];
 const dir=env.CREDENTIALS_DIRECTORY;
 if(envUrl&&dir)return {value:null,blocker:"MULTIPLE_STAGING_CREDENTIAL_SOURCES"};
 if(envUrl)return validCredentialText(envUrl)
   ?{value:envUrl,blocker:null}
   :{value:null,blocker:"STAGING_ENV_CREDENTIAL_INVALID"};
 if(!dir)return {value:null,blocker:"DEDICATED_STAGING_DATABASE_URL_MISSING"};
 if(dir!==CST_ONEJOB_STAGE_CREDENTIAL_DIRECTORY)
   return {value:null,blocker:"STAGING_SYSTEMD_UNIT_DIRECTORY_NOT_PINNED"};
 if(env.APP_ENV!=="development"||env.NODE_ENV!=="development")
   return {value:null,blocker:"CST_DEV_ONLY"};
 try{
  if(!safeDirectory(dir))
    return {value:null,blocker:"STAGING_SYSTEMD_DIRECTORY_UNSAFE"};
  const raw=readCredential(CST_ONEJOB_STAGE_CREDENTIAL_FILE);
  if(!validCredentialText(raw))
    return {value:null,blocker:"STAGING_SYSTEMD_CREDENTIAL_INVALID"};
  return {value:raw,blocker:null};
 }catch{
  return {value:null,blocker:"STAGING_SYSTEMD_CREDENTIAL_UNAVAILABLE"};
 }
}

export function reviewCstOneJobStageDatabaseConfig(
 env:NodeJS.ProcessEnv,
 reader:CredentialReader=readCstOneJobProtectedCredentialFile,
 safeDirectory:(path:string)=>boolean=safeCstOneJobSystemdCredentialDirectory
){
 const blockers:string[]=[];
 const requireCondition=(ok:boolean,reason:string)=>{if(!ok)blockers.push(reason)};
 requireCondition(env.APP_ENV==="development"&&env.NODE_ENV==="development",
   "CST_DEV_ONLY");
 requireCondition(!env.SUPABASE_PROD_DATABASE_URL,
   "PROD_DATABASE_ENV_FORBIDDEN");

 const supabaseUrl=env.SUPABASE_URL_DEV||env.VITE_SUPABASE_URL_DEV;
 try{
  const source=new URL(supabaseUrl??"");
  requireCondition(source.protocol==="https:"&&
    source.hostname===CST_ONEJOB_DEV_PROJECT+".supabase.co",
    "DEV_SUPABASE_REF_MISMATCH");
 }catch{blockers.push("DEV_SUPABASE_REF_MISSING")}

 const credential=resolveCstOneJobStageDatabaseCredential(env,reader,safeDirectory);
 if(credential.blocker)blockers.push(credential.blocker);
 const raw=credential.value;
 if(raw){
  try{
   const u=new URL(raw);
   const user=decodeURIComponent(u.username);
   requireCondition(["postgres:","postgresql:"].includes(u.protocol),
     "STAGING_DATABASE_PROTOCOL_INVALID");
   requireCondition(u.hostname==="aws-1-ap-southeast-2.pooler.supabase.com",
     "STAGING_DATABASE_NOT_SUPABASE_POOLER");
   requireCondition(u.port==="6543","STAGING_TRANSACTION_POOLER_REQUIRED");
   requireCondition(u.pathname==="/postgres","STAGING_DATABASE_NAME_INVALID");
   requireCondition(user===CST_ONEJOB_STAGE_LOGIN+"."+CST_ONEJOB_DEV_PROJECT,
     "STAGING_LOGIN_OR_PROJECT_MISMATCH");
   requireCondition(decodeURIComponent(u.password).length>=16,
     "STAGING_DEDICATED_PASSWORD_MISSING");
   // Never allow URL startup options or altered TLS pin.
   requireCondition(u.searchParams.size===1&&
     u.searchParams.get("sslmode")==="verify-full",
     "STAGING_TLS_VERIFY_FULL_REQUIRED");
   requireCondition(u.hash==="","STAGING_URL_FRAGMENT_FORBIDDEN");
  }catch{blockers.push("STAGING_DATABASE_URL_MALFORMED")}
 }
 return {readyForDedicatedConnection:blockers.length===0,blockers} as const;
}
