import { z } from "zod";

const Registration = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/).refine((id) => id !== "primary"),
  label: z.string().trim().min(1).max(100),
  databaseUrlEnv: z.string().regex(/^[A-Z_][A-Z0-9_]*$/),
}).strict();

export type AdminDbConnectionDescriptor = {
  id: string;
  label: string;
  configured: boolean;
};

export function getAdminDbRegistrations(env: NodeJS.ProcessEnv) {
  const raw = env["AI_CORE_ADMIN_DATABASES_JSON"]?.trim();
  if (!raw) return [];
  let value: unknown;
  try { value = JSON.parse(raw); } catch {
    throw new Error("Registry database AI Core bukan JSON yang valid.");
  }
  const parsed = z.array(Registration).safeParse(value);
  if (!parsed.success) {
    throw new Error("Registry database harus berisi id, label, dan databaseUrlEnv; credential langsung tidak diterima.");
  }
  if (new Set(parsed.data.map((entry) => entry.id)).size !== parsed.data.length) {
    throw new Error("Registry database memiliki id koneksi duplikat.");
  }
  return parsed.data;
}

export function getAdminDbConnectionDescriptors(
  env: NodeJS.ProcessEnv = process.env,
): AdminDbConnectionDescriptor[] {
  return [
    { id: "primary", label: "AI Core", configured: true },
    ...getAdminDbRegistrations(env).map((entry) => ({
      id: entry.id,
      label: entry.label.replace(/\b[a-z]+:\/\/\S+/gi, "[REDACTED]"),
      configured: Boolean(env[entry.databaseUrlEnv]?.trim()),
    })),
  ];
}
