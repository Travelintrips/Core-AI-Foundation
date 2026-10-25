import { useEffect, useMemo, useState } from "react";
import { useListSettings } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

type Reply = { id: string; event: string; enabled: boolean; text: string };
type SopContent = { title: string; steps: string[] };
type Policy = { enabled: boolean; heartbeatGraceMinutes: number; maxRetries: number; requireAcknowledgement: boolean };
const TEMPLATE_KEY = "handshake.reply.templates.v1";
const POLICY_KEY = "handshake.sop2.policy.v1";
const SOP_KEY = "handshake.sop.content.v1";
const defaultSop: SopContent = {
  title: "Resource-First, Human-Last — SOP pemulihan blocker",
  steps: [
    "Catat blocker, correlation ID, resource yang gagal, dan dampaknya.",
    "Gunakan jalur resmi yang tersedia: GitHub, AI Core, OpenClaw atau Desktop Commander pada perangkat terotorisasi.",
    "Pulihkan koneksi dengan retry terbatas dan backoff; jangan melewati autentikasi atau pembatasan keamanan.",
    "Verifikasi hasil tindakan melalui sumber status resmi, callback, dan ACK terautentikasi; jangan klaim PASS sebelum bukti lengkap.",
    "Eskalasi hanya bila perlu persetujuan keamanan, operasi destruktif, perubahan PROD berisiko, atau semua jalur sah gagal.",
  ],
};
const defaultReplies: Reply[] = [
  { id: "received", event: "JOB_RECEIVED", enabled: true, text: "AI Core menerima job {{job_id}}. Status: {{status}}." },
  { id: "queued", event: "JOB_QUEUED", enabled: true, text: "Job {{job_id}} masuk antrian. Worker: {{worker}}." },
  { id: "blocked", event: "JOB_BLOCKED", enabled: true, text: "Job {{job_id}} mengalami kendala: {{blocker}}. Langkah berikutnya: {{next_action}}." },
  { id: "resume", event: "JOB_RESUME_REQUESTED", enabled: true, text: "Lanjutkan job {{job_id}} dari checkpoint {{checkpoint}}. Validasi hasil sebelum menandai selesai." },
  { id: "completed", event: "JOB_COMPLETED", enabled: true, text: "Job {{job_id}} selesai setelah verifikasi. Status: {{status}}." }
];
const defaultPolicy: Policy = { enabled: false, heartbeatGraceMinutes: 10, maxRetries: 3, requireAcknowledgement: true };
const placeholders = ["job_id","status","worker","blocker","next_action","checkpoint","time_wib"];
const supportedEvents = ["JOB_RECEIVED", "JOB_QUEUED", "JOB_BLOCKED", "JOB_RESUME_REQUESTED", "JOB_COMPLETED"];
function safeParse<T>(s: string | undefined, fallback: T): T {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}
function validateTemplates(items: Reply[]) {
  if (items.length > 40) return "Maksimal 40 template.";
  const ids = items.map(t => t.id);
  if (new Set(ids).size !== ids.length) return "ID template tidak boleh duplikat.";
  if (items.some(t => !/^[a-z0-9_-]{1,50}$/i.test(t.id) || !supportedEvents.includes(t.event) || !t.text.trim() || t.text.length > 2000 || /[\u0000-\u001f\u007f]/.test(t.text))) return "ID, event, atau isi template tidak valid.";
  const vars = items.flatMap(t => [...t.text.matchAll(/{{\s*([^}]+)\s*}}/g)].map(m => m[1].trim()));
  if (vars.some(v => !placeholders.includes(v))) return "Variabel tidak dikenal. Gunakan pilihan variabel yang tersedia.";
  return null;
}
export default function HandshakeSopSettings() {
  const queryClient = useQueryClient();
  const { data: allSettings } = useListSettings();
  const templateValue = allSettings?.find((s: { key: string }) => s.key === TEMPLATE_KEY)?.value;
  const policyValue = allSettings?.find((s: { key: string }) => s.key === POLICY_KEY)?.value;
  const sopValue = allSettings?.find((s: { key: string }) => s.key === SOP_KEY)?.value;
  const remoteReplies = useMemo(() => safeParse<Reply[]>(templateValue, defaultReplies), [templateValue]);
  const remotePolicy = useMemo(() => safeParse<Policy>(policyValue, defaultPolicy), [policyValue]);
  const remoteSop = useMemo(() => safeParse<SopContent>(sopValue, defaultSop), [sopValue]);
  const [replies, setReplies] = useState<Reply[]>(defaultReplies);
  const [policy, setPolicy] = useState<Policy>(defaultPolicy);
  const [sop, setSop] = useState<SopContent>(defaultSop);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [previewId, setPreviewId] = useState("received");
  useEffect(() => { if (!dirty) { setReplies(remoteReplies); setPolicy(remotePolicy); setSop(remoteSop); } }, [remoteReplies, remotePolicy, remoteSop, dirty]);
  const change = (next: Reply[]) => { setReplies(next); setDirty(true); };
  const changePolicy = (next: Policy) => { setPolicy(next); setDirty(true); };
  const changeSop = (next: SopContent) => { setSop(next); setDirty(true); };
  const preview = replies.find(r => r.id === previewId)?.text.replace(/{{\s*([^}]+)\s*}}/g, (_m, name: string) =>
    ({ job_id: "TEST-001", status: "QUEUED", worker: "openclaw-dell-dev", blocker: "heartbeat timeout", next_action: "resume from checkpoint", checkpoint: "step-2", time_wib: "25/10/2026 15:00 WIB" } as Record<string,string>)[name.trim()] ?? "?") ?? "";
  async function save() {
    const error = validateTemplates(replies);
    if (error) { setMessage(error); return; }
    const validText = (s: unknown, max: number) => typeof s === "string" &&
      s.length > 0 && s.length <= max && s.trim() === s && !/[\u0000-\u001f\u007f]/.test(s);
    if (!validText(sop.title, 180) || !Array.isArray(sop.steps) ||
      sop.steps.length !== 5 || !sop.steps.every(step => validText(step, 750))) {
      setMessage("SOP harus memiliki judul dan tepat 5 langkah, tanpa baris kosong/control.");
      return;
    }
    if (!Number.isInteger(policy.heartbeatGraceMinutes) || policy.heartbeatGraceMinutes < 2 || policy.heartbeatGraceMinutes > 120 || !Number.isInteger(policy.maxRetries) || policy.maxRetries < 0 || policy.maxRetries > 10) {
      setMessage("Grace period 2–120 menit; percobaan 0–10."); return;
    }
    setSaving(true); setMessage("");
    try {
      const headers: Record<string,string> = { "Content-Type": "application/json" };
      const adminKey = import.meta.env["VITE_ADMIN_API_KEY"] as string | undefined;
      if (adminKey) headers["x-admin-api-key"] = adminKey;
      for (const [key, value, description] of [
        [TEMPLATE_KEY, JSON.stringify(replies), "Versioned handshake reply templates"],
        [POLICY_KEY, JSON.stringify(policy), "SOP2 recovery policy, remains inactive until worker recovery verified"],
        [SOP_KEY, JSON.stringify(sop), "Editable SOP text; immutable safety constraints from AI Core"]
      ]) {
        const res = await fetch("/api/ai/settings/" + encodeURIComponent(key), { method: "PUT", headers, body: JSON.stringify({ value, valueType: "string", category: "handshake", description }) });
        if (!res.ok) throw new Error("HTTP " + res.status + " menyimpan " + key);
      }
      await queryClient.invalidateQueries({ queryKey: ["/api/ai/settings"] });
      setDirty(false); setMessage("Konfigurasi tersimpan. SOP berlaku untuk job baru; recovery otomatis tetap memerlukan aktivasi terverifikasi.");
    } catch (e) { setMessage("Gagal menyimpan: " + String(e)); }
    finally { setSaving(false); }
  }
  return <Card>
    <CardHeader><CardTitle>Handshake Balasan & SOP Tahap 2</CardTitle><p className="text-sm text-muted-foreground">Kelola template balasan. Ini konfigurasi saja; tidak otomatis mengaktifkan wake-up ChatGPT atau routing worker.</p></CardHeader>
    <CardContent className="space-y-5">
      <div className="flex items-center justify-between"><strong>Template balasan</strong><Button variant="outline" onClick={() => { const id = "custom_" + Date.now(); change([...replies, { id, event: "JOB_BLOCKED", enabled: false, text: "Job {{job_id}}: {{status}}" }]); setPreviewId(id); }}>Tambah template</Button></div>
      {replies.map((reply, index) => <div className="grid gap-2 rounded border p-3" key={reply.id}>
        <div className="flex items-center justify-between gap-2"><span className="text-sm font-mono">{reply.id}</span><div className="flex items-center gap-3"><Label>Aktif</Label><Switch checked={reply.enabled} onCheckedChange={checked => change(replies.map((r,i) => i === index ? {...r,enabled:checked}:r))}/><Button size="sm" variant="outline" onClick={() => { change(replies.filter((_,i) => i !== index)); if (previewId === reply.id) setPreviewId(""); }}>Hapus</Button></div></div>
        <Label>Event</Label><select className="rounded border bg-background p-2 text-sm" value={reply.event} onChange={e => change(replies.map((r,i) => i === index ? {...r,event:e.target.value}:r))}>{supportedEvents.map(ev => <option key={ev} value={ev}>{ev}</option>)}</select>
        <Label>Balasan</Label><textarea className="min-h-20 w-full rounded-md border bg-background p-2 text-sm" value={reply.text} onChange={e => change(replies.map((r,i) => i === index ? {...r,text:e.target.value}:r))}/>
        <Button className="justify-self-start" size="sm" variant="secondary" onClick={() => setPreviewId(reply.id)}>Preview</Button>
      </div>)}
      <div className="rounded border p-3"><Label>Preview (data sintetis)</Label><p className="whitespace-pre-wrap text-sm mt-2">{preview || "Pilih template untuk preview"}</p><p className="text-xs text-muted-foreground mt-2">Variabel: {placeholders.map(k => "{{" + k + "}}").join(", ")}</p></div>
      <div className="space-y-3 rounded border p-3">
        <strong>Edit SOP — Resource-First, Human-Last</strong>
        <p className="text-xs text-muted-foreground">Judul dan lima langkah ini diteruskan ke metadata job AI Core berikutnya. Batas keamanan dan izin eksekusi tidak dapat diubah di dashboard.</p>
        <Label>Judul SOP</Label>
        <Input value={sop.title} maxLength={180} onChange={e => changeSop({...sop, title:e.target.value})} />
        {sop.steps.map((step, index) => <div key={index} className="space-y-1">
          <Label>Langkah {index + 1}</Label>
          <textarea className="min-h-16 w-full rounded-md border bg-background p-2 text-sm"
            maxLength={750} value={step}
            onChange={e => changeSop({...sop, steps:sop.steps.map((old, i) => i === index ? e.target.value : old)})} />
        </div>)}
        <strong>Preview SOP</strong>
        <div className="rounded border p-3 whitespace-pre-wrap text-sm">
          {sop.title + "\n\n" + sop.steps.map((step,i) => (i+1) + ". " + step).join("\n")}
        </div>
      </div>
      <div className="space-y-3 rounded border p-3">
        <strong>SOP Tahap 2 — Recovery policy</strong>
        <p className="text-xs text-muted-foreground">Simpan kebijakan terlebih dahulu. Worker recovery belum otomatis aktif hanya dengan menyalakan toggle.</p>
        <div className="flex items-center gap-3"><Switch checked={policy.enabled} onCheckedChange={enabled => changePolicy({...policy,enabled})}/><Label>Izinkan recovery setelah backend terverifikasi</Label></div>
        <div className="grid sm:grid-cols-2 gap-3"><div><Label>Heartbeat grace (menit)</Label><Input type="number" min={2} max={120} value={policy.heartbeatGraceMinutes} onChange={e => changePolicy({...policy,heartbeatGraceMinutes:Number(e.target.value)})}/></div><div><Label>Maksimum retry</Label><Input type="number" min={0} max={10} value={policy.maxRetries} onChange={e => changePolicy({...policy,maxRetries:Number(e.target.value)})}/></div></div>
        <div className="flex items-center gap-3"><Switch checked={policy.requireAcknowledgement} onCheckedChange={requireAcknowledgement => changePolicy({...policy,requireAcknowledgement})}/><Label>Wajib ACK terautentikasi</Label></div>
      </div>
      <div className="flex gap-3 items-center"><Button disabled={!dirty || saving} onClick={save}>{saving ? "Menyimpan..." : "Simpan konfigurasi"}</Button><Button variant="outline" disabled={!dirty} onClick={() => { setReplies(remoteReplies); setPolicy(remotePolicy); setSop(remoteSop); setDirty(false); setMessage(""); }}>Batal</Button></div>
      {message && <p role="status" className="text-sm">{message}</p>}
    </CardContent>
  </Card>;
}
