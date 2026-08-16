import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";
import { adminAuthWithExceptions, optionalSessionAuth } from "./middleware/adminAuth.js";
import { globalLimiter } from "./middleware/rateLimiter.js";
import {
  suspiciousRequestLogger,
  addSecurityContext,
  blockUnknownMethods,
} from "./middleware/securityHardening.js";
import { requestCounterMiddleware } from "./routes/metrics.js";

const app: Express = express();

// ── Security headers (P0-4) ──────────────────────────────────────────────────
// helmet sets X-Frame-Options, X-Content-Type-Options, X-XSS-Protection,
// Referrer-Policy, Content-Security-Policy, and more.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", "https:"],
        fontSrc: ["'self'", "https:"],
        objectSrc: ["'none'"],
        frameSrc: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
    crossOriginEmbedderPolicy: false, // allow embedding in Replit preview
  }),
);

// ── CORS whitelist (P0-4) ────────────────────────────────────────────────────
// Allow origins from environment variable (comma-separated list), or fall back
// to the Replit dev domain and localhost for development.
const rawAllowedOrigins = process.env["ALLOWED_ORIGINS"] ?? "";
const replitDomain = process.env["REPLIT_DEV_DOMAIN"]
  ? `https://${process.env["REPLIT_DEV_DOMAIN"]}`
  : null;

const allowedOrigins: string[] = [
  ...rawAllowedOrigins.split(",").map((s) => s.trim()).filter(Boolean),
  ...(replitDomain ? [replitDomain] : []),
  "http://localhost:3000",
  "http://localhost:5173",
  "http://localhost:5174",
];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (server-to-server, curl, Postman)
      if (!origin) { callback(null, true); return; }
      if (allowedOrigins.some((o) => origin.startsWith(o))) {
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
  }),
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

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(cookieParser());

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

// ── Global rate limiting (P0-3) ───────────────────────────────────────────────
// 200 requests per IP per 15 minutes on all /api routes.
// Individual sensitive routes apply stricter per-route limits on top of this.
// Session-authenticated admin requests are skipped by isAdminRequest above.
app.use("/api", globalLimiter);

// ── Auth + routing ────────────────────────────────────────────────────────────
// adminAuthWithExceptions enforces the key/session guard for non-public routes,
// short-circuiting the DB lookup because req.internalUser is already set.
app.use("/api", adminAuthWithExceptions, router);

export default app;
