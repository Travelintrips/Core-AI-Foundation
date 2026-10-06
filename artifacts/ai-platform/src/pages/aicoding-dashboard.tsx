import { useCallback, useEffect, useMemo, useState } from "react";
import { useInternalAuth, type InternalRole } from "@/hooks/use-internal-auth";
import {
  Activity,
  AlertTriangle,
  Boxes,
  CheckCircle2,
  CircleDot,
  Clock3,
  Code2,
  Cpu,
  Database,
  GitBranch,
  Github,
  HardDrive,
  LayoutDashboard,
  LoaderCircle,
  MemoryStick,
  MessageCircle,
  RefreshCw,
  Server,
  ShieldAlert,
  Mail,
  UserPlus,
  Users,
  Wifi,
  WifiOff,
  Workflow,
  XCircle,
  Zap,
} from "lucide-react";

type ManagedInternalUser = {
  id: number;
  email: string;
  role: InternalRole;
  accountType: string;
  status: string;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
};

type DashboardOverview = {
  generatedAt: string;
  refreshMs: number;
  kpis: {
    totalServices: number;
    activeServices: number;
    codingRunning: number;
    waiting: number;
    workerActive: number;
    workerTotal: number;
    waOnline: number;
    waTotal: number;
    criticalAlerts: number;
    overallHealth: number;
  };
  infrastructure: {
    services: Array<{
      name: string;
      status: string;
      health: number | null;
      responseTimeMs: number | null;
      detail: string | null;
    }>;
    resources: Array<{
      name: string;
      status: string;
      cpuPct: number | null;
      memoryPct: number | null;
      storagePct: number | null;
      detail: string | null;
    }>;
  };
  coding: {
    tasks: Array<{
      id: string;
      taskNumber: string;
      projectName: string;
      repository: string;
      branch: string;
      instruction: string;
      status: string;
      priority: number;
      progress: number;
      worker: string | null;
      runStatus: string | null;
      updatedAt: string;
    }>;
  };
  workers: Array<{
    id: number;
    name: string;
    type: string;
    status: string;
    healthy: boolean;
    runningJobs: number;
    capacity: number;
    averageLatencyMs: number | null;
    provider: string | null;
    model: string | null;
    lastHeartbeat: string;
    leaseExpiresAt: string | null;
  }>;
  whatsapp: {
    devices: Array<{
      deviceId: string;
      name: string | null;
      phoneNumber: string | null;
      rawStatus: string;
      status: "ONLINE" | "OFFLINE" | "QR_REQUIRED" | "RECONNECT" | "UNKNOWN";
      lastSeen: string | null;
    }>;
    error: string | null;
    summary: {
      online: number;
      offline: number;
      qrRequired: number;
      reconnect: number;
      unknown: number;
    };
  };
  incidents: Array<{
    id: string;
    source: string;
    severity: string;
    status: string;
    title: string;
    summary: string;
    lastSeenAt: string;
  }>;
};

const navItems = [
  { id: "overview", label: "Dashboard", icon: LayoutDashboard },
  { id: "infrastruktur", label: "Layanan & Infrastruktur", icon: Server },
  { id: "coding", label: "Coding Monitor", icon: Code2 },
  { id: "workers", label: "Worker", icon: Boxes },
  { id: "whatsapp", label: "WA Gateway", icon: MessageCircle },
  { id: "incidents", label: "Insiden & Aktivitas", icon: ShieldAlert },
  { id: "users", label: "User Management", icon: Users, adminOnly: true },
];

function statusLabel(status: string): string {
  const value = status.toUpperCase();
  if (value === "READY_REVIEW") return "APPROVAL KRITIS";
  if (value === "TESTING") return "QC OTOMATIS";
  if (value === "WAITING_FOR_WORKER") return "MENUNGGU WORKER";
  if (value === "WAITING_FOR_CAPACITY") return "MENUNGGU KAPASITAS";
  if (value === "QUEUED") return "ANTRIAN";
  return value.replaceAll("_", " ");
}

function statusTone(status: string): string {
  const value = status.toUpperCase();
  if (["ACTIVE", "ONLINE", "COMPLETED", "SELESAI", "RUNNING", "CODING"].includes(value)) {
    return "border-emerald-400/25 bg-emerald-400/10 text-emerald-300";
  }
  if (["DOWN", "OFFLINE", "FAILED", "BLOCKED"].includes(value)) {
    return "border-rose-400/25 bg-rose-400/10 text-rose-300";
  }
  if (["QR_REQUIRED", "RECONNECT", "DEGRADED", "READY_REVIEW", "TESTING"].includes(value)) {
    return "border-amber-400/25 bg-amber-400/10 text-amber-300";
  }
  return "border-sky-400/25 bg-sky-400/10 text-sky-300";
}

function pct(value: number | null): string {
  return value == null ? "—" : `${Math.round(value)}%`;
}

function fmtTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function shortText(value: string, max = 52): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

function ProgressBar({ value, tone = "sky" }: { value: number | null; tone?: "sky" | "emerald" | "amber" | "rose" | "violet" }) {
  const width = value == null ? 0 : Math.max(0, Math.min(100, value));
  const toneClass = {
    sky: "bg-sky-400",
    emerald: "bg-emerald-400",
    amber: "bg-amber-400",
    rose: "bg-rose-400",
    violet: "bg-violet-400",
  }[tone];
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
      <div className={`h-full rounded-full ${toneClass} transition-all duration-500`} style={{ width: `${width}%` }} />
    </div>
  );
}

function KpiCard({
  label,
  value,
  detail,
  icon: Icon,
  tone,
  href,
}: {
  label: string;
  value: string | number;
  detail: string;
  icon: typeof Activity;
  tone: "sky" | "emerald" | "violet" | "amber" | "rose" | "cyan";
  href: string;
}) {
  const styles = {
    sky: "border-sky-500/25 from-sky-500/15 text-sky-300",
    emerald: "border-emerald-500/25 from-emerald-500/15 text-emerald-300",
    violet: "border-violet-500/25 from-violet-500/15 text-violet-300",
    amber: "border-amber-500/25 from-amber-500/15 text-amber-300",
    rose: "border-rose-500/25 from-rose-500/15 text-rose-300",
    cyan: "border-cyan-500/25 from-cyan-500/15 text-cyan-300",
  }[tone];
  return (
    <a
      href={href}
      className={`group block rounded-2xl border bg-gradient-to-br ${styles} to-slate-950/30 p-4 shadow-lg shadow-black/10 transition hover:-translate-y-0.5 hover:border-white/20 hover:shadow-xl hover:shadow-black/20 focus:outline-none focus:ring-2 focus:ring-sky-500/40`}
      aria-label={`Buka halaman ${label}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-400">{label}</p>
          <p className="mt-2 text-3xl font-semibold text-white">{value}</p>
          <p className="mt-1 text-xs text-slate-400">{detail}</p>
          <p className="mt-3 text-[10px] font-medium uppercase tracking-[0.12em] text-slate-600 transition group-hover:text-slate-400">Klik untuk detail →</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-2.5 transition group-hover:scale-105"><Icon className="h-5 w-5" /></div>
      </div>
    </a>
  );
}

function Panel({
  title,
  subtitle,
  icon: Icon,
  children,
  id,
  className = "",
}: {
  title: string;
  subtitle?: string;
  icon: typeof Activity;
  children: React.ReactNode;
  id?: string;
  className?: string;
}) {
  return (
    <section id={id} className={`rounded-2xl border border-slate-800 bg-slate-950/55 shadow-xl shadow-black/10 ${className}`}>
      <div className="flex items-center gap-3 border-b border-slate-800 px-4 py-3">
        <div className="rounded-lg bg-sky-500/10 p-2 text-sky-300"><Icon className="h-4 w-4" /></div>
        <div>
          <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
          {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function MetricRow({ label, value, tone = "sky" }: { label: string; value: number | null; tone?: "sky" | "emerald" | "amber" | "violet" }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-slate-500">{label}</span>
        <span className="font-medium text-slate-300">{pct(value)}</span>
      </div>
      <ProgressBar value={value} tone={tone} />
    </div>
  );
}

export default function AicodingDashboard() {
  const { user } = useInternalAuth();
  const canManageUsers = user?.role === "owner" || user?.role === "admin";
  const [data, setData] = useState<DashboardOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [managedUsers, setManagedUsers] = useState<ManagedInternalUser[]>([]);
  const [userEmail, setUserEmail] = useState("");
  const [userRole, setUserRole] = useState<InternalRole>("internal_staff");
  const [userSaving, setUserSaving] = useState(false);
  const [userActionId, setUserActionId] = useState<number | null>(null);
  const [userMessage, setUserMessage] = useState<string | null>(null);
  const [userError, setUserError] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    if (!canManageUsers) return;
    try {
      const response = await fetch("/api/internal/auth/users", { credentials: "include", cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error ?? `User API HTTP ${response.status}`);
      setManagedUsers(Array.isArray(body?.users) ? body.users : []);
      setUserError(null);
    } catch (err) {
      setUserError(err instanceof Error ? err.message : "Gagal memuat user.");
    }
  }, [canManageUsers]);

  const createUser = useCallback(async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canManageUsers || !userEmail.trim()) return;
    setUserSaving(true);
    setUserMessage(null);
    setUserError(null);
    try {
      const response = await fetch("/api/internal/auth/users", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: userEmail.trim().toLowerCase(), role: userRole }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error ?? `Create user HTTP ${response.status}`);
      setUserEmail("");
      setUserRole("internal_staff");
      setUserMessage(body?.inviteSent
        ? `Akun ${body.user?.email ?? ""} dibuat dan link login dikirim.`
        : `Akun ${body.user?.email ?? ""} dibuat, tetapi email login belum terkirim.`);
      await loadUsers();
    } catch (err) {
      setUserError(err instanceof Error ? err.message : "Gagal membuat user.");
    } finally {
      setUserSaving(false);
    }
  }, [canManageUsers, loadUsers, userEmail, userRole]);

  const updateUser = useCallback(async (
    target: ManagedInternalUser,
    patch: { status?: "active" | "suspended"; role?: InternalRole },
  ) => {
    setUserActionId(target.id);
    setUserMessage(null);
    setUserError(null);
    try {
      const response = await fetch(`/api/internal/auth/users/${target.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error ?? `Update user HTTP ${response.status}`);
      setUserMessage(`Akun ${target.email} berhasil diperbarui.`);
      await loadUsers();
    } catch (err) {
      setUserError(err instanceof Error ? err.message : "Gagal memperbarui user.");
    } finally {
      setUserActionId(null);
    }
  }, [loadUsers]);

  const sendUserMagicLink = useCallback(async (target: ManagedInternalUser) => {
    setUserActionId(target.id);
    setUserMessage(null);
    setUserError(null);
    try {
      const response = await fetch(`/api/internal/auth/users/${target.id}/send-magic-link`, {
        method: "POST",
        credentials: "include",
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error ?? `Magic link HTTP ${response.status}`);
      setUserMessage(`Link login dikirim ke ${target.email}.`);
    } catch (err) {
      setUserError(err instanceof Error ? err.message : "Gagal mengirim link login.");
    } finally {
      setUserActionId(null);
    }
  }, []);

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const response = await fetch("/api/ai/aicoding/overview", { credentials: "include", cache: "no-store" });
      if (!response.ok) throw new Error(`Dashboard API HTTP ${response.status}`);
      const body = await response.json() as DashboardOverview;
      setData(body);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat dashboard");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), data?.refreshMs ?? 5_000);
    return () => window.clearInterval(timer);
  }, [load, data?.refreshMs]);

  useEffect(() => {
    if (canManageUsers) void loadUsers();
  }, [canManageUsers, loadUsers]);

  const codingTasks = useMemo(() => data?.coding.tasks.slice(0, 9) ?? [], [data]);
  const incidents = useMemo(() => data?.incidents.filter((item) => item.status !== "RESOLVED").slice(0, 8) ?? [], [data]);
  const healthy = (data?.kpis.overallHealth ?? 0) >= 80;

  if (loading && !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#06101d] text-slate-300">
        <LoaderCircle className="mr-3 h-5 w-5 animate-spin text-sky-400" />
        Menghubungkan monitor live…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#06101d] text-slate-100">
      <div className="flex min-h-screen">
        <aside className="hidden w-[230px] shrink-0 border-r border-slate-800 bg-[#07111f] xl:flex xl:flex-col">
          <div className="border-b border-slate-800 px-5 py-5">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-gradient-to-br from-blue-500 to-cyan-400 p-2 text-white shadow-lg shadow-blue-500/20">
                <Zap className="h-5 w-5" />
              </div>
              <div>
                <p className="font-semibold text-white">AI Coding</p>
                <p className="text-[11px] text-slate-500">Operations Center</p>
              </div>
            </div>
          </div>
          <nav className="space-y-1 p-3">
            {navItems.filter((item) => !item.adminOnly || canManageUsers).map(({ id, label, icon: Icon }, index) => (
              <button
                key={id}
                type="button"
                onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" })}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition ${index === 0 ? "bg-blue-500/15 text-blue-200" : "text-slate-400 hover:bg-slate-900 hover:text-slate-100"}`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </nav>
          <div className="mt-auto space-y-3 p-4">
            <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-emerald-300">
                <CircleDot className="h-3.5 w-3.5" />
                LIVE MONITORING
              </div>
              <p className="mt-2 text-[11px] leading-5 text-slate-500">
                Refresh otomatis setiap {Math.round((data?.refreshMs ?? 5000) / 1000)} detik.
              </p>
            </div>
            <a href="/coding-workspace" className="block rounded-xl border border-slate-800 px-3 py-2 text-center text-xs text-slate-400 hover:border-slate-700 hover:text-white">
              Buka Coding Workspace
            </a>
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <header id="overview" className="sticky top-0 z-20 border-b border-slate-800/80 bg-[#06101d]/90 px-4 py-4 backdrop-blur-xl lg:px-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h1 className="text-xl font-semibold tracking-tight text-white lg:text-2xl">Dashboard Operasional AI Coding</h1>
                <p className="mt-1 text-xs text-slate-500">Coding, worker, infrastruktur, GitHub, Supabase, Hostinger, dan device WhatsApp dalam satu monitor live.</p>
              </div>
              <div className="flex items-center gap-2">
                <div className={`hidden rounded-xl border px-3 py-2 text-xs sm:flex sm:items-center sm:gap-2 ${healthy ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300" : "border-amber-500/20 bg-amber-500/10 text-amber-300"}`}>
                  {healthy ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                  Health {data?.kpis.overallHealth ?? 0}%
                </div>
                <button
                  type="button"
                  onClick={() => void load(true)}
                  className="rounded-xl border border-slate-800 bg-slate-950/60 p-2.5 text-slate-400 transition hover:border-slate-700 hover:text-white"
                  title="Refresh sekarang"
                >
                  <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
                </button>
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-right">
                  <p className="text-[10px] uppercase tracking-[0.14em] text-slate-600">Live Update</p>
                  <p className="text-xs font-medium text-slate-300">{fmtTime(data?.generatedAt)}</p>
                </div>
              </div>
            </div>
            {error && (
              <div className="mt-3 rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                {error} — data terakhir tetap ditampilkan.
              </div>
            )}
          </header>

          <div className="space-y-4 p-4 lg:p-6">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7">
              <KpiCard label="Total Layanan" value={data?.kpis.totalServices ?? 0} detail={`${data?.kpis.activeServices ?? 0} aktif`} icon={Server} tone="sky" href="/aicoding/services" />
              <KpiCard label="Coding Berjalan" value={data?.kpis.codingRunning ?? 0} detail="task live" icon={Code2} tone="violet" href="/aicoding/coding" />
              <KpiCard label="Menunggu Antrian" value={data?.kpis.waiting ?? 0} detail="pending / capacity" icon={Clock3} tone="amber" href="/aicoding/queue" />
              <KpiCard label="Worker Aktif" value={`${data?.kpis.workerActive ?? 0}/${data?.kpis.workerTotal ?? 0}`} detail="lease sehat" icon={Cpu} tone="cyan" href="/aicoding/workers" />
              <KpiCard label="Device WA Live" value={`${data?.kpis.waOnline ?? 0}/${data?.kpis.waTotal ?? 0}`} detail="device online" icon={MessageCircle} tone="emerald" href="/aicoding/whatsapp" />
              <KpiCard label="Alert Kritis" value={data?.kpis.criticalAlerts ?? 0} detail="belum resolved" icon={ShieldAlert} tone="rose" href="/aicoding/incidents" />
              <KpiCard label="Overall Health" value={`${data?.kpis.overallHealth ?? 0}%`} detail="probe live" icon={Activity} tone="emerald" href="/aicoding/health" />
            </div>

            <div className="grid gap-4 2xl:grid-cols-12">
              <Panel id="infrastruktur" title="Status Layanan Infrastruktur" subtitle="Health real-time dari service dan koneksi utama." icon={Server} className="2xl:col-span-5">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[650px] text-left text-xs">
                    <thead className="bg-slate-900/50 text-[10px] uppercase tracking-[0.12em] text-slate-600">
                      <tr>
                        <th className="px-4 py-2.5">Layanan</th>
                        <th className="px-3 py-2.5">Status</th>
                        <th className="px-3 py-2.5">Health</th>
                        <th className="px-3 py-2.5">Response</th>
                        <th className="px-3 py-2.5">Detail</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data?.infrastructure.services.map((service) => (
                        <tr key={service.name} className="border-t border-slate-900 text-slate-300">
                          <td className="px-4 py-2.5 font-medium text-slate-200">{service.name}</td>
                          <td className="px-3 py-2.5"><span className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${statusTone(service.status)}`}>{service.status}</span></td>
                          <td className="px-3 py-2.5">
                            <div className="w-24 space-y-1">
                              <span className="text-[11px]">{pct(service.health)}</span>
                              <ProgressBar value={service.health} tone={service.health != null && service.health < 70 ? "amber" : "emerald"} />
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-slate-500">{service.responseTimeMs == null ? "—" : `${service.responseTimeMs} ms`}</td>
                          <td className="max-w-[230px] px-3 py-2.5 text-slate-500">{service.detail ? shortText(service.detail, 44) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>

              <Panel id="coding" title="Monitor Operasi Coding" subtitle="Task terbaru dan progress lifecycle aktual." icon={Code2} className="2xl:col-span-5">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-left text-xs">
                    <thead className="bg-slate-900/50 text-[10px] uppercase tracking-[0.12em] text-slate-600">
                      <tr>
                        <th className="px-4 py-2.5">ID</th>
                        <th className="px-3 py-2.5">Project / Permintaan</th>
                        <th className="px-3 py-2.5">Status</th>
                        <th className="px-3 py-2.5">Progress</th>
                        <th className="px-3 py-2.5">Worker</th>
                      </tr>
                    </thead>
                    <tbody>
                      {codingTasks.map((task) => (
                        <tr key={task.id} className="border-t border-slate-900">
                          <td className="px-4 py-2.5 font-mono text-[11px] text-sky-300">{task.taskNumber}</td>
                          <td className="px-3 py-2.5">
                            <p className="font-medium text-slate-300">{task.projectName}</p>
                            <p className="mt-0.5 max-w-[250px] truncate text-[11px] text-slate-600">{shortText(task.instruction)}</p>
                          </td>
                          <td className="px-3 py-2.5"><span className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${statusTone(task.status)}`}>{statusLabel(task.status)}</span></td>
                          <td className="px-3 py-2.5">
                            <div className="w-24 space-y-1">
                              <div className="flex justify-between text-[10px] text-slate-500"><span>{task.progress}%</span><span>stage</span></div>
                              <ProgressBar value={task.progress} tone="sky" />
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-slate-500">{task.worker ?? "—"}</td>
                        </tr>
                      ))}
                      {codingTasks.length === 0 && <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-600">Belum ada task coding.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </Panel>

              <Panel id="incidents" title="Peringatan & Insiden" subtitle="Alert aktif lintas service." icon={AlertTriangle} className="2xl:col-span-2">
                <div className="max-h-[420px] divide-y divide-slate-900 overflow-y-auto">
                  {incidents.map((incident) => (
                    <div key={incident.id} className="flex gap-3 px-4 py-3">
                      <div className={`mt-0.5 rounded-lg p-1.5 ${/critical|kritis|high/i.test(incident.severity) ? "bg-rose-500/10 text-rose-300" : "bg-amber-500/10 text-amber-300"}`}>
                        {/critical|kritis|high/i.test(incident.severity) ? <XCircle className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium text-slate-300">{incident.title}</p>
                        <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-slate-600">{incident.summary}</p>
                        <div className="mt-1.5 flex items-center gap-2 text-[10px] text-slate-700">
                          <span>{incident.source}</span><span>•</span><span>{fmtTime(incident.lastSeenAt)}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                  {incidents.length === 0 && <div className="px-4 py-10 text-center text-xs text-slate-600">Tidak ada insiden aktif.</div>}
                </div>
              </Panel>
            </div>

            <div className="grid gap-4 2xl:grid-cols-12">
              <Panel title="Penggunaan Sumber Daya" subtitle="Nilai kosong berarti provider belum mengekspos metrik persentase melalui koneksi live." icon={Activity} className="2xl:col-span-7">
                <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-5">
                  {data?.infrastructure.resources.map((resource, index) => (
                    <div key={resource.name} className="rounded-xl border border-slate-800 bg-slate-900/35 p-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
                          {index === 0 ? <Cpu className="h-4 w-4 text-sky-400" /> : index === 1 ? <Server className="h-4 w-4 text-violet-400" /> : index === 2 ? <Database className="h-4 w-4 text-emerald-400" /> : index === 3 ? <Github className="h-4 w-4 text-slate-300" /> : <Boxes className="h-4 w-4 text-amber-400" />}
                          {resource.name}
                        </div>
                        <span className={`rounded-full border px-1.5 py-0.5 text-[9px] ${statusTone(resource.status)}`}>{resource.status}</span>
                      </div>
                      <div className="mt-4 space-y-3">
                        <MetricRow label="CPU" value={resource.cpuPct} tone="sky" />
                        <MetricRow label="RAM" value={resource.memoryPct} tone="emerald" />
                        <MetricRow label="Storage" value={resource.storagePct} tone="amber" />
                      </div>
                      <p className="mt-3 line-clamp-2 min-h-8 text-[10px] leading-4 text-slate-600">{resource.detail ?? "Metrik belum tersedia."}</p>
                    </div>
                  ))}
                </div>
              </Panel>

              <Panel id="whatsapp" title="Pemantauan Device WA Live" subtitle="Status session device WhatsApp dibaca dari sumber data gateway secara real-time." icon={MessageCircle} className="2xl:col-span-5">
                <div className="grid grid-cols-2 gap-2 border-b border-slate-900 p-3 sm:grid-cols-4">
                  {[
                    ["Online", data?.whatsapp.summary.online ?? 0, "text-emerald-300"],
                    ["Reconnect", data?.whatsapp.summary.reconnect ?? 0, "text-amber-300"],
                    ["QR Required", data?.whatsapp.summary.qrRequired ?? 0, "text-orange-300"],
                    ["Offline", data?.whatsapp.summary.offline ?? 0, "text-rose-300"],
                  ].map(([label, value, tone]) => (
                    <div key={String(label)} className="rounded-lg border border-slate-800 bg-slate-900/30 px-3 py-2">
                      <p className="text-[10px] uppercase tracking-wide text-slate-600">{label}</p>
                      <p className={`mt-1 text-lg font-semibold ${tone}`}>{value}</p>
                    </div>
                  ))}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[620px] text-left text-xs">
                    <thead className="bg-slate-900/40 text-[10px] uppercase tracking-[0.1em] text-slate-600">
                      <tr><th className="px-4 py-2">Device</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Nomor</th><th className="px-3 py-2">Last Seen</th><th className="px-3 py-2">Signal</th></tr>
                    </thead>
                    <tbody>
                      {data?.whatsapp.devices.map((device) => (
                        <tr key={`${device.deviceId}-${device.phoneNumber ?? ""}`} className="border-t border-slate-900">
                          <td className="px-4 py-2.5 font-medium text-slate-300">{device.name ?? device.deviceId}</td>
                          <td className="px-3 py-2.5"><span className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${statusTone(device.status)}`}>{device.status.replaceAll("_", " ")}</span></td>
                          <td className="px-3 py-2.5 text-slate-500">{device.phoneNumber ?? "—"}</td>
                          <td className="px-3 py-2.5 text-slate-500">{fmtTime(device.lastSeen)}</td>
                          <td className="px-3 py-2.5">
                            {device.status === "ONLINE" ? <Wifi className="h-4 w-4 text-emerald-400" /> : <WifiOff className="h-4 w-4 text-rose-400" />}
                          </td>
                        </tr>
                      ))}
                      {data?.whatsapp.devices.length === 0 && (
                        <tr><td colSpan={5} className="px-4 py-8 text-center text-xs text-slate-600">{data.whatsapp.error ?? "Belum ada device WA yang ditemukan."}</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Panel>
            </div>

            <div className="grid gap-4 2xl:grid-cols-12">
              <Panel id="workers" title="Health Worker & Model" subtitle="Hanya lease dan heartbeat sehat yang dihitung sebagai worker aktif." icon={Boxes} className="2xl:col-span-8">
                <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
                  {data?.workers.slice(0, 8).map((worker) => {
                    const utilization = worker.capacity > 0 ? Math.round((worker.runningJobs / worker.capacity) * 100) : 0;
                    return (
                      <div key={worker.id} className="rounded-xl border border-slate-800 bg-slate-900/35 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-xs font-semibold text-slate-300">{worker.name}</p>
                          <span className={`rounded-full border px-1.5 py-0.5 text-[9px] ${statusTone(worker.healthy ? "ONLINE" : "OFFLINE")}`}>{worker.healthy ? "HEALTHY" : "UNAVAILABLE"}</span>
                        </div>
                        <p className="mt-1 truncate text-[10px] text-slate-600">{worker.provider ?? worker.type}{worker.model ? ` · ${worker.model}` : ""}</p>
                        <div className="mt-4">
                          <div className="flex justify-between text-[10px] text-slate-500"><span>Queue / Capacity</span><span>{worker.runningJobs}/{worker.capacity}</span></div>
                          <div className="mt-1"><ProgressBar value={utilization} tone={utilization >= 90 ? "rose" : utilization >= 70 ? "amber" : "sky"} /></div>
                        </div>
                        <div className="mt-3 flex items-center justify-between text-[10px] text-slate-600">
                          <span>Latency {worker.averageLatencyMs == null ? "—" : `${Math.round(worker.averageLatencyMs)}ms`}</span>
                          <span>{fmtTime(worker.lastHeartbeat)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Panel>

              <Panel title="Ringkasan Operasional" subtitle="Indikator yang langsung memengaruhi eksekusi coding." icon={Workflow} className="2xl:col-span-4">
                <div className="grid grid-cols-2 gap-3 p-4">
                  <div className="rounded-xl border border-slate-800 bg-slate-900/35 p-4">
                    <GitBranch className="h-5 w-5 text-violet-400" />
                    <p className="mt-3 text-2xl font-semibold">{codingTasks.filter((task) => task.status === "PR_CREATED" || task.status === "READY_REVIEW").length}</p>
                    <p className="text-[11px] text-slate-600">PR / approval kritis</p>
                  </div>
                  <div className="rounded-xl border border-slate-800 bg-slate-900/35 p-4">
                    <HardDrive className="h-5 w-5 text-amber-400" />
                    <p className="mt-3 text-2xl font-semibold">{data?.kpis.waiting ?? 0}</p>
                    <p className="text-[11px] text-slate-600">Menunggu kapasitas</p>
                  </div>
                  <div className="rounded-xl border border-slate-800 bg-slate-900/35 p-4">
                    <MemoryStick className="h-5 w-5 text-cyan-400" />
                    <p className="mt-3 text-2xl font-semibold">{data?.kpis.workerActive ?? 0}</p>
                    <p className="text-[11px] text-slate-600">Worker lease sehat</p>
                  </div>
                  <div className="rounded-xl border border-slate-800 bg-slate-900/35 p-4">
                    <MessageCircle className="h-5 w-5 text-emerald-400" />
                    <p className="mt-3 text-2xl font-semibold">{data?.kpis.waOnline ?? 0}</p>
                    <p className="text-[11px] text-slate-600">Device WA online</p>
                  </div>
                </div>
              </Panel>
            </div>

            {canManageUsers && (
              <Panel id="users" title="User Management" subtitle="Owner/admin dapat menambah akun login, mengatur role, menonaktifkan akun, dan mengirim ulang magic link." icon={Users}>
                <div className="grid gap-4 p-4 xl:grid-cols-[360px_minmax(0,1fr)]">
                  <form onSubmit={createUser} className="rounded-xl border border-slate-800 bg-slate-900/35 p-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
                      <UserPlus className="h-4 w-4 text-sky-400" />
                      Tambah akun login
                    </div>
                    <p className="mt-1 text-[11px] leading-5 text-slate-500">
                      Akun baru langsung aktif dan menggunakan login magic-link tanpa password.
                    </p>
                    <label className="mt-4 block text-[11px] font-medium text-slate-400">Email</label>
                    <input
                      type="email"
                      required
                      value={userEmail}
                      onChange={(event) => setUserEmail(event.target.value)}
                      placeholder="nama@perusahaan.com"
                      className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-200 outline-none transition focus:border-sky-500"
                    />
                    <label className="mt-3 block text-[11px] font-medium text-slate-400">Role</label>
                    <select
                      value={userRole}
                      onChange={(event) => setUserRole(event.target.value as InternalRole)}
                      className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-200 outline-none focus:border-sky-500"
                    >
                      <option value="internal_staff">Internal Staff</option>
                      <option value="manager">Manager</option>
                      {user?.role === "owner" && <option value="admin">Admin</option>}
                    </select>
                    <button
                      type="submit"
                      disabled={userSaving}
                      className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-sky-500 px-3 py-2 text-sm font-semibold text-slate-950 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {userSaving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                      {userSaving ? "Membuat akun…" : "Tambah & kirim link login"}
                    </button>
                    {userMessage && <p className="mt-3 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-300">{userMessage}</p>}
                    {userError && <p className="mt-3 rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-300">{userError}</p>}
                  </form>

                  <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/20">
                    <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
                      <div>
                        <p className="text-xs font-semibold text-slate-300">Akun Internal</p>
                        <p className="text-[10px] text-slate-600">{managedUsers.length} akun terdaftar</p>
                      </div>
                      <button type="button" onClick={() => void loadUsers()} className="rounded-lg border border-slate-800 p-2 text-slate-500 hover:text-white" title="Refresh user">
                        <RefreshCw className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[760px] text-left text-xs">
                        <thead className="bg-slate-950/40 text-[10px] uppercase tracking-[0.1em] text-slate-600">
                          <tr>
                            <th className="px-4 py-2.5">Email</th>
                            <th className="px-3 py-2.5">Role</th>
                            <th className="px-3 py-2.5">Status</th>
                            <th className="px-3 py-2.5">Last Login</th>
                            <th className="px-3 py-2.5 text-right">Aksi</th>
                          </tr>
                        </thead>
                        <tbody>
                          {managedUsers.map((target) => {
                            const immutable = target.role === "owner";
                            const busy = userActionId === target.id;
                            return (
                              <tr key={target.id} className="border-t border-slate-900">
                                <td className="px-4 py-3">
                                  <p className="font-medium text-slate-300">{target.email}</p>
                                  <p className="mt-0.5 text-[10px] text-slate-600">ID {target.id}</p>
                                </td>
                                <td className="px-3 py-3">
                                  {immutable ? (
                                    <span className="rounded-full border border-violet-500/20 bg-violet-500/10 px-2 py-1 text-[10px] font-semibold text-violet-300">OWNER</span>
                                  ) : (
                                    <select
                                      value={target.role}
                                      disabled={busy || (target.role === "admin" && user?.role !== "owner")}
                                      onChange={(event) => void updateUser(target, { role: event.target.value as InternalRole })}
                                      className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-300"
                                    >
                                      <option value="internal_staff">Internal Staff</option>
                                      <option value="manager">Manager</option>
                                      {user?.role === "owner" && <option value="admin">Admin</option>}
                                    </select>
                                  )}
                                </td>
                                <td className="px-3 py-3">
                                  <span className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${statusTone(target.status === "active" ? "ACTIVE" : "OFFLINE")}`}>
                                    {target.status.toUpperCase()}
                                  </span>
                                </td>
                                <td className="px-3 py-3 text-slate-500">{target.lastLoginAt ? new Date(target.lastLoginAt).toLocaleString("id-ID") : "Belum pernah"}</td>
                                <td className="px-3 py-3">
                                  <div className="flex justify-end gap-2">
                                    <button
                                      type="button"
                                      disabled={busy || target.status !== "active"}
                                      onClick={() => void sendUserMagicLink(target)}
                                      className="rounded-md border border-slate-700 px-2 py-1 text-[10px] text-slate-400 hover:border-sky-500/50 hover:text-sky-300 disabled:opacity-40"
                                    >
                                      Kirim login
                                    </button>
                                    {!immutable && (
                                      <button
                                        type="button"
                                        disabled={busy || target.id === user?.id}
                                        onClick={() => void updateUser(target, { status: target.status === "active" ? "suspended" : "active" })}
                                        className={`rounded-md border px-2 py-1 text-[10px] disabled:opacity-40 ${target.status === "active" ? "border-rose-500/30 text-rose-300 hover:bg-rose-500/10" : "border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10"}`}
                                      >
                                        {busy ? "Proses…" : target.status === "active" ? "Nonaktifkan" : "Aktifkan"}
                                      </button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                          {managedUsers.length === 0 && (
                            <tr><td colSpan={5} className="px-4 py-8 text-center text-xs text-slate-600">Belum ada data user.</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </Panel>
            )}

            <footer className="flex flex-wrap items-center justify-between gap-2 px-1 pb-2 text-[10px] text-slate-700">
              <span>AI Coding Operations · data live tanpa angka dummy</span>
              <span>Terakhir sinkron: {fmtTime(data?.generatedAt)}</span>
            </footer>
          </div>
        </main>
      </div>
    </div>
  );
}
