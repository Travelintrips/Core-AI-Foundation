import { describe, expect, it } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import { createGpt02ReaderCustodyVerifiedAdapter } from "../gpt02ReaderCustodyVerifiedAdapter.js";

const PROJECT="xssrfshdrtdfupgqwfdw";
const NOW=1795536000000;
function keyPair() {
  const {publicKey,privateKey}=generateKeyPairSync("ed25519");
  return {
    publicKey:publicKey.export({format:"der",type:"spki"}).toString("base64"),
    privateKey,
  };
}
function seal(data: Record<string, unknown>, fields: string[], privateKey: ReturnType<typeof keyPair>["privateKey"]) {
  const message: Record<string,unknown>={};
  for(const key of fields) message[key]=data[key];
  return JSON.stringify({...message,signature:sign(null,Buffer.from(JSON.stringify(message)),privateKey).toString("base64")});
}
const workerFields=["kind","serviceId","principal","scope","projectId","issuedAt","expiresAt"];
const receiptFields=["kind","receiptId","role","projectId","issuedAt","expiresAt"];
function fixture(change: {worker?:Record<string,unknown>;receipt?:Record<string,unknown>}={}) {
  const worker=keyPair(),issuer=keyPair();
  const subject={kind:"GPT02_DEV_WORKER_ATTESTATION_V1",serviceId:"actual-service-id-1",principal:"openclaw-vps-main",
    scope:"GPT02_READER_CREDENTIAL_CUSTODY_CST_DEV",projectId:PROJECT,issuedAt:NOW-1000,expiresAt:NOW+60000,...(change.worker??{})};
  const receipt={kind:"GPT02_DEV_OWNER_READER_ISSUER_RECEIPT_V1",receiptId:"receipt-verified-001",
    role:"gpt02_owner_ledger_reader_dev",projectId:PROJECT,issuedAt:NOW-1000,expiresAt:NOW+60000,...(change.receipt??{})};
  const files: Record<string,string>={
    "/run/credentials/gpt02-reader-custody/worker-attestation.json":seal(subject,workerFields,worker.privateKey),
    "/run/credentials/gpt02-reader-custody/issuer-receipt.json":seal(receipt,receiptFields,issuer.privateKey),
  };
  const make=(keys={worker:worker.publicKey,issuer:issuer.publicKey})=>createGpt02ReaderCustodyVerifiedAdapter({
    keys,now:()=>NOW,read:async path=>{if(!(path in files)) throw Error("missing");return files[path];},
  });
  return {files,worker,issuer,make};
}
describe("GPT02 custody adapter has independent signed proof gates",()=>{
  it("remains locked without two pinned keys",async()=>{
    const x=fixture();const adapter=x.make({worker:"",issuer:""});
    expect(await adapter.verifyWorkerAttestation("actual-service-id-1","openclaw-vps-main")).toBe(false);
    expect(await adapter.readDbaCustodyReceipt()).toEqual({verified:false,receiptId:null});
  });
  it("accepts only independent verified short-lived DEV proofs",async()=>{
    const a=fixture().make();
    expect(await a.verifyWorkerAttestation("actual-service-id-1","openclaw-vps-main")).toBe(true);
    expect(await a.readDbaCustodyReceipt()).toEqual({verified:true,receiptId:"receipt-verified-001"});
  });
  it("rejects wrong token service binding and claimed principal",async()=>{
    const a=fixture().make();
    expect(await a.verifyWorkerAttestation("forged-id","openclaw-vps-main")).toBe(false);
    expect(await a.verifyWorkerAttestation("actual-service-id-1","postgres")).toBe(false);
  });
  it("rejects expired, future or wrong environment attestation",async()=>{
    for(const worker of [{expiresAt:NOW-1},{issuedAt:NOW+10},{projectId:"prod"}]){
      const a=fixture({worker}).make();
      expect(await a.verifyWorkerAttestation("actual-service-id-1","openclaw-vps-main")).toBe(false);
    }
  });
  it("does not trust unsigned or tampered source files",async()=>{
    const x=fixture();
    x.files["/run/credentials/gpt02-reader-custody/worker-attestation.json"]='{"serviceId":"actual-service-id-1"}';
    x.files["/run/credentials/gpt02-reader-custody/issuer-receipt.json"]='{}';
    expect(await x.make().verifyWorkerAttestation("actual-service-id-1","openclaw-vps-main")).toBe(false);
    expect((await x.make().readDbaCustodyReceipt()).verified).toBe(false);
  });
  it("denies receipt from wrong reader role and expired receipt",async()=>{
    for(const receipt of [{role:"postgres"},{expiresAt:NOW-100}]){
      expect((await fixture({receipt}).make().readDbaCustodyReceipt()).verified).toBe(false);
    }
  });
  it("rejects shared worker+issuer key and nonexistent file",async()=>{
    const x=fixture(),same=x.make({worker:x.worker.publicKey,issuer:x.worker.publicKey});
    expect(await same.verifyWorkerAttestation("actual-service-id-1","openclaw-vps-main")).toBe(false);
    expect((await same.readDbaCustodyReceipt()).verified).toBe(false);
    delete x.files["/run/credentials/gpt02-reader-custody/issuer-receipt.json"];
    expect((await x.make().readDbaCustodyReceipt()).verified).toBe(false);
  });
  it("does not leak claims from oversized input",async()=>{
    const x=fixture();
    x.files["/run/credentials/gpt02-reader-custody/worker-attestation.json"]="x".repeat(4097);
    expect(await x.make().verifyWorkerAttestation("actual-service-id-1","openclaw-vps-main")).toBe(false);
  });
});
