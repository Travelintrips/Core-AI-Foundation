import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod/v3";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link, useLocation, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Clock3,
  Code2,
  Copy,
  FileCode2,
  GitBranch,
  GitCommitHorizontal,
  History,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  TerminalSquare,
  XCircle,
} from "lucide-react";
import {
  CodingTaskStatus,
  getGetCodingTaskQueryKey,
  getListCodingTasksQueryKey,
  useStartCodingRun,
  useCreateCodingTask,
  useGetCodingTask,
  useListCodingTasks,
  useUpdateCodingTask,
  type CodingTask,
  type CodingTaskDetail,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useCodingTaskPolling } from "./codingWorkspacePolling";

const taskSchema = z.object({
  projectName: z.string().trim().min(1, "Project is required").max(200),
  repository: z.string().trim().min(1, "Repository is required").max(500),
  branch: z.string().trim().min(1, "Branch is required").max(200),
  instruction: z.string().trim().min(1, "Instruction is required").max(20000),
  priority: z.coerce.number().min(0).max(100),
});

type TaskFormValues = z.infer<typeof taskSchema>;

const STATUSES = Object.values(CodingTaskStatus) as CodingTaskStatus[];
const ACTIVE_STATUSES = new Set<CodingTaskStatus>([
  CodingTaskStatus.PENDING,
  CodingTaskStatus.ANALYZING,
  CodingTaskStatus.CODING,
  CodingTaskStatus.TESTING,
  CodingTaskStatus.COMMITTING,
]);

function formatDate(value: string, lang: string, withTime = false) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(lang === "id" ? "id-ID" : "en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(date);
}

type RepositoryAnalyzerUiResult = {
  summary?: string;
  executionStatus?: string;
  filesInspected: string[];
  relevantFiles: string[];
  findings: Array<{
    severity?: string;
    title?: string;
    detail?: string;
    file?: string;
  }>;
  recommendedChanges: string[];
  contextPackage?: {
    branch?: string;
    headSha?: string;
    keywords: string[];
    relevantFiles: Array<{
      path?: string;
      score?: number;
      reasons: string[];
    }>;
    affectedFiles: string[];
    symbols: Array<{
      name?: string;
      kind?: string;
      file?: string;
      line?: number;
      exported?: boolean;
    }>;
    relatedTests: string[];
    verificationCommands: string[];
    testFrameworks: string[];
    warnings: string[];
    index?: {
      filesIndexed?: number;
      sourceFilesParsed?: number;
      sensitiveFilesExcluded?: number;
      cacheHit?: boolean;
      searchBackend?: string;
    };
  };
  orchestration?: {
    sessionId?: string;
    status?: string;
    nextAction?: string;
    stages: Array<{
      id?: string;
      label?: string;
      status?: string;
      detail?: string;
    }>;
  };
  implementationPlan?: {
    summary?: string;
    objectives: string[];
    filesToInspect: string[];
    implementationSteps: string[];
    verificationSteps: string[];
    risks: string[];
    approvalRequired?: boolean;
  };
  planner?: {
    modelUsed?: string;
    provider?: string;
    totalTokens?: number;
    latencyMs?: number;
    parsedAsJson?: boolean;
  };
};

type CodingAgentUiResult = {
  summary?: string;
  nextAction?: string;
  commitCreated?: boolean;
  pushed?: boolean;
  diff?: string;
  proposal?: {
    summary?: string;
    changes: Array<{
      path?: string;
      changeType?: string;
      rationale?: string;
    }>;
    verificationCommands: string[];
    risks: string[];
  };
  model?: {
    provider?: string;
    modelUsed?: string;
    totalTokens?: number;
    latencyMs?: number;
  };
};

type TestAgentUiResult = {
  testOutcome?: string;
  nextAction?: string;
  report?: {
    checks: Array<{
      name?: string;
      status?: string;
      detail?: string;
    }>;
    commandsRun: string[];
    proposedCommands: string[];
  };
};

type ReviewAgentUiResult = {
  decision?: string;
  summary?: string;
  issues: string[];
  recommendations: string[];
  testOutcome?: string;
  nextAction?: string;
  commitCreated?: boolean;
  pushed?: boolean;
  model?: {
    provider?: string;
    modelUsed?: string;
    totalTokens?: number;
  };
};

function parseTestAgentResult(logs?: string | null): TestAgentUiResult | null {
  if (!logs) return null;
  try {
    const value = JSON.parse(logs) as Record<string, unknown>;
    const reportValue =
      value.report && typeof value.report === "object" && !Array.isArray(value.report)
        ? value.report as Record<string, unknown>
        : null;
    const checks = reportValue && Array.isArray(reportValue.checks)
      ? reportValue.checks.filter(
          (item): item is { name?: string; status?: string; detail?: string } =>
            Boolean(item) && typeof item === "object",
        )
      : [];
    const stringList = (input: unknown) =>
      Array.isArray(input)
        ? input.filter((item): item is string => typeof item === "string")
        : [];
    return {
      testOutcome: typeof value.testOutcome === "string" ? value.testOutcome : undefined,
      nextAction: typeof value.nextAction === "string" ? value.nextAction : undefined,
      report: reportValue
        ? {
            checks,
            commandsRun: stringList(reportValue.commandsRun),
            proposedCommands: stringList(reportValue.proposedCommands),
          }
        : undefined,
    };
  } catch {
    return null;
  }
}

function parseReviewAgentResult(logs?: string | null): ReviewAgentUiResult | null {
  if (!logs) return null;
  try {
    const value = JSON.parse(logs) as Record<string, unknown>;
    const modelValue =
      value.model && typeof value.model === "object" && !Array.isArray(value.model)
        ? value.model as Record<string, unknown>
        : null;
    const stringList = (input: unknown) =>
      Array.isArray(input)
        ? input.filter((item): item is string => typeof item === "string")
        : [];
    return {
      decision: typeof value.decision === "string" ? value.decision : undefined,
      summary: typeof value.summary === "string" ? value.summary : undefined,
      issues: stringList(value.issues),
      recommendations: stringList(value.recommendations),
      testOutcome: typeof value.testOutcome === "string" ? value.testOutcome : undefined,
      nextAction: typeof value.nextAction === "string" ? value.nextAction : undefined,
      commitCreated: value.commitCreated === true,
      pushed: value.pushed === true,
      model: modelValue
        ? {
            provider: typeof modelValue.provider === "string" ? modelValue.provider : undefined,
            modelUsed: typeof modelValue.modelUsed === "string" ? modelValue.modelUsed : undefined,
            totalTokens: typeof modelValue.totalTokens === "number" ? modelValue.totalTokens : undefined,
          }
        : undefined,
    };
  } catch {
    return null;
  }
}


function parseCodingAgentResult(logs?: string | null): CodingAgentUiResult | null {
  if (!logs) return null;
  try {
    const value = JSON.parse(logs) as Record<string, unknown>;
    const proposalValue =
      value.proposal && typeof value.proposal === "object" && !Array.isArray(value.proposal)
        ? value.proposal as Record<string, unknown>
        : null;
    const modelValue =
      value.model && typeof value.model === "object" && !Array.isArray(value.model)
        ? value.model as Record<string, unknown>
        : null;
    const stringList = (input: unknown) =>
      Array.isArray(input)
        ? input.filter((item): item is string => typeof item === "string")
        : [];
    const changes = proposalValue && Array.isArray(proposalValue.changes)
      ? proposalValue.changes.filter(
          (item): item is { path?: string; changeType?: string; rationale?: string } =>
            Boolean(item) && typeof item === "object",
        )
      : [];

    return {
      summary: typeof value.summary === "string" ? value.summary : undefined,
      nextAction: typeof value.nextAction === "string" ? value.nextAction : undefined,
      commitCreated: value.commitCreated === true,
      pushed: value.pushed === true,
      diff: typeof value.diff === "string" ? value.diff : undefined,
      proposal: proposalValue
        ? {
            summary: typeof proposalValue.summary === "string" ? proposalValue.summary : undefined,
            changes,
            verificationCommands: stringList(proposalValue.verificationCommands),
            risks: stringList(proposalValue.risks),
          }
        : undefined,
      model: modelValue
        ? {
            provider: typeof modelValue.provider === "string" ? modelValue.provider : undefined,
            modelUsed: typeof modelValue.modelUsed === "string" ? modelValue.modelUsed : undefined,
            totalTokens: typeof modelValue.totalTokens === "number" ? modelValue.totalTokens : undefined,
            latencyMs: typeof modelValue.latencyMs === "number" ? modelValue.latencyMs : undefined,
          }
        : undefined,
    };
  } catch {
    return null;
  }
}


function parseRepositoryAnalyzerResult(logs?: string | null): RepositoryAnalyzerUiResult | null {
  if (!logs) return null;
  try {
    const value = JSON.parse(logs) as Record<string, unknown>;
    const findings = Array.isArray(value.findings)
      ? value.findings.filter((item): item is RepositoryAnalyzerUiResult["findings"][number] =>
          Boolean(item) && typeof item === "object")
      : [];
    const orchestrationValue =
      value.orchestration && typeof value.orchestration === "object" && !Array.isArray(value.orchestration)
        ? (value.orchestration as Record<string, unknown>)
        : null;
    const implementationPlanValue =
      value.implementationPlan && typeof value.implementationPlan === "object" && !Array.isArray(value.implementationPlan)
        ? (value.implementationPlan as Record<string, unknown>)
        : null;
    const plannerValue =
      value.planner && typeof value.planner === "object" && !Array.isArray(value.planner)
        ? (value.planner as Record<string, unknown>)
        : null;
    const contextPackageValue =
      value.contextPackage && typeof value.contextPackage === "object" && !Array.isArray(value.contextPackage)
        ? (value.contextPackage as Record<string, unknown>)
        : null;
    const contextIndexValue =
      contextPackageValue?.index && typeof contextPackageValue.index === "object" && !Array.isArray(contextPackageValue.index)
        ? (contextPackageValue.index as Record<string, unknown>)
        : null;
    const stringList = (input: unknown) =>
      Array.isArray(input)
        ? input.filter((item): item is string => typeof item === "string")
        : [];

    return {
      summary: typeof value.summary === "string" ? value.summary : undefined,
      executionStatus: typeof value.executionStatus === "string" ? value.executionStatus : undefined,
      filesInspected: Array.isArray(value.filesInspected)
        ? value.filesInspected.filter((item): item is string => typeof item === "string")
        : [],
      relevantFiles: Array.isArray(value.relevantFiles)
        ? value.relevantFiles.filter((item): item is string => typeof item === "string")
        : [],
      findings,
      recommendedChanges: Array.isArray(value.recommendedChanges)
        ? value.recommendedChanges.filter((item): item is string => typeof item === "string")
        : [],
      contextPackage: contextPackageValue
        ? {
            branch: typeof contextPackageValue.branch === "string" ? contextPackageValue.branch : undefined,
            headSha: typeof contextPackageValue.headSha === "string" ? contextPackageValue.headSha : undefined,
            keywords: stringList(contextPackageValue.keywords),
            relevantFiles: Array.isArray(contextPackageValue.relevantFiles)
              ? contextPackageValue.relevantFiles
                  .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
                  .map((item) => ({
                    path: typeof item.path === "string" ? item.path : undefined,
                    score: typeof item.score === "number" ? item.score : undefined,
                    reasons: stringList(item.reasons),
                  }))
              : [],
            affectedFiles: stringList(contextPackageValue.affectedFiles),
            symbols: Array.isArray(contextPackageValue.symbols)
              ? contextPackageValue.symbols
                  .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
                  .map((item) => ({
                    name: typeof item.name === "string" ? item.name : undefined,
                    kind: typeof item.kind === "string" ? item.kind : undefined,
                    file: typeof item.file === "string" ? item.file : undefined,
                    line: typeof item.line === "number" ? item.line : undefined,
                    exported: item.exported === true,
                  }))
              : [],
            relatedTests: stringList(contextPackageValue.relatedTests),
            verificationCommands: stringList(contextPackageValue.verificationCommands),
            testFrameworks: stringList(contextPackageValue.testFrameworks),
            warnings: stringList(contextPackageValue.warnings),
            index: contextIndexValue
              ? {
                  filesIndexed: typeof contextIndexValue.filesIndexed === "number" ? contextIndexValue.filesIndexed : undefined,
                  sourceFilesParsed: typeof contextIndexValue.sourceFilesParsed === "number" ? contextIndexValue.sourceFilesParsed : undefined,
                  sensitiveFilesExcluded: typeof contextIndexValue.sensitiveFilesExcluded === "number" ? contextIndexValue.sensitiveFilesExcluded : undefined,
                  cacheHit: contextIndexValue.cacheHit === true,
                  searchBackend: typeof contextIndexValue.searchBackend === "string" ? contextIndexValue.searchBackend : undefined,
                }
              : undefined,
          }
        : undefined,
      orchestration: orchestrationValue
        ? {
            sessionId: typeof orchestrationValue.sessionId === "string" ? orchestrationValue.sessionId : undefined,
            status: typeof orchestrationValue.status === "string" ? orchestrationValue.status : undefined,
            nextAction: typeof orchestrationValue.nextAction === "string" ? orchestrationValue.nextAction : undefined,
            stages: Array.isArray(orchestrationValue.stages)
              ? orchestrationValue.stages.filter(
                  (item): item is NonNullable<RepositoryAnalyzerUiResult["orchestration"]>["stages"][number] =>
                    Boolean(item) && typeof item === "object",
                )
              : [],
          }
        : undefined,
      implementationPlan: implementationPlanValue
        ? {
            summary: typeof implementationPlanValue.summary === "string" ? implementationPlanValue.summary : undefined,
            objectives: stringList(implementationPlanValue.objectives),
            filesToInspect: stringList(implementationPlanValue.filesToInspect),
            implementationSteps: stringList(implementationPlanValue.implementationSteps),
            verificationSteps: stringList(implementationPlanValue.verificationSteps),
            risks: stringList(implementationPlanValue.risks),
            approvalRequired: implementationPlanValue.approvalRequired === true,
          }
        : undefined,
      planner: plannerValue
        ? {
            modelUsed: typeof plannerValue.modelUsed === "string" ? plannerValue.modelUsed : undefined,
            provider: typeof plannerValue.provider === "string" ? plannerValue.provider : undefined,
            totalTokens: typeof plannerValue.totalTokens === "number" ? plannerValue.totalTokens : undefined,
            latencyMs: typeof plannerValue.latencyMs === "number" ? plannerValue.latencyMs : undefined,
            parsedAsJson: plannerValue.parsedAsJson === true,
          }
        : undefined,
    };
  } catch {
    return null;
  }
}

function statusTone(status: CodingTaskStatus) {
  if (status === CodingTaskStatus.FAILED) return "rose";
  if (status === CodingTaskStatus.COMPLETED) return "emerald";
  if (status === CodingTaskStatus.READY_REVIEW || status === CodingTaskStatus.PR_CREATED) return "cyan";
  if (ACTIVE_STATUSES.has(status)) return "amber";
  return "slate";
}

function StatusBadge({ status, label }: { status: CodingTaskStatus; label: string }) {
  const tone = statusTone(status);
  const toneClass = {
    rose: "border-rose-400/20 bg-rose-400/10 text-rose-300",
    emerald: "border-emerald-400/20 bg-emerald-400/10 text-emerald-300",
    cyan: "border-cyan-400/20 bg-cyan-400/10 text-cyan-300",
    amber: "border-amber-400/20 bg-amber-400/10 text-amber-300",
    slate: "border-slate-400/20 bg-slate-400/10 text-slate-300",
  }[tone];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em]", toneClass)} data-testid={`status-task-${status.toLowerCase()}`}>
      <span className={cn("size-1.5 rounded-full", tone === "rose" ? "bg-rose-300" : tone === "emerald" ? "bg-emerald-300" : tone === "cyan" ? "bg-cyan-300" : tone === "amber" ? "bg-amber-300 animate-pulse" : "bg-slate-300")} />
      {label}
    </span>
  );
}

function TaskSkeleton() {
  return (
    <div className="space-y-2 p-4" aria-label="Loading task queue" data-testid="skeleton-task-queue">
      {[1, 2, 3, 4].map((item) => (
        <div key={item} className="grid grid-cols-[1.1fr_1.5fr_1fr_0.8fr] gap-4 rounded-lg border border-white/[0.05] bg-white/[0.02] p-4">
          <div className="skeleton h-3 w-20 rounded" />
          <div className="space-y-2"><div className="skeleton h-3 w-32 rounded" /><div className="skeleton h-2 w-24 rounded" /></div>
          <div className="skeleton h-5 w-24 rounded-full" />
          <div className="skeleton h-3 w-16 rounded" />
        </div>
      ))}
    </div>
  );
}

function CreateTaskDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: (task: CodingTask) => void }) {
  const { t } = useLang();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createTask = useCreateCodingTask();
  const form = useForm<TaskFormValues>({
    resolver: zodResolver(taskSchema),
    defaultValues: { projectName: "", repository: "", branch: "main", instruction: "", priority: 50 },
  });

  useEffect(() => {
    if (!open) form.reset({ projectName: "", repository: "", branch: "main", instruction: "", priority: 50 });
  }, [open, form]);

  const onSubmit = (values: TaskFormValues) => {
    createTask.mutate({ data: values }, {
      onSuccess: (task) => {
        queryClient.invalidateQueries({ queryKey: getListCodingTasksQueryKey() });
        toast({ title: t("pages.codingWorkspace.createdToast"), description: task.taskNumber });
        onOpenChange(false);
        onCreated(task);
      },
      onError: () => toast({ title: t("pages.codingWorkspace.createError"), variant: "destructive" }),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto border-cyan-300/20 bg-[#0c1628] p-0 shadow-2xl shadow-cyan-950/30 sm:max-w-2xl">
        <DialogHeader className="border-b border-white/[0.07] bg-[linear-gradient(135deg,rgba(32,211,193,0.10),transparent_60%)] px-6 py-5 text-left">
          <div className="mb-3 flex size-10 items-center justify-center rounded-xl border border-cyan-300/20 bg-cyan-300/10 text-cyan-300"><Code2 className="size-5" /></div>
          <DialogTitle className="font-display text-xl text-slate-100">{t("pages.codingWorkspace.createTitle")}</DialogTitle>
          <DialogDescription className="max-w-lg text-sm leading-6 text-slate-400">{t("pages.codingWorkspace.createHint")}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5 px-6 py-6">
            <div className="grid gap-5 sm:grid-cols-2">
              <FormField control={form.control} name="projectName" render={({ field }) => (
                <FormItem><FormLabel className="text-slate-300">{t("pages.codingWorkspace.project")} <span className="text-cyan-300">*</span></FormLabel><FormControl><Input {...field} placeholder={t("pages.codingWorkspace.projectPlaceholder")} className="border-white/10 bg-[#091222] text-slate-100 placeholder:text-slate-600" data-testid="input-coding-project" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="repository" render={({ field }) => (
                <FormItem><FormLabel className="text-slate-300">{t("pages.codingWorkspace.repository")} <span className="text-cyan-300">*</span></FormLabel><FormControl><Input {...field} placeholder={t("pages.codingWorkspace.repositoryPlaceholder")} className="border-white/10 bg-[#091222] text-slate-100 placeholder:text-slate-600" data-testid="input-coding-repository" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="branch" render={({ field }) => (
                <FormItem><FormLabel className="text-slate-300">{t("pages.codingWorkspace.branch")} <span className="text-cyan-300">*</span></FormLabel><FormControl><div className="relative"><GitBranch className="pointer-events-none absolute left-3 top-2.5 size-4 text-slate-600" /><Input {...field} className="border-white/10 bg-[#091222] pl-9 text-slate-100 placeholder:text-slate-600" placeholder={t("pages.codingWorkspace.branchPlaceholder")} data-testid="input-coding-branch" /></div></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="priority" render={({ field }) => (
                <FormItem><div className="flex items-center justify-between"><FormLabel className="text-slate-300">{t("pages.codingWorkspace.priority")}</FormLabel><output className="font-mono text-sm font-semibold text-cyan-300" data-testid="text-coding-priority">{field.value}</output></div><FormControl><input {...field} type="range" min="0" max="100" step="1" className="mt-3 h-1.5 w-full cursor-pointer accent-cyan-300" aria-label={t("pages.codingWorkspace.priority")} data-testid="input-coding-priority" /></FormControl><p className="text-xs text-slate-500">{t("pages.codingWorkspace.priorityHint")}</p><FormMessage /></FormItem>
              )} />
            </div>
            <FormField control={form.control} name="instruction" render={({ field }) => (
              <FormItem><FormLabel className="text-slate-300">{t("pages.codingWorkspace.instruction")} <span className="text-cyan-300">*</span></FormLabel><FormControl><Textarea {...field} rows={7} placeholder={t("pages.codingWorkspace.instructionPlaceholder")} className="resize-y border-white/10 bg-[#091222] leading-6 text-slate-100 placeholder:text-slate-600" data-testid="input-coding-instruction" /></FormControl><FormMessage /></FormItem>
            )} />
            <DialogFooter className="gap-2 border-t border-white/[0.07] pt-5">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} className="text-slate-400 hover:bg-white/5 hover:text-slate-200" data-testid="button-cancel-coding-task">{t("common.actions.cancel")}</Button>
              <Button type="submit" disabled={createTask.isPending} className="bg-cyan-300 text-[#062028] hover:bg-cyan-200" data-testid="button-create-coding-task">{createTask.isPending ? <><Loader2 className="animate-spin" />{t("pages.codingWorkspace.creatingTask")}</> : <><Plus />{t("pages.codingWorkspace.createTask")}</>}</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function TaskDetailPanel({ detail, isLoading, isError, onRetry, onClose }: { detail?: CodingTaskDetail; isLoading: boolean; isError: boolean; onRetry: () => void; onClose: () => void }) {
  const { t, lang } = useLang();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const updateTask = useUpdateCodingTask();
  const startCodingRun = useStartCodingRun();
  const [status, setStatus] = useState<CodingTaskStatus>(CodingTaskStatus.PENDING);
  const [summary, setSummary] = useState("");
  const [commitSha, setCommitSha] = useState("");
  const [approvePending, setApprovePending] = useState(false);

  useEffect(() => {
    if (detail?.task) {
      setStatus(detail.task.status);
      setSummary(detail.task.resultSummary ?? "");
      setCommitSha(detail.task.commitSha ?? "");
    }
  }, [detail?.task]);

  if (isLoading) return <Card className="min-h-[420px] border-white/[0.08] bg-[#0c1628]"><div className="space-y-5 p-6"><div className="skeleton h-3 w-24 rounded" /><div className="skeleton h-8 w-3/4 rounded" /><div className="skeleton h-24 w-full rounded-lg" /><div className="skeleton h-32 w-full rounded-lg" /></div></Card>;
  if (isError || !detail) return <Card className="border-rose-400/20 bg-[#0c1628]"><CardContent className="flex min-h-[420px] flex-col items-center justify-center p-8 text-center"><XCircle className="mb-4 size-8 text-rose-300" /><p className="font-display text-lg text-slate-100">{t("pages.codingWorkspace.errorTitle")}</p><p className="mt-2 max-w-xs text-sm leading-6 text-slate-500">{t("pages.codingWorkspace.errorHint")}</p><Button variant="outline" onClick={onRetry} className="mt-5 border-white/10 text-slate-300 hover:bg-white/5" data-testid="button-retry-coding-detail"><RotateCcw />{t("pages.codingWorkspace.retry")}</Button></CardContent></Card>;

  const task = detail.task;
  const hasActiveRun = detail.runs.some((run) => run.status === "RUNNING");
  const latestResultRun = detail.runs.find(
    (run) =>
      ["Coding Orchestrator", "Repository Analyzer"].includes(run.agentName) &&
      Boolean(run.logs),
  );
  const analyzerResult = parseRepositoryAnalyzerResult(latestResultRun?.logs);
  const latestCodingAgentRun = detail.runs.find(
    (run) => run.agentName === "Coding Agent" && Boolean(run.logs),
  );
  const codingResult = parseCodingAgentResult(latestCodingAgentRun?.logs);
  const latestTestAgentRun = detail.runs.find(
    (run) => run.agentName === "Test Agent" && Boolean(run.logs),
  );
  const testResult = parseTestAgentResult(latestTestAgentRun?.logs);
  const latestReviewAgentRun = detail.runs.find(
    (run) => run.agentName === "Review Agent" && Boolean(run.logs),
  );
  const reviewResult = parseReviewAgentResult(latestReviewAgentRun?.logs);
  const displayedResultSummary = analyzerResult?.summary ?? task.resultSummary;
  const canApprovePlan =
    task.status === CodingTaskStatus.READY_REVIEW &&
    analyzerResult?.orchestration?.nextAction === "APPROVE_PLAN" &&
    analyzerResult?.implementationPlan?.approvalRequired === true &&
    !hasActiveRun;
  const runAgent = () => {
    startCodingRun.mutate(
      { id: task.id },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({ queryKey: getGetCodingTaskQueryKey(task.id) });
          void queryClient.invalidateQueries({ queryKey: getListCodingTasksQueryKey() });
          toast({
            title: t("pages.codingWorkspace.runStarted"),
            description: "Local Coding Engine: index → symbols → dependencies → tests → context",
          });
        },
        onError: () => {
          toast({ title: t("pages.codingWorkspace.runError"), variant: "destructive" });
        },
      },
    );
  };

  const approvePlan = async () => {
    setApprovePending(true);
    try {
      const response = await fetch(`/api/ai/coding/tasks/${task.id}/approve-plan`, {
        method: "POST",
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error ?? `HTTP ${response.status}`);
      }
      await response.json();
      void queryClient.invalidateQueries({ queryKey: getGetCodingTaskQueryKey(task.id) });
      void queryClient.invalidateQueries({ queryKey: getListCodingTasksQueryKey() });
      toast({
        title: "Plan approved",
        description: "Coding Agent started in an isolated workspace. No commit or push will be created automatically.",
      });
    } catch (error) {
      toast({
        title: "Could not approve plan",
        description: error instanceof Error ? error.message : "Approval failed",
        variant: "destructive",
      });
    } finally {
      setApprovePending(false);
    }
  };

  const update = () => {
    updateTask.mutate({ id: task.id, data: { status, resultSummary: summary || null, commitSha: commitSha || null } }, {
      onSuccess: (updated) => {
        queryClient.setQueryData(getGetCodingTaskQueryKey(task.id), (old: CodingTaskDetail | undefined) => old ? { ...old, task: updated } : old);
        queryClient.invalidateQueries({ queryKey: getListCodingTasksQueryKey() });
        toast({ title: t("pages.codingWorkspace.updatedToast"), description: updated.taskNumber });
      },
      onError: () => toast({ title: t("pages.codingWorkspace.updateError"), variant: "destructive" }),
    });
  };

  return (
    <Card className="overflow-hidden border-cyan-300/15 bg-[#0c1628] shadow-xl shadow-cyan-950/10" data-testid={`panel-coding-task-${task.id}`}>
      <CardHeader className="border-b border-white/[0.07] bg-[linear-gradient(135deg,rgba(32,211,193,0.08),transparent_55%)] p-5 pb-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0"><div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.15em] text-cyan-300"><span className="size-1.5 rounded-full bg-cyan-300" />{task.taskNumber}</div><h2 className="truncate font-display text-xl text-slate-100">{task.projectName}</h2><div className="mt-2 flex min-w-0 items-center gap-2 text-xs text-slate-500"><GitBranch className="size-3.5 shrink-0 text-slate-600" /><span className="truncate">{task.repository}</span><span className="text-slate-700">/</span><span className="truncate text-slate-400">{task.branch}</span></div></div>
          <button type="button" onClick={onClose} className="rounded-md p-1.5 text-slate-500 transition-colors hover:bg-white/5 hover:text-slate-200" aria-label={t("pages.codingWorkspace.close")} data-testid="button-close-coding-detail"><XCircle className="size-4" /></button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2"><StatusBadge status={task.status} label={t(`pages.codingWorkspace.statuses.${task.status.toLowerCase()}`)} /><span className="rounded-full border border-white/10 px-2 py-1 font-mono text-[10px] text-slate-500">P{task.priority}</span><span className="text-xs text-slate-600">{formatDate(task.createdAt, lang, true)}</span></div>
      </CardHeader>
      <CardContent className="space-y-6 p-5">
        <section><div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500"><TerminalSquare className="size-3.5 text-cyan-300" />{t("pages.codingWorkspace.instruction")}</div><p className="whitespace-pre-wrap rounded-lg border border-white/[0.06] bg-[#091222] p-3 text-sm leading-6 text-slate-300">{task.instruction}</p></section>
        <section className="rounded-xl border border-cyan-300/15 bg-cyan-300/[0.035] p-4" data-testid="panel-coding-analysis-result">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              <Search className="size-3.5 text-cyan-300" />
              Analysis Result
            </div>
            {analyzerResult?.executionStatus && (
              <span className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
                {analyzerResult.executionStatus}
              </span>
            )}
          </div>
          {displayedResultSummary || analyzerResult ? (
            <div className="space-y-4">
              {displayedResultSummary && (
                <p className="whitespace-pre-wrap rounded-lg border border-white/[0.06] bg-[#091222] p-3 text-sm leading-6 text-slate-200" data-testid="text-coding-analysis-summary">
                  {displayedResultSummary}
                </p>
              )}
              {analyzerResult && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-white/[0.06] bg-[#091222] p-3">
                    <div className="text-[10px] uppercase tracking-wider text-slate-600">Files inspected</div>
                    <div className="mt-1 font-mono text-lg text-cyan-300">{analyzerResult.filesInspected.length}</div>
                  </div>
                  <div className="rounded-lg border border-white/[0.06] bg-[#091222] p-3">
                    <div className="text-[10px] uppercase tracking-wider text-slate-600">Findings</div>
                    <div className="mt-1 font-mono text-lg text-cyan-300">{analyzerResult.findings.length}</div>
                  </div>
                </div>
              )}
              {analyzerResult?.contextPackage && (
                <div className="space-y-3 rounded-lg border border-cyan-300/10 bg-[#091222] p-3" data-testid="panel-local-coding-context">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-cyan-300">Local context package</div>
                    <div className="flex flex-wrap items-center gap-2 font-mono text-[9px] text-slate-500">
                      {analyzerResult.contextPackage.branch && <span>{analyzerResult.contextPackage.branch}</span>}
                      {analyzerResult.contextPackage.headSha && <span>{analyzerResult.contextPackage.headSha.slice(0, 12)}</span>}
                      {analyzerResult.contextPackage.index?.searchBackend && <span>{analyzerResult.contextPackage.index.searchBackend}</span>}
                      {analyzerResult.contextPackage.index?.cacheHit && <span>cache hit</span>}
                    </div>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-4">
                    {[
                      ["Indexed", analyzerResult.contextPackage.index?.filesIndexed ?? 0],
                      ["Relevant", analyzerResult.contextPackage.relevantFiles.length],
                      ["Symbols", analyzerResult.contextPackage.symbols.length],
                      ["Tests", analyzerResult.contextPackage.relatedTests.length],
                    ].map(([label, count]) => (
                      <div key={String(label)} className="rounded-md border border-white/[0.05] bg-white/[0.02] p-2">
                        <div className="text-[9px] uppercase tracking-wider text-slate-600">{String(label)}</div>
                        <div className="mt-1 font-mono text-sm text-cyan-300">{String(count)}</div>
                      </div>
                    ))}
                  </div>
                  {analyzerResult.contextPackage.keywords.length > 0 && (
                    <div>
                      <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-[0.11em] text-slate-600">Task keywords</div>
                      <div className="flex flex-wrap gap-1.5">
                        {analyzerResult.contextPackage.keywords.map((keyword) => (
                          <span key={keyword} className="rounded border border-white/[0.06] px-1.5 py-0.5 font-mono text-[9px] text-slate-400">{keyword}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {analyzerResult.contextPackage.relevantFiles.length > 0 && (
                    <div>
                      <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-[0.11em] text-slate-600">Top relevant files</div>
                      <div className="space-y-1">
                        {analyzerResult.contextPackage.relevantFiles.slice(0, 8).map((file, index) => (
                          <div key={`${file.path ?? "file"}-${index}`} className="flex items-center justify-between gap-3 text-[10px]">
                            <span className="min-w-0 truncate font-mono text-slate-300">{file.path ?? "Unknown file"}</span>
                            {typeof file.score === "number" && <span className="shrink-0 font-mono text-cyan-400">score {file.score}</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {analyzerResult.contextPackage.verificationCommands.length > 0 && (
                    <div>
                      <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-[0.11em] text-slate-600">Safe verification commands</div>
                      <div className="flex flex-wrap gap-1.5">
                        {analyzerResult.contextPackage.verificationCommands.map((command) => (
                          <code key={command} className="rounded border border-emerald-300/10 bg-emerald-300/[0.035] px-2 py-1 text-[9px] text-emerald-300">{command}</code>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
              {analyzerResult && analyzerResult.findings.length > 0 && (
                <div className="space-y-2" data-testid="list-coding-analysis-findings">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Findings</div>
                  {analyzerResult.findings.map((finding, index) => (
                    <div key={`${finding.title ?? "finding"}-${index}`} className="rounded-lg border border-white/[0.06] bg-[#091222] p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={cn(
                          "rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider",
                          finding.severity === "warning" ? "bg-amber-300/10 text-amber-300" : "bg-cyan-300/10 text-cyan-300",
                        )}>
                          {finding.severity ?? "info"}
                        </span>
                        <span className="text-xs font-medium text-slate-200">{finding.title ?? "Repository finding"}</span>
                        {finding.file && <span className="font-mono text-[10px] text-slate-600">{finding.file}</span>}
                      </div>
                      {finding.detail && <p className="mt-2 text-xs leading-5 text-slate-400">{finding.detail}</p>}
                    </div>
                  ))}
                </div>
              )}
              {analyzerResult && analyzerResult.recommendedChanges.length > 0 && (
                <div data-testid="list-coding-analysis-recommendations">
                  <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Recommended changes</div>
                  <ul className="space-y-1.5 text-xs leading-5 text-slate-400">
                    {analyzerResult.recommendedChanges.map((item, index) => (
                      <li key={`${item}-${index}`} className="flex gap-2">
                        <span className="mt-2 size-1 shrink-0 rounded-full bg-cyan-300" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {analyzerResult?.orchestration && (
                <div className="space-y-2" data-testid="list-coding-orchestrator-stages">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Orchestrator stages</div>
                    {analyzerResult.orchestration.sessionId && (
                      <span className="font-mono text-[9px] text-slate-600">{analyzerResult.orchestration.sessionId}</span>
                    )}
                  </div>
                  {analyzerResult.orchestration.stages.map((stage, index) => (
                    <div key={`${stage.id ?? stage.label ?? "stage"}-${index}`} className="flex items-start justify-between gap-3 rounded-lg border border-white/[0.06] bg-[#091222] p-3">
                      <div>
                        <div className="text-xs font-medium text-slate-200">{stage.label ?? stage.id ?? "Agent stage"}</div>
                        {stage.detail && <p className="mt-1 text-[10px] leading-4 text-slate-500">{stage.detail}</p>}
                      </div>
                      <span className={cn(
                        "shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider",
                        stage.status === "COMPLETED"
                          ? "bg-emerald-300/10 text-emerald-300"
                          : stage.status === "FAILED"
                            ? "bg-rose-300/10 text-rose-300"
                            : stage.status === "RUNNING"
                              ? "bg-amber-300/10 text-amber-300"
                              : "bg-slate-300/10 text-slate-400",
                      )}>
                        {stage.status ?? "PENDING"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {analyzerResult?.implementationPlan && (
                <div className="space-y-3 rounded-lg border border-violet-300/15 bg-violet-300/[0.035] p-3" data-testid="panel-coding-implementation-plan">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-violet-300">Implementation plan</div>
                    <div className="flex flex-wrap items-center gap-2">
                      {analyzerResult.implementationPlan.approvalRequired && (
                        <span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-2 py-1 text-[9px] font-semibold uppercase tracking-wider text-amber-300">
                          Approval required
                        </span>
                      )}
                      {canApprovePlan && (
                        <Button
                          type="button"
                          size="sm"
                          onClick={approvePlan}
                          disabled={approvePending}
                          className="h-7 bg-violet-300 px-2.5 text-[10px] font-semibold text-[#1b1230] hover:bg-violet-200"
                          data-testid="button-approve-coding-plan"
                        >
                          {approvePending ? <><Loader2 className="size-3 animate-spin" />Starting Coding Agent</> : <><CheckCircle2 className="size-3" />Approve Plan & Start Coding</>}
                        </Button>
                      )}
                    </div>
                  </div>
                  {analyzerResult.implementationPlan.summary && (
                    <p className="text-xs leading-5 text-slate-300">{analyzerResult.implementationPlan.summary}</p>
                  )}
                  {[
                    ["Objectives", analyzerResult.implementationPlan.objectives],
                    ["Files to inspect", analyzerResult.implementationPlan.filesToInspect],
                    ["Implementation steps", analyzerResult.implementationPlan.implementationSteps],
                    ["Verification", analyzerResult.implementationPlan.verificationSteps],
                    ["Risks", analyzerResult.implementationPlan.risks],
                  ].map(([label, items]) => (
                    Array.isArray(items) && items.length > 0 ? (
                      <div key={String(label)}>
                        <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-[0.11em] text-slate-600">{String(label)}</div>
                        <ul className="space-y-1 text-[11px] leading-5 text-slate-400">
                          {items.map((item, index) => <li key={`${String(label)}-${index}`}>• {item}</li>)}
                        </ul>
                      </div>
                    ) : null
                  ))}
                  {analyzerResult.planner?.modelUsed && (
                    <div className="border-t border-white/[0.06] pt-2 font-mono text-[9px] text-slate-600">
                      Planner: {analyzerResult.planner.provider ?? "provider"} / {analyzerResult.planner.modelUsed}
                      {typeof analyzerResult.planner.totalTokens === "number" ? ` · ${analyzerResult.planner.totalTokens} tokens` : ""}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-white/10 px-3 py-5 text-center text-xs text-slate-600">
              {hasActiveRun
                ? "Coding Orchestrator is running. Analyzer and Planner progress will appear here automatically."
                : "No Coding Orchestrator result is available yet."}
            </p>
          )}
        </section>
        {(latestCodingAgentRun || codingResult) && (
          <section className="rounded-xl border border-emerald-300/15 bg-emerald-300/[0.03] p-4" data-testid="panel-coding-proposed-changes">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                <FileCode2 className="size-3.5 text-emerald-300" />
                Proposed Changes
              </div>
              <div className="flex items-center gap-2">
                <span className={cn(
                  "rounded px-2 py-1 text-[9px] font-semibold uppercase tracking-wider",
                  latestCodingAgentRun?.status === "COMPLETED"
                    ? "bg-emerald-300/10 text-emerald-300"
                    : latestCodingAgentRun?.status === "FAILED"
                      ? "bg-rose-300/10 text-rose-300"
                      : "bg-amber-300/10 text-amber-300",
                )}>
                  {latestCodingAgentRun?.status ?? "PENDING"}
                </span>
                {codingResult?.nextAction && (
                  <span className="text-[9px] font-semibold uppercase tracking-wider text-cyan-300">
                    Next: {codingResult.nextAction}
                  </span>
                )}
              </div>
            </div>
            {codingResult?.summary && (
              <p className="rounded-lg border border-white/[0.06] bg-[#091222] p-3 text-xs leading-5 text-slate-300">
                {codingResult.summary}
              </p>
            )}
            {codingResult?.proposal?.changes && codingResult.proposal.changes.length > 0 && (
              <div className="mt-3 space-y-2">
                {codingResult.proposal.changes.map((change, index) => (
                  <div key={`${change.path ?? "change"}-${index}`} className="rounded-lg border border-white/[0.06] bg-[#091222] p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cn(
                        "rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider",
                        change.changeType === "ADDED"
                          ? "bg-emerald-300/10 text-emerald-300"
                          : change.changeType === "DELETED"
                            ? "bg-rose-300/10 text-rose-300"
                            : "bg-cyan-300/10 text-cyan-300",
                      )}>
                        {change.changeType ?? "MODIFIED"}
                      </span>
                      <span className="font-mono text-xs text-slate-200">{change.path ?? "unknown file"}</span>
                    </div>
                    {change.rationale && <p className="mt-2 text-[11px] leading-5 text-slate-500">{change.rationale}</p>}
                  </div>
                ))}
              </div>
            )}
            {codingResult && (
              <div className="mt-3 flex flex-wrap gap-2 text-[9px] uppercase tracking-wider text-slate-600">
                <span>Commit: {codingResult.commitCreated ? "yes" : "no"}</span>
                <span>·</span>
                <span>Push: {codingResult.pushed ? "yes" : "no"}</span>
                {codingResult.model?.modelUsed && (
                  <>
                    <span>·</span>
                    <span>{codingResult.model.provider ?? "provider"} / {codingResult.model.modelUsed}</span>
                  </>
                )}
              </div>
            )}
          </section>
        )}
        {(latestTestAgentRun || testResult || latestReviewAgentRun || reviewResult) && (
          <section className="rounded-xl border border-cyan-300/15 bg-cyan-300/[0.025] p-4" data-testid="panel-coding-test-review">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                Test & Review
              </div>
              {reviewResult?.nextAction && (
                <span className="text-[9px] font-semibold uppercase tracking-wider text-cyan-300">
                  Next: {reviewResult.nextAction}
                </span>
              )}
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="rounded-lg border border-white/[0.06] bg-[#091222] p-3" data-testid="panel-coding-test-agent">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="text-xs font-medium text-slate-200">Test Agent</div>
                  <span className={cn(
                    "rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider",
                    testResult?.testOutcome === "PASSED"
                      ? "bg-emerald-300/10 text-emerald-300"
                      : testResult?.testOutcome === "FAILED"
                        ? "bg-rose-300/10 text-rose-300"
                        : "bg-amber-300/10 text-amber-300",
                  )}>
                    {testResult?.testOutcome ?? latestTestAgentRun?.status ?? "PENDING"}
                  </span>
                </div>
                {testResult?.report?.checks && testResult.report.checks.length > 0 ? (
                  <div className="space-y-1.5">
                    {testResult.report.checks.map((check, index) => (
                      <div key={`${check.name ?? "check"}-${index}`} className="rounded border border-white/[0.05] px-2.5 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate font-mono text-[10px] text-slate-400">{check.name ?? "verification"}</span>
                          <span className={cn(
                            "text-[9px] font-semibold uppercase tracking-wider",
                            check.status === "PASSED" ? "text-emerald-300" : "text-rose-300",
                          )}>
                            {check.status ?? "UNKNOWN"}
                          </span>
                        </div>
                        {check.detail && <p className="mt-1 text-[10px] leading-4 text-slate-600">{check.detail}</p>}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-600">Deterministic verification is pending.</p>
                )}
                {testResult?.report?.proposedCommands && testResult.report.proposedCommands.length > 0 && (
                  <div className="mt-3 border-t border-white/[0.05] pt-2">
                    <div className="mb-1 text-[9px] uppercase tracking-wider text-slate-600">Agent-suggested commands (not blindly executed)</div>
                    {testResult.report.proposedCommands.map((command, index) => (
                      <div key={`${command}-${index}`} className="font-mono text-[10px] text-slate-500">{command}</div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-white/[0.06] bg-[#091222] p-3" data-testid="panel-coding-review-agent">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="text-xs font-medium text-slate-200">Review Agent</div>
                  <span className={cn(
                    "rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider",
                    reviewResult?.decision === "APPROVE_FOR_COMMIT"
                      ? "bg-emerald-300/10 text-emerald-300"
                      : reviewResult?.decision === "REVISE_CHANGES"
                        ? "bg-amber-300/10 text-amber-300"
                        : "bg-slate-300/10 text-slate-400",
                  )}>
                    {reviewResult?.decision ?? latestReviewAgentRun?.status ?? "PENDING"}
                  </span>
                </div>
                {reviewResult?.summary && <p className="text-[11px] leading-5 text-slate-400">{reviewResult.summary}</p>}
                {reviewResult?.issues && reviewResult.issues.length > 0 && (
                  <div className="mt-3">
                    <div className="mb-1 text-[9px] uppercase tracking-wider text-rose-300">Issues</div>
                    <ul className="space-y-1 text-[10px] leading-4 text-slate-500">
                      {reviewResult.issues.map((issue, index) => <li key={`${issue}-${index}`}>• {issue}</li>)}
                    </ul>
                  </div>
                )}
                {reviewResult?.recommendations && reviewResult.recommendations.length > 0 && (
                  <div className="mt-3">
                    <div className="mb-1 text-[9px] uppercase tracking-wider text-cyan-300">Recommendations</div>
                    <ul className="space-y-1 text-[10px] leading-4 text-slate-500">
                      {reviewResult.recommendations.map((item, index) => <li key={`${item}-${index}`}>• {item}</li>)}
                    </ul>
                  </div>
                )}
                {reviewResult && (
                  <div className="mt-3 flex flex-wrap gap-2 border-t border-white/[0.05] pt-2 text-[9px] uppercase tracking-wider text-slate-600">
                    <span>Commit: {reviewResult.commitCreated ? "yes" : "no"}</span>
                    <span>·</span>
                    <span>Push: {reviewResult.pushed ? "yes" : "no"}</span>
                    {reviewResult.model?.modelUsed && (
                      <>
                        <span>·</span>
                        <span>{reviewResult.model.provider ?? "provider"} / {reviewResult.model.modelUsed}</span>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </section>
        )}
        <div className="grid gap-5 xl:grid-cols-2">
          <section><div className="mb-3 flex items-center justify-between"><div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500"><History className="size-3.5 text-cyan-300" />{t("pages.codingWorkspace.runs")}</div><span className="font-mono text-[10px] text-slate-600">{detail.runs.length.toString().padStart(2, "0")}</span></div>{detail.runs.length === 0 ? <p className="rounded-lg border border-dashed border-white/10 px-3 py-5 text-center text-xs text-slate-600">{t("pages.codingWorkspace.noRuns")}</p> : <div className="space-y-2">{detail.runs.map((run) => <div key={run.id} className="rounded-lg border border-white/[0.06] bg-[#091222] p-3" data-testid={`card-coding-run-${run.id}`}><div className="flex items-center justify-between gap-3"><span className="truncate text-sm text-slate-300">{run.agentName}</span><span className={cn("text-[10px] font-semibold uppercase tracking-wider", run.status === "FAILED" ? "text-rose-300" : run.status === "COMPLETED" ? "text-emerald-300" : "text-amber-300")}>{t(`pages.codingWorkspace.runStatuses.${run.status.toLowerCase()}`)}</span></div><div className="mt-2 flex items-center gap-2 text-[10px] text-slate-600">{run.startedAt ? formatDate(run.startedAt, lang, true) : "—"}{run.finishedAt && <><span>→</span>{formatDate(run.finishedAt, lang, true)}</>}</div>{run.errorMessage && <p className="mt-2 text-xs leading-5 text-rose-300">{run.errorMessage}</p>}{run.logs && <details className="mt-2"><summary className="cursor-pointer text-[10px] text-cyan-300">{t("pages.codingWorkspace.runLogs")}</summary><pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap rounded bg-black/20 p-2 font-mono text-[10px] leading-5 text-slate-500">{run.logs}</pre></details>}</div>)}</div>}</section>
          <section className="rounded-lg border border-cyan-300/15 bg-cyan-300/[0.04] p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><div className="text-sm font-medium text-slate-200">{t("pages.codingWorkspace.runAgent")}</div><p className="mt-1 text-xs leading-5 text-slate-500">{t("pages.codingWorkspace.runAgentHint")}</p></div><Button onClick={runAgent} disabled={startCodingRun.isPending || hasActiveRun} className="shrink-0 bg-cyan-300 text-[#062028] hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-60" data-testid="button-run-coding-agent">{startCodingRun.isPending ? <><Loader2 className="animate-spin" />{t("pages.codingWorkspace.runningAgent")}</> : hasActiveRun ? <><Loader2 className="animate-spin" />{t("pages.codingWorkspace.runningAgent")}</> : <><TerminalSquare />{t("pages.codingWorkspace.runAgent")}</>}</Button></div></section>
          <section><div className="mb-3 flex items-center justify-between"><div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500"><FileCode2 className="size-3.5 text-cyan-300" />{t("pages.codingWorkspace.changes")}</div><span className="font-mono text-[10px] text-slate-600">{detail.changes.length.toString().padStart(2, "0")}</span></div>{detail.changes.length === 0 ? <p className="rounded-lg border border-dashed border-white/10 px-3 py-5 text-center text-xs text-slate-600">{t("pages.codingWorkspace.noChanges")}</p> : <div className="space-y-2">{detail.changes.map((change) => <div key={change.id} className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-[#091222] p-3" data-testid={`card-coding-change-${change.id}`}><span className={cn("flex size-7 shrink-0 items-center justify-center rounded-md text-[10px] font-bold", change.changeType === "ADDED" ? "bg-emerald-400/10 text-emerald-300" : change.changeType === "DELETED" ? "bg-rose-400/10 text-rose-300" : "bg-cyan-400/10 text-cyan-300")}>{change.changeType === "ADDED" ? "+" : change.changeType === "DELETED" ? "−" : "M"}</span><div className="min-w-0 flex-1"><div className="truncate font-mono text-xs text-slate-300">{change.filePath}</div><div className="mt-1 text-[10px] uppercase tracking-wider text-slate-600">{t(`pages.codingWorkspace.changeTypes.${change.changeType.toLowerCase()}`)} · {formatDate(change.createdAt, lang)}</div></div></div>)}</div>}</section>
        </div>
         <section className="border-t border-white/[0.07] pt-5"><div className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500"><GitCommitHorizontal className="size-3.5 text-cyan-300" />{t("pages.codingWorkspace.updateStatus")}</div><div className="grid gap-3 sm:grid-cols-2"><label className="space-y-2 text-xs text-slate-500"><span>{t("pages.codingWorkspace.status")}</span><select value={status} onChange={(event) => setStatus(event.target.value as CodingTaskStatus)} className="h-9 w-full rounded-md border border-white/10 bg-[#091222] px-3 text-xs text-slate-200 outline-none focus:border-cyan-300/50" data-testid="select-coding-status">{STATUSES.map((item) => <option key={item} value={item}>{t(`pages.codingWorkspace.statuses.${item.toLowerCase()}`)}</option>)}</select></label><label className="space-y-2 text-xs text-slate-500"><span>{t("pages.codingWorkspace.commitSha")}</span><div className="relative"><Copy className="pointer-events-none absolute left-3 top-2.5 size-3.5 text-slate-600" /><Input value={commitSha} onChange={(event) => setCommitSha(event.target.value)} className="h-9 border-white/10 bg-[#091222] pl-9 font-mono text-xs text-slate-200" placeholder="optional" data-testid="input-coding-commit-sha" /></div></label></div><label className="mt-3 block space-y-2 text-xs text-slate-500"><span>{t("pages.codingWorkspace.resultSummary")}</span><Textarea value={summary} onChange={(event) => setSummary(event.target.value)} rows={3} className="resize-y border-white/10 bg-[#091222] text-xs leading-5 text-slate-200 placeholder:text-slate-600" placeholder="Add a concise outcome for reviewers." data-testid="input-coding-result-summary" /></label><Button onClick={update} disabled={updateTask.isPending} className="mt-3 bg-cyan-300 text-[#062028] hover:bg-cyan-200" data-testid="button-update-coding-task">{updateTask.isPending ? <><Loader2 className="animate-spin" />{t("pages.codingWorkspace.updating")}</> : <><CheckCircle2 />{t("pages.codingWorkspace.saveUpdate")}</>}</Button></section>
      </CardContent>
    </Card>
  );
}

export default function CodingWorkspace() {
  const { t, lang } = useLang();
  const params = useParams<{ id?: string }>();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [search, setSearch] = useState("");
  const { data: tasks, isLoading, isError, refetch } = useListCodingTasks();
  const activeFromRoute = params.id;
  const visibleTasks = useMemo(() => {
    const source = tasks ?? [];
    const query = search.trim().toLowerCase();
    return query ? source.filter((task) => [task.taskNumber, task.projectName, task.repository, task.branch, task.status].some((value) => value.toLowerCase().includes(query))) : source;
  }, [tasks, search]);
  const selectedId = activeFromRoute ?? visibleTasks[0]?.id;
  const detailQuery = useGetCodingTask(selectedId ?? "", { query: { enabled: Boolean(selectedId), queryKey: getGetCodingTaskQueryKey(selectedId ?? "") } });
  const hasActiveRun = detailQuery.data?.runs.some((run) => run.status === "RUNNING") ?? false;
  const activeCount = (tasks ?? []).filter((task) => ACTIVE_STATUSES.has(task.status)).length;
  const readyCount = (tasks ?? []).filter((task) => task.status === CodingTaskStatus.READY_REVIEW || task.status === CodingTaskStatus.PR_CREATED).length;
  const completedCount = (tasks ?? []).filter((task) => task.status === CodingTaskStatus.COMPLETED).length;

  const pollCodingTask = useCallback(() => {
    void detailQuery.refetch();
    void queryClient.invalidateQueries({ queryKey: getListCodingTasksQueryKey() });
  }, [detailQuery.refetch, queryClient]);
  useCodingTaskPolling(Boolean(selectedId) && hasActiveRun, pollCodingTask);

  const selectTask = (task: CodingTask) => setLocation(`/coding-workspace/${task.id}`);
  const openFreshTask = (task: CodingTask) => setLocation(`/coding-workspace/${task.id}`);
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: getListCodingTasksQueryKey() });
    refetch();
  };

  return (
    <div className="min-h-[100dvh] bg-[#060b18] text-slate-100">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(ellipse_at_70%_0%,rgba(32,211,193,0.10),transparent_60%)]" />
      <div className="relative mx-auto max-w-[1680px] px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
        <header className="mb-6 flex flex-col gap-5 border-b border-white/[0.07] pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div><div className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-300"><span className="size-1.5 rounded-full bg-cyan-300 shadow-[0_0_12px_rgba(45,212,191,0.8)]" />{t("pages.codingWorkspace.eyebrow")}</div><h1 className="font-display text-2xl font-semibold tracking-tight text-slate-100 sm:text-3xl">{t("pages.codingWorkspace.title")}</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">{t("pages.codingWorkspace.subtitle")}</p></div>
          <div className="flex items-center gap-2"><Button variant="ghost" onClick={refresh} className="text-slate-400 hover:bg-white/5 hover:text-slate-200" data-testid="button-refresh-coding-tasks"><RefreshCw className={cn("size-4", isLoading && "animate-spin")} />{t("pages.codingWorkspace.refresh")}</Button><Button onClick={() => setCreateOpen(true)} className="bg-cyan-300 text-[#062028] shadow-lg shadow-cyan-950/30 hover:bg-cyan-200" data-testid="button-open-create-coding-task"><Plus />{t("pages.codingWorkspace.newTask")}</Button></div>
        </header>
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[{ label: t("pages.codingWorkspace.total"), value: tasks?.length ?? 0, icon: Code2, tone: "text-cyan-300" }, { label: t("pages.codingWorkspace.active"), value: activeCount, icon: CircleDot, tone: "text-amber-300" }, { label: t("pages.codingWorkspace.ready"), value: readyCount, icon: ArrowUpRight, tone: "text-emerald-300" }, { label: t("pages.codingWorkspace.completed"), value: completedCount, icon: CheckCircle2, tone: "text-slate-300" }].map((stat) => <Card key={stat.label} className="border-white/[0.07] bg-[#0b1425]/80"><CardContent className="flex items-center gap-3 p-4"><stat.icon className={cn("size-4", stat.tone)} /><div><div className="font-mono text-xl font-semibold text-slate-100">{stat.value}</div><div className="mt-0.5 text-[10px] uppercase tracking-[0.12em] text-slate-600">{stat.label}</div></div></CardContent></Card>)}
        </div>
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(420px,0.9fr)]">
          <Card className="min-w-0 overflow-hidden border-white/[0.08] bg-[#0b1425]/85">
            <CardHeader className="border-b border-white/[0.07] p-4 sm:p-5"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex items-center gap-2"><h2 className="font-display text-base text-slate-100">{t("pages.codingWorkspace.taskQueue")}</h2><span className="rounded-full bg-cyan-300/10 px-2 py-0.5 font-mono text-[10px] text-cyan-300">{tasks?.length ?? 0}</span></div><p className="mt-1 text-xs text-slate-600">{t("pages.codingWorkspace.taskQueueHint")}</p></div><div className="relative w-full sm:w-56"><Search className="pointer-events-none absolute left-3 top-2.5 size-3.5 text-slate-600" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("common.actions.search")} className="h-9 border-white/10 bg-[#091222] pl-9 text-xs text-slate-200 placeholder:text-slate-600" aria-label={t("common.actions.search")} data-testid="input-search-coding-tasks" /></div></div></CardHeader>
            <CardContent className="p-0">
              {isLoading ? <TaskSkeleton /> : isError ? <div className="flex min-h-[360px] flex-col items-center justify-center px-6 text-center"><XCircle className="mb-4 size-8 text-rose-300" /><p className="font-display text-lg text-slate-100">{t("pages.codingWorkspace.errorTitle")}</p><p className="mt-2 max-w-sm text-sm leading-6 text-slate-500">{t("pages.codingWorkspace.errorHint")}</p><Button variant="outline" onClick={() => refetch()} className="mt-5 border-white/10 text-slate-300 hover:bg-white/5" data-testid="button-retry-coding-tasks"><RotateCcw />{t("pages.codingWorkspace.retry")}</Button></div> : visibleTasks.length === 0 ? <div className="flex min-h-[360px] flex-col items-center justify-center px-6 text-center"><div className="mb-4 flex size-12 items-center justify-center rounded-2xl border border-cyan-300/20 bg-cyan-300/10 text-cyan-300"><Code2 className="size-5" /></div><p className="font-display text-lg text-slate-100">{tasks?.length ? t("common.noResults") : t("pages.codingWorkspace.emptyTitle")}</p><p className="mt-2 max-w-sm text-sm leading-6 text-slate-500">{tasks?.length ? t("common.noResults") : t("pages.codingWorkspace.emptyHint")}</p>{!tasks?.length && <Button onClick={() => setCreateOpen(true)} className="mt-5 bg-cyan-300 text-[#062028] hover:bg-cyan-200" data-testid="button-empty-create-coding-task"><Plus />{t("pages.codingWorkspace.newTask")}</Button>}</div> : <div className="divide-y divide-white/[0.05]">{visibleTasks.map((task) => <button type="button" key={task.id} onClick={() => selectTask(task)} className={cn("group grid w-full grid-cols-1 gap-3 px-4 py-4 text-left transition-colors hover:bg-cyan-300/[0.04] sm:grid-cols-[1.05fr_1.5fr_1fr_0.85fr] sm:items-center sm:gap-4 sm:px-5", selectedId === task.id && "bg-cyan-300/[0.06]")} data-testid={`row-coding-task-${task.id}`}><div className="flex items-center justify-between sm:block"><div className="font-mono text-xs font-semibold text-cyan-300">{task.taskNumber}</div><div className="mt-1 hidden items-center gap-1.5 text-[10px] text-slate-600 sm:flex"><Clock3 className="size-3" />{formatDate(task.createdAt, lang)}</div><ChevronRight className="size-4 text-slate-700 transition-transform group-hover:translate-x-0.5 sm:hidden" /></div><div className="min-w-0"><div className="truncate text-sm font-medium text-slate-200">{task.projectName}</div><div className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-slate-600"><span className="truncate">{task.repository}</span><span className="text-slate-700">·</span><span className="truncate text-slate-500">{task.branch}</span></div></div><div><StatusBadge status={task.status} label={t(`pages.codingWorkspace.statuses.${task.status.toLowerCase()}`)} /></div><div className="flex items-center justify-between text-xs text-slate-600 sm:block sm:text-right"><span className="sm:hidden">{formatDate(task.createdAt, lang)}</span><span className="font-mono text-[10px] text-slate-500">P{task.priority}</span></div></button>)}</div>}
            </CardContent>
          </Card>
          <div className={cn(!selectedId && "hidden xl:block")}>{selectedId ? <TaskDetailPanel detail={detailQuery.data} isLoading={detailQuery.isLoading} isError={detailQuery.isError} onRetry={() => detailQuery.refetch()} onClose={() => setLocation("/coding-workspace")} /> : <Card className="min-h-[420px] border-white/[0.08] bg-[#0c1628]"><CardContent className="flex min-h-[420px] flex-col items-center justify-center p-8 text-center"><div className="mb-4 flex size-12 items-center justify-center rounded-2xl border border-cyan-300/20 bg-cyan-300/10 text-cyan-300"><Code2 className="size-5" /></div><p className="font-display text-lg text-slate-100">{isLoading ? t("pages.codingWorkspace.loading") : t("pages.codingWorkspace.selectTask")}</p></CardContent></Card>}</div>
        </div>
        <div className="mt-5 flex items-center gap-2 text-[10px] uppercase tracking-[0.15em] text-slate-700"><div className="h-px flex-1 bg-white/[0.05]" /><span>Travelintrips engineering / coding intake</span><div className="h-px flex-1 bg-white/[0.05]" /></div>
      </div>
      <CreateTaskDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={openFreshTask} />
    </div>
  );
}