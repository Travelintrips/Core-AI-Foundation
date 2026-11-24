import express, { type Express } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";
import { adminAuthWithExceptions, optionalSessionAuth } from "./middleware/adminAuth.js";
import { globalLimiter, mcpLimiter } from "./middleware/rateLimiter.js";
import {
  suspiciousRequestLogger,
  addSecurityContext,
  blockUnknownMethods,
} from "./middleware/securityHardening.js";
import { requestCounterMiddleware } from "./routes/metrics.js";
import codingGithubWebhookRouter from "./routes/coding-github-webhook.js";
import codingWhatsappWebhookRouter from "./routes/coding-whatsapp-webhook.js";
import aiCoreSignedCallbackReceiver from "./routes/ai-core-signed-callback-receiver.js";
import remoteOllamaWorkerRouter from "./routes/remote-ollama-worker.js";
import task189ReleaseRouter from "./routes/task189-release.js";
import agentRuntimeRouter from "./routes/agent-runtime.js";
import { createDefaultCstProjectContinuePartialRouter } from "./routes/cst-project-continue-partial.js";
import { createDefaultGpt02ContinuePartialRouter } from "./routes/gpt02-continue-partial-job.js";
import { createDefaultCrossProjectContinuePartialRouter } from "./routes/cst-project-continue-partial-job.js";
import { createLockedGpt02ReaderCustodyBroker } from "./routes/gpt02-reader-custody-broker.js";
import temporalCodingWorkerRouter from "./routes/temporal-coding-worker.js";
import aiCoreMcpOauthRouter from "./routes/ai-core-mcp-oauth.js";
import { oauthNavigationCors } from "./middleware/oauthNavigationCors.js";
import { createGpt02RelockOwnerApprovalRouter } from "./routes/gpt02-relock-owner-approval.js";
import { createGpt02OwnerLedgerReadRouter } from "./routes/gpt02-owner-ledger-read.js";
import { readGpt02SuperAdminLedgerReceipt } from "./services/gpt02SuperAdminLedgerReader.js";
import { verifyCstHubGpt02OwnerSession, verifyCstHubGpt02OwnerLink } from "./services/cstHubGpt02OwnerIdentityVerifier.js";

const app: Express = express();

// ── Security headers (P0-4) ──────────────────────────────────────────────────
// helmet sets X-Frame-Options, X-Content-Type-Options, X-XSS-Protection,
// Referrer-Policy, Content-Security-Policy, and more.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "https://ajax.googleapis.com"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:", "https:"],
        connectSrc: ["'self'", "blob:", "https:"],
        fontSrc: ["'self'", "https:"],
        objectSrc: ["'none'"],
        frameSrc: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
    crossOriginEmbedderPolicy: false, // allow embedding in Replit preview
  }),
);

// OAuth consent POST redirects to the validated ChatGPT/Codex callback. Browsers
// apply form-action to redirects, so 'self' alone breaks authorization.
// Only the OAuth consent page receives this narrowly scoped override.
// Redirect targets are independently allowlisted and PKCE-validated by OAuth.
app.use((req, res, next) => {
  if (req.method === "GET" && req.path === "/api/ai/core-chat/oauth/authorize") {
    const csp = res.getHeader("Content-Security-Policy");
    if (typeof csp === "string") {
      res.setHeader(
        "Content-Security-Policy",
        csp.replace(
          /(?:^|;)\s*form-action\s+[^;]*/i,
          ";form-action 'self' https://chatgpt.com http://localhost:* http://127.0.0.1:*",
        ),
      );
    }
  }
  next();
});

// ── CORS whitelist (P0-4) ────────────────────────────────────────────────────
// Allow origins from environment variable (comma-separated list), or fall back
// to the Replit dev domain and localhost for development.
const rawAllowedOrigins = process.env["ALLOWED_ORIGINS"] ?? "";
const publicAppUrl = process.env["PUBLIC_APP_URL"] ?? "";
const shouldServeFrontend =
  process.env["NODE_ENV"] === "production" ||
  process.env["SERVE_FRONTEND"] === "true";

const productionDefaultOrigins =
  process.env["NODE_ENV"] === "production"
    ? [
        "https://aicore.cstlogistic.co.id",
        "https://aicoding.travelintrips.co.id",
        "https://coding.cstlogistic.co.id",
        "https://aifront.cstlogistic.co.id",
        "https://lightsalmon-cheetah-642414.hostingersite.com",
        "https://grey-crocodile-883871.hostingersite.com",
      ]
    : [];
const replitDomain = process.env["REPLIT_DEV_DOMAIN"]
  ? `https://${process.env["REPLIT_DEV_DOMAIN"]}`
  : null;

const allowedOrigins: string[] = [
  ...rawAllowedOrigins.split(",").map((s) => s.trim()).filter(Boolean),
  ...(publicAppUrl ? [publicAppUrl] : []),
  ...productionDefaultOrigins,
  ...(replitDomain ? [replitDomain] : []),
  "http://localhost:3000",
  "http://localhost:5173",
  "http://localhost:5174",
];

app.use(
  oauthNavigationCors(cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (server-to-server, curl, Postman)
      if (!origin) { callback(null, true); return; }
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else if (process.env["NODE_ENV"] === "development") {
        // In development, be permissive to allow Vite HMR and previews
        callback(null, true);
      } else {
        callback(new Error(`CORS: origin '${origin}' is not allowed`));
      }
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Admin-Api-Key", "x-admin-api-key"],
    credentials: true,
    maxAge: 86400,
  })),
);

// ── Request logging ──────────────────────────────────────────────────────────
app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// Webhooks that verify signatures must see exact raw bytes before the global JSON parser.
app.use("/api", codingGithubWebhookRouter);
app.use("/api", codingWhatsappWebhookRouter);
app.use("/api", aiCoreSignedCallbackReceiver);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(cookieParser());

// OAuth discovery/authorization endpoints own their authentication and must be
// reachable before the admin API guard. MCP tool execution remains protected.
app.use(aiCoreMcpOauthRouter);

// ── Trust proxy (Replit reverse proxy injects X-Forwarded-For) ───────────────
// Without this express-rate-limit cannot identify individual client IPs and
// buckets all traffic together, causing false 429s.
app.set("trust proxy", 1);

// ── WP-12 Security hardening ─────────────────────────────────────────────────
// blockUnknownMethods: rejects non-standard HTTP verbs (PROPFIND, TRACK, etc.)
// addSecurityContext:  adds X-Request-Id + X-Content-Type-Options to every response
// suspiciousRequestLogger: logs (but does not block) path-traversal / probe requests
// requestCounterMiddleware: in-memory request counters for /ai/metrics
app.use(blockUnknownMethods);
app.use(addSecurityContext);
app.use(suspiciousRequestLogger);
app.use(requestCounterMiddleware);

// optionalSessionAuth runs first: hydrates req.internalUser from the session
// cookie without blocking.  This ensures that public routes (PUBLIC_ROUTE_RULES
// exemptions) receive an authenticated internalUser when a valid session exists,
// allowing route handlers to do their own admin-branching (e.g. status=inactive).
app.use("/api", optionalSessionAuth);

// Machine-to-machine workers authenticate with dedicated scoped credentials.
// Mount these routers before the public per-IP limiter: their heartbeat and
// discovery loops are intentionally frequent, and sharing the Hostinger proxy IP
// with unrelated traffic would otherwise create false 429s. Each matching route
// still fails closed in its own worker/service-token middleware.
app.use("/api", remoteOllamaWorkerRouter);
app.use("/api", agentRuntimeRouter);
// Shared continuation API for CST projects; project-specific verified pairing required.
if (process.env["NODE_ENV"] !== "production" && process.env["APP_ENV"] !== "production") {
  app.use("/api/ai/agent-runtime/dev/projects/continue-partial", createDefaultCstProjectContinuePartialRouter());
}
// DEV-only paired GPT02 continuation lane; existing DELL identity and browser proof remain mandatory.
if (process.env["NODE_ENV"] !== "production" && process.env["APP_ENV"] !== "production") {
  app.use("/api/ai/agent-runtime/dev/gpt02/continue-partial", createDefaultGpt02ContinuePartialRouter());
  // Reuses the same verified DELL transport; each request carries a strict project scope.
  app.use("/api/ai/agent-runtime/dev/projects/continue-partial", createDefaultCrossProjectContinuePartialRouter());
}
// DEV-only, authenticated custody broker; fail closed until real attestation + DBA receipt.
if (process.env["NODE_ENV"] !== "production" && process.env["APP_ENV"] !== "production") {
  app.use("/api/gpt02-reader-custody", createLockedGpt02ReaderCustodyBroker());
}
app.use("/api", temporalCodingWorkerRouter);

// ── Global rate limiting (P0-3) ───────────────────────────────────────────────
// 200 requests per IP per 15 minutes on all remaining /api routes.
// Individual sensitive routes apply stricter per-route limits on top of this.
// Session-authenticated admin requests are skipped by isAdminRequest above.
app.use("/api", globalLimiter);
app.use("/api", mcpLimiter);
app.use("/api", task189ReleaseRouter);

// DEV-only Owner approval uses its own signed Google session and Owner-link checks.
// Mount BEFORE the generic admin API key guard; no other API bypass is granted.
if (
  process.env.NODE_ENV !== "production" &&
  process.env.APP_ENV === "development" &&
  process.env.GPT02_RELOCK_OWNER_APPROVAL_ENABLED === "true"
) {
  app.use("/api/gpt02-owner-approval", createGpt02RelockOwnerApprovalRouter({
    verifyOwnerSession: ({ bearerToken }) => verifyCstHubGpt02OwnerSession({ bearerToken }),
    verifyOwnerEligibility: verifyCstHubGpt02OwnerLink,
  }));
}

// Isolated DEV-only Super Admin ledger reader: GET-only, separate Postgres
// credentials/custody. Never fall back to the main application writer pool.
if (
  process.env.NODE_ENV !== "production" &&
  process.env.APP_ENV === "development" &&
  process.env.GPT02_OWNER_LEDGER_READER_ENABLED === "true"
) {
  app.use("/api/gpt02-owner-ledger", createGpt02OwnerLedgerReadRouter({
    verifyOwnerSession: (token) => verifyCstHubGpt02OwnerSession({ bearerToken: token }),
    verifyOwnerEligibility: verifyCstHubGpt02OwnerLink,
    readReceipt: readGpt02SuperAdminLedgerReceipt,
  }));
}

// ── Auth + routing ────────────────────────────────────────────────────────────
// adminAuthWithExceptions enforces the key/session guard for non-public routes,
// short-circuiting the DB lookup because req.internalUser is already set.
app.use("/api", adminAuthWithExceptions, router);

const productionPublicDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "public",
);

const serveStaticFrontend =
  shouldServeFrontend ||
  process.env["SERVE_STATIC_FRONTEND"] === "true";

// Serve sitemap with an explicit XML content type. Search Console must receive
// a real XML response rather than relying on the hosting layer to infer MIME
// from a staged static file. Keep the retired aicore sitemap URL as a permanent
// redirect because that URL was submitted before the public/internal split.
app.get("/sitemap.xml", (req, res, next) => {
  const hostname = req.hostname.toLowerCase();

  if (hostname === "aicore.cstlogistic.co.id") {
    return res.redirect(301, "https://aifront.cstlogistic.co.id/sitemap.xml");
  }

  if (
    process.env["NODE_ENV"] === "production" &&
    hostname === "aifront.cstlogistic.co.id"
  ) {
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=300");
    return res.sendFile(path.join(productionPublicDir, "sitemap.xml"));
  }

  return next();
});

// Serve the production frontend from the same Hostinger Node deployment.
if (serveStaticFrontend) {
  const publicDir = productionPublicDir;
  app.use(express.static(publicDir));
  app.use((req, res, next) => {
    if (req.method !== "GET") return next();
    return res.sendFile(path.join(publicDir, "index.html"));
  });
}

export default app;
