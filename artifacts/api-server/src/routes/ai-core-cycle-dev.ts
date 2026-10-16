import { Router, type RequestHandler } from "express";
import { ZodError } from "zod";
import { AiCoreCyclicHandshakeCoordinator } from "../services/aiCoreCyclicHandshakeCoordinatorService.js";

/**
 * Mount only in DEV behind a scoped, server-verified service-token middleware.
 * Caller-supplied VERIFIED/ACK flags are never sufficient: the coordinator
 * independently checks a trusted verifier and durable store.
 */
export function createDevCyclicHandshakeRouter(
  authenticateService: RequestHandler,
  coordinator: AiCoreCyclicHandshakeCoordinator,
) {
  const router = Router();
  router.use((req, res, next) => {
    if (process.env["NODE_ENV"] === "production" || process.env["AI_CORE_CYCLE_DEV_ENABLED"] !== "true") {
      res.status(404).json({ error: "not_enabled" });
      return;
    }
    next();
  });
  router.use(authenticateService);
  const handler = (operation: "handshake" | "receiveVerifiedResult" | "continue"): RequestHandler =>
    async (req, res) => {
      try {
        const response = await coordinator[operation](req.body as unknown);
        const accepted = "accepted" in response ? response.accepted : response.continued;
        res.status(accepted ? 200 : 409).json(response);
      } catch (error) {
        if (error instanceof ZodError) {
          res.status(400).json({ error: "invalid_payload" });
          return;
        }
        // Fail closed; never echo exception details or secrets to callers.
        res.status(503).json({ error: "cycle_unavailable" });
      }
    };
  router.post("/handshake", handler("handshake"));
  router.post("/result", handler("receiveVerifiedResult"));
  router.post("/continue", handler("continue"));
  return router;
}
