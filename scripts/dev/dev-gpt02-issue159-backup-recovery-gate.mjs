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
    // OpenClaw's native archive captures application data, not the custom
    // staged host package, pinned Windows Node executable or Scheduled Task
    // launcher outside the state tree. An independent recovery must prove
    // these separately, never by assuming the source DELL remains available.
    ["CUSTOM_HOST_PACKAGE_RECOVERY_UNVERIFIED",
      details.customHostPackageRecoveryVerified === true],
    ["PINNED_NODE_RECOVERY_UNVERIFIED",
      details.pinnedNodeRecoveryVerified === true],
    ["GATEWAY_LAUNCHER_TASK_RECOVERY_UNVERIFIED",
      details.gatewayLauncherTaskRecoveryVerified === true],
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


// Expanded DELL *OpenClaw/AI Core chain* recovery evidence check. The original
// Gateway backup gate above is intentionally left unchanged (existing PASS
// baseline). This is NOT proof of recovering the entire Windows host/OS.
// Source-machine file presence or task status must never satisfy these flags;
// each flag requires independent recovery-target evidence reviewed by an
// authorized operator, without exposing credentials to CI or PR comments.
export function evaluateDellOpenClawChainRecoveryGate(input = {}) {
  const gatewayBackup = evaluateBackupRecoveryGate(input);
  const details = input && typeof input === "object" && !Array.isArray(input)
    ? input : {};
  const conditions = [
    ["WORKSPACE_RECOVERY_UNVERIFIED", details.workspaceRecoveryVerified === true],
    ["OPENCLAW_NODE_LAUNCHER_RECOVERY_UNVERIFIED",
      details.openclawNodeLauncherRecoveryVerified === true],
    ["OPENCLAW_NODE_SCHEDULED_TASK_RECOVERY_UNVERIFIED",
      details.openclawNodeScheduledTaskRecoveryVerified === true],
    ["WAKE_EXECUTOR_SCRIPT_RECOVERY_UNVERIFIED",
      details.wakeExecutorScriptRecoveryVerified === true],
    ["WAKE_EXECUTOR_DEPENDENCY_CLOSURE_RECOVERY_UNVERIFIED",
      details.wakeExecutorDependencyClosureRecoveryVerified === true],
    ["WAKE_STAGED_OPENCLAW_PACKAGE_RECOVERY_UNVERIFIED",
      details.wakeStagedOpenClawPackageRecoveryVerified === true],
    ["WAKE_EXECUTOR_NODE_RECOVERY_UNVERIFIED",
      details.wakeExecutorNodeRecoveryVerified === true],
    ["WAKE_EXECUTOR_SCHEDULED_TASK_RECOVERY_UNVERIFIED",
      details.wakeExecutorScheduledTaskRecoveryVerified === true],
    ["WAKE_EXECUTOR_SCOPED_CONFIG_RECOVERY_UNVERIFIED",
      details.wakeExecutorScopedConfigRecoveryVerified === true],
    ["CROSS_TASK_BINDINGS_RECOVERY_UNVERIFIED",
      details.crossTaskBindingsRecoveryVerified === true],
  ];
  const reasons = [
    ...gatewayBackup.reasons,
    ...conditions.filter(([, verified]) => !verified).map(([reason]) => reason),
  ];
  return Object.freeze({
    evidenceStatus: reasons.length ? "NO_GO" : "DELL_OPENCLAW_CHAIN_EVIDENCE_COMPLETE",
    backupEvidenceComplete: gatewayBackup.backupEvidenceComplete,
    chainRecoveryEvidenceComplete: reasons.length === 0,
    reasons: Object.freeze(reasons),
    // No evidence gate may operate a Windows service or release a GPT02 task.
    gatewayRestartAuthorized: false,
    openclawNodeRestartAuthorized: false,
    wakeExecutorRestartAuthorized: false,
    workerDispatchAuthorized: false,
    productionModificationAuthorized: false,
  });
}
