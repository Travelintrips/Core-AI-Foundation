import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

export type EmployeeKasbonOwnerDecision = {
  decision: "APPROVE";
  taskNumber: string | null;
};

export type EmployeeKasbonOwnerApprovalResult =
  | {
      kind: "approved";
      taskId: number;
      taskNumber: string;
      advanceId: number;
      advanceNumber: string;
      requesterPhone: string;
      ownerPhone: string;
      ownerName: string;
      employeeName: string;
      amount: number;
      neededDate: string;
      alreadyRecorded: boolean;
    }
  | {
      kind: "ambiguous";
      taskNumbers: string[];
    };

type PendingKasbonRow = {
  id: number;
  task_number: string;
  customer_phone: string | null;
  customer_name: string | null;
  admin_notes: string | null;
};

type EmployeeRow = {
  id: number;
  company_id: number;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
};

type AdvanceRow = {
  id: number;
  advance_number: string;
};

type KasbonAdminNotes = {
  kind?: unknown;
  state?: unknown;
  requesterPhone?: unknown;
  ownerPhone?: unknown;
  ownerName?: unknown;
  fields?: {
    employee_name?: unknown;
    amount?: unknown;
    needed_date?: unknown;
    repayment_method?: unknown;
  } | null;
  [key: string]: unknown;
};

function normalizeDigits(value: string): string {
  return value.replace(/\D/g, "");
}

function cleanQuotedName(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const cleaned = value.trim().replace(/^"+|"+$/g, "").trim();
  return cleaned || fallback;
}

function parseNotes(value: string | null): KasbonAdminNotes | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as KasbonAdminNotes)
      : null;
  } catch {
    return null;
  }
}

function validIsoDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function parseEmployeeKasbonOwnerDecision(
  text: string,
): EmployeeKasbonOwnerDecision | null {
  const normalized = text.trim().replace(/\s+/g, " ");
  const match = /^(?:ok|ya|setuju)(?:\s+(KASBON-WA-\d+))?$/i.exec(normalized);
  if (!match) return null;
  return {
    decision: "APPROVE",
    taskNumber: match[1]?.toUpperCase() ?? null,
  };
}

export async function approveEmployeeKasbonOwnerWhatsapp(input: {
  senderPhone: string;
  taskNumber?: string | null;
}): Promise<EmployeeKasbonOwnerApprovalResult | null> {
  const senderPhone = normalizeDigits(input.senderPhone);
  if (!senderPhone) return null;

  return db.transaction(async (tx) => {
    const taskFilter = input.taskNumber
      ? sql`AND task_number = ${input.taskNumber}`
      : sql`AND created_at >= now() - interval '15 minutes'`;

    const pendingResult = await tx.execute(sql`
      SELECT id, task_number, customer_phone, customer_name, admin_notes
      FROM public.ai_tasks
      WHERE source = 'employee_kasbon_conversation'
        AND status = 'ready_for_review'
        AND required_action = 'employee_kasbon_owner_ok'
        AND admin_notes LIKE '%"state":"waiting_owner_ok"%'
        AND admin_notes LIKE ${'%"ownerPhone":"' + senderPhone + '"%'}
        ${taskFilter}
      ORDER BY created_at DESC
      LIMIT 2
      FOR UPDATE
    `);
    const pending = pendingResult.rows as unknown as PendingKasbonRow[];
    if (pending.length === 0) return null;
    if (pending.length > 1 && !input.taskNumber) {
      return {
        kind: "ambiguous",
        taskNumbers: pending.map((row) => row.task_number),
      };
    }

    const task = pending[0]!;
    const notes = parseNotes(task.admin_notes);
    const fields = notes?.fields;
    const amount = Number(fields?.amount);
    const neededDate = fields?.needed_date;
    const requesterPhone = normalizeDigits(
      typeof notes?.requesterPhone === "string"
        ? notes.requesterPhone
        : task.customer_phone ?? "",
    );
    const ownerPhone = normalizeDigits(
      typeof notes?.ownerPhone === "string" ? notes.ownerPhone : "",
    );
    const ownerName = cleanQuotedName(notes?.ownerName, "Owner");
    const employeeName = cleanQuotedName(
      fields?.employee_name,
      task.customer_name ?? "Karyawan",
    );

    if (
      ownerPhone !== senderPhone ||
      !requesterPhone ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      !validIsoDate(neededDate)
    ) {
      throw new Error("KASBON_PENDING_TASK_INVALID");
    }

    const employeeResult = await tx.execute(sql`
      SELECT id, company_id, first_name, last_name, phone
      FROM public.employees
      WHERE regexp_replace(coalesce(phone, ''), '\\D', '', 'g') = ${requesterPhone}
      ORDER BY id
      LIMIT 2
    `);
    const employees = employeeResult.rows as unknown as EmployeeRow[];
    if (employees.length !== 1) {
      throw new Error(
        employees.length === 0
          ? "KASBON_EMPLOYEE_NOT_FOUND"
          : "KASBON_EMPLOYEE_AMBIGUOUS",
      );
    }
    const employee = employees[0]!;

    const existingResult = await tx.execute(sql`
      SELECT id, advance_number
      FROM public.cash_advances
      WHERE reference_number = ${task.task_number}
      ORDER BY id DESC
      LIMIT 1
      FOR UPDATE
    `);
    const existing = (existingResult.rows as unknown as AdvanceRow[])[0] ?? null;
    const advanceNumber = existing?.advance_number ?? `AIK-${task.task_number}`;
    let advanceId = existing?.id ?? null;

    const approvedAt = new Date();
    if (advanceId === null) {
      const insertResult = await tx.execute(sql`
        INSERT INTO public.cash_advances (
          company_id,
          advance_number,
          type,
          party_name,
          amount,
          remaining_amount,
          payment_method,
          date,
          notes,
          status,
          advance_type,
          lifecycle_status,
          counterparty_type,
          purpose,
          approved_by,
          approved_at,
          currency,
          exchange_rate,
          source_system,
          employee_id,
          repayment_method,
          outstanding_amount,
          posting_status,
          reference_number
        )
        VALUES (
          ${employee.company_id},
          ${advanceNumber},
          'kasbon',
          ${employeeName},
          ${amount},
          ${amount},
          'bank',
          ${neededDate}::date,
          ${`AI Task ${task.task_number} | Persetujuan Owner via WhatsApp | Keperluan: Kasbon karyawan`},
          'active',
          'EMPLOYEE',
          'approved',
          'employee',
          'Kasbon karyawan',
          ${ownerName},
          ${approvedAt},
          'IDR',
          1,
          'ai_task_owner_wa',
          ${employee.id},
          'ONE_TIME',
          ${amount},
          'PENDING',
          ${task.task_number}
        )
        RETURNING id, advance_number
      `);
      const inserted = (insertResult.rows as unknown as AdvanceRow[])[0];
      if (!inserted) throw new Error("KASBON_BIZPORTAL_INSERT_FAILED");
      advanceId = inserted.id;
    }

    const nextNotes: KasbonAdminNotes = {
      ...(notes ?? {}),
      state: "recorded_waiting_disbursement",
      ownerPhone,
      ownerName,
      requesterPhone,
      approvedAt: approvedAt.toISOString(),
      approvedByPhone: senderPhone,
      approvedByName: ownerName,
      bizportalAdvanceId: advanceId,
      bizportalAdvanceNumber: advanceNumber,
      lastError: null,
    };

    await tx.execute(sql`
      UPDATE public.ai_tasks
      SET status = 'in_progress',
          required_action = 'waiting_disbursement',
          assigned_to = ${ownerName},
          assigned_role = 'owner',
          admin_notes = ${JSON.stringify(nextNotes)},
          updated_at = now()
      WHERE id = ${task.id}
    `);

    await tx.execute(sql`
      INSERT INTO public.task_comments (
        task_id,
        sender_type,
        sender_name,
        comment,
        created_at
      )
      SELECT
        ${task.id},
        'owner',
        ${ownerName},
        ${`OK — kasbon disetujui via WhatsApp dan tercatat di BizPortal sebagai ${advanceNumber}. Status menunggu pencairan.`},
        now()
      WHERE NOT EXISTS (
        SELECT 1
        FROM public.task_comments
        WHERE task_id = ${task.id}
          AND comment LIKE 'OK — kasbon disetujui via WhatsApp%'
      )
    `);

    return {
      kind: "approved",
      taskId: task.id,
      taskNumber: task.task_number,
      advanceId,
      advanceNumber,
      requesterPhone,
      ownerPhone,
      ownerName,
      employeeName,
      amount,
      neededDate,
      alreadyRecorded: Boolean(existing),
    };
  });
}
