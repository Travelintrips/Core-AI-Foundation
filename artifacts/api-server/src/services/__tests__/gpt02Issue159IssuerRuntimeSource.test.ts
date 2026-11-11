import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

describe("GPT02 Issue159 issuer reader DynamicUser runtime directory", () => {
  it("accepts only the exact systemd /run/private mapping and validates its owner/mode", async () => {
    const source = await readFile(
      new URL("../../../../../scripts/dev/gpt02-issuer-reader-runtime.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain('fs.lstatSync(parent)');
    expect(source).toContain('fs.realpathSync(parent)');
    expect(source).toContain('path.join("/run/private", path.basename(parent))');
    expect(source).toContain('fs.lstatSync("/run/private")');
    expect(source).toContain('privateRoot.uid !== 0 || privateRoot.gid !== 0');
    expect(source).toContain('const privateRootMode = privateRoot.mode & 0o777');
    expect(source).toContain('![0o700, 0o755].includes(privateRootMode)');
    expect(source).toContain('(privateRootMode & 0o022) !== 0');
    expect(source).toContain('directory.uid !== process.getuid?.() || directory.gid !== gid');
    expect(source).toContain('(directory.mode & 0o777) !== 0o750');
    expect(source).toContain('ISSUER_READER_SYSTEMD_RUNTIME_MAPPING_INVALID');
    expect(source).toContain("let healthInFlight: Promise<Awaited<ReturnType");
    expect(source).toContain("healthInFlight ??= runSerialized(() => reader.health()).finally");
    expect(source).toContain("let databaseQueue: Promise<unknown> = Promise.resolve()");
    expect(source).toContain("runSerialized(() => reader.read(input))");
  });

  it("keeps signing, authorization and dispatch disabled in the reader runtime", async () => {
    const source = await readFile(
      new URL("../../../../../scripts/dev/gpt02-issuer-reader-runtime.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain('signingPermitted: false');
    expect(source).toContain('authorizationGranted: false');
    expect(source).toContain('dispatchPermitted: false');
    expect(source).toContain('releaseDecision: "NO_GO"');
  });
});
