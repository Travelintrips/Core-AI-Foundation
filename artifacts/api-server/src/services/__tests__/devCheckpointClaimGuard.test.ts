import { describe, expect, it } from 'vitest';
import { assertNoSelfAttestedCheckpoint } from '../devCheckpointClaimGuard.js';
describe('checkpoint issuer safety', () => {
  it('rejects caller-provided verified claims', () => {
    for (const key of ['verified','checkpointVerified','verifiedAssistantReply','attestationVerified','verifiedAttestation']) {
      expect(() => assertNoSelfAttestedCheckpoint('CHECKPOINT',{[key]:true})).toThrow('DEV_CHECKPOINT_ATTESTATION_ISSUER_REQUIRED');
    }
    expect(() => assertNoSelfAttestedCheckpoint('CHECKPOINT',{attestation:{algorithm:'Ed25519',signature:'fake'}})).toThrow();
  });
  it('permits nonverified diagnostic checkpoints and other lifecycle events', () => {
    expect(() => assertNoSelfAttestedCheckpoint('CHECKPOINT',{nextStepId:'step-2'})).not.toThrow();
    expect(() => assertNoSelfAttestedCheckpoint('COMPLETED',{verified:true})).not.toThrow();
  });
});
