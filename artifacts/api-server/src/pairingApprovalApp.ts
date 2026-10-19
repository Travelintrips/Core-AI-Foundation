import express, { type NextFunction, type Request, type RequestHandler, type Response } from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { oauthNavigationCors } from "./middleware/oauthNavigationCors.js";

export const PAIRING_APPROVAL_PATH = "/api/ai/core-chat/oauth/pair/approve";
export type PairingIdentityEnvironment = "development" | "production";

class PairingApprovalCorsError extends Error {}

type Options = {
  oauthRouter: RequestHandler;
  publicOrigin: string;
  identityEnvironment: PairingIdentityEnvironment;
  buildSha: string;
};

/** A narrow host for the existing approval handler, never a general API server. */
export function createPairingApprovalApp(options: Options) {
  const origin = new URL(options.publicOrigin);
  if (origin.protocol !== "https:" || origin.origin !== options.publicOrigin) {
    throw new Error("Pairing approval requires an explicit HTTPS issuer origin");
  }
  if (!["development", "production"].includes(options.identityEnvironment)) {
    throw new Error("Pairing approval requires an explicit identity environment");
  }
  if (!/^[0-9a-f]{40}$/.test(options.buildSha)) {
    throw new Error("Pairing approval requires an immutable source SHA");
  }

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(helmet());
  app.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.method === "GET" && req.path === "/api/healthz") {
      res.json({
        status: "ok",
        service: "mcp-pairing-approval",
        scope: "PAIRING_APPROVAL_ONLY",
        identityEnvironment: options.identityEnvironment,
        backgroundControllers: false,
        buildSha: options.buildSha,
      });
      return;
    }
    if (req.path !== PAIRING_APPROVAL_PATH || !["GET", "POST"].includes(req.method)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    next();
  });
  app.use(oauthNavigationCors(cors({
    origin: (requestOrigin, callback) => {
      if (!requestOrigin || requestOrigin === options.publicOrigin) {
        callback(null, true);
        return;
      }
      callback(new PairingApprovalCorsError("Origin not allowed"));
    },
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"],
    credentials: true,
  })));
  app.use(express.json({ limit: "8kb" }));
  app.use(express.urlencoded({ extended: false, limit: "8kb" }));
  app.use(cookieParser());
  // Keep session verification, active-user checks and pairing updates unchanged.
  app.use(options.oauthRouter);
  app.use((_req, res) => res.status(404).json({ error: "Not found" }));
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof PairingApprovalCorsError) {
      res.status(403).json({ error: "origin_not_allowed" });
      return;
    }
    // Never emit a stack, session cookie, code, database URL or upstream error.
    res.status(500).json({ error: "pairing_approval_unavailable" });
  });
  return app;
}
