import { GoogleAuth } from "google-auth-library";

export type GcpCostRange = "daily" | "monthly";

type BillingRow = {
  period?: string;
  cost?: number | string;
  usageHours?: number | string;
};

function credentialsFromEnv(env: NodeJS.ProcessEnv) {
  const raw =
    env.GCP_AI_CORE_COMPUTE_SA_JSON ??
    env.GCP_CODING_WORKER_COMPUTE_SA_JSON ??
    env.GCP_OLLAMA_COMPUTE_SA_JSON;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function rangeDates(range: GcpCostRange, now = new Date()) {
  const end = new Date(now);
  const start = new Date(now);
  if (range === "monthly") start.setUTCMonth(start.getUTCMonth() - 11, 1);
  else start.setUTCDate(start.getUTCDate() - 29);
  start.setUTCHours(0, 0, 0, 0);
  return { start: start.toISOString(), end: end.toISOString() };
}

export async function getGcpWorkspaceCostUsage(
  range: GcpCostRange,
  env: NodeJS.ProcessEnv = process.env,
) {
  const projectId = env.GCP_OLLAMA_VM_PROJECT ?? "";
  const billingProject = env.GCP_BILLING_EXPORT_PROJECT ?? projectId;
  const dataset = env.GCP_BILLING_EXPORT_DATASET ?? "";
  const table = env.GCP_BILLING_EXPORT_TABLE ?? "";
  const credentials = credentialsFromEnv(env);
  const { start, end } = rangeDates(range);

  if (!projectId || !billingProject || !dataset || !table || !credentials) {
    return {
      configured: false,
      range,
      currency: "IDR",
      projectId,
      start,
      end,
      totalCost: 0,
      totalUsageHours: 0,
      series: [] as BillingRow[],
      message: "Set GCP_BILLING_EXPORT_PROJECT, GCP_BILLING_EXPORT_DATASET, and GCP_BILLING_EXPORT_TABLE to enable actual GCP billing data.",
    };
  }

  const auth = new GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/bigquery.readonly"],
  });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  const accessToken = typeof token === "string" ? token : token.token;
  if (!accessToken) throw new Error("Unable to obtain GCP billing access token");

  const bucket = range === "monthly"
    ? "FORMAT_DATE('%Y-%m', DATE(usage_start_time))"
    : "FORMAT_DATE('%Y-%m-%d', DATE(usage_start_time))";
  const query = `
    SELECT
      ${bucket} AS period,
      SUM(CAST(cost AS FLOAT64)) AS cost,
      SUM(
        CASE
          WHEN LOWER(COALESCE(usage.unit, '')) IN ('hour', 'hours', 'h')
          THEN CAST(usage.amount AS FLOAT64)
          WHEN LOWER(COALESCE(usage.unit, '')) IN ('second', 'seconds', 's')
          THEN CAST(usage.amount AS FLOAT64) / 3600
          ELSE 0
        END
      ) AS usageHours
    FROM \`${billingProject}.${dataset}.${table}\`
    WHERE project.id = @projectId
      AND usage_start_time >= TIMESTAMP(@start)
      AND usage_start_time <= TIMESTAMP(@end)
    GROUP BY period
    ORDER BY period
  `;

  const response = await fetch(
    `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(billingProject)}/queries`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        useLegacySql: false,
        parameterMode: "NAMED",
        queryParameters: [
          { name: "projectId", parameterType: { type: "STRING" }, parameterValue: { value: projectId } },
          { name: "start", parameterType: { type: "STRING" }, parameterValue: { value: start } },
          { name: "end", parameterType: { type: "STRING" }, parameterValue: { value: end } },
        ],
      }),
    },
  );
  if (!response.ok) throw new Error(`BigQuery billing query failed with HTTP ${response.status}`);
  const payload = await response.json() as {
    schema?: { fields?: Array<{ name?: string }> };
    rows?: Array<{ f?: Array<{ v?: string | null }> }>;
  };
  const names = payload.schema?.fields?.map((field) => field.name ?? "") ?? [];
  const rows = (payload.rows ?? []).map((row) => {
    const record = Object.fromEntries(names.map((name, index) => [name, row.f?.[index]?.v ?? null]));
    return {
      period: String(record.period ?? ""),
      cost: Number(record.cost ?? 0),
      usageHours: Number(record.usageHours ?? 0),
    };
  });

  return {
    configured: true,
    range,
    currency: env.GCP_BILLING_CURRENCY ?? "USD",
    projectId,
    start,
    end,
    totalCost: rows.reduce((sum, row) => sum + Number(row.cost || 0), 0),
    totalUsageHours: rows.reduce((sum, row) => sum + Number(row.usageHours || 0), 0),
    series: rows,
  };
}
