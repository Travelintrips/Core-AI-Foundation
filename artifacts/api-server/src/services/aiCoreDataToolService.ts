import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export type AiCoreDataToolName =
  | "SPORT_CENTER_BOOKING_LOOKUP"
  | "TENANT_OUTSTANDING_SUMMARY"
  | "CUSTOMER_LOOKUP";

export type AiCoreDataToolResult =
  | { matched: false }
  | {
      matched: true;
      tool: AiCoreDataToolName;
      reply: string;
      data: Record<string, unknown>;
      warning?: string;
    };

const MUTATION_WORDS =
  /\b(hapus|delete|ubah|update|edit|approve|setujui|batalkan|cancel|buat|create|insert|bayar|mark\s+paid|lunas(?:kan)?|reconcile|cocokkan|settle)\b/i;

const READ_WORDS =
  /\b(cek|periksa|lihat|cari|tampilkan|status|berapa|berapa\s+total|audit|show|check|find)\b/i;

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rupiah(value: unknown): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(toNumber(value));
}

function rowsOf<T extends Record<string, unknown>>(value: unknown): T[] {
  if (!value || typeof value !== "object" || !("rows" in value)) return [];
  const rows = (value as { rows?: unknown }).rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}

function cleanCustomerQuery(value: string): string {
  return value
    .replace(/[?!.,;:]+$/g, "")
    .replace(/\s+(?:di|dari)\s+(?:db|database)(?:\s+.*)?$/i, "")
    .trim()
    .slice(0, 160);
}

export function detectAiCoreDataTool(message: string):
  | { tool: "SPORT_CENTER_BOOKING_LOOKUP"; bookingNumber: string }
  | { tool: "TENANT_OUTSTANDING_SUMMARY" }
  | { tool: "CUSTOMER_LOOKUP"; query: string }
  | null {
  const text = normalize(message);
  if (!text || MUTATION_WORDS.test(text) || !READ_WORDS.test(text)) return null;

  const booking = text.match(/\bSC[-\s]?(\d{2,})\b/i);
  if (booking && /\b(book(?:ing|ingan)|sport\s*center|sc)\b/i.test(text)) {
    return {
      tool: "SPORT_CENTER_BOOKING_LOOKUP",
      bookingNumber: `SC-${booking[1]}`.toUpperCase(),
    };
  }

  const tenantOutstanding =
    /\b(outstanding|tunggakan|piutang|belum\s+bayar|belum\s+lunas)\b/i.test(text) &&
    /\btenant\b/i.test(text);
  if (tenantOutstanding) {
    return { tool: "TENANT_OUTSTANDING_SUMMARY" };
  }

  const customerKeyword = /\b(customer|pelanggan|klien|client)\b/i.test(text);
  if (customerKeyword) {
    const match = text.match(
      /\b(?:customer|pelanggan|klien|client)\b(?:\s+(?:atas\s+nama|bernama|nama))?\s+(.+)$/i,
    );
    const query = cleanCustomerQuery(match?.[1] ?? "");
    if (query.length >= 2) {
      return { tool: "CUSTOMER_LOOKUP", query };
    }
  }

  return null;
}

async function lookupSportCenterBooking(
  bookingNumber: string,
): Promise<AiCoreDataToolResult> {
  const bookingResult = await db.execute(sql`
    SELECT
      b.id,
      b.booking_number,
      b.customer_name,
      f.name AS facility_name,
      b.booking_date,
      b.start_time::text AS start_time,
      b.end_time::text AS end_time,
      b.total_amount AS total_price,
      b.payment_status,
      b.status
    FROM public.sport_bookings b
    LEFT JOIN public.sport_facilities f ON f.id = b.facility_id
    WHERE upper(b.booking_number) = upper(${bookingNumber})
    LIMIT 1
  `);

  const booking = rowsOf<Record<string, unknown>>(bookingResult)[0];
  if (!booking) {
    return {
      matched: true,
      tool: "SPORT_CENTER_BOOKING_LOOKUP",
      reply: `Booking ${bookingNumber} tidak ditemukan di public.sport_bookings.`,
      data: { bookingNumber, found: false },
    };
  }

  const paymentResult = await db.execute(sql`
    SELECT
      payment_number,
      amount,
      method AS payment_method,
      status,
      paid_at
    FROM public.sport_payments
    WHERE booking_id = ${toNumber(booking.id)}
    ORDER BY paid_at DESC NULLS LAST, id DESC
    LIMIT 20
  `);
  const payments = rowsOf<Record<string, unknown>>(paymentResult);

  const totalPaid = payments
    .filter((payment) => String(payment.status ?? "").toLowerCase() !== "cancelled")
    .reduce((sum, payment) => sum + toNumber(payment.amount), 0);

  const reply = [
    `Booking ${String(booking.booking_number)} ditemukan.`,
    `Customer: ${String(booking.customer_name ?? "—")}; fasilitas: ${String(booking.facility_name ?? "—")}; tanggal: ${String(booking.booking_date ?? "—")} ${String(booking.start_time ?? "")}-${String(booking.end_time ?? "")}.`,
    `Status booking: ${String(booking.status ?? "—")}; payment status: ${String(booking.payment_status ?? "—")}; total booking: ${rupiah(booking.total_price)}.`,
    payments.length > 0
      ? `Payment record: ${payments.length}; total tercatat: ${rupiah(totalPaid)}.`
      : "Belum ada payment record di public.sport_payments.",
    "Data dibaca langsung oleh AI Core secara read-only; 0 token LLM.",
  ].join("\n");

  return {
    matched: true,
    tool: "SPORT_CENTER_BOOKING_LOOKUP",
    reply,
    data: {
      found: true,
      booking,
      payments,
      totalPaid,
    },
  };
}

async function lookupCustomer(
  query: string,
): Promise<AiCoreDataToolResult> {
  const pattern = `%${query}%`;
  const result = await db.execute(sql`
    SELECT
      id,
      customer_code,
      name,
      company_name,
      email,
      phone,
      whatsapp,
      pic_name,
      pic_phone,
      tier,
      payment_terms,
      preferred_channel,
      preferred_language,
      total_tasks,
      total_documents,
      ai_summary,
      updated_at
    FROM public.customers
    WHERE
      name ILIKE ${pattern}
      OR company_name ILIKE ${pattern}
      OR customer_code ILIKE ${pattern}
      OR email ILIKE ${pattern}
      OR phone ILIKE ${pattern}
      OR whatsapp ILIKE ${pattern}
      OR pic_name ILIKE ${pattern}
    ORDER BY
      CASE
        WHEN lower(COALESCE(name, '')) = lower(${query}) THEN 0
        WHEN lower(COALESCE(company_name, '')) = lower(${query}) THEN 1
        WHEN lower(COALESCE(customer_code, '')) = lower(${query}) THEN 2
        WHEN lower(COALESCE(name, '')) LIKE lower(${query}) || '%' THEN 3
        WHEN lower(COALESCE(company_name, '')) LIKE lower(${query}) || '%' THEN 4
        ELSE 5
      END,
      updated_at DESC NULLS LAST,
      id DESC
    LIMIT 20
  `);

  const customers = rowsOf<Record<string, unknown>>(result);
  if (customers.length === 0) {
    return {
      matched: true,
      tool: "CUSTOMER_LOOKUP",
      reply:
        `Customer dengan pencarian "${query}" tidak ditemukan di public.customers. Data dibaca langsung secara read-only; 0 token LLM.`,
      data: { query, found: false, customers: [] },
    };
  }

  const lines = customers.slice(0, 10).map((customer, index) => {
    const displayName =
      String(customer.company_name ?? "").trim() ||
      String(customer.name ?? "").trim() ||
      "Customer";
    const code = String(customer.customer_code ?? "").trim();
    const contact =
      String(customer.pic_name ?? "").trim() ||
      String(customer.name ?? "").trim();
    const phone =
      String(customer.whatsapp ?? "").trim() ||
      String(customer.phone ?? "").trim() ||
      String(customer.pic_phone ?? "").trim();
    const suffix = [
      code ? `kode ${code}` : "",
      contact && contact !== displayName ? `PIC ${contact}` : "",
      phone ? `kontak ${phone}` : "",
      customer.tier ? `tier ${String(customer.tier)}` : "",
    ].filter(Boolean).join("; ");

    return `${index + 1}. ${displayName}${suffix ? ` — ${suffix}` : ""}`;
  });

  const reply = [
    `Ditemukan ${customers.length} customer yang cocok dengan "${query}".`,
    ...lines,
    customers.length > 10
      ? `Menampilkan 10 dari ${customers.length} hasil teratas.`
      : "",
    "Data dibaca langsung dari public.customers secara read-only; 0 token LLM.",
  ].filter(Boolean).join("\n");

  return {
    matched: true,
    tool: "CUSTOMER_LOOKUP",
    reply,
    data: {
      query,
      found: true,
      count: customers.length,
      customers,
    },
  };
}

async function tenantOutstandingSummary(): Promise<AiCoreDataToolResult> {
  const result = await db.execute(sql`
    WITH eligible AS (
      SELECT
        ti.tenant_id,
        COALESCE(
          NULLIF(ti.outstanding_amount, 0),
          GREATEST(COALESCE(ti.total_amount, 0) - COALESCE(ti.paid_amount, 0), 0)
        ) AS outstanding
      FROM public.tenant_invoices ti
      WHERE lower(COALESCE(ti.status, '')) NOT IN ('paid', 'cancelled', 'canceled', 'void')
        AND COALESCE(ti.period_start, ti.issued_date, ti.created_at::date) <= CURRENT_DATE
    )
    SELECT
      t.id AS tenant_id,
      t.business_name,
      COUNT(*) FILTER (WHERE e.outstanding > 0)::int AS invoice_count,
      COALESCE(SUM(e.outstanding) FILTER (WHERE e.outstanding > 0), 0) AS outstanding
    FROM eligible e
    JOIN public.tenants t ON t.id = e.tenant_id
    WHERE e.outstanding > 0
    GROUP BY t.id, t.business_name
    ORDER BY outstanding DESC, t.business_name ASC
    LIMIT 50
  `);

  const tenants = rowsOf<Record<string, unknown>>(result);
  const totalOutstanding = tenants.reduce(
    (sum, tenant) => sum + toNumber(tenant.outstanding),
    0,
  );
  const invoiceCount = tenants.reduce(
    (sum, tenant) => sum + toNumber(tenant.invoice_count),
    0,
  );

  const top = tenants.slice(0, 10).map(
    (tenant, index) =>
      `${index + 1}. ${String(tenant.business_name ?? "Tenant")} — ${rupiah(tenant.outstanding)} (${toNumber(tenant.invoice_count)} invoice)`,
  );

  const reply = [
    `Outstanding Tenant saat ini: ${rupiah(totalOutstanding)} dari ${invoiceCount} invoice pada ${tenants.length} tenant.`,
    "Invoice future dan status paid/cancelled/void tidak dihitung.",
    ...(top.length > 0 ? ["Terbesar:", ...top] : ["Tidak ada outstanding tenant yang memenuhi kriteria."]),
    "Data dibaca langsung oleh AI Core secara read-only; 0 token LLM.",
  ].join("\n");

  return {
    matched: true,
    tool: "TENANT_OUTSTANDING_SUMMARY",
    reply,
    data: {
      totalOutstanding,
      invoiceCount,
      tenantCount: tenants.length,
      tenants,
      asOf: new Date().toISOString(),
    },
  };
}


export type AiCoreDataToolReadiness = {
  status: "ok" | "degraded";
  tools: {
    sportCenterBookingLookup: {
      ready: boolean;
      missing: string[];
    };
    tenantOutstandingSummary: {
      ready: boolean;
      missing: string[];
    };
    customerLookup: {
      ready: boolean;
      missing: string[];
    };
  };
};

const DATA_TOOL_SCHEMA_REQUIREMENTS = {
  sportCenterBookingLookup: {
    sport_bookings: [
      "id",
      "booking_number",
      "customer_name",
      "facility_id",
      "booking_date",
      "start_time",
      "end_time",
      "total_amount",
      "payment_status",
      "status",
    ],
    sport_facilities: ["id", "name"],
    sport_payments: [
      "id",
      "booking_id",
      "payment_number",
      "amount",
      "method",
      "status",
      "paid_at",
    ],
  },
  customerLookup: {
    customers: [
      "id",
      "customer_code",
      "name",
      "company_name",
      "email",
      "phone",
      "whatsapp",
      "pic_name",
      "pic_phone",
      "tier",
      "payment_terms",
      "preferred_channel",
      "preferred_language",
      "total_tasks",
      "total_documents",
      "ai_summary",
      "updated_at",
    ],
  },
  tenantOutstandingSummary: {
    tenant_invoices: [
      "tenant_id",
      "outstanding_amount",
      "total_amount",
      "paid_amount",
      "status",
      "period_start",
      "issued_date",
      "created_at",
    ],
    tenants: ["id", "business_name"],
  },
} as const;

function readinessForRequirements(
  available: Map<string, Set<string>>,
  requirements: Record<string, readonly string[]>,
): { ready: boolean; missing: string[] } {
  const missing: string[] = [];
  for (const [table, columns] of Object.entries(requirements)) {
    const present = available.get(table);
    if (!present) {
      missing.push(`public.${table}`);
      continue;
    }
    for (const column of columns) {
      if (!present.has(column)) {
        missing.push(`public.${table}.${column}`);
      }
    }
  }
  return { ready: missing.length === 0, missing };
}

export async function getAiCoreDataToolReadiness(): Promise<AiCoreDataToolReadiness> {
  const tableNames = [
    "sport_bookings",
    "sport_facilities",
    "sport_payments",
    "customers",
    "tenant_invoices",
    "tenants",
  ];

  const result = await db.execute(sql`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN (
        'sport_bookings',
        'sport_facilities',
        'sport_payments',
        'customers',
        'tenant_invoices',
        'tenants'
      )
  `);

  const available = new Map<string, Set<string>>();
  for (const row of rowsOf<Record<string, unknown>>(result)) {
    const table = typeof row.table_name === "string" ? row.table_name : "";
    const column = typeof row.column_name === "string" ? row.column_name : "";
    if (!table || !column || !tableNames.includes(table)) continue;
    const set = available.get(table) ?? new Set<string>();
    set.add(column);
    available.set(table, set);
  }

  const sportCenterBookingLookup = readinessForRequirements(
    available,
    DATA_TOOL_SCHEMA_REQUIREMENTS.sportCenterBookingLookup,
  );
  const tenantOutstandingSummary = readinessForRequirements(
    available,
    DATA_TOOL_SCHEMA_REQUIREMENTS.tenantOutstandingSummary,
  );
  const customerLookup = readinessForRequirements(
    available,
    DATA_TOOL_SCHEMA_REQUIREMENTS.customerLookup,
  );

  return {
    status:
      sportCenterBookingLookup.ready &&
      tenantOutstandingSummary.ready &&
      customerLookup.ready
        ? "ok"
        : "degraded",
    tools: {
      sportCenterBookingLookup,
      tenantOutstandingSummary,
      customerLookup,
    },
  };
}

export async function tryRunAiCoreDataTool(
  message: string,
): Promise<AiCoreDataToolResult> {
  const intent = detectAiCoreDataTool(message);
  if (!intent) return { matched: false };

  try {
    if (intent.tool === "SPORT_CENTER_BOOKING_LOOKUP") {
      return await lookupSportCenterBooking(intent.bookingNumber);
    }
    if (intent.tool === "CUSTOMER_LOOKUP") {
      return await lookupCustomer(intent.query);
    }
    return await tenantOutstandingSummary();
  } catch (error) {
    const warning = error instanceof Error ? error.message : String(error);
    return {
      matched: true,
      tool: intent.tool,
      reply:
        "Data Tool dikenali tetapi query read-only gagal. Tidak ada perubahan data yang dilakukan.",
      data: { failed: true },
      warning: warning.replace(/[\r\n\t]+/g, " ").slice(0, 500),
    };
  }
}
