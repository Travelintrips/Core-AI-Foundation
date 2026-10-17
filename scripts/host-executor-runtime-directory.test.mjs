import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const config = readFileSync(new URL("../deploy/ai-workers/systemd/ai-core-host-executor-runtime-directory.conf", import.meta.url), "utf8");
test("host executor creates private /run socket directory automatically", () => {
  assert.match(config, /^\[Service\]$/m);
  assert.match(config, /^RuntimeDirectory=ai-core-host-executor$/m);
  assert.match(config, /^RuntimeDirectoryMode=0700$/m);
  assert.doesNotMatch(config, /^ExecStart=|^User=|^ProtectSystem=|^ReadWritePaths=/m);
});
