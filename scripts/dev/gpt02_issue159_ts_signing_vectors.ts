/**
 * Offline synthetic-only TypeScript/Python Ed25519 interoperability fixture.
 * No production key loads, database connections, issuer leases or dispatch.
 */
import {createHash, generateKeyPairSync, sign} from "node:crypto";
import {stdin, stdout} from "node:process";
import {
  GPT02_ISSUE159_SIGNER_ROLES,
  gpt02Issue159SigningBytes,
  verifyGpt02Issue159Signature,
} from "../../artifacts/api-server/src/services/gpt02Issue159FourSignerContract.js";

type Role = (typeof GPT02_ISSUE159_SIGNER_ROLES)[number];
type Envelope = {claims: Record<string, unknown>; signature: string};
type Packet = {
  approval: Envelope;
  hubLink: Envelope;
  coreLink: Envelope;
  issuerEvidence: Envelope;
};
type Input = {
  action: "sign" | "verify";
  packet: Packet;
  roots?: Record<Role, string>;
};
const roles: readonly Role[] = GPT02_ISSUE159_SIGNER_ROLES;
const names = {approval: "approval", hub: "hubLink", core: "coreLink", issuer: "issuerEvidence"} as const;
const read = async () => {
  let body = "";
  for await (const chunk of stdin) {
    body += String(chunk);
    if (body.length > 35000) throw Error("SYNTHETIC_FIXTURE_TOO_LARGE");
  }
  return JSON.parse(body) as Input;
};
const canonicalHashes = (packet: Packet) => Object.fromEntries(
  roles.map(role => [
    role,
    createHash("sha256")
      .update(gpt02Issue159SigningBytes(role, packet[names[role]].claims))
      .digest("hex"),
  ]),
);
const main = async () => {
  const input = await read();
  if (!input || !input.packet || (input.action !== "sign" && input.action !== "verify")) {
    throw Error("SYNTHETIC_FIXTURE_INVALID");
  }
  if (input.action === "verify") {
    if (!input.roots) throw Error("PUBLIC_ROOTS_REQUIRED");
    const verified = Object.fromEntries(roles.map(role => [
      role,
      verifyGpt02Issue159Signature(
        role, input.packet[names[role]].claims,
        input.packet[names[role]].signature, input.roots![role],
      ),
    ]));
    stdout.write(JSON.stringify({verified, hashes: canonicalHashes(input.packet)}) + "\n");
    return;
  }
  // Test-only fresh ephemeral private keys; neither persisted nor returned.
  const keys = Object.fromEntries(
    roles.map(role => [role, generateKeyPairSync("ed25519")]),
  ) as Record<Role, ReturnType<typeof generateKeyPairSync>>;
  const packet = JSON.parse(JSON.stringify(input.packet)) as Packet;
  const roots = Object.fromEntries(roles.map(role => [
    role,
    keys[role].publicKey.export({format:"pem",type:"spki"}).toString(),
  ])) as Record<Role, string>;
  for (const role of roles) {
    const envelope = packet[names[role]];
    envelope.signature = sign(
      null,
      gpt02Issue159SigningBytes(role, envelope.claims),
      keys[role].privateKey,
    ).toString("base64url");
  }
  stdout.write(JSON.stringify({packet, roots, hashes:canonicalHashes(packet)}) + "\n");
};
main().catch(() => {
  // No fixture, key, nonce, signature or token printed on error.
  process.stderr.write("SYNTHETIC_INTEROPERABILITY_TEST_FAILED\n");
  process.exitCode = 2;
});
