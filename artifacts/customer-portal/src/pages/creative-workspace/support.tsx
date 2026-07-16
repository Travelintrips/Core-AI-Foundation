/**
 * creative-workspace/support.tsx — Support center page (Team 2).
 * Route: /creative-workspace/:token/support
 * Uses existing workspace support endpoints (not Team 2's routes) to avoid duplication.
 */
import { useState } from "react";
import { motion } from "framer-motion";
import { LifeBuoy, Send, CheckCircle2, Loader2, MessageSquare, Clock, AlertCircle } from "lucide-react";
import { CWLayout } from "@/components/creative-workspace/cw-layout";
import { CWError } from "@/components/creative-workspace/cw-empty";
import { useCreateSupportTicket, useSupportTickets } from "@/hooks/use-workspace";

const CATEGORIES = [
  { value: "general",    label: "Pertanyaan Umum" },
  { value: "billing",    label: "Pembayaran & Invoice" },
  { value: "delivery",   label: "Pengiriman File" },
  { value: "quality",    label: "Kualitas Output" },
  { value: "revision",   label: "Revisi" },
  { value: "technical",  label: "Masalah Teknis" },
];

const TICKET_STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  open:        { label: "Terbuka",      cls: "bg-blue-500/15 text-blue-300" },
  in_progress: { label: "Diproses",     cls: "bg-indigo-500/15 text-indigo-300" },
  resolved:    { label: "Selesai",      cls: "bg-emerald-500/15 text-emerald-300" },
  closed:      { label: "Ditutup",      cls: "bg-slate-700 text-slate-400" },
};

function fmtDate(d: string) {
  try { return new Date(d).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }); }
  catch { return d; }
}

type Ticket = {
  id: number; subject: string; message: string; category?: string;
  status?: string; createdAt: string;
};

export default function CWSupportPage({ params }: { params: { token: string } }) {
  const { token } = params;
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [category, setCategory] = useState("general");
  const [submitted, setSubmitted] = useState(false);

  const { data: ticketsData, isLoading, error, refetch } = useSupportTickets(token);
  const createTicket = useCreateSupportTicket(token);

  const tickets: Ticket[] = (ticketsData?.items ?? []) as Ticket[];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!subject.trim() || !message.trim()) return;
    try {
      await createTicket.mutateAsync({ subject: subject.trim(), message: message.trim(), category });
      setSubmitted(true);
      setSubject("");
      setMessage("");
    } catch { /* error shown via createTicket.error */ }
  }

  return (
    <CWLayout token={token} title="Bantuan" backHref={`/creative-workspace/${token}`}>
      {/* Header */}
      <div className="mb-7">
        <h1 className="text-2xl font-bold text-white mb-1">Pusat Bantuan</h1>
        <p className="text-slate-400 text-sm">Tim kami siap membantu Anda 24/7. Rata-rata respon dalam 2 jam kerja.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* New ticket form */}
        <div className="rounded-2xl border border-white/8 bg-white/3 p-5">
          <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
            <Send className="w-4 h-4 text-indigo-400" /> Buat Tiket Baru
          </h2>

          {submitted && !createTicket.isPending && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-start gap-3 p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 mb-4"
            >
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-emerald-300">Tiket Terkirim!</p>
                <p className="text-xs text-emerald-400 mt-0.5">Tim kami akan segera merespons pesan Anda.</p>
              </div>
            </motion.div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Kategori</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border border-white/10 bg-white/4 text-sm text-white focus:outline-none focus:border-indigo-500/40"
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value} className="bg-slate-900">{c.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Subjek *</label>
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Judul singkat masalah Anda"
                required
                className="w-full px-3 py-2.5 rounded-xl border border-white/10 bg-white/4 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500/40"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Pesan *</label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Jelaskan masalah Anda secara detail…"
                required
                rows={5}
                className="w-full px-3 py-2.5 rounded-xl border border-white/10 bg-white/4 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500/40 resize-none"
              />
            </div>

            {createTicket.error && (
              <div className="flex items-center gap-2 text-sm text-red-400">
                <AlertCircle className="w-4 h-4" />
                Gagal mengirim. Coba lagi.
              </div>
            )}

            <button
              type="submit"
              disabled={createTicket.isPending || !subject.trim() || !message.trim()}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-indigo-500 text-white text-sm font-semibold hover:bg-indigo-600 disabled:opacity-40 transition-colors"
            >
              {createTicket.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {createTicket.isPending ? "Mengirim…" : "Kirim Tiket"}
            </button>
          </form>
        </div>

        {/* Ticket history */}
        <div>
          <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-indigo-400" /> Riwayat Tiket
          </h2>

          {isLoading ? (
            <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-indigo-400" /></div>
          ) : error ? (
            <CWError onRetry={() => refetch()} />
          ) : tickets.length === 0 ? (
            <div className="text-center py-10 rounded-2xl border border-white/8 bg-white/2">
              <MessageSquare className="w-8 h-8 text-slate-600 mx-auto mb-2" />
              <p className="text-sm text-slate-400">Belum ada tiket. Buat tiket pertama Anda.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {tickets.map((t, i) => {
                const badge = TICKET_STATUS_BADGE[t.status ?? "open"] ?? TICKET_STATUS_BADGE.open;
                return (
                  <motion.div
                    key={t.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.04 }}
                    className="p-3.5 rounded-xl border border-white/8 bg-white/3 hover:border-white/15 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-semibold text-white flex-1 min-w-0 truncate">{t.subject}</p>
                      <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium shrink-0 ${badge.cls}`}>
                        {badge.label}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-1 line-clamp-2">{t.message}</p>
                    <div className="flex items-center gap-1.5 mt-2 text-[11px] text-slate-600">
                      <Clock className="w-3 h-3" />
                      {fmtDate(t.createdAt)}
                      {t.category && <><span>·</span><span className="capitalize">{t.category}</span></>}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </CWLayout>
  );
}
