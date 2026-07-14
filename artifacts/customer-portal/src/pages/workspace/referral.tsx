import { useParams, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { WorkspaceLayout } from "@/components/workspace-layout";
import { useToast } from "@/hooks/use-toast";
import {
  Link2, Gift, Users, TrendingUp, Copy, Loader2,
  CheckCircle2, Clock, Share2, ChevronRight, ArrowLeft,
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

type ReferralProfile = {
  referralCode: string;
  referralLink: string;
  rewardType: string;
  rewardAmount: number;
  rewardStatus: string;
  status: string;
  convertedAt: string | null;
};

type ReferralStats = {
  totalReferrals: number;
  pendingReferrals: number;
  convertedReferrals: number;
  totalRewardEarned: number;
};

export default function ReferralWorkspacePage() {
  const { token } = useParams<{ token: string }>();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: referral, isLoading } = useQuery<ReferralProfile | null>({
    queryKey: ["workspace", token, "referral"],
    queryFn: () => wsFetch<ReferralProfile | null>(token, "/referral"),
    enabled: !!token,
  });

  const { data: stats } = useQuery<ReferralStats>({
    queryKey: ["workspace", token, "referral", "stats"],
    queryFn: () => wsFetch<ReferralStats>(token, "/referral/stats"),
    enabled: !!token,
  });

  const { data: history = [] } = useQuery<ReferralProfile[]>({
    queryKey: ["workspace", token, "referral", "history"],
    queryFn: () => wsFetch<ReferralProfile[]>(token, "/referral/history"),
    enabled: !!token && !!referral,
  });

  const generateReferral = useMutation({
    mutationFn: () => wsFetch<ReferralProfile>(token, "/referral/generate", { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspace", token, "referral"] });
      toast({ title: "Referral link berhasil dibuat!" });
    },
    onError: (err) => toast({ title: "Gagal", description: String((err as Error)?.message ?? err), variant: "destructive" }),
  });

  const copyLink = () => {
    if (!referral?.referralLink) return;
    navigator.clipboard.writeText(referral.referralLink).then(() =>
      toast({ title: "Link tersalin!" }),
    );
  };

  const shareLink = async () => {
    if (!referral?.referralLink) return;
    if (navigator.share) {
      await navigator.share({ title: "AI Creative Studio", text: "Coba layanan AI terbaik!", url: referral.referralLink });
    } else {
      copyLink();
    }
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
        <h1 className="text-2xl font-serif font-semibold mb-1">Referral Center</h1>
        <p className="text-sm text-muted-foreground mb-8">
          Undang teman dan dapatkan reward saat mereka menjadi pelanggan.
        </p>

        {isLoading ? (
          <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : !referral ? (
          // Generate CTA
          <div className="bg-card border border-border rounded-2xl p-8 text-center">
            <div className="w-14 h-14 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <Gift className="w-7 h-7 text-primary" />
            </div>
            <h2 className="font-serif text-xl font-medium mb-2">Buat Link Referral Anda</h2>
            <p className="text-sm text-muted-foreground mb-6 max-w-sm mx-auto">
              Bagikan link unik Anda kepada teman. Saat mereka mendaftar dan memesan, Anda mendapatkan reward.
            </p>
            <button
              onClick={() => generateReferral.mutate()}
              disabled={generateReferral.isPending}
              className="inline-flex items-center gap-2 px-6 py-2.5 bg-primary text-primary-foreground font-medium rounded-xl hover:bg-primary/90 disabled:opacity-60 transition-colors"
            >
              {generateReferral.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Gift className="w-4 h-4" />}
              Buat Link Referral
            </button>
          </div>
        ) : (
          <div className="space-y-5">
            {/* Stats */}
            {stats && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <MiniStat icon={Users} label="Total Referral" value={stats.totalReferrals} />
                <MiniStat icon={Clock} label="Menunggu" value={stats.pendingReferrals} />
                <MiniStat icon={CheckCircle2} label="Berhasil" value={stats.convertedReferrals} />
                <MiniStat icon={Gift} label="Reward" value={formatMoney(stats.totalRewardEarned)} />
              </div>
            )}

            {/* Link card */}
            <div className="bg-card border border-border rounded-2xl p-5">
              <h2 className="font-medium mb-3 flex items-center gap-2"><Link2 className="w-4 h-4" /> Link Referral Anda</h2>
              <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-xl mb-3">
                <span className="text-sm text-muted-foreground flex-1 truncate font-mono text-xs">{referral.referralLink}</span>
                <button onClick={copyLink} className="shrink-0 p-1.5 hover:bg-muted rounded-lg transition-colors" title="Salin">
                  <Copy className="w-4 h-4" />
                </button>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={copyLink}
                  className="flex-1 flex items-center justify-center gap-2 py-2 border border-border rounded-xl text-sm hover:bg-muted/50 transition-colors"
                >
                  <Copy className="w-3.5 h-3.5" /> Salin Link
                </button>
                <button
                  onClick={shareLink}
                  className="flex-1 flex items-center justify-center gap-2 py-2 bg-primary text-primary-foreground rounded-xl text-sm hover:bg-primary/90 transition-colors"
                >
                  <Share2 className="w-3.5 h-3.5" /> Bagikan
                </button>
              </div>
            </div>

            {/* Reward info */}
            <div className="bg-card border border-border rounded-2xl p-5">
              <h2 className="font-medium mb-3 flex items-center gap-2"><Gift className="w-4 h-4" /> Reward Anda</h2>
              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-muted-foreground">Tipe Reward</span>
                <span className="text-sm font-medium capitalize">{referral.rewardType}</span>
              </div>
              {Number(referral.rewardAmount) > 0 && (
                <div className="flex items-center justify-between py-2 border-t border-border">
                  <span className="text-sm text-muted-foreground">Jumlah</span>
                  <span className="text-sm font-semibold">{formatMoney(referral.rewardAmount)}</span>
                </div>
              )}
              <div className="flex items-center justify-between py-2 border-t border-border">
                <span className="text-sm text-muted-foreground">Status</span>
                <RewardBadge status={referral.rewardStatus} />
              </div>
            </div>

            {/* Referral history */}
            {history.length > 0 && (
              <div className="bg-card border border-border rounded-2xl overflow-hidden">
                <div className="p-4 border-b border-border bg-muted/30">
                  <h2 className="font-medium flex items-center gap-2">
                    <TrendingUp className="w-4 h-4" /> Riwayat Referral
                  </h2>
                </div>
                <div className="divide-y divide-border">
                  {history.map((ref, idx) => (
                    <div key={idx} className="flex items-center justify-between p-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-muted rounded-full flex items-center justify-center">
                          <Users className="w-4 h-4 text-muted-foreground" />
                        </div>
                        <div>
                          <p className="text-sm font-medium">Referral #{idx + 1}</p>
                          <p className="text-xs text-muted-foreground capitalize">{ref.status}</p>
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
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

function MiniStat({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: number | string }) {
  return (
    <div className="bg-card border border-border rounded-xl p-3">
      <Icon className="w-4 h-4 text-muted-foreground mb-1" />
      <p className="text-lg font-semibold">{typeof value === "number" ? value.toLocaleString() : value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function RewardBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
    issued: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    claimed: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${map[status] ?? "bg-muted text-muted-foreground"}`}>
      {status}
    </span>
  );
}
