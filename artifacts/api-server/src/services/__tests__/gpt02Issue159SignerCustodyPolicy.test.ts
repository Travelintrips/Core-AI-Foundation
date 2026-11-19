import { describe, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  GPT02_ISSUE159_CUSTODY_POLICY,
  GPT02_ISSUE159_FORBIDDEN_REUSE_DOMAINS,
  assessGpt02Issue159SignerProvenance,
} from "../gpt02Issue159SignerCustodyPolicy.js";
import { GPT02_ISSUE159_SIGNER_DOMAINS } from "../gpt02Issue159FourSignerContract.js";

const keyPem = () => generateKeyPairSync("ed25519").publicKey
  .export({ format: "pem", type: "spki" }).toString();

function good() {
  return {
    approval: {
      role: "approval" as const,
      ...GPT02_ISSUE159_CUSTODY_POLICY.approval,
      signingDomain: GPT02_ISSUE159_SIGNER_DOMAINS.approval,
      publicKeyPem: keyPem(),
    },
    hub: {
      role: "hub" as const,
      ...GPT02_ISSUE159_CUSTODY_POLICY.hub,
      signingDomain: GPT02_ISSUE159_SIGNER_DOMAINS.hub,
      publicKeyPem: keyPem(),
    },
    core: {
      role: "core" as const,
      ...GPT02_ISSUE159_CUSTODY_POLICY.core,
      signingDomain: GPT02_ISSUE159_SIGNER_DOMAINS.core,
      publicKeyPem: keyPem(),
    },
    issuer: {
      role: "issuer" as const,
      ...GPT02_ISSUE159_CUSTODY_POLICY.issuer,
      signingDomain: GPT02_ISSUE159_SIGNER_DOMAINS.issuer,
      publicKeyPem: keyPem(),
    },
  };
}

describe("GPT02 Issue159 signer custody provenance policy", () => {
  it("pins four independent custody slots and single-admin authorizer sources but stays NO_GO", () => {
    expect(GPT02_ISSUE159_CUSTODY_POLICY.approval.authorizerSource)
      .toBe("authenticated-super-admin-approval-audit");
    const result = assessGpt02Issue159SignerProvenance(good());
    expect(result.provenancePolicyVerified).toBe(true);
    expect(result.distinctCustodySlots).toBe(true);
    expect(new Set(Object.values(result.publicFingerprints)).size).toBe(4);
    expect(result.privateKeyCustodyAttested).toBe(false);
    expect(result.roleAuthorizersOperationallyVerified).toBe(false);
    expect(result.signerMounted).toBe(false);
    expect(result.authorizationGranted).toBe(false);
    expect(result.dispatchPermitted).toBe(false);
    expect(result.releaseDecision).toBe("NO_GO");
  });

  it("rejects a checkpoint, wake, session or recovery-fence domain", () => {
    for (const forbidden of GPT02_ISSUE159_FORBIDDEN_REUSE_DOMAINS) {
      const input = good();
      input.issuer.signingDomain = forbidden;
      expect(() => assessGpt02Issue159SignerProvenance(input))
        .toThrow("GPT02_ISSUE159_SIGNING_DOMAIN_MISMATCH");
    }
  });

  it("rejects wrong authorizer source, wrong custody slot and duplicate key roots", () => {
    {
      const input = good();
      input.approval.authorizerSource = "static-dev-approval-token";
      expect(() => assessGpt02Issue159SignerProvenance(input))
        .toThrow("GPT02_ISSUE159_AUTHORIZER_SOURCE_MISMATCH");
    }
    {
      const input = good();
      input.hub.custodySlot = input.core.custodySlot;
      expect(() => assessGpt02Issue159SignerProvenance(input))
        .toThrow("GPT02_ISSUE159_CUSTODY_SLOT_MISMATCH");
    }
    {
      const input = good();
      input.hub.publicKeyPem = input.approval.publicKeyPem;
      expect(() => assessGpt02Issue159SignerProvenance(input))
        .toThrow("GPT02_ISSUE159_INDEPENDENT_PUBLIC_KEYS_REQUIRED");
    }
  });

  it("requires exact role records and exact signer identity", () => {
    const extra = { ...good(), checkpoint: {} };
    expect(() => assessGpt02Issue159SignerProvenance(extra))
      .toThrow("GPT02_ISSUE159_FOUR_PROVENANCE_RECORDS_REQUIRED");

    const wrong = good();
    (wrong.core as { role: string }).role = "hub";
    expect(() => assessGpt02Issue159SignerProvenance(wrong))
      .toThrow("GPT02_ISSUE159_PROVENANCE_SHAPE_INVALID");
  });

  it("production policy source has no signing, private-key, env, DB or network surface", async () => {
    const source = await readFile(
      new URL("../gpt02Issue159SignerCustodyPolicy.ts", import.meta.url),
      "utf8",
    );
    for (const forbidden of [
      "createPrivateKey", "sign(", "process.env", "readFile",
      "node:fs", "@workspace/db", "fetch(", "http://", "https://",
      "dispatchPermitted: true",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });
});
