import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Boxes,
  CheckCircle2,
  Clock3,
  Code2,
  Cpu,
  MessageCircle,
  RefreshCw,
  Server,
  ShieldAlert,
  Wifi,
  WifiOff,
} from "lucide-react";

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

type Section = "services" | "coding" | "queue" | "workers" | "whatsapp" | "incidents" | "health";

const SECTION_META: Record<Section, { title: string; subtitle: string; icon: typeof Activity }> = {
  services: {
    title: "Layanan & Infrastruktur",
    subtitle: "Status live seluruh service dan penggunaan resource utama.",
    icon: Server,
  },
  coding: {
    title: "Coding Berjalan",
    subtitle: "Seluruh task coding aktif beserta lifecycle, progress, worker, repository, dan branch.",
    icon: Code2,
  },
  queue: {
    title: "Menunggu Antrian",
    subtitle: "Task yang masih pending, queued, menunggu worker, atau menunggu kapasitas.",
    icon: Clock3,
  },
  workers: {
    title: "Worker Aktif",
    subtitle: "Health, lease, kapasitas, beban, provider, dan model seluruh worker.",
    icon: Boxes,
  },
  whatsapp: {
    title: "Device WhatsApp Live",
    subtitle: "Status session perangkat WhatsApp, nomor, last seen, dan kondisi koneksi.",
    icon: MessageCircle,
  },
  incidents: {
    title: "Alert Kritis & Insiden",
    subtitle: "Daftar incident lintas coding dan infrastruktur yang belum diselesaikan.",
    icon: ShieldAlert,
  },
  health: {
    title: "Overall Health",
    subtitle: "Ringkasan kesehatan service, worker, database, Hostinger, GitHub, dan WhatsApp.",
    icon: Activity,
  },
};

function statusTone(status: string): string {
  const value = status.toUpperCase();
  if (["ACTIVE", "ONLINE", "COMPLETED", "RUNNING", "CODING"].includes(value)) {
    return "border-emerald-400/25 bg-emerald-400/10 text-emerald-300";
  }
  if (["DOWN", "OFFLINE", "FAILED", "BLOCKED", "SUSPENDED"].includes(value)) {
    return "border-rose-400/25 bg-rose-400/10 text-rose-300";
  }
  if (["QR_REQUIRED", "RECONNECT", "DEGRADED", "READY_REVIEW", "TESTING", "WAITING_FOR_CAPACITY"].includes(value)) {
    return "border-amber-400/25 bg-amber-400/10 text-amber-300";
  }
  return "border-sky-400/25 bg-sky-400/10 text-sky-300";
}

function Progress({ value }: { value: number | null }) {
  const numeric = value == null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
      <div className="h-full rounded-full bg-sky-400" style={{ width: `${numeric}%` }} />
    </div>
  );
}

function formatTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("id-ID");
}

function Stat({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  icon: typeof Activity;
}) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/55 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-slate-500">{label}</p>
          <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
        </div>
        <div className="rounded-xl bg-sky-500/10 p-2.5 text-sky-300"><Icon className="h-5 w-5" /></div>
      </div>
    </div>
  );
}

export default function AicodingDetailPage({ section }: { section: Section }) {
  const [data, setData] = useState<DashboardOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const meta = SECTION_META[section];
  const Icon = meta.icon;

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const response = await fetch("/api/ai/aicoding/overview", { credentials: "include", cache: "no-store" });
      if (!response.ok) throw new Error(`Dashboard API HTTP ${response.status}`);
      setData(await response.json() as DashboardOverview);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat data.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), data?.refreshMs ?? 5_000);
    return () => window.clearInterval(timer);
  }, [data?.refreshMs, load]);

  const waitingTasks = useMemo(
    () => data?.coding.tasks.filter((task) =>
      ["PENDING", "QUEUED", "WAITING_FOR_WORKER", "WAITING_FOR_CAPACITY"].includes(task.status),
    ) ?? [],
    [data],
  );
  const runningTasks = useMemo(
    () => data?.coding.tasks.filter((task) =>
      ["ANALYZING", "CODING", "TESTING", "COMMITTING", "PR_CREATED"].includes(task.status),
    ) ?? [],
    [data],
  );
  const openIncidents = useMemo(
    () => data?.incidents.filter((incident) => incident.status !== "RESOLVED") ?? [],
    [data],
  );

  if (loading && !data) {
    return <div className="flex min-h-screen items-center justify-center bg-[#06101d] text-slate-400">Memuat halaman monitor…</div>;
  }

  const taskRows = section === "queue" ? waitingTasks : runningTasks;

  return (
    <div className="min-h-screen bg-[#06101d] text-slate-100">
      <header className="sticky top-0 z-20 border-b border-slate-800/80 bg-[#06101d]/90 px-4 py-4 backdrop-blur-xl lg:px-6">
        <div className="mx-auto flex max-w-[1700px] flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <a
              href="/aicoding"
              className="rounded-xl border border-slate-800 bg-slate-950/60 p-2.5 text-slate-400 transition hover:border-slate-700 hover:text-white"
              title="Kembali ke dashboard"
            >
              <ArrowLeft className="h-4 w-4" />
            </a>
            <div className="rounded-xl bg-sky-500/10 p-2.5 text-sky-300"><Icon className="h-5 w-5" /></div>
            <div>
              <h1 className="text-xl font-semibold text-white">{meta.title}</h1>
              <p className="mt-0.5 text-xs text-slate-500">{meta.subtitle}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void load(true)}
            className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs text-slate-400 hover:text-white"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-[1700px] space-y-4 p-4 lg:p-6">
        {error && (
          <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>
        )}

        {section === "services" && (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Total Layanan" value={data?.kpis.totalServices ?? 0} icon={Server} />
              <Stat label="Aktif" value={data?.kpis.activeServices ?? 0} icon={CheckCircle2} />
              <Stat label="Health" value={`${data?.kpis.overallHealth ?? 0}%`} icon={Activity} />
              <Stat label="Alert Kritis" value={data?.kpis.criticalAlerts ?? 0} icon={AlertTriangle} />
            </div>
            <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/55">
              <table className="w-full min-w-[850px] text-left text-xs">
                <thead className="bg-slate-900/60 text-[10px] uppercase tracking-[0.12em] text-slate-600">
                  <tr><th className="px-4 py-3">Layanan</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Health</th><th className="px-3 py-3">Response</th><th className="px-3 py-3">Detail</th></tr>
                </thead>
                <tbody>
                  {data?.infrastructure.services.map((service) => (
                    <tr key={service.name} className="border-t border-slate-900">
                      <td className="px-4 py-3 font-medium text-slate-200">{service.name}</td>
                      <td className="px-3 py-3"><span className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${statusTone(service.status)}`}>{service.status}</span></td>
                      <td className="px-3 py-3"><div className="w-28 space-y-1"><span className="text-slate-400">{service.health == null ? "—" : `${service.health}%`}</span><Progress value={service.health} /></div></td>
                      <td className="px-3 py-3 text-slate-500">{service.responseTimeMs == null ? "—" : `${service.responseTimeMs} ms`}</td>
                      <td className="px-3 py-3 text-slate-500">{service.detail ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              {data?.infrastructure.resources.map((resource) => (
                <div key={resource.name} className="rounded-2xl border border-slate-800 bg-slate-950/55 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium text-slate-200">{resource.name}</p>
                    <span className={`rounded-full border px-2 py-1 text-[10px] ${statusTone(resource.status)}`}>{resource.status}</span>
                  </div>
                  <div className="mt-4 space-y-3 text-xs">
                    {[["CPU", resource.cpuPct], ["RAM", resource.memoryPct], ["Storage", resource.storagePct]].map(([label, value]) => (
                      <div key={String(label)}>
                        <div className="mb-1 flex justify-between text-slate-500"><span>{label}</span><span>{value == null ? "—" : `${value}%`}</span></div>
                        <Progress value={typeof value === "number" ? value : null} />
                      </div>
                    ))}
                  </div>
                  <p className="mt-4 text-[11px] leading-5 text-slate-600">{resource.detail ?? "Metrik provider belum tersedia."}</p>
                </div>
              ))}
            </div>
          </>
        )}

        {(section === "coding" || section === "queue") && (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label={section === "queue" ? "Total Menunggu" : "Coding Aktif"} value={taskRows.length} icon={section === "queue" ? Clock3 : Code2} />
              <Stat label="Worker Aktif" value={`${data?.kpis.workerActive ?? 0}/${data?.kpis.workerTotal ?? 0}`} icon={Cpu} />
              <Stat label="Alert Kritis" value={data?.kpis.criticalAlerts ?? 0} icon={AlertTriangle} />
              <Stat label="Overall Health" value={`${data?.kpis.overallHealth ?? 0}%`} icon={Activity} />
            </div>
            <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/55">
              <table className="w-full min-w-[1050px] text-left text-xs">
                <thead className="bg-slate-900/60 text-[10px] uppercase tracking-[0.12em] text-slate-600">
                  <tr><th className="px-4 py-3">Task</th><th className="px-3 py-3">Project</th><th className="px-3 py-3">Permintaan</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Progress</th><th className="px-3 py-3">Worker</th><th className="px-3 py-3">Repository / Branch</th><th className="px-3 py-3">Update</th></tr>
                </thead>
                <tbody>
                  {taskRows.map((task) => (
                    <tr key={task.id} className="border-t border-slate-900">
                      <td className="px-4 py-3 font-mono text-sky-300">{task.taskNumber}</td>
                      <td className="px-3 py-3 text-slate-300">{task.projectName}</td>
                      <td className="max-w-[330px] px-3 py-3 text-slate-500">{task.instruction}</td>
                      <td className="px-3 py-3"><span className={`rounded-full border px-2 py-1 text-[10px] ${statusTone(task.status)}`}>{task.status.replaceAll("_", " ")}</span></td>
                      <td className="px-3 py-3"><div className="w-28 space-y-1"><span className="text-slate-500">{task.progress}%</span><Progress value={task.progress} /></div></td>
                      <td className="px-3 py-3 text-slate-500">{task.worker ?? "—"}</td>
                      <td className="px-3 py-3 text-slate-500"><div>{task.repository}</div><div className="mt-1 font-mono text-[10px] text-slate-600">{task.branch}</div></td>
                      <td className="px-3 py-3 text-slate-600">{formatTime(task.updatedAt)}</td>
                    </tr>
                  ))}
                  {taskRows.length === 0 && <tr><td colSpan={8} className="px-4 py-12 text-center text-slate-600">Tidak ada task pada status ini.</td></tr>}
                </tbody>
              </table>
            </div>
          </>
        )}

        {section === "workers" && (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label="Worker Aktif" value={data?.kpis.workerActive ?? 0} icon={CheckCircle2} />
              <Stat label="Total Worker" value={data?.kpis.workerTotal ?? 0} icon={Boxes} />
              <Stat label="Tidak Sehat" value={(data?.kpis.workerTotal ?? 0) - (data?.kpis.workerActive ?? 0)} icon={AlertTriangle} />
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {data?.workers.map((worker) => {
                const usage = worker.capacity > 0 ? Math.round((worker.runningJobs / worker.capacity) * 100) : 0;
                return (
                  <div key={worker.id} className="rounded-2xl border border-slate-800 bg-slate-950/55 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div><p className="font-semibold text-white">{worker.name}</p><p className="mt-1 text-[11px] text-slate-600">{worker.provider ?? worker.type}{worker.model ? ` · ${worker.model}` : ""}</p></div>
                      <span className={`rounded-full border px-2 py-1 text-[10px] ${statusTone(worker.healthy ? "ONLINE" : "OFFLINE")}`}>{worker.healthy ? "HEALTHY" : "UNAVAILABLE"}</span>
                    </div>
                    <div className="mt-5"><div className="mb-1 flex justify-between text-xs text-slate-500"><span>Capacity</span><span>{worker.runningJobs}/{worker.capacity}</span></div><Progress value={usage} /></div>
                    <div className="mt-4 grid grid-cols-2 gap-2 text-[11px] text-slate-500">
                      <div className="rounded-lg bg-slate-900/60 p-2">Latency<br /><span className="text-slate-300">{worker.averageLatencyMs == null ? "—" : `${Math.round(worker.averageLatencyMs)} ms`}</span></div>
                      <div className="rounded-lg bg-slate-900/60 p-2">Heartbeat<br /><span className="text-slate-300">{formatTime(worker.lastHeartbeat)}</span></div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {section === "whatsapp" && (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <Stat label="Online" value={data?.whatsapp.summary.online ?? 0} icon={Wifi} />
              <Stat label="Offline" value={data?.whatsapp.summary.offline ?? 0} icon={WifiOff} />
              <Stat label="Reconnect" value={data?.whatsapp.summary.reconnect ?? 0} icon={RefreshCw} />
              <Stat label="QR Required" value={data?.whatsapp.summary.qrRequired ?? 0} icon={AlertTriangle} />
              <Stat label="Total Device" value={data?.kpis.waTotal ?? 0} icon={MessageCircle} />
            </div>
            <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/55">
              <table className="w-full min-w-[760px] text-left text-xs">
                <thead className="bg-slate-900/60 text-[10px] uppercase tracking-[0.12em] text-slate-600">
                  <tr><th className="px-4 py-3">Device</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Nomor</th><th className="px-3 py-3">Status Raw</th><th className="px-3 py-3">Last Seen</th><th className="px-3 py-3">Signal</th></tr>
                </thead>
                <tbody>
                  {data?.whatsapp.devices.map((device) => (
                    <tr key={`${device.deviceId}-${device.phoneNumber ?? ""}`} className="border-t border-slate-900">
                      <td className="px-4 py-3 font-medium text-slate-300">{device.name ?? device.deviceId}</td>
                      <td className="px-3 py-3"><span className={`rounded-full border px-2 py-1 text-[10px] ${statusTone(device.status)}`}>{device.status.replaceAll("_", " ")}</span></td>
                      <td className="px-3 py-3 text-slate-500">{device.phoneNumber ?? "—"}</td>
                      <td className="px-3 py-3 text-slate-600">{device.rawStatus}</td>
                      <td className="px-3 py-3 text-slate-500">{formatTime(device.lastSeen)}</td>
                      <td className="px-3 py-3">{device.status === "ONLINE" ? <Wifi className="h-4 w-4 text-emerald-400" /> : <WifiOff className="h-4 w-4 text-rose-400" />}</td>
                    </tr>
                  ))}
                  {data?.whatsapp.devices.length === 0 && <tr><td colSpan={6} className="px-4 py-12 text-center text-slate-600">{data.whatsapp.error ?? "Belum ada device."}</td></tr>}
                </tbody>
              </table>
            </div>
          </>
        )}

        {section === "incidents" && (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label="Insiden Aktif" value={openIncidents.length} icon={ShieldAlert} />
              <Stat label="Alert Kritis" value={data?.kpis.criticalAlerts ?? 0} icon={AlertTriangle} />
              <Stat label="Overall Health" value={`${data?.kpis.overallHealth ?? 0}%`} icon={Activity} />
            </div>
            <div className="space-y-3">
              {openIncidents.map((incident) => (
                <div key={incident.id} className="rounded-2xl border border-slate-800 bg-slate-950/55 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div><p className="font-semibold text-slate-200">{incident.title}</p><p className="mt-1 text-sm leading-6 text-slate-500">{incident.summary}</p></div>
                    <div className="flex gap-2">
                      <span className={`rounded-full border px-2 py-1 text-[10px] ${statusTone(incident.status)}`}>{incident.status}</span>
                      <span className={`rounded-full border px-2 py-1 text-[10px] ${/critical|high/i.test(incident.severity) ? "border-rose-500/20 bg-rose-500/10 text-rose-300" : "border-amber-500/20 bg-amber-500/10 text-amber-300"}`}>{incident.severity}</span>
                    </div>
                  </div>
                  <div className="mt-3 flex gap-3 text-[11px] text-slate-600"><span>{incident.source}</span><span>•</span><span>{formatTime(incident.lastSeenAt)}</span></div>
                </div>
              ))}
              {openIncidents.length === 0 && <div className="rounded-2xl border border-slate-800 bg-slate-950/55 px-4 py-12 text-center text-slate-600">Tidak ada insiden aktif.</div>}
            </div>
          </>
        )}

        {section === "health" && (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <Stat label="Overall Health" value={`${data?.kpis.overallHealth ?? 0}%`} icon={Activity} />
              <Stat label="Layanan Aktif" value={`${data?.kpis.activeServices ?? 0}/${data?.kpis.totalServices ?? 0}`} icon={Server} />
              <Stat label="Worker Aktif" value={`${data?.kpis.workerActive ?? 0}/${data?.kpis.workerTotal ?? 0}`} icon={Cpu} />
              <Stat label="WA Online" value={`${data?.kpis.waOnline ?? 0}/${data?.kpis.waTotal ?? 0}`} icon={MessageCircle} />
              <Stat label="Alert Kritis" value={data?.kpis.criticalAlerts ?? 0} icon={AlertTriangle} />
            </div>
            <div className="grid gap-4 xl:grid-cols-2">
              <div className="rounded-2xl border border-slate-800 bg-slate-950/55 p-4">
                <h2 className="font-semibold text-slate-200">Health Layanan</h2>
                <div className="mt-4 space-y-3">
                  {data?.infrastructure.services.map((service) => (
                    <div key={service.name}>
                      <div className="mb-1 flex items-center justify-between text-xs"><span className="text-slate-400">{service.name}</span><span className="text-slate-500">{service.health == null ? "—" : `${service.health}%`}</span></div>
                      <Progress value={service.health} />
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-950/55 p-4">
                <h2 className="font-semibold text-slate-200">Worker & Device</h2>
                <div className="mt-4 space-y-3">
                  {data?.workers.map((worker) => (
                    <div key={worker.id} className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900/30 px-3 py-2">
                      <div><p className="text-sm text-slate-300">{worker.name}</p><p className="text-[10px] text-slate-600">{worker.runningJobs}/{worker.capacity} job</p></div>
                      <span className={`rounded-full border px-2 py-1 text-[10px] ${statusTone(worker.healthy ? "ONLINE" : "OFFLINE")}`}>{worker.healthy ? "HEALTHY" : "UNAVAILABLE"}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}

        <footer className="flex justify-between px-1 pb-2 text-[10px] text-slate-700">
          <span>Auto refresh {Math.round((data?.refreshMs ?? 5000) / 1000)} detik</span>
          <span>Terakhir sinkron: {formatTime(data?.generatedAt)}</span>
        </footer>
      </main>
    </div>
  );
}
