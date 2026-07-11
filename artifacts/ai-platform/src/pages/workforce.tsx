import { useState, useEffect, useCallback } from "react";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Users,
  Search,
  LayoutGrid,
  List,
  ChevronRight,
  X,
  Building2,
  Cpu,
  Zap,
  CheckCircle2,
  AlertCircle,
  WifiOff,
  Wrench,
  Star,
  Clock,
  DollarSign,
  BarChart3,
  ShieldCheck,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

const API = "";

// ── Types ──────────────────────────────────────────────────────────────────

interface Skill    { id: number; skillCode: string; skillName: string; category: string; proficiency?: number }
interface Tool     { id: number; toolCode: string; toolName: string; category: string }
interface Workload { runningJobs: number; queuedJobs: number; completedToday: number; failedToday: number; status: string; availability: number; averageLatency: string | null; averageCost: string | null }

interface Employee {
  id: number;
  employeeCode: string;
  employeeName: string;
  position: string;
  role: string;
  level: string;
  status: string;
  costCenter: string | null;
  salaryVirtual: string | null;
  hourlyCost: string | null;
  priority: number;
  maxParallelJobs: number;
  agentSlug: string | null;
  bio: string | null;
  avatarUrl: string | null;
  department: { id: number; name: string; code: string } | null;
  provider:   { id: number; name: string; slug: string } | null;
  model:      { id: number; name: string; modelId: string } | null;
  skills:     Skill[];
  workload:   Workload | null;
  // detail only
  tools?:       (Tool & { permissions: { read: boolean; write: boolean; execute: boolean } })[];
  supervisor?:  { id: number; name: string; position: string } | null;
  subordinates?: { id: number; name: string; position: string; status: string }[];
}

interface Department { id: number; departmentCode: string; departmentName: string; status: string; employeeCount: number }

// ── Status helpers ────────────────────────────────────────────────────────

const STATUS_META: Record<string, { label: string; className: string; Icon: typeof CheckCircle2 }> = {
  active:      { label: "Active",      className: "border-green-500/30 text-green-400 bg-green-500/10",   Icon: CheckCircle2 },
  busy:        { label: "Busy",        className: "border-yellow-500/30 text-yellow-400 bg-yellow-500/10", Icon: Zap },
  offline:     { label: "Offline",     className: "border-muted text-muted-foreground",                    Icon: WifiOff },
  maintenance: { label: "Maintenance", className: "border-orange-500/30 text-orange-400 bg-orange-500/10", Icon: Wrench },
  idle:        { label: "Idle",        className: "border-sky-500/30 text-sky-400 bg-sky-500/10",          Icon: Clock },
};

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? STATUS_META.offline;
  return (
    <Badge variant="outline" className={`font-mono text-[10px] uppercase gap-1 ${meta.className}`}>
      <meta.Icon className="size-2.5" />
      {meta.label}
    </Badge>
  );
}

const LEVEL_COLORS: Record<string, string> = {
  junior:   "bg-muted/60 text-muted-foreground",
  mid:      "bg-sky-500/10 text-sky-400",
  senior:   "bg-violet-500/10 text-violet-400",
  lead:     "bg-amber-500/10 text-amber-400",
  director: "bg-rose-500/10 text-rose-400",
};

const PROVIDER_COLORS: Record<string, string> = {
  openai:         "text-green-400",
  anthropic:      "text-orange-400",
  "google-gemini":"text-blue-400",
  replicate:      "text-purple-400",
};

function ProficiencyStars({ level }: { level: number }) {
  return (
    <div className="flex gap-0.5">
      {[1,2,3,4,5].map((i) => (
        <Star key={i} className={cn("size-2.5", i <= level ? "text-amber-400 fill-amber-400" : "text-muted-foreground/20")} />
      ))}
    </div>
  );
}

// ── Avatar placeholder ────────────────────────────────────────────────────

function EmployeeAvatar({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  const initials = name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  const sizeClass = size === "lg" ? "size-16 text-xl" : size === "sm" ? "size-8 text-xs" : "size-10 text-sm";
  const colors = ["from-violet-500 to-fuchsia-500","from-sky-500 to-blue-500","from-green-500 to-emerald-500","from-rose-500 to-pink-500","from-amber-500 to-orange-500"];
  const color = colors[name.charCodeAt(0) % colors.length];
  return (
    <div className={cn("rounded-full bg-gradient-to-br flex items-center justify-center font-bold text-white flex-shrink-0", sizeClass, color)}>
      {initials}
    </div>
  );
}

// ── Employee Card ─────────────────────────────────────────────────────────

function EmployeeCard({ emp, onClick }: { emp: Employee; onClick: () => void }) {
  return (
    <Card
      className="cursor-pointer hover:border-primary/50 hover:bg-sidebar/60 transition-all duration-200 group relative overflow-hidden"
      onClick={onClick}
    >
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity bg-gradient-to-br from-primary/5 to-transparent pointer-events-none" />
      <CardContent className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-start gap-3">
          <EmployeeAvatar name={emp.employeeName} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-semibold text-sm truncate">{emp.employeeName}</p>
              <ChevronRight className="size-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity ml-auto flex-shrink-0" />
            </div>
            <p className="text-xs text-muted-foreground truncate">{emp.position}</p>
          </div>
        </div>

        {/* Dept + level badges */}
        <div className="flex flex-wrap gap-1">
          {emp.department && (
            <Badge variant="outline" className="text-[10px] gap-1 border-border/50">
              <Building2 className="size-2.5" />
              {emp.department.name}
            </Badge>
          )}
          <Badge variant="outline" className={cn("text-[10px] font-mono uppercase", LEVEL_COLORS[emp.level] ?? "")}>
            {emp.level}
          </Badge>
          <StatusBadge status={emp.status} />
        </div>

        {/* Skills */}
        {emp.skills.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {emp.skills.slice(0, 3).map((s) => (
              <span key={s.id} className="text-[10px] px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground font-mono">
                {s.skillName}
              </span>
            ))}
            {emp.skills.length > 3 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted/30 text-muted-foreground font-mono">
                +{emp.skills.length - 3}
              </span>
            )}
          </div>
        )}

        {/* Provider + workload */}
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          {emp.provider && (
            <span className={cn("flex items-center gap-1 font-mono", PROVIDER_COLORS[emp.provider.slug] ?? "")}>
              <Cpu className="size-3" />
              {emp.provider.name}
            </span>
          )}
          {emp.workload && (
            <span className="flex items-center gap-1">
              <BarChart3 className="size-3" />
              {emp.workload.completedToday} today
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Employee Detail Panel ─────────────────────────────────────────────────

function DetailPanel({ emp, onClose }: { emp: Employee; onClose: () => void }) {
  const workloadStatus = emp.workload?.status ?? "idle";
  const wlMeta = STATUS_META[workloadStatus] ?? STATUS_META.idle;
  const hourlyCost = parseFloat(emp.hourlyCost ?? "0");
  const salary = parseFloat(emp.salaryVirtual ?? "0");

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-6 border-b border-border">
        <div className="flex items-start gap-4">
          <EmployeeAvatar name={emp.employeeName} size="lg" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-lg font-bold">{emp.employeeName}</h2>
              <StatusBadge status={emp.status} />
            </div>
            <p className="text-sm text-muted-foreground">{emp.position}</p>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              {emp.department && (
                <Badge variant="outline" className="text-[10px] gap-1">
                  <Building2 className="size-2.5" />
                  {emp.department.name}
                </Badge>
              )}
              <Badge variant="outline" className={cn("text-[10px] uppercase font-mono", LEVEL_COLORS[emp.level] ?? "")}>
                {emp.level}
              </Badge>
              <Badge variant="outline" className="text-[10px] font-mono">{emp.role}</Badge>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="size-8 flex-shrink-0" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>
        {emp.bio && <p className="text-sm text-muted-foreground mt-3 leading-relaxed">{emp.bio}</p>}
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">

        {/* Identifiers */}
        <section className="grid grid-cols-2 gap-3 text-sm">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wider font-mono">Code</p>
            <p className="font-mono text-xs">{emp.employeeCode}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wider font-mono">Cost Center</p>
            <p className="font-mono text-xs">{emp.costCenter ?? "—"}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wider font-mono">Max Jobs</p>
            <p className="font-mono text-xs">{emp.maxParallelJobs}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wider font-mono">Agent Slug</p>
            <p className="font-mono text-xs">{emp.agentSlug ?? "—"}</p>
          </div>
        </section>

        {/* Provider / Model */}
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
            <Cpu className="size-3" /> AI Backend
          </h3>
          <div className="rounded-lg border border-border bg-muted/10 p-3 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground text-xs">Provider</span>
              <span className={cn("font-mono text-xs", PROVIDER_COLORS[emp.provider?.slug ?? ""] ?? "")}>{emp.provider?.name ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground text-xs">Model</span>
              <span className="font-mono text-xs">{emp.model?.name ?? "—"}</span>
            </div>
          </div>
        </section>

        {/* Cost */}
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
            <DollarSign className="size-3" /> Cost Simulation
          </h3>
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: "Virtual Salary", value: `$${salary.toLocaleString()}`, sub: "per month" },
              { label: "Hourly Rate", value: `$${hourlyCost.toFixed(4)}`, sub: "per hour" },
            ].map((item) => (
              <div key={item.label} className="rounded-lg border border-border bg-muted/10 p-3 text-center">
                <p className="text-xs text-muted-foreground mb-1">{item.label}</p>
                <p className="text-base font-bold font-mono">{item.value}</p>
                <p className="text-[10px] text-muted-foreground">{item.sub}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Workload */}
        {emp.workload && (
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
              <BarChart3 className="size-3" /> Workload
            </h3>
            <div className="rounded-lg border border-border bg-muted/10 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Status</span>
                <Badge variant="outline" className={cn("text-[10px] uppercase gap-1", wlMeta.className)}>
                  <wlMeta.Icon className="size-2.5" />
                  {wlMeta.label}
                </Badge>
              </div>
              {[
                { label: "Running Jobs",     value: emp.workload.runningJobs },
                { label: "Queued Jobs",      value: emp.workload.queuedJobs },
                { label: "Completed Today",  value: emp.workload.completedToday },
                { label: "Failed Today",     value: emp.workload.failedToday },
                { label: "Availability",     value: `${emp.workload.availability}%` },
              ].map((item) => (
                <div key={item.label} className="flex justify-between text-xs">
                  <span className="text-muted-foreground">{item.label}</span>
                  <span className="font-mono">{item.value}</span>
                </div>
              ))}
              {emp.workload.averageLatency && (
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Avg Latency</span>
                  <span className="font-mono">{parseFloat(emp.workload.averageLatency).toFixed(0)}ms</span>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Skills */}
        {(emp.skills?.length ?? 0) > 0 && (
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
              <Star className="size-3" /> Skill Matrix
            </h3>
            <div className="space-y-2">
              {emp.skills.map((s) => (
                <div key={s.id} className="flex items-center justify-between rounded border border-border/50 bg-muted/5 px-3 py-2">
                  <div>
                    <p className="text-xs font-medium">{s.skillName}</p>
                    <p className="text-[10px] text-muted-foreground capitalize">{s.category}</p>
                  </div>
                  <ProficiencyStars level={s.proficiency ?? 3} />
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Tools */}
        {(emp.tools?.length ?? 0) > 0 && (
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
              <ShieldCheck className="size-3" /> Tool Permissions
            </h3>
            <div className="space-y-1.5">
              {emp.tools!.map((t) => (
                <div key={t.id} className="flex items-center justify-between rounded border border-border/50 bg-muted/5 px-3 py-2">
                  <div>
                    <p className="text-xs font-medium">{t.toolName}</p>
                    <p className="text-[10px] text-muted-foreground capitalize">{t.category?.replace(/_/g," ")}</p>
                  </div>
                  <div className="flex gap-1 text-[10px] font-mono">
                    {t.permissions.read    && <span className="px-1 py-0.5 rounded bg-sky-500/10 text-sky-400">R</span>}
                    {t.permissions.write   && <span className="px-1 py-0.5 rounded bg-green-500/10 text-green-400">W</span>}
                    {t.permissions.execute && <span className="px-1 py-0.5 rounded bg-violet-500/10 text-violet-400">X</span>}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Hierarchy */}
        {((emp as any).supervisor || ((emp as any).subordinates?.length ?? 0) > 0) && (
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
              <Users className="size-3" /> Hierarchy
            </h3>
            <div className="space-y-2">
              {(emp as any).supervisor && (
                <div className="flex items-center gap-2 rounded border border-border/50 bg-muted/5 px-3 py-2">
                  <EmployeeAvatar name={(emp as any).supervisor.name} size="sm" />
                  <div>
                    <p className="text-xs font-medium">{(emp as any).supervisor.name}</p>
                    <p className="text-[10px] text-muted-foreground">Supervisor · {(emp as any).supervisor.position}</p>
                  </div>
                </div>
              )}
              {((emp as any).subordinates ?? []).map((sub: any) => (
                <div key={sub.id} className="flex items-center gap-2 rounded border border-border/50 bg-muted/5 px-3 py-2 ml-4">
                  <EmployeeAvatar name={sub.name} size="sm" />
                  <div className="flex-1">
                    <p className="text-xs font-medium">{sub.name}</p>
                    <p className="text-[10px] text-muted-foreground">{sub.position}</p>
                  </div>
                  <StatusBadge status={sub.status} />
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────

export default function Workforce() {
  const [employees,   setEmployees]   = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [seeding,     setSeeding]     = useState(false);
  const [view,        setView]        = useState<"card" | "table">("card");
  const [selected,    setSelected]    = useState<Employee | null>(null);
  const [detailFull,  setDetailFull]  = useState<Employee | null>(null);
  const [search,      setSearch]      = useState("");
  const [filterDept,  setFilterDept]  = useState("all");
  const [filterStatus,setFilterStatus]= useState("all");

  const { toast } = useToast();

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [empRes, deptRes] = await Promise.all([
        fetch(`${API}/api/ai/workforce/employees`),
        fetch(`${API}/api/ai/workforce/departments`),
      ]);
      const [empData, deptData] = await Promise.all([empRes.json(), deptRes.json()]);
      setEmployees(Array.isArray(empData) ? empData : []);
      setDepartments(Array.isArray(deptData) ? deptData : []);
    } catch {
      toast({ title: "Error", description: "Failed to load workforce data", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const fetchDetail = useCallback(async (emp: Employee) => {
    setSelected(emp);
    setDetailFull(null);
    try {
      const res  = await fetch(`${API}/api/ai/workforce/employees/${emp.id}`);
      const data = await res.json();
      setDetailFull(data);
    } catch {
      setDetailFull(emp);
    }
  }, []);

  const handleSeed = async () => {
    setSeeding(true);
    try {
      const res  = await fetch(`${API}/api/ai/seed/all`, { method: "POST" });
      const data = await res.json();
      toast({ title: "Seed complete", description: `${data.workforce?.employees ?? 0} employees, ${data.workforce?.departments ?? 0} departments seeded.` });
      await fetchData();
    } catch {
      toast({ title: "Seed failed", variant: "destructive" });
    } finally {
      setSeeding(false);
    }
  };

  // Filtered employees
  const filtered = employees.filter((e) => {
    if (filterDept   !== "all" && e.department?.code !== filterDept) return false;
    if (filterStatus !== "all" && e.status !== filterStatus)          return false;
    if (search) {
      const q = search.toLowerCase();
      return e.employeeName.toLowerCase().includes(q) || e.position.toLowerCase().includes(q);
    }
    return true;
  });

  // Stats
  const activeCount   = employees.filter((e) => e.status === "active").length;
  const deptCount     = departments.length;
  const totalJobsToday = employees.reduce((s, e) => s + (e.workload?.completedToday ?? 0), 0);

  return (
    <Layout>
      <div className="flex h-full">

        {/* Main area */}
        <div className={cn("flex-1 min-w-0 flex flex-col overflow-hidden transition-all", selected ? "border-r border-border" : "")}>

          {/* Page header */}
          <div className="border-b border-border bg-background/60 px-6 py-4 flex-shrink-0">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="size-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
                  <Users className="size-4 text-primary" />
                </div>
                <div>
                  <h1 className="text-lg font-bold">AI Workforce</h1>
                  <p className="text-xs text-muted-foreground">Digital Employee Directory</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={fetchData} disabled={loading}>
                  <RefreshCw className={cn("size-3.5 mr-1", loading && "animate-spin")} />
                  Refresh
                </Button>
                {employees.length === 0 && (
                  <Button size="sm" onClick={handleSeed} disabled={seeding}>
                    {seeding ? <RefreshCw className="size-3.5 mr-1 animate-spin" /> : <Zap className="size-3.5 mr-1" />}
                    Seed Workforce
                  </Button>
                )}
              </div>
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-4 gap-3 mt-4">
              {[
                { label: "Total Employees", value: employees.length, icon: Users,      color: "text-primary" },
                { label: "Active Now",      value: activeCount,       icon: CheckCircle2,color: "text-green-400" },
                { label: "Departments",     value: deptCount,          icon: Building2,  color: "text-sky-400" },
                { label: "Jobs Today",      value: totalJobsToday,     icon: BarChart3,  color: "text-violet-400" },
              ].map((s) => (
                <div key={s.label} className="rounded-lg border border-border bg-muted/10 px-3 py-2">
                  <div className="flex items-center gap-1.5">
                    <s.icon className={cn("size-3", s.color)} />
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{s.label}</span>
                  </div>
                  <p className={cn("text-xl font-bold mt-0.5 font-mono", s.color)}>{s.value}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Filters */}
          <div className="flex items-center gap-2 px-6 py-3 border-b border-border flex-shrink-0 bg-background/40">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <Input
                placeholder="Search employees..."
                className="pl-8 h-8 text-sm"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <Select value={filterDept} onValueChange={setFilterDept}>
              <SelectTrigger className="h-8 w-40 text-xs">
                <SelectValue placeholder="Department" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Departments</SelectItem>
                {departments.map((d) => (
                  <SelectItem key={d.departmentCode} value={d.departmentCode}>
                    {d.departmentName}
                    {d.employeeCount > 0 && <span className="ml-1 text-muted-foreground">({d.employeeCount})</span>}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="h-8 w-36 text-xs">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="busy">Busy</SelectItem>
                <SelectItem value="offline">Offline</SelectItem>
                <SelectItem value="maintenance">Maintenance</SelectItem>
              </SelectContent>
            </Select>

            <div className="ml-auto flex items-center gap-1">
              <Button
                variant={view === "card" ? "secondary" : "ghost"}
                size="icon"
                className="size-8"
                onClick={() => setView("card")}
              >
                <LayoutGrid className="size-3.5" />
              </Button>
              <Button
                variant={view === "table" ? "secondary" : "ghost"}
                size="icon"
                className="size-8"
                onClick={() => setView("table")}
              >
                <List className="size-3.5" />
              </Button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center h-48 text-muted-foreground">
                <RefreshCw className="size-5 animate-spin mr-2" />
                Loading workforce...
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-center">
                <Users className="size-12 text-muted-foreground/30 mb-4" />
                <p className="text-muted-foreground text-sm">No employees found</p>
                {employees.length === 0 && (
                  <div className="mt-4 space-y-2">
                    <p className="text-xs text-muted-foreground max-w-xs">Seed the database to create Digital Workforce employees.</p>
                    <Button size="sm" onClick={handleSeed} disabled={seeding}>
                      {seeding ? <RefreshCw className="size-3.5 mr-1 animate-spin" /> : <Zap className="size-3.5 mr-1" />}
                      Seed Workforce
                    </Button>
                  </div>
                )}
              </div>
            ) : view === "card" ? (
              <div className="p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {filtered.map((emp) => (
                  <EmployeeCard
                    key={emp.id}
                    emp={emp}
                    onClick={() => fetchDetail(emp)}
                  />
                ))}
              </div>
            ) : (
              <div className="p-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-48">Employee</TableHead>
                      <TableHead>Position</TableHead>
                      <TableHead>Department</TableHead>
                      <TableHead>Level</TableHead>
                      <TableHead>Provider</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Jobs Today</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((emp) => (
                      <TableRow
                        key={emp.id}
                        className="cursor-pointer hover:bg-muted/30"
                        onClick={() => fetchDetail(emp)}
                      >
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <EmployeeAvatar name={emp.employeeName} size="sm" />
                            <div>
                              <p className="font-medium text-sm">{emp.employeeName}</p>
                              <p className="text-[10px] text-muted-foreground font-mono">{emp.employeeCode}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{emp.position}</TableCell>
                        <TableCell>
                          {emp.department && (
                            <Badge variant="outline" className="text-[10px]">{emp.department.name}</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={cn("text-[10px] font-mono uppercase", LEVEL_COLORS[emp.level] ?? "")}>
                            {emp.level}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <span className={cn("text-xs font-mono", PROVIDER_COLORS[emp.provider?.slug ?? ""] ?? "text-muted-foreground")}>
                            {emp.provider?.name ?? "—"}
                          </span>
                        </TableCell>
                        <TableCell><StatusBadge status={emp.status} /></TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {emp.workload?.completedToday ?? 0}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </div>

        {/* Detail slide-over */}
        {selected && (
          <div className="w-96 flex-shrink-0 overflow-hidden flex flex-col bg-sidebar">
            <DetailPanel
              emp={detailFull ?? selected}
              onClose={() => { setSelected(null); setDetailFull(null); }}
            />
          </div>
        )}
      </div>
    </Layout>
  );
}
