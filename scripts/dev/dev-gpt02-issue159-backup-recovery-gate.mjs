// Issue159 DEV only. Evaluate redacted operator-owned BACKUP EVIDENCE, not
// actual secret files or an active OpenClaw state. The result NEVER authorizes
// launching/restarting a Gateway, dispatching a worker, or writing to PROD.
// Operator must supply only boolean evidence, never credentials or paths.
export function evaluateBackupRecoveryGate(input = {}) {
  const details = input && typeof input === "object" ? input : {};
  const reasons = [];
  const conditions = [
    ["DEV_SCOPE_UNVERIFIED", details.devOnlyScope === true],
    ["ENCRYPTED_BACKUP_LOCATION_MISSING",
      Number.isSafeInteger(details.configuredEncryptedStorageLocationCount) &&
      details.configuredEncryptedStorageLocationCount >= 1],
    ["BACKUP_STORAGE_MARKER_UNVERIFIED", details.storageMarkerVerified === true],
    ["BACKUP_DESTINATION_ENCRYPTION_UNVERIFIED", details.encryptedTargetVerified === true],
    ["FULL_ARCHIVE_NOT_CREATED", details.fullArchiveCreated === true],
    ["FULL_ARCHIVE_NATIVE_VERIFY_NOT_PASS", details.fullArchiveNativeVerifyPassed === true],
    ["CONFIG_AND_PLUGIN_INVENTORY_UNVERIFIED", details.configAndPluginInventoryVerified === true],
    ["ALL_AGENT_SQLITE_INVENTORY_UNVERIFIED", details.allAgentSqliteInventoryVerified === true],
    ["CREDENTIAL_COVERAGE_UNVERIFIED", details.credentialCoverageVerified === true],
    ["INDEPENDENT_FULL_RESTORE_UNVERIFIED", details.independentRestorePassed === true],
    ["RESTORE_KEY_CUSTODY_UNVERIFIED", details.operatorRecoveryKeyCustodyVerified === true],
  ];
  for (const [reason, ok] of conditions) if (!ok) reasons.push(reason);
  return Object.freeze({
    evidenceStatus: reasons.length ? "NO_GO" : "BACKUP_EVIDENCE_COMPLETE",
    backupEvidenceComplete: reasons.length === 0,
    reasons: Object.freeze(reasons),
    // Not a "restart gate": even all backups passing cannot decide
    // maintenance approval, one-instance ownership, live provider identity,
    // business-side effects, signer/attestation or Final ACK.
    gatewayRestartAuthorized: false,
    workerDispatchAuthorized: false,
    productionModificationAuthorized: false,
  });
}
