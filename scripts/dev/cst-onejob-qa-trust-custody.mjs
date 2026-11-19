/**
 * Read-only filesystem custody preflight for a FUTURE separate QA process.
 * This check never reads a private key and never grants operational authority.
 * No caller-selected trust root is accepted for production-shaped checks.
 */
import {lstatSync,realpathSync,readFileSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {createHash,createPublicKey} from "node:crypto";

export const CST_QA_PINNED_TRUST_PATH="/etc/cst-onejob-qa/trust/public-root.json";
export const CST_QA_TRUST_DIR="/etc/cst-onejob-qa/trust";

export function reviewQaTrustCustody(
  trustFileStat, trustDirStat, observedRealpath, expectedPath,
  trustDocument, expectedProject="xssrfshdrtdfupgqwfdw"
) {
  const blockers=[];
  const check=(ok,reason)=>{if(!ok)blockers.push(reason)};
  check(expectedPath===CST_QA_PINNED_TRUST_PATH &&
    observedRealpath===CST_QA_PINNED_TRUST_PATH,
    "QA_TRUST_PATH_NOT_PINNED");
  for(const [s,label] of [[trustFileStat,"FILE"],[trustDirStat,"DIRECTORY"]]){
    check(Boolean(s && typeof s.uid==="number" && s.uid===0 &&
      typeof s.mode==="number" && (s.mode&0o022)===0 &&
      typeof s.isSymbolicLink==="function" && !s.isSymbolicLink() &&
      typeof s.isDirectory==="function" && typeof s.isFile==="function" &&
      (label==="FILE"?s.isFile():s.isDirectory())),
      "QA_TRUST_"+label+"_CUSTODY_INVALID");
  }
  check(Boolean(trustDocument&&
    Object.keys(trustDocument).sort().join(",")===
      ["use","project","verifierId","publicKeyPem","fingerprint"].sort().join(",") &&
    trustDocument.use==="CST_DEV_ONEJOB_QA_PUBLIC_PIN" &&
    trustDocument.project===expectedProject &&
    /^cst-independent-qa-[a-z0-9_-]{8,80}$/.test(trustDocument.verifierId||"") &&
    /^[a-f0-9]{64}$/.test(trustDocument.fingerprint||"")),
    "QA_TRUST_MANIFEST_SHAPE_INVALID");
  try{
    const key=createPublicKey(trustDocument.publicKeyPem);
    const actual=createHash("sha256").update(
      key.export({type:"spki",format:"der"})).digest("hex");
    check(key.asymmetricKeyType==="ed25519" &&
      actual===trustDocument.fingerprint,
      "QA_TRUST_PUBLIC_KEY_PIN_MISMATCH");
  }catch{check(false,"QA_TRUST_PUBLIC_KEY_INVALID")}
  return {status:blockers.length===0?"CUSTODY_CHECK_ONLY":"DENIED",
    blockers,queueTransitionAuthorized:false,
    dispatchPermitted:false,finalAckVerified:false};
}
export function readRootOwnedQaPublicTrust(){
  // File and directory custody are checked before opening. A production
  // verifier should additionally use openat/O_NOFOLLOW + fstat on the same fd
  // to close pathname races; this read-only preflight is not that verifier.
  const path=CST_QA_PINNED_TRUST_PATH;
  const file=lstatSync(path),dir=lstatSync(dirname(path));
  const real=realpathSync(path);
  if(file.isSymbolicLink()||dir.isSymbolicLink()||real!==path)
    throw Error("QA_TRUST_SYMLINK_OR_PATH");
  if(file.uid!==0||dir.uid!==0||(file.mode&0o022)!==0||
    (dir.mode&0o022)!==0||!file.isFile()||!dir.isDirectory())
    throw Error("QA_TRUST_UNSAFE_OWNERSHIP");
  if(file.size>8192||file.size<1)throw Error("QA_TRUST_INVALID_SIZE");
  const document=JSON.parse(readFileSync(path,"utf8"));
  return reviewQaTrustCustody(file,dir,real,path,document);
}
