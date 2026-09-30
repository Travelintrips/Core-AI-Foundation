import { getAdminDbConnectionDescriptors } from "./aiCoreAdminDbRegistryService.js";

export type AiCoreCapabilityKind =
  | "database"
  | "repository"
  | "infrastructure"
  | "orchestrator"
  | "agent"
  | "automation";

export type AiCoreCapabilityState =
  | "available"
  | "configured"
  | "unavailable"
  | "degraded";

export interface AiCoreCapabilityResource {
  id: string;
  kind: AiCoreCapabilityKind;
  provider: string;
  label: string;
  state: AiCoreCapabilityState;
  actions: string[];
  mutatingActions: string[];
  approvalRequiredActions: string[];
  details?: Record<string, unknown>;
}

export interface AiCoreCapabilityRegistrySnapshot {
  authority: "ai-core";
  generatedAt: string;
  resources: AiCoreCapabilityResource[];
}

function hasAnyEnv(env: NodeJS.ProcessEnv, keys: string[]): boolean {
  return keys.some((key) => Boolean((env[key] ?? "").trim()));
}

function configuredState(configured: boolean): AiCoreCapabilityState {
  return configured ? "configured" : "unavailable";
}

function baseResources(env: NodeJS.ProcessEnv): AiCoreCapabilityResource[] {
  const databaseConfigured = hasAnyEnv(env, [
    "SUPABASE_PROD_DATABASE_URL",
    "SUPABASE_DEV_DATABASE_URL",
    "SUPABASE_DATABASE_URL",
    "DATABASE_URL",
  ]);

  const gcpConfigured = Boolean(
    (env["GCP_OLLAMA_VM_PROJECT"] ?? "").trim() &&
    (env["GCP_OLLAMA_VM_ZONE"] ?? "").trim() &&
    (env["GCP_OLLAMA_VM_INSTANCE"] ?? "").trim() &&
    (
      (env["GCP_OLLAMA_COMPUTE_SA_JSON"] ?? "").trim() ||
      (env["GCP_SECRET_MANAGER_BOOTSTRAP_JSON"] ?? "").trim()
    ),
  );
  const hostingerConfigured = Boolean(
    (env["HOSTINGER_API_TOKEN"] ?? "").trim() &&
    (env["HOSTINGER_VPS_ID"] ?? "").trim(),
  );
  const hostingerDockerConfigured = Boolean(
    hostingerConfigured &&
    (env["HOSTINGER_DOCKER_PROJECT"] ?? "").trim(),
  );

  return [
    {
      id: "database.admin",
      kind: "database",
      provider: "postgres",
      label: "Admin database",
      state: configuredState(databaseConfigured),
      actions: ["schema-discovery", "select", "with", "insert", "update", "delete"],
      mutatingActions: ["insert", "update", "delete"],
      approvalRequiredActions: ["ddl", "drop", "truncate", "security-change"],
      details: {
        dynamicSchemaDiscovery: true,
        readOnlyTransactions: true,
        explicitDmlExecutor: true,
        secretsExposed: false,
      },
    },
    ...getAdminDbConnectionDescriptors(env).filter((entry) => entry.id !== "primary").map((entry): AiCoreCapabilityResource => ({
      id: `database.${entry.id}`,
      kind: "database",
      provider: "postgres",
      label: entry.label,
      state: configuredState(entry.configured),
      actions: ["schema-discovery", "select", "with"],
      mutatingActions: [],
      approvalRequiredActions: [],
      details: { databaseId: entry.id, dynamicSchemaDiscovery: true, readOnlyTransactions: true, secretsExposed: false },
    })),
    {
      id: "repository.coding",
      kind: "repository",
      provider: "git",
      label: "Coding workspace repository control",
      state: "available",
      actions: [
        "inspect",
        "diff",
        "build",
        "test",
        "patch",
        "commit",
        "push",
        "workstream-delegation",
      ],
      mutatingActions: ["patch", "commit", "push"],
      approvalRequiredActions: ["merge", "production-deploy"],
      details: {
        controlPlane: "coding-orchestrator",
        readOnlyWorker: true,
      },
    },
    {
      id: "infrastructure.gcp-compute",
      kind: "infrastructure",
      provider: "gcp",
      label: "Google Cloud Compute",
      state: configuredState(gcpConfigured),
      actions: ["status", "start", "stop", "restart"],
      mutatingActions: ["start", "stop", "restart"],
      approvalRequiredActions: [],
      details: {
        projectConfigured: Boolean((env["GCP_OLLAMA_VM_PROJECT"] ?? "").trim()),
        instanceConfigured: Boolean((env["GCP_OLLAMA_VM_INSTANCE"] ?? "").trim()),
        credentialsExposed: false,
      },
    },
    {
      id: "infrastructure.hostinger-vps",
      kind: "infrastructure",
      provider: "hostinger",
      label: "Hostinger VPS",
      state: configuredState(hostingerConfigured),
      actions: ["status", "start", "stop", "restart"],
      mutatingActions: ["start", "stop", "restart"],
      approvalRequiredActions: [],
      details: { credentialsExposed: false },
    },
    {
      id: "infrastructure.hostinger-docker",
      kind: "infrastructure",
      provider: "hostinger",
      label: "Hostinger Docker project",
      state: configuredState(hostingerDockerConfigured),
      actions: ["status", "restart"],
      mutatingActions: ["restart"],
      approvalRequiredActions: [],
      details: { credentialsExposed: false },
    },
  ];
}

async function externalAgentResources(): Promise<AiCoreCapabilityResource[]> {
  try {
    const { getExternalAgentRegistrySnapshot } =
      await import("./externalAgentRegistryService.js");
    const agents = await getExternalAgentRegistrySnapshot();

    return agents.map((agent) => ({
      id: `agent.${agent.clientId}`,
      kind: agent.source === "n8n" ? "automation" : "agent",
      provider: agent.source,
      label: agent.clientId,
      state:
        agent.eligible
          ? "available"
          : agent.presenceState === "ACTIVE"
            ? "degraded"
            : "unavailable",
      actions: [...agent.capabilities],
      mutatingActions: Object.entries(agent.permissions)
        .filter(([, allowed]) => allowed)
        .map(([permission]) => permission),
      approvalRequiredActions: ["productionDeploy"],
      details: {
        role: agent.role,
        reportedHealth: agent.reportedHealth,
        presenceState: agent.presenceState,
        lastSeenAt: agent.lastSeenAt,
        leaseExpiresAt: agent.leaseExpiresAt,
        version: agent.version,
      },
    }));
  } catch {
    return [];
  }
}

async function temporalResource(): Promise<AiCoreCapabilityResource> {
  try {
    const [{ getCodingBridgeAvailability }, autonomous] = await Promise.all([
      import("./localCodingControlBridgeService.js"),
      import("./localCodingAutonomousRepairService.js"),
    ]);
    const availability = await getCodingBridgeAvailability(
      autonomous.TEMPORAL_CODING_ORCHESTRATOR_CLIENT_ID,
    );

    return {
      id: "orchestrator.temporal",
      kind: "orchestrator",
      provider: "temporal",
      label: "Temporal coding orchestrator",
      state: availability.state === "ACTIVE" ? "available" : "unavailable",
      actions: ["task-orchestration", "workflow-recovery", "worker-coordination"],
      mutatingActions: ["task-orchestration"],
      approvalRequiredActions: ["production-deploy", "merge"],
      details: {
        presenceState: availability.state,
        lastSeenAt: availability.lastSeenAt,
        leaseExpiresAt: availability.leaseExpiresAt,
      },
    };
  } catch {
    return {
      id: "orchestrator.temporal",
      kind: "orchestrator",
      provider: "temporal",
      label: "Temporal coding orchestrator",
      state: "unavailable",
      actions: ["task-orchestration", "workflow-recovery", "worker-coordination"],
      mutatingActions: ["task-orchestration"],
      approvalRequiredActions: ["production-deploy", "merge"],
    };
  }
}

export async function getAiCoreCapabilityRegistrySnapshot(
  env: NodeJS.ProcessEnv = process.env,
): Promise<AiCoreCapabilityRegistrySnapshot> {
  const [agents, temporal] = await Promise.all([
    externalAgentResources(),
    temporalResource(),
  ]);

  return {
    authority: "ai-core",
    generatedAt: new Date().toISOString(),
    resources: [...baseResources(env), temporal, ...agents],
  };
}

export function renderAiCoreCapabilityRegistry(
  snapshot: AiCoreCapabilityRegistrySnapshot,
): string {
  const available = snapshot.resources.filter(
    (resource) =>
      resource.state === "available" || resource.state === "configured",
  );
  const unavailable = snapshot.resources.filter(
    (resource) => resource.state === "unavailable",
  );

  const lines = available.map((resource) => {
    const actions = resource.actions.join(", ");
    return `- ${resource.label} [${resource.provider}]: ${resource.state}; ${actions}`;
  });

  return [
    "AI Core capability registry:",
    ...lines,
    "",
    `Aktif/terkonfigurasi: ${available.length}/${snapshot.resources.length}.`,
    unavailable.length > 0
      ? `Belum tersedia: ${unavailable.map((item) => item.label).join(", ")}.`
      : "Semua resource registry tersedia.",
    "Secret dan credential tidak ditampilkan.",
  ].join("\n");
}
