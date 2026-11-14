import assert from "node:assert/strict";
import { test } from "node:test";
import {
  evaluateBackupRecoveryGate as evaluate,
  evaluateDellOpenClawChainRecoveryGate as evaluateChain,
} from "./dev-gpt02-issue159-backup-recovery-gate.mjs";

const fullyProven = Object.freeze({
  devOnlyScope: true,
  configuredEncryptedStorageLocationCount: 1,
  storageMarkerVerified: true,
  encryptedTargetVerified: true,
  fullArchiveCreated: true,
  fullArchiveNativeVerifyPassed: true,
  configAndPluginInventoryVerified: true,
  allAgentSqliteInventoryVerified: true,
  credentialCoverageVerified: true,
  independentRestorePassed: true,
  operatorRecoveryKeyCustodyVerified: true,
  customHostPackageRecoveryVerified: true,
  pinnedNodeRecoveryVerified: true,
  gatewayLauncherTaskRecoveryVerified: true,
});
test("actual observed DELL state with no location and only two DPAPI SQLite copies is NO_GO", () => {
  const report = evaluate({
    devOnlyScope: true,
    configuredEncryptedStorageLocationCount: 0,
    // A successful dry-run and two user-bound DB snapshots do not supply
    // evidence for a complete encrypted full recovery point.
    backupDryRunPass: true,
    twoDpapiSqliteSnapshotsPass: true,
    nativeBackupRunsObserved: 0,
  });
  assert.equal(report.evidenceStatus, "NO_GO");
  assert.ok(report.reasons.includes("ENCRYPTED_BACKUP_LOCATION_MISSING"));
  assert.ok(report.reasons.includes("FULL_ARCHIVE_NOT_CREATED"));
  assert.ok(report.reasons.includes("INDEPENDENT_FULL_RESTORE_UNVERIFIED"));
  assert.equal(report.gatewayRestartAuthorized, false);
});
test("dry-run cannot satisfy a native archive or restore", () => {
  const report = evaluate({
    ...fullyProven,
    fullArchiveCreated: false,
    fullArchiveNativeVerifyPassed: false,
    independentRestorePassed: false,
    backupDryRunPass: true,
  });
  assert.equal(report.backupEvidenceComplete, false);
  assert.ok(report.reasons.includes("FULL_ARCHIVE_NOT_CREATED"));
});
test("a backup with missing credential inventory is NO_GO", () => {
  const report = evaluate({...fullyProven, credentialCoverageVerified: false});
  assert.deepEqual(report.reasons, ["CREDENTIAL_COVERAGE_UNVERIFIED"]);
});
test("partial agent SQLite coverage is NO_GO", () => {
  const report = evaluate({...fullyProven, allAgentSqliteInventoryVerified: false});
  assert.ok(report.reasons.includes("ALL_AGENT_SQLITE_INVENTORY_UNVERIFIED"));
});
test("archive verification without independent restore is NO_GO", () => {
  const report = evaluate({...fullyProven, independentRestorePassed: false});
  assert.deepEqual(report.reasons, ["INDEPENDENT_FULL_RESTORE_UNVERIFIED"]);
});
test("no recovery key custody is NO_GO even if every archive check passes", () => {
  const report = evaluate({...fullyProven, operatorRecoveryKeyCustodyVerified: false});
  assert.ok(report.reasons.includes("RESTORE_KEY_CUSTODY_UNVERIFIED"));
});
test("missing storage encryption or marker fails closed", () => {
  const report = evaluate({...fullyProven, storageMarkerVerified: false, encryptedTargetVerified: false});
  assert.ok(report.reasons.includes("BACKUP_STORAGE_MARKER_UNVERIFIED"));
  assert.ok(report.reasons.includes("BACKUP_DESTINATION_ENCRYPTION_UNVERIFIED"));
});
test("incorrect PROD/DEV scope fails closed", () => {
  const report = evaluate({...fullyProven, devOnlyScope: false});
  assert.ok(report.reasons.includes("DEV_SCOPE_UNVERIFIED"));
  assert.equal(report.productionModificationAuthorized, false);
});
test("invalid location count fails closed", () => {
  for (const configuredEncryptedStorageLocationCount of [-1, 0, 0.5, "1", null]) {
    const report = evaluate({...fullyProven, configuredEncryptedStorageLocationCount});
    assert.ok(report.reasons.includes("ENCRYPTED_BACKUP_LOCATION_MISSING"));
  }
});
test("even complete operator backup evidence NEVER authorizes a service start or dispatch", () => {
  const report = evaluate(fullyProven);
  assert.equal(report.backupEvidenceComplete, true);
  assert.equal(report.evidenceStatus, "BACKUP_EVIDENCE_COMPLETE");
  assert.deepEqual(report.reasons, []);
  assert.equal(report.gatewayRestartAuthorized, false);
  assert.equal(report.workerDispatchAuthorized, false);
  assert.equal(report.productionModificationAuthorized, false);
});
test("undefined or unsafe input is NO_GO", () => {
  for (const input of [undefined, null, "", 42, {fullArchiveCreated: true}]) {
    const report=evaluate(input);
    assert.equal(report.evidenceStatus, "NO_GO");
    assert.equal(report.gatewayRestartAuthorized, false);
  }
});

test("full data archive alone cannot stand in for custom host executable recovery", () => {
  const result = evaluate({...fullyProven, customHostPackageRecoveryVerified: false});
  assert.equal(result.evidenceStatus, "NO_GO");
  assert.deepEqual(result.reasons, ["CUSTOM_HOST_PACKAGE_RECOVERY_UNVERIFIED"]);
});
test("pinned Node binary must be reproducible on the recovery computer", () => {
  const result = evaluate({...fullyProven, pinnedNodeRecoveryVerified: false});
  assert.equal(result.evidenceStatus, "NO_GO");
  assert.deepEqual(result.reasons, ["PINNED_NODE_RECOVERY_UNVERIFIED"]);
});
test("existing launcher file without a recoverable Windows Scheduled Task remains NO_GO", () => {
  const result = evaluate({...fullyProven, gatewayLauncherTaskRecoveryVerified: false});
  assert.equal(result.evidenceStatus, "NO_GO");
  assert.deepEqual(result.reasons, ["GATEWAY_LAUNCHER_TASK_RECOVERY_UNVERIFIED"]);
});
test("all source-device executables existing does not prove independent recovery", () => {
  const result = evaluate({
    ...fullyProven,
    customHostPackageRecoveryVerified: false,
    pinnedNodeRecoveryVerified: false,
    gatewayLauncherTaskRecoveryVerified: false,
    sourceDevicePackageExists: true,
    sourceDeviceNodeExists: true,
    sourceDeviceLauncherExists: true,
  });
  assert.equal(result.backupEvidenceComplete, false);
  assert.deepEqual(result.reasons, [
    "CUSTOM_HOST_PACKAGE_RECOVERY_UNVERIFIED",
    "PINNED_NODE_RECOVERY_UNVERIFIED",
    "GATEWAY_LAUNCHER_TASK_RECOVERY_UNVERIFIED",
  ]);
  assert.equal(result.gatewayRestartAuthorized, false);
});


const fullyProvenChain = Object.freeze({
  ...fullyProven,
  workspaceRecoveryVerified: true,
  openclawNodeLauncherRecoveryVerified: true,
  openclawNodeScheduledTaskRecoveryVerified: true,
  wakeExecutorScriptRecoveryVerified: true,
  wakeExecutorDependencyClosureRecoveryVerified: true,
  wakeStagedOpenClawPackageRecoveryVerified: true,
  wakeExecutorNodeRecoveryVerified: true,
  wakeExecutorScheduledTaskRecoveryVerified: true,
  wakeExecutorScopedConfigRecoveryVerified: true,
  crossTaskBindingsRecoveryVerified: true,
});

const chainRecoveryDimensions = [
  ["workspaceRecoveryVerified", "WORKSPACE_RECOVERY_UNVERIFIED"],
  ["openclawNodeLauncherRecoveryVerified", "OPENCLAW_NODE_LAUNCHER_RECOVERY_UNVERIFIED"],
  ["openclawNodeScheduledTaskRecoveryVerified", "OPENCLAW_NODE_SCHEDULED_TASK_RECOVERY_UNVERIFIED"],
  ["wakeExecutorScriptRecoveryVerified", "WAKE_EXECUTOR_SCRIPT_RECOVERY_UNVERIFIED"],
  ["wakeExecutorDependencyClosureRecoveryVerified", "WAKE_EXECUTOR_DEPENDENCY_CLOSURE_RECOVERY_UNVERIFIED"],
  ["wakeStagedOpenClawPackageRecoveryVerified", "WAKE_STAGED_OPENCLAW_PACKAGE_RECOVERY_UNVERIFIED"],
  ["wakeExecutorNodeRecoveryVerified", "WAKE_EXECUTOR_NODE_RECOVERY_UNVERIFIED"],
  ["wakeExecutorScheduledTaskRecoveryVerified", "WAKE_EXECUTOR_SCHEDULED_TASK_RECOVERY_UNVERIFIED"],
  ["wakeExecutorScopedConfigRecoveryVerified", "WAKE_EXECUTOR_SCOPED_CONFIG_RECOVERY_UNVERIFIED"],
  ["crossTaskBindingsRecoveryVerified", "CROSS_TASK_BINDINGS_RECOVERY_UNVERIFIED"],
];

test("Gateway backup PASS baseline remains unchanged by independent DELL chain gate", () => {
  assert.equal(evaluate(fullyProven).backupEvidenceComplete, true);
  const chain = evaluateChain(fullyProven);
  assert.equal(chain.backupEvidenceComplete, true);
  assert.equal(chain.chainRecoveryEvidenceComplete, false);
  assert.equal(chain.evidenceStatus, "NO_GO");
  assert.deepEqual(chain.reasons, chainRecoveryDimensions.map(([, reason]) => reason));
});

test("all synthetic DELL chain recovery evidence is necessary but never authorizes operation", () => {
  const chain = evaluateChain(fullyProvenChain);
  assert.equal(chain.backupEvidenceComplete, true);
  assert.equal(chain.chainRecoveryEvidenceComplete, true);
  assert.equal(chain.evidenceStatus, "DELL_OPENCLAW_CHAIN_EVIDENCE_COMPLETE");
  assert.deepEqual(chain.reasons, []);
  for (const key of [
    "gatewayRestartAuthorized",
    "openclawNodeRestartAuthorized",
    "wakeExecutorRestartAuthorized",
    "workerDispatchAuthorized",
    "productionModificationAuthorized",
  ]) assert.equal(chain[key], false, key);
});

for (const [key, reason] of chainRecoveryDimensions) {
  test(`DELL chain refuses missing independent ${key} proof`, () => {
    const report = evaluateChain({ ...fullyProvenChain, [key]: false });
    assert.equal(report.backupEvidenceComplete, true);
    assert.equal(report.chainRecoveryEvidenceComplete, false);
    assert.deepEqual(report.reasons, [reason]);
    assert.equal(report.gatewayRestartAuthorized, false);
    assert.equal(report.wakeExecutorRestartAuthorized, false);
  });
}

test("host runtime evidence never overrides a missing encrypted full archive", () => {
  const report = evaluateChain({ ...fullyProvenChain, fullArchiveCreated: false });
  assert.equal(report.chainRecoveryEvidenceComplete, false);
  assert.deepEqual(report.reasons, ["FULL_ARCHIVE_NOT_CREATED"]);
});

test("existing source files, running Wake Executor, and task definitions are not an isolated restore", () => {
  const report = evaluateChain({
    ...fullyProven,
    sourceDeviceGatewayExists: true,
    sourceDeviceNodeVbsExists: true,
    sourceDeviceWakeListenerExists: true,
    sourceDeviceWakeExecutorTaskRunning: true,
    sourceDeviceScheduledTasksExist: true,
    sourceDeviceNode24Exists: true,
    sourceDevicePortableNodeExists: true,
    workspaceBackupDryRunIncluded: true,
  });
  assert.equal(report.chainRecoveryEvidenceComplete, false);
  assert.deepEqual(report.reasons, chainRecoveryDimensions.map(([, reason]) => reason));
});

test("unsafe and empty chain evidence inputs fail closed", () => {
  for (const bad of [undefined, null, 0, [], "", {}]) {
    const report = evaluateChain(bad);
    assert.equal(report.evidenceStatus, "NO_GO");
    assert.equal(report.chainRecoveryEvidenceComplete, false);
    assert.equal(report.productionModificationAuthorized, false);
  }
});


test("Wake listener on recovery host without its imported executor module is NO_GO", () => {
  const report = evaluateChain({
    ...fullyProvenChain,
    wakeExecutorDependencyClosureRecoveryVerified: false,
    sourceWakeListenerAndImportedModulePresent: true,
    sourceWakeListenerStartedBefore: true,
  });
  assert.equal(report.evidenceStatus, "NO_GO");
  assert.deepEqual(report.reasons, ["WAKE_EXECUTOR_DEPENDENCY_CLOSURE_RECOVERY_UNVERIFIED"]);
  assert.equal(report.wakeExecutorRestartAuthorized, false);
});


test("restoring Gateway 2026.10.7 does not prove separate Wake staging OpenClaw 2026.11.1", () => {
  const report = evaluateChain({
    ...fullyProvenChain,
    wakeStagedOpenClawPackageRecoveryVerified: false,
    sourceGatewayPackage2026_10_7Present: true,
    sourceWakeStagingPackage2026_11_1Present: true,
    sourceWakeHelperIntegrityMatches: true,
  });
  assert.equal(report.backupEvidenceComplete, true);
  assert.equal(report.chainRecoveryEvidenceComplete, false);
  assert.deepEqual(report.reasons, ["WAKE_STAGED_OPENCLAW_PACKAGE_RECOVERY_UNVERIFIED"]);
  assert.equal(report.gatewayRestartAuthorized, false);
  assert.equal(report.wakeExecutorRestartAuthorized, false);
});
