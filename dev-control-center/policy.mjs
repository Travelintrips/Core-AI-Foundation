export function validateSeparation(dev, prod) {
  const fields = ["databaseId", "credentialId", "namespace", "storageBucket"];
  const issues = [];
  for (const field of fields) {
    if (!dev?.[field] || !prod?.[field]) issues.push("missing_" + field);
    else if (dev[field] === prod[field]) issues.push("shared_" + field);
  }
  if (dev?.environment !== "dev") issues.push("invalid_dev_environment");
  if (prod?.environment !== "prod") issues.push("invalid_prod_environment");
  return { safe: issues.length === 0, issues };
}

export function canApproveRelease({ isolation, verifiedAt, gates, commitSha, environment, confirmation }) {
  const validSha = typeof commitSha === "string" && /^[0-9a-f]{40}$/.test(commitSha);
  return Boolean(isolation?.safe && verifiedAt && validSha && environment === "production" &&
    confirmation === "APPROVE_PRODUCTION" && gates?.allRequiredPassed === true &&
    gates?.securityPassed === true && gates?.productionTargetVerified === true);
}
