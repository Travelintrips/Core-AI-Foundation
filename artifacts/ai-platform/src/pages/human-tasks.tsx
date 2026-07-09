import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListHumanTasks,
  useGetHumanTaskStats,
  useGetHumanTask,
  useAssignHumanTask,
  useAcceptHumanTask,
  useRejectHumanTask,
  useCompleteHumanTask,
  useReassignHumanTask,
  getListHumanTasksQueryKey,
  getGetHumanTaskStatsQueryKey,
  getGetHumanTaskQueryKey,
} from "@workspace/api-client-react";
import type { HumanTask, ListHumanTasksParams } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  ClipboardCheck,
  Clock,
  Users,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RefreshCw,
  ChevronRight,
  UserCheck,
  BarChart2,
  Building2,
  Filter,
} from "lucide-react";

// ── Helpers ────────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  pending:     "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  assigned:    "bg-blue-500/15 text-blue-400 border-blue-500/30",
  accepted:    "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
  in_progress: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  completed:   "bg-green-500/15 text-green-400 border-green-500/30",
  rejected:    "bg-red-500/15 text-red-400 border-red-500/30",
  cancelled:   "bg-muted text-muted-foreground",
  expired:     "bg-orange-500/15 text-orange-400 border-orange-500/30",
};

const SLA_COLORS: Record<string, string> = {
  on_time: "text-green-400",
  warning: "text-yellow-400",
  overdue: "text-red-400",
  expired: "text-red-500",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cn("text-xs px-2 py-0.5 rounded-full border font-mono", STATUS_COLORS[status] ?? "bg-muted text-muted-foreground")}>
      {status.replace("_", " ")}
    </span>
  );
}

function SlaIndicator({ slaStatus, dueAt }: { slaStatus: string; dueAt?: string | null }) {
  if (!dueAt) return null;
  const due = new Date(dueAt);
  const now = new Date();
  const diffMs = due.getTime() - now.getTime();
  const diffH = Math.round(diffMs / (1000 * 60 * 60));
  return (
    <span className={cn("text-xs font-mono", SLA_COLORS[slaStatus] ?? "text-muted-foreground")}>
      {slaStatus === "overdue" || slaStatus === "expired"
        ? "Overdue"
        : diffH > 0
        ? `${diffH}h remaining`
        : "Due now"}
    </span>
  );
}

function priorityLabel(p: number): string {
  if (p >= 80) return "Critical";
  if (p >= 60) return "High";
  if (p >= 40) return "Medium";
  return "Low";
}

function priorityColor(p: number): string {
  if (p >= 80) return "text-red-400";
  if (p >= 60) return "text-orange-400";
  if (p >= 40) return "text-yellow-400";
  return "text-muted-foreground";
}

// ── Stat Card ──────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: number | string;
  icon: React.ElementType;
  color?: string;
}) {
  return (
    <Card className="bg-card border-border">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">{label}</p>
            <p className={cn("text-2xl font-bold font-mono", color ?? "text-foreground")}>{value}</p>
          </div>
          <Icon className={cn("size-8 opacity-30", color)} />
        </div>
      </CardContent>
    </Card>
  );
}

// ── Task Detail Dialog ─────────────────────────────────────────────────────────

function TaskDetailDialog({
  taskId,
  open,
  onClose,
}: {
  taskId: number | null;
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [notes, setNotes] = useState("");
  const [assignUser, setAssignUser] = useState("");
  const [assignRole, setAssignRole] = useState("");

  const { data, isLoading } = useGetHumanTask(taskId ?? 0, {
    query: { enabled: open && taskId !== null, queryKey: getGetHumanTaskQueryKey(taskId ?? 0) },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getListHumanTasksQueryKey() });
    qc.invalidateQueries({ queryKey: getGetHumanTaskStatsQueryKey() });
    if (taskId) qc.invalidateQueries({ queryKey: getGetHumanTaskQueryKey(taskId) });
  };

  const accept   = useAcceptHumanTask({ mutation: { onSuccess: invalidate } });
  const reject   = useRejectHumanTask({ mutation: { onSuccess: invalidate } });
  const complete = useCompleteHumanTask({ mutation: { onSuccess: invalidate } });
  const reassign = useReassignHumanTask({ mutation: { onSuccess: invalidate } });
  const assign   = useAssignHumanTask({ mutation: { onSuccess: invalidate } });

  if (!open || !taskId) return null;

  const task = data?.task;
  const history = data?.history ?? [];
  const isTerminal = task && ["completed", "rejected", "cancelled", "expired"].includes(task.status);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3 font-mono">
            <ClipboardCheck className="size-5 text-primary" />
            {task?.taskCode ?? "Loading…"}
          </DialogTitle>
        </DialogHeader>

        {isLoading && <p className="text-muted-foreground text-sm py-8 text-center">Loading task…</p>}

        {task && (
          <div className="space-y-5">
            {/* Meta */}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Status</p>
                <StatusBadge status={task.status} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">SLA</p>
                <SlaIndicator slaStatus={task.slaStatus} dueAt={task.dueAt} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Source</p>
                <span className="font-mono text-xs">{task.sourceModule} / {task.sourceType}</span>
                {task.sourceId && <span className="text-muted-foreground"> #{task.sourceId}</span>}
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Priority</p>
                <span className={cn("font-mono text-xs", priorityColor(task.priority))}>
                  {priorityLabel(task.priority)} ({task.priority})
                </span>
              </div>
              {task.assignedDepartment && (
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Department</p>
                  <span className="text-xs">{task.assignedDepartment}</span>
                </div>
              )}
              {task.assignedUser && (
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Assigned to</p>
                  <span className="text-xs">{task.assignedUser}</span>
                </div>
              )}
              {task.assignedRole && (
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Role</p>
                  <span className="text-xs">{task.assignedRole}</span>
                </div>
              )}
              {task.dueAt && (
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Due</p>
                  <span className="text-xs">{new Date(task.dueAt).toLocaleString()}</span>
                </div>
              )}
            </div>

            {/* Reason + Instructions */}
            {task.reason && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Reason</p>
                <p className="text-sm bg-muted/40 rounded p-2">{task.reason}</p>
              </div>
            )}
            {task.instructions && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Instructions</p>
                <p className="text-sm bg-muted/40 rounded p-2 whitespace-pre-wrap">{task.instructions}</p>
              </div>
            )}

            {/* Payload */}
            {task.payloadJson && Object.keys(task.payloadJson).length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Payload</p>
                <pre className="text-xs bg-muted/40 rounded p-3 overflow-x-auto font-mono text-foreground/80">
                  {JSON.stringify(task.payloadJson, null, 2)}
                </pre>
              </div>
            )}

            {/* Actions */}
            {!isTerminal && (
              <div className="border border-border rounded-lg p-4 space-y-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Actions</p>
                <Textarea
                  placeholder="Notes (optional)…"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  className="text-sm"
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-cyan-400 border-cyan-500/30"
                    onClick={() => accept.mutate({ id: taskId, data: { notes: notes || undefined } })}
                    disabled={accept.isPending || task.status === "accepted"}
                  >
                    <UserCheck className="size-3 mr-1" /> Accept
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-green-400 border-green-500/30"
                    onClick={() => complete.mutate({ id: taskId, data: { notes: notes || undefined } })}
                    disabled={complete.isPending}
                  >
                    <CheckCircle2 className="size-3 mr-1" /> Complete
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-red-400 border-red-500/30"
                    onClick={() => reject.mutate({ id: taskId, data: { notes: notes || undefined } })}
                    disabled={reject.isPending}
                  >
                    <XCircle className="size-3 mr-1" /> Reject
                  </Button>
                </div>

                {/* Reassign */}
                <div className="border-t border-border pt-3 space-y-2">
                  <p className="text-xs text-muted-foreground">Reassign</p>
                  <div className="flex gap-2">
                    <Input
                      placeholder="User / email"
                      value={assignUser}
                      onChange={(e) => setAssignUser(e.target.value)}
                      className="text-sm h-8 flex-1"
                    />
                    <Select value={assignRole} onValueChange={setAssignRole}>
                      <SelectTrigger className="h-8 w-40 text-xs">
                        <SelectValue placeholder="Role" />
                      </SelectTrigger>
                      <SelectContent>
                        {["Designer","Marketing","Finance","HR","Tax","Legal","Sales","Supervisor","Manager","Administrator"].map((r) => (
                          <SelectItem key={r} value={r} className="text-xs">{r}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8"
                      onClick={() => {
                        reassign.mutate({
                          id: taskId,
                          data: {
                            assignedUser: assignUser || undefined,
                            assignedRole: assignRole || undefined,
                            notes: notes || undefined,
                          },
                        });
                        setAssignUser("");
                        setAssignRole("");
                      }}
                      disabled={reassign.isPending || (!assignUser && !assignRole)}
                    >
                      <RefreshCw className="size-3" />
                    </Button>
                  </div>
                </div>

                {/* Assign (if unassigned) */}
                {task.status === "pending" && (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-blue-400 border-blue-500/30"
                      onClick={() =>
                        assign.mutate({
                          id: taskId,
                          data: {
                            assignedUser: assignUser || undefined,
                            assignedRole: assignRole || undefined,
                            notes: notes || undefined,
                          },
                        })
                      }
                      disabled={assign.isPending || (!assignUser && !assignRole)}
                    >
                      <Users className="size-3 mr-1" /> Assign
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* History / Timeline */}
            {history.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Timeline</p>
                <div className="space-y-2">
                  {history.map((h) => (
                    <div key={h.id} className="flex gap-3 text-sm">
                      <div className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-primary">{h.action}</span>
                          {h.newStatus && (
                            <ChevronRight className="size-3 text-muted-foreground" />
                          )}
                          {h.newStatus && <StatusBadge status={h.newStatus} />}
                          <span className="text-xs text-muted-foreground ml-auto">
                            {new Date(h.createdAt).toLocaleString()}
                          </span>
                        </div>
                        {h.performedBy && (
                          <p className="text-xs text-muted-foreground">by {h.performedBy}</p>
                        )}
                        {h.notes && (
                          <p className="text-xs text-foreground/70 mt-0.5">{h.notes}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function HumanTasksPage() {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [filters, setFilters] = useState<ListHumanTasksParams>({ limit: 50, offset: 0 });
  const [statusFilter, setStatusFilter] = useState("__all__");
  const [deptFilter, setDeptFilter] = useState("__all__");
  const [slaFilter, setSlaFilter] = useState("__all__");
  const [moduleFilter, setModuleFilter] = useState("__all__");

  const queryParams: ListHumanTasksParams = {
    ...filters,
    status:       statusFilter !== "__all__" ? statusFilter : undefined,
    department:   deptFilter   !== "__all__" ? deptFilter   : undefined,
    slaStatus:    slaFilter    !== "__all__" ? slaFilter    : undefined,
    sourceModule: moduleFilter !== "__all__" ? moduleFilter : undefined,
  };

  const { data: statsData } = useGetHumanTaskStats({ query: { refetchInterval: 15000, queryKey: getGetHumanTaskStatsQueryKey() } });
  const { data: listData, isLoading } = useListHumanTasks(queryParams, {
    query: { refetchInterval: 10000, queryKey: getListHumanTasksQueryKey(queryParams) },
  });

  const tasks: HumanTask[] = listData?.items ?? [];
  const stats = statsData;

  function refresh() {
    qc.invalidateQueries({ queryKey: getListHumanTasksQueryKey() });
    qc.invalidateQueries({ queryKey: getGetHumanTaskStatsQueryKey() });
  }

  return (
    <div className="p-6 space-y-6 max-w-[1400px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <ClipboardCheck className="size-6 text-primary" />
            Human Task Center
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            AI-to-human handoff — review, approve, reject, and escalate
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh}>
          <RefreshCw className="size-3.5 mr-1.5" /> Refresh
        </Button>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
          <StatCard label="Total"       value={stats.total}      icon={ClipboardCheck} />
          <StatCard label="Pending"     value={stats.pending}    icon={Clock}          color="text-yellow-400" />
          <StatCard label="Assigned"    value={stats.assigned}   icon={Users}          color="text-blue-400" />
          <StatCard label="In Progress" value={stats.inProgress} icon={RefreshCw}      color="text-purple-400" />
          <StatCard label="Completed"   value={stats.completed}  icon={CheckCircle2}   color="text-green-400" />
          <StatCard label="Rejected"    value={stats.rejected}   icon={XCircle}        color="text-red-400" />
          <StatCard label="Overdue"     value={stats.overdue}    icon={AlertTriangle}  color="text-orange-400" />
          <StatCard
            label="Overdue Rate"
            value={`${(stats.overdueRate * 100).toFixed(1)}%`}
            icon={BarChart2}
            color={stats.overdueRate > 0.1 ? "text-red-400" : "text-muted-foreground"}
          />
        </div>
      )}

      {/* Analytics Mini */}
      {stats && (stats.byDepartment.length > 0 || stats.bySourceModule.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {stats.byDepartment.length > 0 && (
            <Card className="bg-card border-border">
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Building2 className="size-4 text-primary" /> Department Workload
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-2">
                {stats.byDepartment.map((d) => (
                  <div key={d.department} className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{d.department}</span>
                    <span className="font-mono">{d.count}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
          {stats.bySourceModule.length > 0 && (
            <Card className="bg-card border-border">
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm flex items-center gap-2">
                  <BarChart2 className="size-4 text-primary" /> Source Module Breakdown
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-2">
                {stats.bySourceModule.map((m) => (
                  <div key={m.sourceModule} className="flex justify-between text-sm">
                    <span className="text-muted-foreground font-mono">{m.sourceModule}</span>
                    <span className="font-mono">{m.count}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <Filter className="size-4 text-muted-foreground" />

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-8 w-36 text-xs">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__" className="text-xs">All statuses</SelectItem>
            {["pending","assigned","accepted","in_progress","completed","rejected","cancelled","expired"].map((s) => (
              <SelectItem key={s} value={s} className="text-xs">{s.replace("_"," ")}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={deptFilter} onValueChange={setDeptFilter}>
          <SelectTrigger className="h-8 w-40 text-xs">
            <SelectValue placeholder="Department" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__" className="text-xs">All departments</SelectItem>
            {["Creative","Marketing","Finance","HR","Legal","Tax","Logistics","Trading"].map((d) => (
              <SelectItem key={d} value={d} className="text-xs">{d}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={slaFilter} onValueChange={setSlaFilter}>
          <SelectTrigger className="h-8 w-32 text-xs">
            <SelectValue placeholder="SLA" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__" className="text-xs">All SLA</SelectItem>
            {["on_time","warning","overdue","expired"].map((s) => (
              <SelectItem key={s} value={s} className="text-xs">{s.replace("_"," ")}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={moduleFilter} onValueChange={setModuleFilter}>
          <SelectTrigger className="h-8 w-44 text-xs">
            <SelectValue placeholder="Source Module" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__" className="text-xs">All modules</SelectItem>
            {["creative_ai","job_engine","workforce","client_review","scheduler","human_task_center"].map((m) => (
              <SelectItem key={m} value={m} className="text-xs font-mono">{m}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {(statusFilter !== "__all__" || deptFilter !== "__all__" || slaFilter !== "__all__" || moduleFilter !== "__all__") && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs"
            onClick={() => {
              setStatusFilter("__all__");
              setDeptFilter("__all__");
              setSlaFilter("__all__");
              setModuleFilter("__all__");
            }}
          >
            Clear filters
          </Button>
        )}
      </div>

      {/* Task Table */}
      <Card className="bg-card border-border">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="py-12 text-center text-muted-foreground text-sm">Loading tasks…</div>
          ) : tasks.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground text-sm">
              No human tasks found.
              <p className="text-xs mt-1 opacity-60">Tasks are created automatically when AI confidence is low, QC fails, or approval is required.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="text-left px-4 py-3 font-medium">Task</th>
                    <th className="text-left px-4 py-3 font-medium">Source</th>
                    <th className="text-left px-4 py-3 font-medium">Status</th>
                    <th className="text-left px-4 py-3 font-medium">Priority</th>
                    <th className="text-left px-4 py-3 font-medium">Assigned</th>
                    <th className="text-left px-4 py-3 font-medium">SLA</th>
                    <th className="text-left px-4 py-3 font-medium">Created</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((task) => (
                    <tr
                      key={task.id}
                      className="border-b border-border/50 hover:bg-muted/20 cursor-pointer transition-colors"
                      onClick={() => setSelectedId(task.id)}
                    >
                      <td className="px-4 py-3">
                        <div>
                          <span className="font-mono text-xs text-primary">{task.taskCode}</span>
                          {task.reason && (
                            <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-[200px]">{task.reason}</p>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs text-muted-foreground">{task.sourceModule}</span>
                        <span className="text-xs text-muted-foreground/60"> / {task.sourceType}</span>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={task.status} />
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn("text-xs font-mono", priorityColor(task.priority))}>
                          {priorityLabel(task.priority)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-xs text-muted-foreground">
                          {task.assignedUser ?? task.assignedRole ?? task.assignedDepartment ?? (
                            <span className="opacity-40">Unassigned</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <SlaIndicator slaStatus={task.slaStatus} dueAt={task.dueAt} />
                        {!task.dueAt && <span className="text-xs text-muted-foreground/40">—</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground font-mono">
                        {new Date(task.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3">
                        <ChevronRight className="size-4 text-muted-foreground" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Pagination */}
              {(listData?.total ?? 0) > (filters.limit ?? 50) && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-border text-xs text-muted-foreground">
                  <span>{listData?.total} total</span>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      disabled={(filters.offset ?? 0) === 0}
                      onClick={() => setFilters((f) => ({ ...f, offset: Math.max(0, (f.offset ?? 0) - (f.limit ?? 50)) }))}
                    >
                      Prev
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      disabled={(filters.offset ?? 0) + (filters.limit ?? 50) >= (listData?.total ?? 0)}
                      onClick={() => setFilters((f) => ({ ...f, offset: (f.offset ?? 0) + (f.limit ?? 50) }))}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail Dialog */}
      <TaskDetailDialog
        taskId={selectedId}
        open={selectedId !== null}
        onClose={() => setSelectedId(null)}
      />
    </div>
  );
}
