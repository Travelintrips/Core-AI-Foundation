import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateBackupRecoveryGate as evaluate } from "./dev-gpt02-issue159-backup-recovery-gate.mjs";

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
