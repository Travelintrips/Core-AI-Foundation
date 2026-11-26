import { constants, type Stats } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { dirname, isAbsolute, normalize } from "node:path";

/** Bounded codes only: never expose a pathname, OS error, or file contents. */
export class ProtectedRuntimeFileError extends Error {
  constructor(readonly code: "MISSING" | "UNSAFE" | "INVALID") { super(code); }
}

export type ProtectedRuntimeFilePolicy = Readonly<{
  maxBytes: number;
  forbiddenPermissionBits: number;
  requireRootGroup?: boolean;
}>;

function validateInputs(path: string, policy: ProtectedRuntimeFilePolicy): void {
  if (typeof path !== "string" || !isAbsolute(path) || normalize(path) !== path || path.includes("\0") ||
      !policy || !Number.isSafeInteger(policy.maxBytes) || policy.maxBytes < 1 || policy.maxBytes > 65_536 ||
      !Number.isSafeInteger(policy.forbiddenPermissionBits) || policy.forbiddenPermissionBits < 0 ||
      policy.forbiddenPermissionBits > 0o777 || (policy.forbiddenPermissionBits & 0o022) !== 0o022 ||
      (policy.requireRootGroup !== undefined && typeof policy.requireRootGroup !== "boolean")) {
    throw new ProtectedRuntimeFileError("INVALID");
  }
}

async function assertTrustedParents(path: string, policy: ProtectedRuntimeFilePolicy): Promise<void> {
  let parent = dirname(path);
  while (true) {
    const stat = await lstat(parent);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== 0 ||
        (policy.requireRootGroup && stat.gid !== 0) || (stat.mode & 0o022) !== 0) {
      throw new ProtectedRuntimeFileError("UNSAFE");
    }
    if (parent === "/") return;
    parent = dirname(parent);
  }
}

function assertTrustedFile(stat: Stats, policy: ProtectedRuntimeFilePolicy): void {
  if (!stat.isFile() || stat.uid !== 0 || (policy.requireRootGroup && stat.gid !== 0) ||
      (stat.mode & policy.forbiddenPermissionBits) !== 0 || stat.nlink !== 1 ||
      stat.size < 1 || stat.size > policy.maxBytes) {
    throw new ProtectedRuntimeFileError("UNSAFE");
  }
}

function fileError(error: unknown): ProtectedRuntimeFileError {
  if (error instanceof ProtectedRuntimeFileError) return error;
  const code = error && typeof error === "object" && "code" in error ? error.code : null;
  return new ProtectedRuntimeFileError(code === "ENOENT" ? "MISSING" : "UNSAFE");
}

/** Internal callers supply fixed paths and policies, never request input.
 * O_NOFOLLOW checks the final object actually opened; O_NONBLOCK prevents a
 * substituted FIFO from hanging before fstat can reject it. */
export async function readProtectedRuntimeFile(
  path: string,
  policy: ProtectedRuntimeFilePolicy,
): Promise<Buffer> {
  let file: Awaited<ReturnType<typeof open>> | undefined;
  try {
    validateInputs(path, policy);
    await assertTrustedParents(path, policy);
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = await file.stat();
    assertTrustedFile(before, policy);
    const bytes = Buffer.alloc(policy.maxBytes + 1);
    let total = 0;
    while (total < bytes.length) {
      const remaining = bytes.length - total;
      const { bytesRead } = await file.read(bytes, total, remaining, null);
      if (!Number.isSafeInteger(bytesRead) || bytesRead < 0 || bytesRead > remaining) {
        throw new ProtectedRuntimeFileError("UNSAFE");
      }
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    const after = await file.stat();
    assertTrustedFile(after, policy);
    if (total > policy.maxBytes || total !== before.size || total !== after.size ||
        before.dev !== after.dev || before.ino !== after.ino ||
        before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
      throw new ProtectedRuntimeFileError("UNSAFE");
    }
    return bytes.subarray(0, total);
  } catch (error) {
    throw fileError(error);
  } finally {
    await file?.close().catch(() => undefined);
  }
}

/** Metadata-only inspection; no file contents are read or hashed. */
export async function inspectProtectedRuntimeFile(
  path: string,
  policy: ProtectedRuntimeFilePolicy,
): Promise<void> {
  let file: Awaited<ReturnType<typeof open>> | undefined;
  try {
    validateInputs(path, policy);
    await assertTrustedParents(path, policy);
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    assertTrustedFile(await file.stat(), policy);
  } catch (error) {
    throw fileError(error);
  } finally {
    await file?.close().catch(() => undefined);
  }
}
