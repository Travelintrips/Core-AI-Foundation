/**
 * Exact-project, dedicated PostgreSQL staging-login preflight.
 *
 * No connection is attempted by this module. It never returns, logs, or
 * serializes a password/URL. The existing shared @workspace/db pool must
 * never be substituted if this separately supplied credential is absent.
 */
export const CST_ONEJOB_DEV_PROJECT = "xssrfshdrtdfupgqwfdw";
export const CST_ONEJOB_STAGE_LOGIN = "cst_team_model_pilot_stage_login";
export const CST_ONEJOB_STAGE_WRITER = "cst_team_model_pilot_writer";
export const CST_ONEJOB_STAGE_URL_KEY = "CST_DEV_ONEJOB_STAGE_DATABASE_URL";

export function reviewCstOneJobStageDatabaseConfig(env:NodeJS.ProcessEnv) {
  const blockers:string[]=[];
  const requireCondition=(ok:boolean,reason:string)=>{if(!ok)blockers.push(reason)};
  requireCondition(env.APP_ENV==="development"&&env.NODE_ENV==="development",
    "CST_DEV_ONLY");
  requireCondition(!env.SUPABASE_PROD_DATABASE_URL,
    "PROD_DATABASE_ENV_FORBIDDEN");

  const supabaseUrl=env.SUPABASE_URL_DEV || env.VITE_SUPABASE_URL_DEV;
  try {
    const source=new URL(supabaseUrl??"");
    requireCondition(source.protocol==="https:"&&
      source.hostname===CST_ONEJOB_DEV_PROJECT+".supabase.co",
      "DEV_SUPABASE_REF_MISMATCH");
  }catch{blockers.push("DEV_SUPABASE_REF_MISSING")}

  const raw=env[CST_ONEJOB_STAGE_URL_KEY];
  if(!raw){
    blockers.push("DEDICATED_STAGING_DATABASE_URL_MISSING");
  }else{
    try {
      const u=new URL(raw);
      const user=decodeURIComponent(u.username);
      requireCondition(["postgres:","postgresql:"].includes(u.protocol),
        "STAGING_DATABASE_PROTOCOL_INVALID");
      requireCondition(/^[a-z0-9-]+\.pooler\.supabase\.com$/.test(u.hostname),
        "STAGING_DATABASE_NOT_SUPABASE_POOLER");
      requireCondition(u.port==="6543","STAGING_TRANSACTION_POOLER_REQUIRED");
      requireCondition(u.pathname==="/postgres","STAGING_DATABASE_NAME_INVALID");
      requireCondition(user===CST_ONEJOB_STAGE_LOGIN+"."+CST_ONEJOB_DEV_PROJECT,
        "STAGING_LOGIN_OR_PROJECT_MISMATCH");
      requireCondition(decodeURIComponent(u.password).length>=16,
        "STAGING_DEDICATED_PASSWORD_MISSING");
      // The pg driver translates sslmode=verify-full to certificate/hostname
      // validation. Reject libpq options, alternate root CA paths and any
      // connection-string parameter that could change role/SSL semantics.
      requireCondition(u.searchParams.size===1&&
        u.searchParams.get("sslmode")==="verify-full",
        "STAGING_TLS_VERIFY_FULL_REQUIRED");
      requireCondition(u.hash==="","STAGING_URL_FRAGMENT_FORBIDDEN");
    }catch{blockers.push("STAGING_DATABASE_URL_MALFORMED")}
  }
  return {readyForDedicatedConnection:blockers.length===0,blockers} as const;
}
