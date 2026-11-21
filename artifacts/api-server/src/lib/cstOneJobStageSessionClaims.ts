/**
 * The existing Core internal_session JWT has EXACTLY sub,iat,exp.
 * This is a locator, never a DB role or an Owner business approval.
 * Cryptographic HS256 verification is performed separately in middleware.
 */
export function cstOneJobStageSessionId(claims:unknown,nowSeconds:number):number|null{
 if(!claims||typeof claims!=="object"||Array.isArray(claims)||
   !Number.isSafeInteger(nowSeconds)||nowSeconds<=0)return null;
 const c=claims as Record<string,unknown>;
 if(Object.keys(c).sort().join(",")!=="exp,iat,sub"||
   !Number.isSafeInteger(c.sub)||Number(c.sub)<=0||
   !Number.isSafeInteger(c.iat)||Number(c.iat)>nowSeconds||
   !Number.isSafeInteger(c.exp)||Number(c.exp)<=nowSeconds||
   nowSeconds-Number(c.iat)>12*3600)return null;
 return Number(c.sub);
}
