import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { useToast } from "@/hooks/use-toast";
import { Loader2, CheckCircle2, Receipt, Clock, Wallet } from "lucide-react";

// Same pattern as service-requests.tsx — empty base so fetch goes through the
// Vite /api proxy, plus the admin API key header.
const API_BASE = "";

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {};
  const key = import.meta.env.VITE_ADMIN_API_KEY;
  if (key) headers["x-admin-api-key"] = key;
  if (init?.body) headers["Content-Type"] = "application/json";

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers: { ...headers, ...((init?.headers as Record<string, string>) ?? {}) } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error((body?.error as string) ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

type PaymentSchedule = {
  id: number;
  projectId: number;
  paymentType: string;
  percentage: number | null;
  amount: string;
  currency: string;
  status: string;
  reference: string | null;
  verifiedBy: string | null;
  paidAt: string | null;
};

type CreativeProject = {
  id: number;
  projectId: string;
  brandName: string;
  status: string;
  paymentPolicy: string;
  paymentStatus: string;
  filesUnlocked: boolean;
};

type PendingGroup = { project: CreativeProject; schedule: PaymentSchedule[] };

const PAYMENT_TYPE_LABEL: Record<string, string> = {
  deposit: "Deposit",
  remaining_balance: "Sisa Pembayaran",
  full_payment: "Pembayaran Penuh",
  custom_installment: "Cicilan",
  subscription_charge: "Tagihan Langganan",
};

function fmt(amount: string, currency: string) {
  const n = parseFloat(amount);
  if (currency === "IDR") return `Rp${Math.round(n).toLocaleString("id-ID")}`;
  return `${currency} ${n.toLocaleString()}`;
}

export default function Payments() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [verifiedBy, setVerifiedBy] = useState("admin");

  const { data, isLoading } = useQuery({
    queryKey: ["payments", "pending"],
    queryFn: () => apiFetch<PendingGroup[]>("/api/ai/payments/pending"),
  });

  const verify = useMutation({
    mutationFn: ({ scheduleId, reference }: { scheduleId: number; reference?: string }) =>
      apiFetch(`/api/ai/payments/${scheduleId}/verify`, {
        method: "POST",
        body: JSON.stringify({ verifiedBy, reference }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payments", "pending"] });
      toast({ title: "Pembayaran diverifikasi." });
    },
    onError: (err: Error) => toast({ title: "Gagal memverifikasi", description: err.message, variant: "destructive" }),
  });

  const invoice = useMutation({
    mutationFn: (scheduleId: number) =>
      apiFetch(`/api/ai/payments/${scheduleId}/invoice`, { method: "POST" }),
    onSuccess: () => toast({ title: "Invoice dibuat." }),
    onError: (err: Error) => toast({ title: "Gagal membuat invoice", description: err.message, variant: "destructive" }),
  });

  return (
    <Layout>
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2"><Wallet className="w-6 h-6" /> Verifikasi Pembayaran</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Daftar proyek dengan cicilan/pembayaran yang belum lunas. Produksi AI hanya akan berjalan setelah pembayaran (deposit atau penuh) diverifikasi di sini.
          </p>
        </div>

        <div className="flex items-center gap-2 text-sm">
          <label className="text-muted-foreground">Diverifikasi oleh:</label>
          <input
            className="border rounded px-2 py-1 bg-background text-sm w-48"
            value={verifiedBy}
            onChange={(e) => setVerifiedBy(e.target.value)}
          />
        </div>

        {isLoading && (
          <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        )}

        {!isLoading && (data?.length ?? 0) === 0 && (
          <div className="text-center py-16 text-muted-foreground">
            <CheckCircle2 className="w-8 h-8 mx-auto mb-2" />
            Tidak ada pembayaran yang menunggu verifikasi.
          </div>
        )}

        <div className="space-y-4">
          {data?.map(({ project, schedule }) => (
            <div key={project.id} className="border rounded-xl p-4 bg-card">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="font-medium">{project.brandName}</p>
                  <p className="text-xs text-muted-foreground font-mono">{project.projectId}</p>
                </div>
                <span className="text-xs px-2 py-1 rounded-full bg-muted">{project.status}</span>
              </div>
              <div className="space-y-2">
                {schedule.map((s) => (
                  <div key={s.id} className="flex items-center justify-between border-t pt-2 text-sm">
                    <div>
                      <p className="font-medium">{PAYMENT_TYPE_LABEL[s.paymentType] ?? s.paymentType} — {fmt(s.amount, s.currency)}</p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" /> Status: {s.status}
                        {s.reference && <> · Referensi: <span className="font-mono">{s.reference}</span></>}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        className="text-xs px-3 py-1.5 rounded-lg bg-primary text-primary-foreground disabled:opacity-50"
                        disabled={s.status === "paid" || verify.isPending}
                        onClick={() => verify.mutate({ scheduleId: s.id, reference: s.reference ?? undefined })}
                      >
                        Verifikasi
                      </button>
                      <button
                        className="text-xs px-3 py-1.5 rounded-lg border flex items-center gap-1 disabled:opacity-50"
                        disabled={invoice.isPending}
                        onClick={() => invoice.mutate(s.id)}
                      >
                        <Receipt className="w-3 h-3" /> Buat Invoice
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Layout>
  );
}
