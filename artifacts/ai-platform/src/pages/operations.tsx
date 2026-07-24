import { useState, useEffect, useCallback } from "react";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Crown,
  Building2,
  ListChecks,
  Users,
  Trophy,
  GraduationCap,
  TrendingUp,
  ScrollText,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Clock,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

const API = "";
const ADMIN_HEADERS = { "x-admin-api-key": import.meta.env.VITE_ADMIN_API_KEY ?? "" };

// ── Types ──────────────────────────────────────────────────────────────────

interface StatusCount { status: string; count: number }

interface DepartmentRow {
  id: number;
  departmentCode: string;
  departmentName: string;
  status: string;
  activePlans: number;
  employeeCount: number;
}

interface CapacityRow {
  employeeId: number;
  runningJobs: number;
  maxParallelJobs: number;
  queueLength: number;
  availability: number;
  loadPercentage: number;
  status: string;
}

interface PerformanceRow {
  employeeId: number;
  completedProjects: number;
  successRate: string;
  qualityScore: string;
  promotionScore: string;
  trainingRequired: boolean;
  experiencePoints: number;
  employee: { id: number; name: string } | null;
}

interface DecisionLog {
  id: number;
  executionPlanId: number | null;
  decisionBy: string;
  decisionType: string;
  reason: string | null;
  selectedEmployee: string | null;
  selectedDepartment: string | null;
  score: string | null;
  createdAt: string;
}

interface ExecutionPlan {
  id: number;
  projectId: string | null;
  projectType: string;
  objective: string;
  department: string;
  priority: string;
  status: string;
  createdAt: string;
}

interface TaskAssignment {
  id: number;
  executionPlanId: number;
  employeeId: number | null;
  taskName: string;
  status: string;
  priority: string;
  createdAt: string;
}

interface Summary {
  plansByStatus: StatusCount[];
  tasksByStatus: StatusCount[];
  departments: DepartmentRow[];
  capacity: CapacityRow[];
  topPerformers: PerformanceRow[];
  trainingCandidates: PerformanceRow[];
  promotionCandidates: PerformanceRow[];
  recentDecisions: DecisionLog[];
}

// ── Helpers ────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  active:              "border-green-500/30 text-green-400 bg-green-500/10",
  completed:           "border-sky-500/30 text-sky-400 bg-sky-500/10",
  failed:              "border-destructive/30 text-destructive bg-destructive/10",
  cancelled:           "border-muted text-muted-foreground",
  draft:               "border-muted text-muted-foreground",
  pending:             "border-amber-500/30 text-amber-400 bg-amber-500/10",
  in_progress:         "border-sky-500/30 text-sky-400 bg-sky-500/10",
  revision_requested:  "border-orange-500/30 text-orange-400 bg-orange-500/10",
};

function StatusPill({ status }: { status: string }) {
  const cls = STATUS_COLORS[status] ?? "border-muted text-muted-foreground";
  return (
    <Badge variant="outline" className={cn("font-mono text-[10px] uppercase", cls)}>
      {status.replace(/_/g, " ")}
    </Badge>
  );
}

function PriorityPill({ priority }: { priority: string }) {
  const colors: Record<string, string> = {
    critical: "border-destructive/30 text-destructive bg-destructive/10",
    high:     "border-orange-500/30 text-orange-400 bg-orange-500/10",
    normal:   "border-muted text-muted-foreground",
    low:      "border-muted text-muted-foreground",
  };
  return (
    <Badge variant="outline" className={cn("font-mono text-[10px] uppercase", colors[priority] ?? colors.normal)}>
      {priority}
    </Badge>
  );
}

function SummaryStat({ icon: Icon, label, value, accent }: { icon: typeof Crown; label: string; value: number | string; accent?: string }) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={cn("size-9 rounded-md flex items-center justify-center flex-shrink-0", accent ?? "bg-primary/10 text-primary")}>
          <Icon className="size-4" />
        </div>
        <div className="min-w-0">
          <p className="text-2xl font-bold leading-none">{value}</p>
          <p className="text-xs text-muted-foreground mt-1">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────

export default function Operations() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [plans, setPlans] = useState<ExecutionPlan[]>([]);
  const [tasks, setTasks] = useState<TaskAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [rebalancing, setRebalancing] = useState<number | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [summaryRes, plansRes, tasksRes] = await Promise.all([
        fetch(`${API}/api/ai/operations/summary`, { headers: ADMIN_HEADERS }),
        fetch(`${API}/api/ai/execution-plans`, { headers: ADMIN_HEADERS }),
        fetch(`${API}/api/ai/task-assignments`, { headers: ADMIN_HEADERS }),
      ]);
      if (summaryRes.ok) setSummary(await summaryRes.json());
      if (plansRes.ok) setPlans(await plansRes.json());
      if (tasksRes.ok) setTasks(await tasksRes.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleRebalance = async (departmentId: number) => {
    setRebalancing(departmentId);
    try {
      await fetch(`${API}/api/ai/workforce/${departmentId}/rebalance`, { method: "POST", headers: ADMIN_HEADERS });
      await fetchData();
    } finally {
      setRebalancing(null);
    }
  };

  const activePlanCount = summary?.plansByStatus.find((s) => s.status === "active")?.count ?? 0;
  const completedPlanCount = summary?.plansByStatus.find((s) => s.status === "completed")?.count ?? 0;
  const inProgressTaskCount = summary?.tasksByStatus.find((s) => s.status === "in_progress")?.count ?? 0;
  const failedTaskCount = summary?.tasksByStatus.find((s) => s.status === "failed")?.count ?? 0;

  return (
    <Layout>
      <div className="flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div className="h-14 border-b border-border flex items-center justify-between px-6 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Crown className="size-5 text-primary" />
            <h1 className="font-semibold text-lg">AI Operations Center</h1>
            <span className="text-[10px] uppercase tracking-widest font-mono bg-primary/10 text-primary px-1.5 py-0.5 rounded ml-1">
              Phase 4.9
            </span>
          </div>
          <Button size="sm" variant="outline" onClick={fetchData} disabled={loading}>
            <RefreshCw className={cn("size-3.5 mr-1.5", loading && "animate-spin")} />
            Refresh
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* CEO Status summary strip */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <SummaryStat icon={ListChecks} label="Active Execution Plans" value={activePlanCount} />
            <SummaryStat icon={CheckCircle2} label="Completed Plans" value={completedPlanCount} accent="bg-sky-500/10 text-sky-400" />
            <SummaryStat icon={Clock} label="Tasks In Progress" value={inProgressTaskCount} accent="bg-amber-500/10 text-amber-400" />
            <SummaryStat icon={XCircle} label="Failed Tasks" value={failedTaskCount} accent="bg-destructive/10 text-destructive" />
          </div>

          {/* Department Status */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Building2 className="size-4 text-primary" /> Department Status
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Department</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Employees</TableHead>
                    <TableHead className="text-right">Active Plans</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary?.departments.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell className="font-medium">{d.departmentName}</TableCell>
                      <TableCell><StatusPill status={d.status} /></TableCell>
                      <TableCell className="text-right font-mono">{d.employeeCount}</TableCell>
                      <TableCell className="text-right font-mono">{d.activePlans}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs"
                          disabled={rebalancing === d.id}
                          onClick={() => handleRebalance(d.id)}
                        >
                          {rebalancing === d.id ? "Rebalancing…" : "Rebalance"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {(!summary || summary.departments.length === 0) && !loading && (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">No departments seeded yet.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Running Execution Plans */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <ListChecks className="size-4 text-primary" /> Execution Plans
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Objective</TableHead>
                      <TableHead>Dept</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {plans.slice(0, 8).map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="max-w-[220px] truncate text-xs" title={p.objective}>{p.objective}</TableCell>
                        <TableCell className="text-xs font-mono">{p.department}</TableCell>
                        <TableCell><PriorityPill priority={p.priority} /></TableCell>
                        <TableCell><StatusPill status={p.status} /></TableCell>
                      </TableRow>
                    ))}
                    {plans.length === 0 && !loading && (
                      <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">No execution plans yet. They're created automatically when Creative AI projects run.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Task Assignments */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Users className="size-4 text-primary" /> Task Assignments
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Task</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tasks.slice(0, 8).map((t) => (
                      <TableRow key={t.id}>
                        <TableCell className="max-w-[220px] truncate text-xs">{t.taskName}</TableCell>
                        <TableCell><PriorityPill priority={t.priority} /></TableCell>
                        <TableCell><StatusPill status={t.status} /></TableCell>
                      </TableRow>
                    ))}
                    {tasks.length === 0 && !loading && (
                      <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-6">No task assignments yet.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Employee Capacity */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <TrendingUp className="size-4 text-primary" /> Employee Capacity
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {summary?.capacity.slice(0, 10).map((c) => (
                  <div key={c.employeeId} className="flex items-center gap-3">
                    <span className="text-xs font-mono text-muted-foreground w-16 flex-shrink-0">#{c.employeeId}</span>
                    <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all",
                          c.loadPercentage >= 90 ? "bg-destructive" : c.loadPercentage >= 60 ? "bg-amber-400" : "bg-green-500",
                        )}
                        style={{ width: `${Math.min(100, c.loadPercentage)}%` }}
                      />
                    </div>
                    <span className="text-xs font-mono w-20 text-right flex-shrink-0">{c.runningJobs}/{c.maxParallelJobs} jobs</span>
                  </div>
                ))}
                {(!summary || summary.capacity.length === 0) && !loading && (
                  <p className="text-center text-muted-foreground text-sm py-6">No capacity data yet.</p>
                )}
              </CardContent>
            </Card>

            {/* Leaderboard */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Trophy className="size-4 text-amber-400" /> Performance Leaderboard
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead className="text-right">Quality</TableHead>
                      <TableHead className="text-right">Success</TableHead>
                      <TableHead className="text-right">XP</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summary?.topPerformers.map((p) => (
                      <TableRow key={p.employeeId}>
                        <TableCell className="text-xs font-medium">{p.employee?.name ?? `#${p.employeeId}`}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{p.qualityScore}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{p.successRate}%</TableCell>
                        <TableCell className="text-right font-mono text-xs">{p.experiencePoints}</TableCell>
                      </TableRow>
                    ))}
                    {(!summary || summary.topPerformers.length === 0) && !loading && (
                      <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">No performance records yet.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Training / Promotion candidates */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <GraduationCap className="size-4 text-primary" /> Training & Promotion Candidates
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {summary?.trainingCandidates.map((p) => (
                  <div key={`t-${p.employeeId}`} className="flex items-center gap-2 text-xs">
                    <AlertTriangle className="size-3.5 text-orange-400 flex-shrink-0" />
                    <span className="flex-1 truncate">{p.employee?.name ?? `#${p.employeeId}`} — training required (success rate {p.successRate}%)</span>
                  </div>
                ))}
                {summary?.promotionCandidates.map((p) => (
                  <div key={`p-${p.employeeId}`} className="flex items-center gap-2 text-xs">
                    <Trophy className="size-3.5 text-amber-400 flex-shrink-0" />
                    <span className="flex-1 truncate">{p.employee?.name ?? `#${p.employeeId}`} — promotion candidate (score {p.promotionScore})</span>
                  </div>
                ))}
                {(!summary || (summary.trainingCandidates.length === 0 && summary.promotionCandidates.length === 0)) && !loading && (
                  <p className="text-center text-muted-foreground text-sm py-6">No candidates flagged yet.</p>
                )}
              </CardContent>
            </Card>

            {/* Decision Logs */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <ScrollText className="size-4 text-primary" /> Decision Logs
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 max-h-64 overflow-y-auto">
                {summary?.recentDecisions.map((d) => (
                  <div key={d.id} className="text-xs border-l-2 border-primary/30 pl-2 py-0.5">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[9px] font-mono uppercase">{d.decisionBy}</Badge>
                      <span className="text-muted-foreground">{d.decisionType.replace(/_/g, " ")}</span>
                    </div>
                    {d.reason && <p className="text-muted-foreground/80 mt-0.5 truncate" title={d.reason}>{d.reason}</p>}
                  </div>
                ))}
                {(!summary || summary.recentDecisions.length === 0) && !loading && (
                  <p className="text-center text-muted-foreground text-sm py-6">No decisions logged yet.</p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </Layout>
  );
}
