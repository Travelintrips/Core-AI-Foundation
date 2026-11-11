import { afterEach, describe, expect, it } from "vitest";
import {
  chmodSync,
  chownSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertIssuerReaderRuntimeDirectory,
} from "../../../../../scripts/dev/gpt02-issuer-reader-runtime.js";

const roots: string[] = [];
const uid = process.getuid?.() ?? 0;
const gid = process.getgid?.() ?? 0;

function tempRoot() {
  const root = mkdtempSync(join(tmpdir(), "gpt02-issuer-runtime-dir-"));
  roots.push(root);
  return root;
}

function makeDirectory(path: string, mode = 0o750) {
  mkdirSync(path);
  chownSync(path, uid, gid);
  chmodSync(path, mode);
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("GPT02 issuer reader DynamicUser runtime directory", () => {
  it("accepts systemd's exact DynamicUser /run/private symlink", () => {
    const root = tempRoot();
    const privatePath = join(root, "private", "gpt02-issuer-reader");
    const publicPath = join(root, "gpt02-issuer-reader");
    mkdirSync(join(root, "private"));
    makeDirectory(privatePath);
    symlinkSync(privatePath, publicPath);

    expect(assertIssuerReaderRuntimeDirectory(publicPath, {
      expectedPublicPath: publicPath,
      expectedPrivatePath: privatePath,
      expectedUid: uid,
      expectedGid: gid,
    })).toBe(privatePath);
  });

  it("rejects a symlink that does not resolve to the pinned private runtime directory", () => {
    const root = tempRoot();
    const expectedPrivate = join(root, "private", "gpt02-issuer-reader");
    const unexpected = join(root, "unexpected");
    const publicPath = join(root, "gpt02-issuer-reader");
    mkdirSync(join(root, "private"));
    makeDirectory(expectedPrivate);
    makeDirectory(unexpected);
    symlinkSync(unexpected, publicPath);

    expect(() => assertIssuerReaderRuntimeDirectory(publicPath, {
      expectedPublicPath: publicPath,
      expectedPrivatePath: expectedPrivate,
      expectedUid: uid,
      expectedGid: gid,
    })).toThrow("ISSUER_READER_SOCKET_DIRECTORY_SYMLINK_INVALID");
  });

  it("accepts a direct systemd RuntimeDirectory when no migration symlink exists", () => {
    const root = tempRoot();
    const publicPath = join(root, "gpt02-issuer-reader");
    const privatePath = join(root, "private", "gpt02-issuer-reader");
    makeDirectory(publicPath);

    expect(assertIssuerReaderRuntimeDirectory(publicPath, {
      expectedPublicPath: publicPath,
      expectedPrivatePath: privatePath,
      expectedUid: uid,
      expectedGid: gid,
    })).toBe(publicPath);
  });

  it("rejects incorrect owner, group, or permissions", () => {
    const root = tempRoot();
    const publicPath = join(root, "gpt02-issuer-reader");
    makeDirectory(publicPath, 0o700);

    expect(() => assertIssuerReaderRuntimeDirectory(publicPath, {
      expectedPublicPath: publicPath,
      expectedPrivatePath: join(root, "private", "gpt02-issuer-reader"),
      expectedUid: uid,
      expectedGid: gid,
    })).toThrow("ISSUER_READER_SOCKET_DIRECTORY_SECURITY_INVALID");

    chmodSync(publicPath, 0o750);
    expect(() => assertIssuerReaderRuntimeDirectory(publicPath, {
      expectedPublicPath: publicPath,
      expectedPrivatePath: join(root, "private", "gpt02-issuer-reader"),
      expectedUid: uid,
      expectedGid: gid + 1,
    })).toThrow("ISSUER_READER_SOCKET_DIRECTORY_SECURITY_INVALID");
  });

  it("keeps Docker socket group access and production frontend build inputs explicit", async () => {
    const { readFile } = await import("node:fs/promises");
    const compose = await readFile(
      new URL("../../../../../deploy/dev-hostinger/docker-compose.yml", import.meta.url),
      "utf8",
    );
    const dockerfile = await readFile(
      new URL("../../../../../deploy/dev-hostinger/Dockerfile", import.meta.url),
      "utf8",
    );
    const unit = await readFile(
      new URL("../../../../../deploy/ai-coding-standalone-dev/gpt02-issue159-issuer-reader.service", import.meta.url),
      "utf8",
    );

    expect(compose).toContain('group_add:\n      - "999"');
    expect(compose).toContain('GPT02_ISSUER_READER_SOCKET_GID: "999"');
    expect(compose).toContain("source: /run/gpt02-issuer-reader");
    expect(compose).toContain("read_only: true");
    expect(compose).toContain("start_period: 45s");

    const buildStep = dockerfile.indexOf("RUN pnpm run build:workspace");
    expect(buildStep).toBeGreaterThan(0);
    expect(dockerfile.indexOf("ENV NODE_ENV=production")).toBeLessThan(buildStep);
    expect(dockerfile.indexOf("ENV PORT=8080")).toBeLessThan(buildStep);
    expect(dockerfile.indexOf("ENV BASE_PATH=/")).toBeLessThan(buildStep);
    expect(dockerfile).toContain("127.0.0.1:8080/api/healthz");
    expect(unit).toContain("DynamicUser=yes");
    expect(unit).toContain("ReadWritePaths=/run/gpt02-issuer-reader /run/private/gpt02-issuer-reader");
  });
});
