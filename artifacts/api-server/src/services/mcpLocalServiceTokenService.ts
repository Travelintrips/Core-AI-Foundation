import { createHash, timingSafeEqual } from "node:crypto";

const ALLOWED_SHA256 = [
  "0db2299b580ba314f10f1311c046763f98ac578020aaf12117cdff7426f03b91",
] as const;

function safeEqual(actual: string, expected: string): boolean {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function isAllowedLocalMcpServiceToken(token: string): boolean {
  if (!token) return false;
  const digest = createHash("sha256").update(token, "utf8").digest("hex");
  return ALLOWED_SHA256.some((expected) => safeEqual(digest, expected));
}
