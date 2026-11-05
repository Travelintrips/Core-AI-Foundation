import { describe, expect, it } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import { verifyDevAttestation } from "../devChatgptAttestationVerifier.js";
const {privateKey, publicKey} = generateKeyPairSync("ed25519");
const pub=publicKey.export({format:"der",type:"spki"}).toString("base64");
const v={
 commandId:"d7479903-9a64-4a95-8511-7041817e4e61",
 eventId:"a".repeat(64),challenge:"b".repeat(64),
 conversationId:"6ad4e0a7-9964-83ec-81a6-9db5eb8457ae",
 workerId:"openclaw-travelintrips-dev",
 keyId:"openclaw-travelintrips-dev-ed25519-v1",
 assistantMessageId:"d7479903-9a64-4a95-8511-7041817e4e61",
 assistantResponseHash:"c".repeat(64),
 observedAt:"2026-10-22T08:00:00+00:00",signature:""
};
const payload=[
 "dev-chatgpt-assistant-attestation/v1",
 "keyId="+v.keyId,"workerId="+v.workerId,
 "conversationId="+v.conversationId,"eventId="+v.eventId,
 "challenge="+v.challenge,"assistantMessageId="+v.assistantMessageId,
 "assistantResponseHash="+v.assistantResponseHash,"observedAt="+v.observedAt
].join("\n");
v.signature=sign(null,Buffer.from(payload),privateKey).toString("base64");
describe("DEV attestation verifier",()=>{
 it("accepts a valid Ed25519 receipt",()=>expect(verifyDevAttestation(v,pub)).toBe(true));
 it("rejects changed eventId",()=>expect(verifyDevAttestation({...v,eventId:"d".repeat(64)},pub)).toBe(false));
 it("rejects changed challenge",()=>expect(verifyDevAttestation({...v,challenge:"d".repeat(64)},pub)).toBe(false));
 it("rejects forged signature",()=>expect(verifyDevAttestation({...v,signature:Buffer.alloc(64).toString("base64")},pub)).toBe(false));
 it("rejects different worker",()=>expect(verifyDevAttestation({...v,workerId:"openclaw-dell-chatgpt-wake-dev"},pub)).toBe(false));
});

[executed on device: srv1792369 (0891e23a-6a6b-4f8c-a16a-962e888e2014)]