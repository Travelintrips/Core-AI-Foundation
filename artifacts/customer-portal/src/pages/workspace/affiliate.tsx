import { useState } from "react";
import { useParams, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { WorkspaceLayout } from "@/components/workspace-layout";
import { useToast } from "@/hooks/use-toast";
import {
  Link2, QrCode, MousePointer, TrendingUp, DollarSign,
  Clock, CheckCircle2, Copy, Loader2, Users, Award, BarChart3, ArrowLeft,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function wsFetch<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/api/public/customer/workspace/${token}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...((init?.headers as Record<string, string>) ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error((body.error as string) ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

type AffiliateProfile = {
  id: number;
  affiliateCode: string;
  affiliateLink: string;
  commissionRate: number;
  totalClicks: number;
  totalConversions: number;
  totalCommission: number;
  pendingCommission: number;
  paidCommission: number;
  status: string;
};

type AffiliateConversion = {
  id: number;
  orderId: string;
  commissionAmount: number;
  status: string;
  createdAt: string;
};

export default function AffiliateWorkspacePage() {
  const { token } = useParams<{ token: string }>();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showQr, setShowQr] = useState(false);

  const { data: affiliate, isLoading } = useQuery<AffiliateProfile | null>({
    queryKey: ["workspace", token, "affiliate"],
    queryFn: () => wsFetch<AffiliateProfile | null>(token, "/affiliate"),
    enabled: !!token,
  });

  const { data: conversions = [] } = useQuery<AffiliateConversion[]>({
    queryKey: ["workspace", token, "affiliate", "conversions"],
    queryFn: () => wsFetch<AffiliateConversion[]>(token, "/affiliate/conversions"),
    enabled: !!token && !!affiliate,
  });

  const joinAffiliate = useMutation({
    mutationFn: () => wsFetch<AffiliateProfile>(token, "/affiliate/join", { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspace", token, "affiliate"] });
      toast({ title: "Selamat datang di program afiliasi!" });
    },
    onError: (err) => toast({ title: "Gagal bergabung", description: String((err as Error)?.message ?? err), variant: "destructive" }),
  });

  const copyLink = () => {
    if (!affiliate?.affiliateLink) return;
    navigator.clipboard.writeText(affiliate.affiliateLink).then(() =>
      toast({ title: "Link tersalin!" }),
    );
  };

  const formatMoney = (amount: number) =>
    new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(amount);

  return (
    <WorkspaceLayout token={token}>
      <Link href={`/workspace/${token}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6 group">
        <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
        Kembali ke Dashboard
      </Link>
      <div className="max-w-3xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-serif font-semibold mb-1">Program Afiliasi</h1>
        <p className="text-sm text-muted-foreground mb-8">
          Dapatkan komisi dengan merekomendasikan layanan kami kepada orang lain.
        </p>

        {isLoading ? (
          <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : !affiliate ? (
          // Join CTA
          <div className="bg-card border border-border rounded-2xl p-8 text-center">
            <div className="w-14 h-14 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <Award className="w-7 h-7 text-primary" />
            </div>
            <h2 className="font-serif text-xl font-medium mb-2">Bergabung Program Afiliasi</h2>
            <p className="text-sm text-muted-foreground mb-6 max-w-sm mx-auto">
              Rekomendasikan layanan AI kami dan dapatkan komisi untuk setiap konversi yang berhasil.
            </p>
            <button
              onClick={() => joinAffiliate.mutate()}
              disabled={joinAffiliate.isPending}
              className="inline-flex items-center gap-2 px-6 py-2.5 bg-primary text-primary-foreground font-medium rounded-xl hover:bg-primary/90 disabled:opacity-60 transition-colors"
            >
              {joinAffiliate.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Daftarkan Saya
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Stats cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <StatCard icon={MousePointer} label="Total Klik" value={affiliate.totalClicks.toLocaleString()} />
              <StatCard icon={TrendingUp} label="Konversi" value={affiliate.totalConversions.toLocaleString()} />
              <StatCard icon={DollarSign} label="Total Komisi" value={formatMoney(affiliate.totalCommission)} />
              <StatCard icon={Clock} label="Pending" value={formatMoney(affiliate.pendingCommission)} highlight />
              <StatCard icon={CheckCircle2} label="Dibayar" value={formatMoney(affiliate.paidCommission)} />
              <StatCard icon={BarChart3} label="Rate Komisi" value={`${affiliate.commissionRate}%`} />
            </div>

            {/* Referral link */}
            <div className="bg-card border border-border rounded-2xl p-5">
              <h2 className="font-medium mb-3 flex items-center gap-2"><Link2 className="w-4 h-4" /> Link Afiliasi Anda</h2>
              <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-xl">
                <span className="text-sm text-muted-foreground flex-1 truncate font-mono">{affiliate.affiliateLink}</span>
                <button
                  onClick={copyLink}
                  className="shrink-0 p-1.5 hover:bg-muted rounded-lg transition-colors"
                  title="Salin link"
                >
                  <Copy className="w-4 h-4" />
                </button>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Kode:</span>
                <code className="text-xs bg-muted px-2 py-0.5 rounded font-mono">{affiliate.affiliateCode}</code>
                <button
                  onClick={() => setShowQr(!showQr)}
                  className="ml-auto text-xs flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
                >
                  <QrCode className="w-3.5 h-3.5" />
                  {showQr ? "Sembunyikan" : "Tampilkan"} QR
                </button>
              </div>
              {showQr && (
                <div className="mt-4 flex justify-center p-4 bg-white dark:bg-white/10 rounded-xl">
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(affiliate.affiliateLink)}`}
                    alt="QR Code"
                    className="w-32 h-32"
                  />
                </div>
              )}
            </div>

            {/* Marketing kit */}
            <div className="bg-card border border-border rounded-2xl p-5">
              <h2 className="font-medium mb-3 flex items-center gap-2"><Users className="w-4 h-4" /> Marketing Kit</h2>
              <div className="grid sm:grid-cols-2 gap-3">
                <KitItem title="Banner Digital" desc="1200×628px, 1080×1080px" />
                <KitItem title="Caption Sosial Media" desc="IG, Facebook, LinkedIn, Twitter" />
                <KitItem title="Email Template" desc="Siap kirim ke kontak Anda" />
                <KitItem title="Contoh Pitch" desc="Script untuk referral langsung" />
              </div>
              <p className="text-xs text-muted-foreground mt-3">Hubungi support untuk mendapatkan materi marketing kit.</p>
            </div>

            {/* Conversions */}
            {conversions.length > 0 && (
              <div className="bg-card border border-border rounded-2xl overflow-hidden">
                <div className="p-4 border-b border-border bg-muted/30">
                  <h2 className="font-medium">Riwayat Konversi</h2>
                </div>
                <div className="divide-y divide-border">
                  {conversions.map((c) => (
                    <div key={c.id} className="flex items-center justify-between p-4">
                      <div>
                        <p className="text-sm font-mono">{c.orderId.slice(0, 12)}…</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {new Date(c.createdAt).toLocaleDateString("id-ID")}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold">{formatMoney(c.commissionAmount)}</p>
                        <StatusBadge status={c.status} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </WorkspaceLayout>
  );
}

function StatCard({ icon: Icon, label, value, highlight }: { icon: typeof DollarSign; label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 ${highlight ? "border-primary/30 bg-primary/5" : "border-border bg-card"}`}>
      <div className="flex items-center gap-2 mb-1">
        <Icon className={`w-4 h-4 ${highlight ? "text-primary" : "text-muted-foreground"}`} />
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <p className={`text-lg font-semibold ${highlight ? "text-primary" : ""}`}>{value}</p>
    </div>
  );
}

function KitItem({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="border border-border rounded-lg p-3 bg-muted/20">
      <p className="text-sm font-medium">{title}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
    paid: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    rejected: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  };
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${map[status] ?? "bg-muted text-muted-foreground"}`}>
      {status}
    </span>
  );
}
