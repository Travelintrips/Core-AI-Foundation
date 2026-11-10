import { describe, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  GPT02_ISSUE159_SIGNER_DOMAINS,
} from "../gpt02Issue159FourSignerContract.js";
import {
  GPT02_ISSUE159_CUSTODY_POLICY,
} from "../gpt02Issue159SignerCustodyPolicy.js";
import {
  GPT02_ISSUE159_HUB_PUBLIC_KEY_FILES,
  GPT02_ISSUE159_HUB_PUBLIC_TRUST_TARGETS,
  buildGpt02Issue159PublicTrustHandoff,
} from "../gpt02Issue159PublicTrustHandoff.js";

const pem = () => generateKeyPairSync("ed25519").publicKey
  .export({ format: "pem", type: "spki" }).toString();

function provenance() {
  return {
    approval: {
      role: "approval" as const,
      ...GPT02_ISSUE159_CUSTODY_POLICY.approval,
      signingDomain: GPT02_ISSUE159_SIGNER_DOMAINS.approval,
      publicKeyPem: pem(),
    },
    hub: {
      role: "hub" as const,
      ...GPT02_ISSUE159_CUSTODY_POLICY.hub,
      signingDomain: GPT02_ISSUE159_SIGNER_DOMAINS.hub,
      publicKeyPem: pem(),
    },
    core: {
      role: "core" as const,
      ...GPT02_ISSUE159_CUSTODY_POLICY.core,
      signingDomain: GPT02_ISSUE159_SIGNER_DOMAINS.core,
      publicKeyPem: pem(),
    },
    issuer: {
      role: "issuer" as const,
      ...GPT02_ISSUE159_CUSTODY_POLICY.issuer,
      signingDomain: GPT02_ISSUE159_SIGNER_DOMAINS.issuer,
      publicKeyPem: pem(),
    },
  };
}

describe("GPT02 Issue159 public trust handoff", () => {
  it("maps four verified public roots to the exact Hub filenames and manifest", () => {
    const input = provenance();
    const result = buildGpt02Issue159PublicTrustHandoff(input);

    expect(GPT02_ISSUE159_HUB_PUBLIC_KEY_FILES).toEqual({
      approval: "approval-public.pem",
      hub: "hub-identity-public.pem",
      core: "core-identity-public.pem",
      issuer: "issuer-public.pem",
    });
    expect(GPT02_ISSUE159_HUB_PUBLIC_TRUST_TARGETS).toEqual({
      publicKeyDirectory: "/run/credentials/gpt02-dev",
      fingerprintManifest: "/etc/gpt02-dev/trust-fingerprints.json",
    });

    expect(result.files["approval-public.pem"]).toBe(input.approval.publicKeyPem);
    expect(result.files["hub-identity-public.pem"]).toBe(input.hub.publicKeyPem);
    expect(result.files["core-identity-public.pem"]).toBe(input.core.publicKeyPem);
    expect(result.files["issuer-public.pem"]).toBe(input.issuer.publicKeyPem);
    expect(new Set(Object.values(result.manifest)).size).toBe(4);
  });

  it("is public-only and permanently non-authorizing", () => {
    const result = buildGpt02Issue159PublicTrustHandoff(provenance());
    expect(result.privateKeyMaterialIncluded).toBe(false);
    expect(result.writesPerformed).toBe(false);
    expect(result.signerMounted).toBe(false);
    expect(result.authorizationGranted).toBe(false);
    expect(result.dispatchPermitted).toBe(false);
    expect(result.operationalTrustInstalled).toBe(false);
    expect(result.releaseDecision).toBe("NO_GO");
  });

  it("inherits provenance rejection for duplicated or misbound roots", () => {
    const input = provenance();
    input.hub.publicKeyPem = input.approval.publicKeyPem;
    expect(() => buildGpt02Issue159PublicTrustHandoff(input))
      .toThrow("GPT02_ISSUE159_INDEPENDENT_PUBLIC_KEYS_REQUIRED");

    const wrong = provenance();
    wrong.issuer.signingDomain = "ai-core-dev-checkpoint/v1";
    expect(() => buildGpt02Issue159PublicTrustHandoff(wrong))
      .toThrow("GPT02_ISSUE159_SIGNING_DOMAIN_MISMATCH");
  });

  it("production source never writes files, loads private keys, signs or uses network/DB", async () => {
    const source = await readFile(
      new URL("../gpt02Issue159PublicTrustHandoff.ts", import.meta.url),
      "utf8",
    );
    for (const forbidden of [
      "writeFile", "createPrivateKey", "sign(", "process.env",
      "node:fs", "@workspace/db", "fetch(", "http://", "https://",
      "dispatchPermitted: true",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });
});
