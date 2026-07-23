import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, Users, Mail, Building2, ArrowUpRight } from "lucide-react";

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

type ServiceRequest = {
  id: number;
  requestId: string;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  companyName: string | null;
  status: string;
  total: string;
  currency: string;
  createdAt: string;
};

type CustomerSummary = {
  email: string;
  name: string;
  company: string | null;
  phone: string | null;
  requestCount: number;
  latestStatus: string;
  totalRevenue: number;
  currency: string;
  firstSeen: string;
  lastSeen: string;
};

function buildCustomerList(requests: ServiceRequest[]): CustomerSummary[] {
  const map = new Map<string, CustomerSummary>();
  for (const r of requests) {
    const existing = map.get(r.customerEmail);
    const amount = parseFloat(r.total) || 0;
    if (!existing) {
      map.set(r.customerEmail, {
        email: r.customerEmail,
        name: r.customerName,
        company: r.companyName,
        phone: r.customerPhone ?? null,
        requestCount: 1,
        latestStatus: r.status,
        totalRevenue: amount,
        currency: r.currency,
        firstSeen: r.createdAt,
        lastSeen: r.createdAt,
      });
    } else {
      existing.requestCount++;
      existing.totalRevenue += amount;
      if (r.createdAt > existing.lastSeen) {
        existing.lastSeen = r.createdAt;
        existing.latestStatus = r.status;
      }
      if (r.createdAt < existing.firstSeen) existing.firstSeen = r.createdAt;
    }
  }
  return Array.from(map.values()).sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
}

function fmt(n: number, currency = "IDR") {
  if (currency === "IDR") return `Rp${Math.round(n).toLocaleString("id-ID")}`;
  return `${currency} ${n.toLocaleString()}`;
}

const STATUS_COLOR: Record<string, string> = {
  completed: "bg-green-500/15 text-green-400 border-green-500/30",
  in_progress: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  waiting_customer_approval: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  draft: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
  cancelled: "bg-red-500/15 text-red-400 border-red-500/30",
};

export default function Customers() {
  const [search, setSearch] = useState("");

  const { data: requests, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["customers", "service-requests"],
    queryFn: () => apiFetch<ServiceRequest[]>("/api/ai/catalog/requests"),
    refetchInterval: 60_000,
  });

  const customers = buildCustomerList(requests ?? []).filter(
    (c) =>
      !search ||
      c.email.toLowerCase().includes(search.toLowerCase()) ||
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      (c.company ?? "").toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6" data-testid="page-customers">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Users className="w-6 h-6" /> Customers
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            All unique customers derived from service requests — canonical source of truth.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Search name, email, company…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="text-xs px-3 py-1.5 rounded-lg border border-border bg-muted/20 focus:outline-none focus:ring-1 focus:ring-primary w-64"
            data-testid="input-search-customers"
          />
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`w-4 h-4 mr-1.5 ${isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Total Customers", value: customers.length, icon: Users },
          { label: "Active (in progress)", value: customers.filter((c) => ["in_progress", "waiting_review", "orchestrating"].includes(c.latestStatus)).length, icon: ArrowUpRight },
          { label: "Completed", value: customers.filter((c) => c.latestStatus === "completed").length, icon: Building2 },
        ].map(({ label, value, icon: Icon }) => (
          <div key={label} className="border border-border rounded-xl p-4 bg-card/40 flex items-center gap-3">
            <Icon className="w-5 h-5 text-muted-foreground flex-shrink-0" />
            <div>
              <div className="text-xl font-bold font-mono">{value}</div>
              <div className="text-xs text-muted-foreground">{label}</div>
            </div>
          </div>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : customers.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground text-sm">No customers found.</div>
      ) : (
        <div className="border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm" data-testid="table-customers">
            <thead>
              <tr className="border-b border-border bg-muted/20 text-xs text-muted-foreground uppercase tracking-wide">
                <th className="text-left px-4 py-2.5">Customer</th>
                <th className="text-left px-4 py-2.5">Email</th>
                <th className="text-left px-4 py-2.5">Company</th>
                <th className="text-right px-4 py-2.5">Requests</th>
                <th className="text-right px-4 py-2.5">Revenue</th>
                <th className="text-left px-4 py-2.5">Latest Status</th>
                <th className="text-left px-4 py-2.5">Last Seen</th>
                <th className="text-right px-4 py-2.5">Actions</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.email} className="border-b border-border/50 hover:bg-muted/5 transition-colors" data-testid={`row-customer-${c.email}`}>
                  <td className="px-4 py-3 font-medium">{c.name}</td>
                  <td className="px-4 py-3 text-xs font-mono text-muted-foreground">
                    <a href={`mailto:${c.email}`} className="flex items-center gap-1 hover:text-primary">
                      <Mail className="w-3 h-3" /> {c.email}
                    </a>
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">{c.company ?? "—"}</td>
                  <td className="px-4 py-3 text-right font-mono text-sm">{c.requestCount}</td>
                  <td className="px-4 py-3 text-right font-mono text-sm text-green-400">
                    {fmt(c.totalRevenue, c.currency)}
                  </td>
                  <td className="px-4 py-3">
                    <Badge className={`text-[10px] border font-mono px-1.5 py-0 h-4 ${STATUS_COLOR[c.latestStatus] ?? "bg-muted text-muted-foreground border-border"}`}>
                      {c.latestStatus}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground font-mono">
                    {new Date(c.lastSeen).toLocaleDateString("id-ID")}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end">
                      <a href={`/api/ai/customer-workspace/${encodeURIComponent(c.email)}`} target="_blank" rel="noopener noreferrer">
                        <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" data-testid={`button-view-workspace-${c.email}`}>
                          <ArrowUpRight className="w-3 h-3 mr-1" /> Workspace
                        </Button>
                      </a>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
