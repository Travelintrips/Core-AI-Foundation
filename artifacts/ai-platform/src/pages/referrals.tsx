/**
 * Referral System — Sprint P2.5
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Share2, Plus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

const HEADERS = () => {

  return { "Content-Type": "application/json", };
};
async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: HEADERS(), ...init });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<T>;
}

type Referral = {
  id: number; referrerProfileId: number; refereeProfileId?: number | null;
  referralCode: string; referralLink?: string | null;
  status: string; rewardType?: string | null; rewardAmount?: number | null;
  rewardStatus?: string | null; convertedAt?: string | null; createdAt: string;
};

const STATUS_CONFIG: Record<string, string> = {
  pending: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  converted: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  rewarded: "bg-green-500/10 text-green-400 border-green-500/20",
};

export default function ReferralsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [profileId, setProfileId] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["referrals"],
    queryFn: () => apiFetch<{ items: Referral[]; total: number }>("/api/ai/referrals"),
  });

  const generateMutation = useMutation({
    mutationFn: (customerProfileId: number) =>
      apiFetch("/api/ai/referrals/generate", {
        method: "POST",
        body: JSON.stringify({ customerProfileId }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["referrals"] });
      toast({ title: "Referral generated" });
      setOpen(false); setProfileId("");
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const pending = data?.items.filter((r) => r.status === "pending").length ?? 0;
  const converted = data?.items.filter((r) => r.status === "converted").length ?? 0;
  const rewarded = data?.items.filter((r) => r.status === "rewarded").length ?? 0;

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Share2 className="size-6 text-indigo-400" />Referral System</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Track and manage customer referrals and rewards</p>
        </div>
        <Button onClick={() => setOpen(true)}><Plus className="size-4 mr-2" />Generate Referral</Button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Pending", value: pending, color: "text-yellow-400" },
          { label: "Converted", value: converted, color: "text-blue-400" },
          { label: "Rewarded", value: rewarded, color: "text-green-400" },
        ].map((k) => (
          <Card key={k.label}>
            <CardContent className="p-4 text-center">
              <p className={`text-3xl font-bold ${k.color}`}>{k.value}</p>
              <p className="text-xs text-muted-foreground mt-1">{k.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">All Referrals ({data?.total ?? 0})</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-muted-foreground text-sm">Loading…</div>
          ) : data?.items.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">No referrals yet.</div>
          ) : (
            <div className="space-y-3">
              {data?.items.map((r) => (
                <div key={r.id} className="rounded-lg border border-border p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <code className="font-mono text-sm font-bold bg-muted px-2 py-0.5 rounded">{r.referralCode}</code>
                        <Badge className={`${STATUS_CONFIG[r.status] ?? ""} border text-xs`}>{r.status}</Badge>
                      </div>
                      <div className="flex gap-4 mt-1 text-xs text-muted-foreground">
                        <span>Referrer: Customer #{r.referrerProfileId}</span>
                        {r.refereeProfileId && <span>Referee: Customer #{r.refereeProfileId}</span>}
                        {r.rewardType && <span>Reward: {r.rewardType} {r.rewardAmount ? `(Rp ${r.rewardAmount.toLocaleString("id-ID")})` : ""}</span>}
                        {r.convertedAt && <span>Converted: {new Date(r.convertedAt).toLocaleDateString("id-ID")}</span>}
                      </div>
                      {r.referralLink && (
                        <p className="text-xs text-primary/70 mt-1 truncate max-w-sm">{r.referralLink}</p>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleDateString("id-ID")}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Generate Referral Code</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input type="number" placeholder="Customer Profile ID *" value={profileId} onChange={(e) => setProfileId(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => generateMutation.mutate(parseInt(profileId, 10))} disabled={!profileId || generateMutation.isPending}>
              {generateMutation.isPending ? "Generating…" : "Generate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
