import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, CheckCircle2, Clock3, RefreshCw, UsersRound } from "lucide-react";

type Job = {
  id: string;
  title: string;
  source: string;
  status: string;
  stage?: string | null;
  verifiedProgress?: number | null;
  worker?: string | null;
  workerType?: string | null;
  accountable?: string | null;
  blocker?: string | null;
  evidence?: string | null;
  updatedAt?: string | null;
};
type MonitorResponse = { jobs: Job[]; warnings?: string[] };
type JobFilter = "active" | "attention" | "verifying" | "failed" | "history" | "all" | "completed";
const terminal = new Set(["COMPLETED", "CANCELLED", "FAILED"]);
// An old job status is not proof of ongoing work. Seven days is a display-only
// cutoff; archive classification never updates a command, ACK, or DB status.
const HISTORY_CUTOFF_MS = 7 * 24 * 60 * 60 * 1000;
const isStale = (job: Job, now = Date.now()) => !job.updatedAt || !Number.isFinite(Date.parse(job.updatedAt)) || now - Date.parse(job.updatedAt) > HISTORY_CUTOFF_MS;
const isHistorical = (job: Job, now = Date.now()) => isStale(job, now) && !["COMPLETED", "CANCELLED"].includes(job.status);
const isCurrentAttention = (job: Job, now = Date.now()) => attention.has(job.status) && !isStale(job, now);
const running = new Set(["RUNNING", "PROCESSING", "DISPATCHING", "RETRYING"]);
const waiting = new Set(["QUEUED", "WAITING", "PENDING", "RECEIVED"]);
const attention = new Set(["BLOCKED", "REVIEW_REQUIRED"]);
const verifying = new Set(["VERIFYING"]);
const formatWib = (value?: string | null) => {
  if (!value || Number.isNaN(Date.parse(value))) return "Belum tersedia";
  return new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
};

export default function UnifiedJobMonitor() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [filter, setFilter] = useState<JobFilter>("active");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updated, setUpdated] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (document.hidden) return;
      try {
        const response = await fetch("/api/dev-center/jobs", { credentials: "include", cache: "no-store" });
        if (!response.ok) throw new Error(response.status === 401 || response.status === 403
          ? "Session AI Core tidak berwenang. Periksa login Dashboard utama."
          : `Monitoring tidak tersedia (HTTP ${response.status}).`);
        const payload: MonitorResponse = await response.json();
        if (!Array.isArray(payload.jobs)) throw new Error("Format data monitoring tidak valid.");
        if (active) {
          setJobs(payload.jobs);
          setWarnings(payload.warnings ?? []);
          setError(null);
          setUpdated(new Date().toISOString());
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Monitoring gagal dimuat.");
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    const interval = window.setInterval(() => void load(), 15_000);
    const onVisibility = () => { if (!document.hidden) void load(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => { active = false; window.clearInterval(interval); document.removeEventListener("visibilitychange", onVisibility); };
  }, []);

  const summary = useMemo(() => {
    const now = Date.now();
    return {
      active: jobs.filter(job => running.has(job.status) && !isStale(job, now)).length,
      waiting: jobs.filter(job => waiting.has(job.status) && !isStale(job, now)).length,
      attention: jobs.filter(job => isCurrentAttention(job, now)).length,
      failed: jobs.filter(job => job.status === "FAILED").length,
      verifying: jobs.filter(job => verifying.has(job.status) && !isStale(job, now)).length,
      completed: jobs.filter(job => job.status === "COMPLETED").length,
      history: jobs.filter(job => isHistorical(job, now)).length,
    };
  }, [jobs, updated]);
  const shown = useMemo(() => {
    const now = Date.now();
    return jobs.filter(job => {
      if (filter === "completed" && job.status !== "COMPLETED") return false;
      if (filter === "history" && !isHistorical(job, now)) return false;
      if (filter === "attention" && !isCurrentAttention(job, now)) return false;
      if (filter === "failed" && job.status !== "FAILED") return false;
      if (filter === "verifying" && !verifying.has(job.status)) return false;
      if (filter === "active" && (terminal.has(job.status) || isHistorical(job, now) || isStale(job, now))) {
        return false;
      }
      const text = [job.title, job.id, job.source, job.worker, job.accountable, job.status].join(" ").toLowerCase();
      return text.includes(query.trim().toLowerCase());
    });
  }, [jobs, updated, filter, query]);

  return (
    <Card className="border-border/60" data-testid="unified-job-monitor">
      <CardHeader className="space-y-2">
        <CardTitle className="text-lg">Monitoring Semua Pekerjaan — Human & AI</CardTitle>
        <CardDescription>Terintegrasi di Dashboard AI Core. Menggunakan session yang sama; pembaruan otomatis setiap 15 detik. Progres hanya ditampilkan jika ada bukti resmi.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
          {([
            { label: "Sedang dikerjakan", count: summary.active, Icon: RefreshCw },
            { label: "Menunggu", count: summary.waiting, Icon: Clock3 },
            { label: "Perlu tindakan (7 hari)", count: summary.attention, Icon: AlertTriangle },
            { label: "Dalam verifikasi (7 hari)", count: summary.verifying, Icon: Clock3 },
            { label: "Gagal (riwayat)", count: summary.failed, Icon: AlertTriangle },
            { label: "Status selesai (bukan PASS)", count: summary.completed, Icon: CheckCircle2 },
          ] as const).map(item => (
            <div key={item.label} className="rounded-lg border p-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground"><item.Icon className="size-4" /> {item.label}</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">{item.count}</div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-3 items-center justify-between">
          <div className="flex flex-wrap gap-2 items-center">
            <label htmlFor="job-monitor-filter" className="text-sm">Status</label>
            <select id="job-monitor-filter" aria-label="Filter status pekerjaan" className="rounded-md border bg-background p-2 text-sm" value={filter} onChange={event => setFilter(event.target.value as JobFilter)}>
              <option value="active">Pekerjaan terkini (7 hari)</option>
              <option value="attention">Perlu tindakan terkini</option>
              <option value="verifying">Dalam verifikasi</option>
              <option value="failed">Gagal (termasuk testing)</option>
              <option value="history">Riwayat lama (termasuk testing)</option>
              <option value="completed">Status selesai (belum tentu PASS)</option>
              <option value="all">Semua data yang dimuat</option>
            </select>
            <input aria-label="Cari pekerjaan" className="rounded-md border bg-background p-2 text-sm w-56" value={query} onChange={event => setQuery(event.target.value)} placeholder="Cari job, worker, penanggung jawab" />
          </div>
          <span className="text-xs text-muted-foreground">{loading ? "Memuat…" : updated ? `Terakhir diperbarui: ${formatWib(updated)} WIB` : "Belum diperbarui"}</span>
        </div>
        <p className="text-xs text-muted-foreground">Dari {jobs.length} record yang berhasil dimuat: {summary.history} masuk riwayat lama / testing (&gt;7 hari tanpa pembaruan). FAILED adalah hasil terminal dan ditampilkan terpisah dari pekerjaan yang perlu tindakan. COMPLETED tidak otomatis berarti PASS. Ini pengelompokan tampilan, bukan perubahan status database.</p>
        {error && <p role="alert" className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">{error}</p>}
        {warnings.length > 0 && <p role="status" className="text-sm text-amber-600">Data parsial: {warnings.join(", ")}</p>}
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[950px] text-sm">
            <thead className="bg-muted/40 text-left text-xs"><tr>
              <th className="p-3">Pekerjaan / Sumber</th><th className="p-3">Status</th><th className="p-3">Progres terverifikasi</th><th className="p-3">Pelaksana</th><th className="p-3">Penanggung jawab</th><th className="p-3">Terakhir aktif</th>
            </tr></thead>
            <tbody>
              {shown.map(job => {
                const open = selected === `${job.source}:${job.id}`;
                const stale = running.has(job.status) && job.updatedAt && Date.now() - Date.parse(job.updatedAt) > 3_600_000;
                return <FragmentRow key={`${job.source}:${job.id}`} job={job} open={open} stale={Boolean(stale)} onClick={() => setSelected(open ? null : `${job.source}:${job.id}`)} />;
              })}
              {!shown.length && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">{loading ? "Memuat pekerjaan…" : "Tidak ada pekerjaan sesuai filter."}</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground"><UsersRound className="size-4" /> Nama pelaksana atau penanggung jawab yang belum terverifikasi tetap ditandai “Belum ditetapkan”. Pekerjaan gagal tidak dinyatakan PASS.</div>
      </CardContent>
    </Card>
  );
}

function FragmentRow({ job, open, stale, onClick }: { job: Job; open: boolean; stale: boolean; onClick: () => void }) {
  return <>
    <tr className="border-t hover:bg-muted/20 cursor-pointer" onClick={onClick} aria-expanded={open}>
      <td className="p-3"><strong className="font-medium">{job.title}</strong><div className="text-xs text-muted-foreground break-all">{job.source} · {job.id}</div></td>
      <td className="p-3"><span className="rounded bg-muted px-2 py-1 text-xs">{job.status}</span>{isHistorical(job) && <div className="mt-1 text-xs text-muted-foreground">Riwayat lama</div>}{stale && <div className="mt-1 text-xs text-amber-600">Tidak diperbarui &gt;60 menit</div>}</td>
      <td className="p-3">{typeof job.verifiedProgress === "number" ? <div className="flex items-center gap-2"><progress className="w-28" max={100} value={job.verifiedProgress} /><span>{job.verifiedProgress}%</span></div> : <span className="text-muted-foreground">Belum terverifikasi</span>}</td>
      <td className="p-3">{job.worker || "Belum ditetapkan"}{job.workerType && <div className="text-xs text-muted-foreground">{job.workerType}</div>}</td>
      <td className="p-3">{job.accountable || "Belum ditetapkan"}</td>
      <td className="p-3">{formatWib(job.updatedAt)} WIB</td>
    </tr>
    {open && <tr className="border-t bg-muted/20"><td colSpan={6} className="p-4 space-y-1 text-sm">
      <div><strong>Tahap:</strong> {job.stage || "Belum terverifikasi"}</div>
      <div><strong>Hambatan:</strong> {job.blocker || "Tidak tercatat"}</div>
      <div><strong>Bukti / ACK:</strong> {job.evidence || "Belum tersedia"}</div>
      <div><strong>Jenis pelaksana:</strong> {job.workerType || "Belum tercatat"}</div>
    </td></tr>}
  </>;
}
