import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, CheckCircle2, Clock3, RefreshCw, UsersRound } from "lucide-react";

type Job = {
  id: string;
  deleteKey?: string;
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
type Assistance = { job_key: string; id: number; task_code: string; status: string; assigned_user: string | null; reason: string | null; resumeAllowed: false; nextAction: string };
type JobFilter = "active" | "running" | "waiting" | "attention" | "verifying" | "failed" | "history" | "all" | "completed";
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
  const [assistance, setAssistance] = useState<Record<string,Assistance>>({});
  const [warnings, setWarnings] = useState<string[]>([]);
  const [filter, setFilter] = useState<JobFilter>("active");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [checked, setChecked] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
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
          setChecked(old => old.filter(key => payload.jobs.some(job => job.deleteKey === key && terminal.has(job.status))));
          setWarnings(payload.warnings ?? []);
          setError(null);
          setUpdated(new Date().toISOString());
        }
        // Independent Human Task query: never claim a missing request is resolved.
        try {
          const humanRes = await fetch("/api/dev-center/jobs/human-assistance", {credentials:"include",cache:"no-store"});
          if (!humanRes.ok) throw new Error("HUMAN_ASSISTANCE_UNAVAILABLE");
          const humanData: {requests?: Assistance[]} = await humanRes.json();
          if (active) setAssistance(Object.fromEntries((humanData.requests ?? []).map(item => [item.job_key,item])));
        } catch { if (active) setWarnings(old => [...new Set([...old,"HUMAN_ASSISTANCE_UNAVAILABLE"])]); }
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
      if (filter === "running" && (!running.has(job.status) || isStale(job, now))) return false;
      if (filter === "waiting" && (!waiting.has(job.status) || isStale(job, now))) return false;
      if (filter === "completed" && job.status !== "COMPLETED") return false;
      if (filter === "history" && !isHistorical(job, now)) return false;
      if (filter === "attention" && !isCurrentAttention(job, now)) return false;
      if (filter === "failed" && job.status !== "FAILED") return false;
      if (filter === "verifying" && (!verifying.has(job.status) || isStale(job, now))) return false;
      if (filter === "active" && (terminal.has(job.status) || isHistorical(job, now) || isStale(job, now))) {
        return false;
      }
      const text = [job.title, job.id, job.source, job.worker, job.accountable, job.status].join(" ").toLowerCase();
      return text.includes(query.trim().toLowerCase());
    });
  }, [jobs, updated, filter, query]);

  const eligible = shown.filter(job => Boolean(job.deleteKey) && terminal.has(job.status));
  const allChecked = eligible.length > 0 && eligible.every(job => checked.includes(job.deleteKey!));
  const visibleChecked = eligible.filter(job => checked.includes(job.deleteKey!)).length;
  const selectAll = (value: boolean) => setChecked(old => value
    ? [...new Set([...old, ...eligible.map(job => job.deleteKey!)])]
    : old.filter(key => !eligible.some(job => job.deleteKey === key)));
  const dismiss = async () => {
    const keys = shown.filter(job => job.deleteKey && terminal.has(job.status) && checked.includes(job.deleteKey)).map(job => job.deleteKey!);
    if (!keys.length || deleting) return;
    if (!window.confirm(`Hapus ${keys.length} pekerjaan terminal dari Dashboard DEV Anda?\n\nData job sumber, event, dan ACK tidak akan dihapus.`)) return;
    setDeleting(true); setFeedback(null);
    try {
      const response = await fetch("/api/dev-center/jobs/dismiss", { method: "POST", credentials: "include", headers: {"Content-Type": "application/json"}, body: JSON.stringify({keys: keys.slice(0,100)}) });
      if (!response.ok) throw new Error(`Gagal menyimpan penghapusan Dashboard (HTTP ${response.status})`);
      const result: {dismissed: string[]; rejected: string[]} = await response.json();
      setJobs(old => old.filter(job => !result.dismissed.includes(job.deleteKey || "")));
      setChecked(old => old.filter(key => !result.dismissed.includes(key)));
      setFeedback(`${result.dismissed.length} pekerjaan dihapus dari Dashboard Anda. ${result.rejected.length} ditolak atau sudah pernah dihapus. Riwayat sumber tetap aman.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Gagal menghapus pekerjaan."); }
    finally { setDeleting(false); }
  };

  return (
    <Card className="border-border/60" data-testid="unified-job-monitor">
      <CardHeader className="space-y-2">
        <CardTitle className="text-lg">Monitoring Semua Pekerjaan — Human & AI</CardTitle>
        <CardDescription>Terintegrasi di Dashboard AI Core. Menggunakan session yang sama; pembaruan otomatis setiap 15 detik. Progres hanya ditampilkan jika ada bukti resmi.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
          {([
            { label: "Sedang dikerjakan", count: summary.active, Icon: RefreshCw, filter: "running" },
            { label: "Menunggu", count: summary.waiting, Icon: Clock3, filter: "waiting" },
            { label: "Perlu tindakan (7 hari)", count: summary.attention, Icon: AlertTriangle, filter: "attention" },
            { label: "Dalam verifikasi (7 hari)", count: summary.verifying, Icon: Clock3, filter: "verifying" },
            { label: "Gagal (riwayat)", count: summary.failed, Icon: AlertTriangle, filter: "failed" },
            { label: "Status selesai (bukan PASS)", count: summary.completed, Icon: CheckCircle2, filter: "completed" },
          ] as const).map(item => (
            <button type="button" key={item.label} aria-pressed={filter === item.filter}
              onClick={() => { setFilter(item.filter as JobFilter); setSelected(null); setChecked([]); }}
              className={`rounded-lg border p-3 text-left transition-colors hover:border-primary/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${filter === item.filter ? "border-primary bg-primary/10" : ""}`}>
              <div className="flex items-center gap-2 text-xs text-muted-foreground"><item.Icon className="size-4" /> {item.label}</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">{item.count}</div>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-3 items-center justify-between">
          <div className="flex flex-wrap gap-2 items-center">
            <label htmlFor="job-monitor-filter" className="text-sm">Status</label>
            <select id="job-monitor-filter" aria-label="Filter status pekerjaan" className="rounded-md border bg-background p-2 text-sm" value={filter} onChange={event => { setFilter(event.target.value as JobFilter); setChecked([]); }}>
              <option value="active">Pekerjaan terkini (7 hari)</option>
              <option value="running">Sedang dikerjakan</option>
              <option value="waiting">Menunggu</option>
              <option value="attention">Perlu tindakan terkini</option>
              <option value="verifying">Dalam verifikasi</option>
              <option value="failed">Gagal (termasuk testing)</option>
              <option value="history">Riwayat lama (termasuk testing)</option>
              <option value="completed">Status selesai (belum tentu PASS)</option>
              <option value="all">Semua data yang dimuat</option>
            </select>
            <input aria-label="Cari pekerjaan" className="rounded-md border bg-background p-2 text-sm w-56" value={query} onChange={event => { setQuery(event.target.value); setChecked([]); }} placeholder="Cari job, worker, penanggung jawab" />
          </div>
          <span className="text-xs text-muted-foreground">{loading ? "Memuat…" : updated ? `Terakhir diperbarui: ${formatWib(updated)} WIB` : "Belum diperbarui"}</span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" aria-label="Pilih semua pekerjaan terminal yang tampil" checked={allChecked}
              onChange={event => selectAll(event.target.checked)} disabled={!eligible.length || deleting} />
            Pilih Semua ({eligible.length} dapat dipilih pada filter ini)
          </label>
          <button type="button" className="rounded-md bg-destructive px-3 py-2 text-sm text-destructive-foreground disabled:opacity-40"
            onClick={() => void dismiss()} disabled={!visibleChecked || deleting}>
            {deleting ? "Menghapus…" : `Hapus dari Dashboard (${visibleChecked})`}
          </button>
          <span className="text-xs text-muted-foreground">Hanya FAILED, COMPLETED, CANCELLED. Job aktif serta riwayat sumber/ACK tidak dihapus.</span>
        </div>
        {feedback && <p role="status" className="text-sm text-green-600">{feedback}</p>}
        <p className="text-xs text-muted-foreground">Dari {jobs.length} record yang berhasil dimuat: {summary.history} masuk riwayat lama / testing (&gt;7 hari tanpa pembaruan). FAILED adalah hasil terminal dan ditampilkan terpisah dari pekerjaan yang perlu tindakan. COMPLETED tidak otomatis berarti PASS. Ini pengelompokan tampilan, bukan perubahan status database.</p>
        {error && <p role="alert" className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">{error}</p>}
        {warnings.length > 0 && <p role="status" className="text-sm text-amber-600">Data parsial: {warnings.join(", ")}</p>}
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[950px] text-sm">
            <thead className="bg-muted/40 text-left text-xs"><tr>
              <th className="p-3">Pilih</th><th className="p-3">Pekerjaan / Sumber</th><th className="p-3">Status</th><th className="p-3">Progres terverifikasi</th><th className="p-3">Pelaksana</th><th className="p-3">Penanggung jawab</th><th className="p-3">Terakhir aktif</th>
            </tr></thead>
            <tbody>
              {shown.map(job => {
                const open = selected === `${job.source}:${job.id}`;
                const stale = running.has(job.status) && job.updatedAt && Date.now() - Date.parse(job.updatedAt) > 3_600_000;
                const checkedJob = Boolean(job.deleteKey && checked.includes(job.deleteKey));
                return <FragmentRow key={`${job.source}:${job.id}`} job={job} open={open} stale={Boolean(stale)}
                  checked={checkedJob} toggleChecked={value => setChecked(old => !job.deleteKey ? old : value ? [...new Set([...old, job.deleteKey])] : old.filter(key => key !== job.deleteKey))}
                  assistance={job.deleteKey ? assistance[job.deleteKey] : undefined}
                  onAssistanceCreated={item => setAssistance(old => ({...old,[item.job_key]:item}))}
                  onClick={() => setSelected(open ? null : `${job.source}:${job.id}`)} />;
              })}
              {!shown.length && <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">{loading ? "Memuat pekerjaan…" : "Tidak ada pekerjaan sesuai filter."}</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground"><UsersRound className="size-4" /> Nama pelaksana atau penanggung jawab yang belum terverifikasi tetap ditandai “Belum ditetapkan”. Pekerjaan gagal tidak dinyatakan PASS.</div>
      </CardContent>
    </Card>
  );
}

function FragmentRow({ job, open, stale, checked, toggleChecked, assistance, onAssistanceCreated, onClick }: { job: Job; open: boolean; stale: boolean; checked: boolean; toggleChecked: (value: boolean) => void; assistance?: Assistance; onAssistanceCreated: (value:Assistance)=>void; onClick: () => void }) {
  return <>
    <tr className="border-t hover:bg-muted/20 cursor-pointer" onClick={onClick} aria-expanded={open}>
      <td className="p-3"><input type="checkbox" aria-label={`Pilih ${job.title}`} checked={checked}
        disabled={!terminal.has(job.status) || !job.deleteKey} onClick={event => event.stopPropagation()}
        onChange={event => toggleChecked(event.target.checked)} /></td>
      <td className="p-3"><strong className="font-medium">{job.title}</strong><div className="text-xs text-muted-foreground break-all">{job.source} · {job.id}</div></td>
      <td className="p-3"><span className="rounded bg-muted px-2 py-1 text-xs">{job.status}</span>{isHistorical(job) && <div className="mt-1 text-xs text-muted-foreground">Riwayat lama</div>}{stale && <div className="mt-1 text-xs text-amber-600">Tidak diperbarui &gt;60 menit</div>}</td>
      <td className="p-3">{typeof job.verifiedProgress === "number" ? <div className="flex items-center gap-2"><progress className="w-28" max={100} value={job.verifiedProgress} /><span>{job.verifiedProgress}%</span></div> : <span className="text-muted-foreground">Belum terverifikasi</span>}</td>
      <td className="p-3">{job.worker || "Belum ditetapkan"}{job.workerType && <div className="text-xs text-muted-foreground">{job.workerType}</div>}</td>
      <td className="p-3">{job.accountable || assistance?.assigned_user || "Belum ditetapkan"}{!job.accountable && assistance?.assigned_user && <div className="text-xs text-muted-foreground">PIC bantuan Human</div>}</td>
      <td className="p-3">{formatWib(job.updatedAt)} WIB</td>
    </tr>
    {open && <tr className="border-t bg-muted/20"><td colSpan={7} className="p-4 space-y-1 text-sm">
      <div><strong>Tahap:</strong> {job.stage || "Belum terverifikasi"}</div>
      <div><strong>Hambatan:</strong> {job.blocker || "Tidak tercatat"}</div>
      <div><strong>Bukti / ACK:</strong> {job.evidence || "Belum tersedia"}</div>
      <div><strong>Jenis pelaksana:</strong> {job.workerType || "Belum tercatat"}</div>
      {job.deleteKey && <HumanAssistancePanel job={job} assistance={assistance} onCreated={onAssistanceCreated} />}
    </td></tr>}
  </>;
}

function HumanAssistancePanel({job,assistance,onCreated}:{job:Job;assistance?:Assistance;onCreated:(item:Assistance)=>void}) {
  const [reason,setReason]=useState("");
  const [openclaw,setOpenclaw]=useState("");
  const [pic,setPic]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [created,setCreated]=useState(false);
  const eligible=["BLOCKED","REVIEW_REQUIRED","FAILED"].includes(job.status);
  const submit=async()=>{
    if (!job.deleteKey || busy || reason.trim().length<20 || openclaw.trim().length<20) return;
    if (!window.confirm("Buat Human Task untuk hambatan job ini? GPT02 tidak akan di-resume otomatis."))return;
    setBusy(true);setError("");
    try {
      const response=await fetch("/api/dev-center/jobs/human-assistance",{
        method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({jobKey:job.deleteKey,reason:reason.trim(),openClawEvidence:openclaw.trim(),...(pic.trim()?{assignedUser:pic.trim()}:{})})
      });
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||`HTTP ${response.status}`);
      if(data.task){setCreated(true);onCreated({job_key:job.deleteKey,id:data.task.id,task_code:data.task.task_code,status:data.task.status,assigned_user:pic.trim()||null,reason:reason.trim(),resumeAllowed:false,nextAction:"HUMAN_TASK_ACTION_REQUIRED"});}
    }catch(cause){setError(cause instanceof Error?cause.message:"Gagal meminta bantuan Human");}
    finally{setBusy(false);}
  };
  if (assistance || created) return <div className="mt-3 space-y-2 rounded-md border border-amber-500/40 p-3">
    <strong>Bantuan Human: {assistance?.task_code||"Baru dibuat"}</strong>
    <div>Status: {assistance?.status||"assigned"} · PIC: {assistance?.assigned_user||"Lihat Human Tasks"}</div>
    <div>{assistance?.status==="completed"?"Human selesai — resume GPT02 MASIH DIKUNCI sampai checkpoint/ACK, lease, otorisasi dan hasil resmi diverifikasi.":"Menunggu tindakan Human. Eksekusi ulang GPT02 tidak diizinkan oleh panel ini."}</div>
    <a className="text-primary underline" href="/human-tasks">Buka Human Task Center untuk terima, beri bukti, dan selesaikan bantuan</a>
  </div>;
  if (!eligible) return <p className="mt-3 text-xs text-muted-foreground">Eskalasi Human tersedia untuk job BLOCKED, REVIEW_REQUIRED atau FAILED; bukan untuk job berjalan atau selesai.</p>;
  return <div className="mt-3 space-y-2 rounded-md border p-3" onClick={event=>event.stopPropagation()}>
    <strong>Eskalasi GPT02 / OpenClaw → Human</strong>
    <p className="text-xs text-muted-foreground">Gunakan ketika AI tidak mampu menyelesaikan hambatan. Sertakan bukti OpenClaw gagal, atau alasan mengapa OpenClaw tidak bisa digunakan. Ini permintaan bantuan yang diinisiasi operator, bukan bukti kegagalan OpenClaw yang sudah diattestasi.</p>
    <textarea aria-label="Deskripsi hambatan" className="w-full rounded-md border bg-background p-2" rows={2} maxLength={2000} placeholder="Hambatan dan tindakan Human yang diperlukan (minimum 20 karakter)" value={reason} onChange={e=>setReason(e.target.value)}/>
    <textarea aria-label="Bukti atau alasan OpenClaw" className="w-full rounded-md border bg-background p-2" rows={2} maxLength={2000} placeholder="Bukti upaya OpenClaw / alasan tidak memungkinkan (minimum 20 karakter)" value={openclaw} onChange={e=>setOpenclaw(e.target.value)}/>
    <input aria-label="Email PIC Human" type="email" className="w-full rounded-md border bg-background p-2" value={pic} onChange={e=>setPic(e.target.value)} placeholder="Email PIC internal (kosong = akun login)" />
    {error&&<p role="alert" className="text-destructive">{error}</p>}
    <button type="button" className="rounded-md border p-2 hover:bg-muted disabled:opacity-40" disabled={busy||reason.trim().length<20||openclaw.trim().length<20} onClick={()=>void submit()}>{busy?"Membuat tugas…":"Minta Bantuan Human"}</button>
    <p className="text-xs text-amber-600">Setelah Human selesai, resume tetap membutuhkan pemeriksaan resmi. Tidak ada bypass atau dispatch ganda.</p>
  </div>;
}
