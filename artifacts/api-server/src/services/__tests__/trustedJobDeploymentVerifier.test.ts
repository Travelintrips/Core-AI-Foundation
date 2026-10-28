import { describe, expect, it } from "vitest";
import { verifyTrustedDeployment } from "../trustedJobDeploymentVerifier.js";
const sha = "a".repeat(40);
const runtime = { imageId: "sha256:" + "b".repeat(64), labels: {"org.opencontainers.image.revision":sha}, running:true, healthy:true };
describe("trusted deployment evidence",()=>{
 it("validates matching image revision",async()=>expect((await verifyTrustedDeployment(sha,async()=>runtime)).verified).toBe(true));
 it("rejects unlabeled image",async()=>expect((await verifyTrustedDeployment(sha,async()=>({...runtime,labels:null}))).reason).toBe("IMAGE_REVISION_MISSING"));
 it("rejects wrong revision",async()=>expect((await verifyTrustedDeployment(sha,async()=>({...runtime,labels:{"org.opencontainers.image.revision":"c".repeat(40)}}))).verified).toBe(false));
 it("rejects unhealthy runtime",async()=>expect((await verifyTrustedDeployment(sha,async()=>({...runtime,healthy:false}))).verified).toBe(false));
 it("rejects spoofable tag instead of immutable image ID",async()=>expect((await verifyTrustedDeployment(sha,async()=>({...runtime,imageId:"ai-core:latest"}))).verified).toBe(false));
});
