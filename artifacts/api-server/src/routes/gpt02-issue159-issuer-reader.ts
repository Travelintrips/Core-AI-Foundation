import { Router } from "express";
import { requireAdminApiKey } from "../middleware/adminAuth.js";
import {
  readGpt02Issue159IssuerReaderSocketHealth,
} from "../services/gpt02Issue159IssuerReaderSocketClient.js";

const router = Router();

/**
 * Admin-only health view for the isolated issuer evidence reader.
 *
 * This endpoint exposes no task, approval, nonce, operator, or ledger rows.
 * It only reports the native TLS/read-only reader health and always keeps
 * signing, authorization and dispatch disabled.
 */
router.get(
  "/internal/gpt02/issue159/issuer-reader/health",
  requireAdminApiKey,
  async (_req, res): Promise<void> => {
    try {
      const health = await readGpt02Issue159IssuerReaderSocketHealth();
      res.status(200).json({
        ok: true,
        environment: "DEV",
        reader: "gpt02_issuer_evidence_reader",
        authenticationVerified: health.nativeRoleAuthenticated,
        tlsVerified: health.tlsVerified,
        readOnlySessionVerified: health.readOnlySessionVerified,
        businessEvidenceRead: false,
        persistedTrustedReadProven: false,
        signingPermitted: false,
        authorizationGranted: false,
        dispatchPermitted: false,
        releaseDecision: "NO_GO",
      });
    } catch {
      res.status(503).json({
        ok: false,
        environment: "DEV",
        reason: "ISSUER_READER_RUNTIME_UNAVAILABLE",
        authenticationVerified: false,
        tlsVerified: false,
        readOnlySessionVerified: false,
        businessEvidenceRead: false,
        persistedTrustedReadProven: false,
        signingPermitted: false,
        authorizationGranted: false,
        dispatchPermitted: false,
        releaseDecision: "NO_GO",
      });
    }
  },
);

export default router;
