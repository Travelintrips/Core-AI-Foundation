import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Request, Response, NextFunction } from "express";
import { aiAgentServiceTokensTable, db } from "@workspace/db";
import { logger } from "../lib/logger.js";

const MAX_TOKEN_LENGTH = 512;

export function hashAgentServiceToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function readAgentToken(req: Request): string | null {
  const direct = req.headers["x-ai-agent-token"];
  if (typeof direct === "string" && direct.trim()) return direct.trim();

  const authorization = req.headers.authorization;
  if (authorization?.startsWith("Bearer ")) {
    const token = authorization.slice(7).trim();
    return token || null;
  }
  return null;
}

export function requireAgentServiceScope(requiredScope: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const token = readAgentToken(req);
    if (!token || token.length > MAX_TOKEN_LENGTH) {
      res.status(401).json({ error: "Invalid or missing AI agent service token" });
      return;
    }

    try {
      const tokenHash = hashAgentServiceToken(token);
      const [record] = await db
        .select()
        .from(aiAgentServiceTokensTable)
        .where(and(
          eq(aiAgentServiceTokensTable.tokenHash, tokenHash),
          eq(aiAgentServiceTokensTable.isActive, true),
        ))
        .limit(1);

      if (!record) {
        res.status(401).json({ error: "Invalid or inactive AI agent service token" });
        return;
      }

      if (record.expiresAt && record.expiresAt.getTime() <= Date.now()) {
        res.status(401).json({ error: "AI agent service token has expired" });
        return;
      }

      const scopes = Array.isArray(record.scopes) ? record.scopes : [];
      if (!scopes.includes("*") && !scopes.includes(requiredScope)) {
        res.status(403).json({ error: "AI agent service token scope is insufficient" });
        return;
      }

      res.locals["aiAgentService"] = {
        id: record.id,
        name: record.name,
        scopes,
      };

      await db
        .update(aiAgentServiceTokensTable)
        .set({ lastUsedAt: new Date(), updatedAt: new Date() })
        .where(eq(aiAgentServiceTokensTable.id, record.id));

      next();
    } catch (error) {
      logger.error({ err: error }, "[agent-runtime] scoped token authentication failed");
      res.status(503).json({ error: "AI agent service authentication temporarily unavailable" });
    }
  };
}
