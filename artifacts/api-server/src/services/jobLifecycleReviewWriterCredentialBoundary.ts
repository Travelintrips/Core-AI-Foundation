/**
 * Validate a potential future isolated DEV review writer credential without
 * connecting or logging any secret. This is a PRECONDITION only, never
 * authorization to sign, insert, lease, dispatch or grant.
 *
 * The writer URL belongs to a separately deployed trusted service. It MUST
 * NOT be loaded into the ordinary web API environment even if these checks
 * pass. The current production readiness gate stays hard-disabled.
 */
export function assessDevReviewWriterCredentialBoundary(input:{
  appEnv:string|undefined;
  nodeEnv:string|undefined;
  runtimeDatabaseUrl:string|undefined;
  writerDatabaseUrl:string|undefined;
}):{eligibleForIndependentSecurityReview:boolean;reason:string}{
  const deny=(reason:string)=>({eligibleForIndependentSecurityReview:false,reason});
  if(input.appEnv!=="development"||input.nodeEnv==="production")
    return deny("DEV_ONLY");
  if(!input.runtimeDatabaseUrl||!input.writerDatabaseUrl)
    return deny("SEPARATE_CREDENTIAL_REQUIRED");
  try{
    const runtime=new URL(input.runtimeDatabaseUrl);
    const writer=new URL(input.writerDatabaseUrl);
    if(!["postgres:","postgresql:"].includes(runtime.protocol)||
       !["postgres:","postgresql:"].includes(writer.protocol))
      return deny("DATABASE_PROTOCOL_INVALID");
    if(!runtime.hostname||!writer.hostname||!runtime.username||!writer.username||
       !runtime.password||!writer.password||!runtime.pathname||!writer.pathname)
      return deny("DATABASE_CREDENTIAL_INCOMPLETE");
    if(runtime.hostname.toLowerCase()!==writer.hostname.toLowerCase()||
       runtime.port!==writer.port||runtime.pathname!==writer.pathname)
      return deny("DATABASE_TARGET_MISMATCH");
    // URL.username/password expose percent-encoded strings; compare the
    // actual decoded credentials to prevent reuse hidden by URL encoding.
    const runtimeUser=decodeURIComponent(runtime.username);
    const writerUser=decodeURIComponent(writer.username);
    const runtimePassword=decodeURIComponent(runtime.password);
    const writerPassword=decodeURIComponent(writer.password);
    if(runtimeUser===writerUser||runtimePassword===writerPassword||
       input.runtimeDatabaseUrl===input.writerDatabaseUrl)
      return deny("RUNTIME_CREDENTIAL_REUSE_FORBIDDEN");
    if(writerUser!=="gpt02_dev_review_writer_login")
      return deny("DEDICATED_WRITER_ROLE_REQUIRED");
    // Do not accept libpq overrides for identity, address, or database.
    // Extra query fields are not required for this preflight proposal.
    // A dedicated writer must use a reviewed connection configuration.
    if(writer.search||runtime.search)
      return deny("DATABASE_URL_PARAMETER_OVERRIDE_FORBIDDEN");
    return {eligibleForIndependentSecurityReview:true,reason:"DISTINCT_CREDENTIAL_SHAPE_ONLY_NOT_READY"};
  }catch{return deny("DATABASE_URL_INVALID");}
}
