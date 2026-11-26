import { constants, type Stats } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fs = vi.hoisted(() => ({
  lstat: vi.fn(), open: vi.fn(), readFile: vi.fn(), lstatSync: vi.fn(), readFileSync: vi.fn(),
}));
vi.mock("node:fs/promises", () => fs);
vi.mock("node:fs", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:fs")>(), lstatSync: fs.lstatSync, readFileSync: fs.readFileSync,
}));

import {
  inspectProtectedRuntimeFile,
  ProtectedRuntimeFileError,
  readProtectedRuntimeFile,
} from "../gpt02ProtectedRuntimeFile.js";

const PATH = "/run/credentials/test-reader/reader.json";
const POLICY = { maxBytes: 64, forbiddenPermissionBits: 0o077, requireRootGroup: true };

function regular(size: number, overrides: Partial<Stats> = {}): Stats {
  return {
    uid: 0, gid: 0, mode: 0o100600, nlink: 1, size,
    dev: 1, ino: 10, mtimeMs: 100, ctimeMs: 100,
    isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false,
    ...overrides,
  } as Stats;
}

function directory(overrides: Partial<Stats> = {}): Stats {
  return {
    uid: 0, gid: 0, mode: 0o40755,
    isDirectory: () => true, isSymbolicLink: () => false,
    ...overrides,
  } as Stats;
}

function fixture(options: {
  content?: Buffer;
  before?: Partial<Stats>;
  after?: Partial<Stats>;
  parents?: Record<string, Partial<Stats>>;
  chunkSize?: number;
} = {}) {
  const content = options.content ?? Buffer.from("synthetic-test-content");
  const before = regular(content.length, options.before);
  const after = { ...before, ...options.after } as Stats;
  let position = 0;
  const handle = {
    stat: vi.fn().mockResolvedValueOnce(before).mockResolvedValue(after),
    read: vi.fn(async (target: Buffer, offset: number, length: number, _position: number | null) => {
      const bytesRead = Math.min(length, options.chunkSize ?? length, content.length - position);
      content.copy(target, offset, position, position + bytesRead);
      position += bytesRead;
      return { bytesRead, buffer: target };
    }),
    close: vi.fn().mockResolvedValue(undefined),
  };
  fs.lstat.mockImplementation(async (path: string) => directory(options.parents?.[path]));
  fs.open.mockResolvedValue(handle);
  return { handle, content, bytesRead: () => position };
}

async function expectFileError(promise: Promise<unknown>, code: "MISSING" | "UNSAFE" | "INVALID") {
  const error = await promise.then(() => undefined, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(ProtectedRuntimeFileError);
  expect(error).toMatchObject({ message: code, code });
  expect(error).not.toHaveProperty("path");
  expect(error).not.toHaveProperty("cause");
}

describe("protected GPT02 runtime files", () => {
  beforeEach(() => vi.resetAllMocks());

  it("reads only the validated descriptor, handles partial reads, and closes it", async () => {
    const { handle, content } = fixture({ chunkSize: 3 });
    await expect(readProtectedRuntimeFile(PATH, POLICY)).resolves.toEqual(content);
    expect(fs.open).toHaveBeenCalledExactlyOnceWith(
      PATH, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    expect(handle.read.mock.calls.length).toBeGreaterThan(2);
    expect(fs.readFile).not.toHaveBeenCalled();
    expect(fs.readFileSync).not.toHaveBeenCalled();
    expect(handle.close).toHaveBeenCalledOnce();
  });

  it("refuses a final symlink swapped in before open, without following or reading it", async () => {
    const { handle } = fixture();
    fs.open.mockImplementation(async (_path: string, flags: number) => {
      expect(flags & constants.O_NOFOLLOW).toBe(constants.O_NOFOLLOW);
      throw Object.assign(new Error("SYNTHETIC_PRIVATE_PATH: swapped symlink"), { code: "ELOOP" });
    });
    await expectFileError(readProtectedRuntimeFile(PATH, POLICY), "UNSAFE");
    expect(fs.readFile).not.toHaveBeenCalled();
    expect(handle.read).not.toHaveBeenCalled();
    expect(handle.close).not.toHaveBeenCalled();
  });

  it.each([
    ["symlink ancestor", "/run/credentials", { isSymbolicLink: () => true }],
    ["non-directory ancestor", "/run/credentials", { isDirectory: () => false }],
    ["untrusted ancestor owner", "/run", { uid: 1000 }],
    ["untrusted ancestor group", "/run/credentials/test-reader", { gid: 999 }],
    ["group-writable ancestor", "/run/credentials", { mode: 0o40775 }],
    ["world-writable filesystem root", "/", { mode: 0o40757 }],
  ] as const)("rejects %s before opening a file", async (_name, path, stat) => {
    fixture({ parents: { [path]: stat } });
    await expectFileError(readProtectedRuntimeFile(PATH, POLICY), "UNSAFE");
    expect(fs.open).not.toHaveBeenCalled();
  });

  it.each([
    ["non-regular descriptor", { isFile: () => false }],
    ["non-root owner", { uid: 1000 }],
    ["non-root group", { gid: 999 }],
    ["group-readable credential", { mode: 0o100640 }],
    ["world-readable credential", { mode: 0o100604 }],
    ["hard-linked credential", { nlink: 2 }],
    ["empty credential", { size: 0 }],
    ["oversized credential", { size: POLICY.maxBytes + 1 }],
  ] as const)("rejects %s before reading and closes the descriptor", async (_name, before) => {
    const { handle } = fixture({ before });
    await expectFileError(readProtectedRuntimeFile(PATH, POLICY), "UNSAFE");
    expect(handle.read).not.toHaveBeenCalled();
    expect(handle.close).toHaveBeenCalledOnce();
  });

  it("caps reads at limit plus one when the file grows after its first stat", async () => {
    const { handle, bytesRead } = fixture({
      content: Buffer.alloc(16_384, 0x61), before: { size: 1 }, chunkSize: 7,
    });
    await expectFileError(readProtectedRuntimeFile(PATH, POLICY), "UNSAFE");
    expect(bytesRead()).toBe(POLICY.maxBytes + 1);
    for (const [target, offset, length] of handle.read.mock.calls) {
      expect(target.length).toBeLessThanOrEqual(POLICY.maxBytes + 1);
      expect(offset + length).toBeLessThanOrEqual(POLICY.maxBytes + 1);
    }
    expect(handle.close).toHaveBeenCalledOnce();
  });

  it.each([
    ["device", { dev: 2 }], ["inode", { ino: 11 }],
    ["modification time", { mtimeMs: 101 }], ["change time", { ctimeMs: 101 }],
    ["size", { size: 1 }], ["links", { nlink: 2 }],
  ] as const)("rejects a changed %s after reading", async (_name, after) => {
    const { handle } = fixture({ after });
    await expectFileError(readProtectedRuntimeFile(PATH, POLICY), "UNSAFE");
    expect(handle.read).toHaveBeenCalled();
    expect(handle.close).toHaveBeenCalledOnce();
  });

  it("rejects early EOF even when both stats still advertise the old size", async () => {
    const { handle } = fixture({ content: Buffer.from("x"), before: { size: 10 } });
    await expectFileError(readProtectedRuntimeFile(PATH, POLICY), "UNSAFE");
    expect(handle.close).toHaveBeenCalledOnce();
  });

  it.each(["stat", "read"] as const)("sanitizes %s errors and closes the opened descriptor", async (operation) => {
    const { handle } = fixture();
    handle[operation].mockRejectedValueOnce(new Error("SYNTHETIC_PRIVATE_PATH_AND_CONTENT"));
    await expectFileError(readProtectedRuntimeFile(PATH, POLICY), "UNSAFE");
    expect(handle.close).toHaveBeenCalledOnce();
  });

  it("preserves the bounded rejection when close also fails", async () => {
    const { handle } = fixture({ before: { nlink: 2 } });
    handle.close.mockRejectedValue(new Error("SYNTHETIC_PRIVATE_CLOSE_DIAGNOSTIC"));
    await expectFileError(readProtectedRuntimeFile(PATH, POLICY), "UNSAFE");
    expect(handle.close).toHaveBeenCalledOnce();
  });

  it("normalizes missing files without leaking an OS pathname", async () => {
    fixture();
    fs.open.mockRejectedValue(Object.assign(new Error("ENOENT SYNTHETIC_PRIVATE_PATH"), { code: "ENOENT" }));
    await expectFileError(readProtectedRuntimeFile(PATH, POLICY), "MISSING");
  });

  it.each(["relative/reader.json", "/run/../reader.json", "/run//reader.json", "/run/reader\0.json"])(
    "refuses noncanonical input %j before filesystem access", async (path) => {
      await expectFileError(readProtectedRuntimeFile(path, POLICY), "INVALID");
      expect(fs.lstat).not.toHaveBeenCalled();
      expect(fs.open).not.toHaveBeenCalled();
    },
  );

  it("retains the custody broker's existing uid-only group policy when not opted into root group", async () => {
    const { content } = fixture({ before: { gid: 999 }, parents: { "/run/credentials": { gid: 999 } } });
    await expect(readProtectedRuntimeFile(PATH, {
      maxBytes: POLICY.maxBytes, forbiddenPermissionBits: 0o077,
    })).resolves.toEqual(content);
  });

  it("inspects a reader mount without reading any content", async () => {
    const { handle } = fixture();
    await expect(inspectProtectedRuntimeFile(PATH, POLICY)).resolves.toBeUndefined();
    expect(handle.read).not.toHaveBeenCalled();
    expect(fs.readFile).not.toHaveBeenCalled();
    expect(handle.close).toHaveBeenCalledOnce();
  });

  it("also closes an unsafe descriptor during metadata-only inspection", async () => {
    const { handle } = fixture({ before: { uid: 1000 } });
    await expectFileError(inspectProtectedRuntimeFile(PATH, POLICY), "UNSAFE");
    expect(handle.read).not.toHaveBeenCalled();
    expect(handle.close).toHaveBeenCalledOnce();
  });
});
