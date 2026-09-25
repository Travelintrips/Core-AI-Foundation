import { useCallback, useEffect, useMemo, useState } from "react";
import { CodingAiObservabilityPanel } from "./codingAiObservabilityPanel";
import { CodingMissionControlPanel } from "./codingMissionControlPanel";
import { useForm } from "react-hook-form";
import { z } from "zod/v3";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link, useLocation, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Clock3,
  Code2,
  Copy,
  FileCode2,
  GitBranch,
  Github,
  GitCommitHorizontal,
  History,
  Loader2,
  LockKeyhole,
  Plus,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  FileDiff,
  Bot,
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
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/apiFetch";
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

type CodingGitHubRepository = {
  fullName: string;
  owner: string;
  name: string;
  private: boolean;
  defaultBranch: string;
  htmlUrl: string;
  updatedAt: string | null;
};

type CodingGitHubBranch = {
  name: string;
  protected: boolean;
  commitSha: string;
};

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
  localExecutionPlan?: {
    status?: string;
    reason?: string;
    targetFiles: string[];
    verificationCommands: string[];
    operations: Array<{ kind?: string; path?: string }>;
    warnings: string[];
  };
  localExecution?: {
    status?: string;
    reason?: string;
    changedFiles: string[];
    patch?: string;
    rolledBack?: boolean;
    warnings: string[];
    verification: Array<{ command?: string; status?: string }>;
    verificationAttempts: Array<{
      attempt?: number;
      passed?: boolean;
      staticIssues: Array<{ file?: string; kind?: string; detail?: string; line?: number }>;
      commands: Array<{ command?: string; status?: string }>;
    }>;
    autoFixes: string[];
    scriptsExecuted?: boolean;
  };
  localPatchApproval?: {
    status?: string;
    gateStatus?: string;
    reason?: string;
    changedFiles: string[];
    scriptsExecuted?: boolean;
    warnings: string[];
    approvedAt?: string;
    commitCreated?: boolean;
    pushed?: boolean;
  };
  sandboxVerification?: {
    status?: string;
    gateStatus?: string;
    runtime?: string;
    image?: string;
    network?: string;
    verificationCommands: string[];
    commands: Array<{ command?: string; status?: string; exitCode?: number | null; durationMs?: number }>;
    deterministicRetries: Array<{ command?: string; trigger?: string; status?: string }>;
    failureContexts: Array<{
      command?: string;
      status?: string;
      exitCode?: number | null;
      kind?: string;
      primaryFiles: string[];
      errorCodes: string[];
      diagnostics: Array<{
        kind?: string;
        file?: string;
        line?: number;
        column?: number;
        code?: string;
        symbol?: string;
        message?: string;
      }>;
      retry?: { allowed?: boolean; reason?: string; command?: string };
      warnings: string[];
    }>;
    scriptsExecuted?: boolean;
    warnings: string[];
    verifiedAt?: string;
  };
  failureRecoveryContext?: {
    status?: string;
    nextAction?: string;
    failureCommands: string[];
    failureKinds: string[];
    errorCodes: string[];
    focusFiles: string[];
    focusSymbols: Array<{
      name?: string;
      kind?: string;
      file?: string;
      line?: number;
      exported?: boolean;
    }>;
    dependencies: Array<{
      file?: string;
      specifier?: string;
      resolvedFile?: string;
      kind?: string;
    }>;
    relatedTests: string[];
    verificationCommands: string[];
    deterministicRetry?: {
      attempted?: boolean;
      exhausted?: boolean;
      commands: string[];
    };
    warnings: string[];
  };
  localRecovery?: {
    status?: string;
    reason?: string;
    attempts: Array<{
      attempt?: number;
      planStatus?: string;
      operations?: number;
      strategies: string[];
      sandboxStatus?: string;
      changedFiles: string[];
      reason?: string;
    }>;
    originalPatchSha256?: string;
    recoveredPatchSha256?: string;
    baseHeadSha?: string;
    changedFiles: string[];
    sandboxVerification?: string;
    aiInvoked?: boolean;
    commitCreated?: boolean;
    pushed?: boolean;
    completedAt?: string;
  };
  aiHandoff?: {
    status?: string;
    gateStatus?: string;
    packageHash?: string;
    preparedAt?: string;
    approvedAt?: string | null;
    expiresAt?: string | null;
    revokedAt?: string | null;
    modelInvoked?: boolean;
    package?: {
      allowedFiles: string[];
      diagnostics: Array<{
        command?: string;
        kind?: string;
        file?: string;
        line?: number;
        column?: number;
        code?: string;
        symbol?: string;
        message?: string;
      }>;
      snippets: Array<{
        file?: string;
        startLine?: number;
        endLine?: number;
        reason?: string;
      }>;
      relatedTests: string[];
      verificationCommands: string[];
      policy?: {
        readOnlyContext?: boolean;
        repositoryAccess?: boolean;
        networkAccess?: boolean;
        shellAccess?: boolean;
        secretAccess?: boolean;
        sourceWrite?: boolean;
        commitPushMerge?: boolean;
        modelInvoked?: boolean;
        requiresExplicitApprovalBeforeModel?: boolean;
        allowedFilesOnly?: boolean;
      };
    };
  };
  aiExecution?: {
    status?: string;
    gateStatus?: string;
    startedAt?: string;
    completedAt?: string;
    proposal?: {
      version?: number;
      summary?: string;
      rationale?: string;
      operationCount?: number;
      changedFiles: string[];
    };
    policyValidation?: {
      ok?: boolean;
      status?: string;
      codes: string[];
      errors: Array<{
        code?: string;
        message?: string;
        path?: string;
      }>;
    };
    patch?: {
      status?: string;
      reason?: string;
      changedFiles: string[];
      diff?: string;
      patchSha256?: string;
      rolledBack?: boolean;
      scriptsExecuted?: boolean;
      networkUsed?: boolean;
    };
    model?: {
      provider?: string;
      model?: string;
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
      latencyMs?: number;
      attempts?: number;
      retries?: number;
      fallbackUsed?: boolean;
    };
  };
  localCommitApproval?: {
    status?: string;
    branch?: string;
    baseBranch?: string;
    baseHeadSha?: string;
    commitSha?: string;
    pullRequestNumber?: number;
    pullRequestUrl?: string;
    commitCreated?: boolean;
    pushed?: boolean;
    autoMerged?: boolean;
    publishedAt?: string;
  };
  prVerification?: {
    status?: string;
    gateStatus?: string;
    reason?: string;
    pullRequestNumber?: number;
    pullRequestUrl?: string;
    baseSha?: string;
    headSha?: string;
    checks: Array<{ name?: string; status?: string; conclusion?: string | null }>;
    combinedStatus?: string | null;
    mergeable?: boolean | null;
    mergeableState?: string | null;
    draft?: boolean;
    verifiedAt?: string;
  };
  localMergeApproval?: {
    status?: string;
    pullRequestNumber?: number;
    pullRequestUrl?: string;
    sourceCommitSha?: string;
    baseHeadSha?: string;
    mergeCommitSha?: string;
    explicitApproval?: boolean;
    autoMerged?: boolean;
    mergedAt?: string;
  };
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
    const localExecutionPlanValue =
      value.localExecutionPlan && typeof value.localExecutionPlan === "object" && !Array.isArray(value.localExecutionPlan)
        ? (value.localExecutionPlan as Record<string, unknown>)
        : null;
    const localExecutionValue =
      value.localExecution && typeof value.localExecution === "object" && !Array.isArray(value.localExecution)
        ? (value.localExecution as Record<string, unknown>)
        : null;
    const localPatchApprovalValue =
      value.localPatchApproval && typeof value.localPatchApproval === "object" && !Array.isArray(value.localPatchApproval)
        ? (value.localPatchApproval as Record<string, unknown>)
        : null;
    const sandboxVerificationValue =
      value.sandboxVerification && typeof value.sandboxVerification === "object" && !Array.isArray(value.sandboxVerification)
        ? (value.sandboxVerification as Record<string, unknown>)
        : null;
    const failureRecoveryContextValue =
      value.failureRecoveryContext && typeof value.failureRecoveryContext === "object" && !Array.isArray(value.failureRecoveryContext)
        ? (value.failureRecoveryContext as Record<string, unknown>)
        : null;
    const localRecoveryValue =
      value.localRecovery && typeof value.localRecovery === "object" && !Array.isArray(value.localRecovery)
        ? (value.localRecovery as Record<string, unknown>)
        : null;
    const aiHandoffValue =
      value.aiHandoff && typeof value.aiHandoff === "object" && !Array.isArray(value.aiHandoff)
        ? (value.aiHandoff as Record<string, unknown>)
        : null;
    const recordOrNull = (input: unknown): Record<string, unknown> | null =>
      input && typeof input === "object" && !Array.isArray(input)
        ? input as Record<string, unknown>
        : null;
    const aiExecutionValue =
      recordOrNull(value.aiExecution) ??
      recordOrNull(value.constrainedAiExecution) ??
      recordOrNull(value.aiProposalExecution) ??
      recordOrNull(value.aiProposal);
    const aiProposalValue =
      recordOrNull(aiExecutionValue?.proposal) ??
      recordOrNull(aiExecutionValue?.parsedProposal) ??
      recordOrNull(value.aiProposal);
    const aiProposalBodyValue =
      recordOrNull(aiProposalValue?.proposal) ?? aiProposalValue;
    const aiPolicyValue =
      recordOrNull(aiExecutionValue?.policyValidation) ??
      recordOrNull(aiExecutionValue?.policyResult) ??
      recordOrNull(aiExecutionValue?.policy);
    const aiPatchValue =
      recordOrNull(aiExecutionValue?.patchApplication) ??
      recordOrNull(aiExecutionValue?.candidatePatch) ??
      recordOrNull(aiExecutionValue?.patchResult) ??
      recordOrNull(aiExecutionValue?.patch) ??
      (localExecutionValue?.source === "AI_PROPOSAL" ? localExecutionValue : null);
    const aiModelValue =
      recordOrNull(aiExecutionValue?.model) ??
      recordOrNull(aiExecutionValue?.modelMetadata) ??
      recordOrNull(aiExecutionValue?.invocationMetadata) ??
      recordOrNull(aiExecutionValue?.metadata);
    const aiModelUsageValue = recordOrNull(aiModelValue?.usage);
    const localCommitApprovalValue =
      value.localCommitApproval && typeof value.localCommitApproval === "object" && !Array.isArray(value.localCommitApproval)
        ? (value.localCommitApproval as Record<string, unknown>)
        : null;
    const prVerificationValue =
      value.prVerification && typeof value.prVerification === "object" && !Array.isArray(value.prVerification)
        ? (value.prVerification as Record<string, unknown>)
        : null;
    const localMergeApprovalValue =
      value.localMergeApproval && typeof value.localMergeApproval === "object" && !Array.isArray(value.localMergeApproval)
        ? (value.localMergeApproval as Record<string, unknown>)
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
      localExecutionPlan: localExecutionPlanValue
        ? {
            status: typeof localExecutionPlanValue.status === "string" ? localExecutionPlanValue.status : undefined,
            reason: typeof localExecutionPlanValue.reason === "string" ? localExecutionPlanValue.reason : undefined,
            targetFiles: stringList(localExecutionPlanValue.targetFiles),
            verificationCommands: stringList(localExecutionPlanValue.verificationCommands),
            operations: Array.isArray(localExecutionPlanValue.operations)
              ? localExecutionPlanValue.operations
                  .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
                  .map((item) => ({
                    kind: typeof item.kind === "string" ? item.kind : undefined,
                    path: typeof item.path === "string" ? item.path : undefined,
                  }))
              : [],
            warnings: stringList(localExecutionPlanValue.warnings),
          }
        : undefined,
      localExecution: localExecutionValue
        ? {
            status: typeof localExecutionValue.status === "string" ? localExecutionValue.status : undefined,
            reason: typeof localExecutionValue.reason === "string" ? localExecutionValue.reason : undefined,
            changedFiles: stringList(localExecutionValue.changedFiles),
            patch: typeof localExecutionValue.patch === "string" ? localExecutionValue.patch : undefined,
            rolledBack: localExecutionValue.rolledBack === true,
            warnings: stringList(localExecutionValue.warnings),
            verification: Array.isArray(localExecutionValue.verification)
              ? localExecutionValue.verification
                  .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
                  .map((item) => ({
                    command: typeof item.command === "string" ? item.command : undefined,
                    status: typeof item.status === "string" ? item.status : undefined,
                  }))
              : [],
            verificationAttempts: Array.isArray(localExecutionValue.verificationAttempts)
              ? localExecutionValue.verificationAttempts
                  .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
                  .map((item) => ({
                    attempt: typeof item.attempt === "number" ? item.attempt : undefined,
                    passed: item.passed === true,
                    staticIssues: Array.isArray(item.staticIssues)
                      ? item.staticIssues
                          .filter((issue): issue is Record<string, unknown> => Boolean(issue) && typeof issue === "object" && !Array.isArray(issue))
                          .map((issue) => ({
                            file: typeof issue.file === "string" ? issue.file : undefined,
                            kind: typeof issue.kind === "string" ? issue.kind : undefined,
                            detail: typeof issue.detail === "string" ? issue.detail : undefined,
                            line: typeof issue.line === "number" ? issue.line : undefined,
                          }))
                      : [],
                    commands: Array.isArray(item.commands)
                      ? item.commands
                          .filter((command): command is Record<string, unknown> => Boolean(command) && typeof command === "object" && !Array.isArray(command))
                          .map((command) => ({
                            command: typeof command.command === "string" ? command.command : undefined,
                            status: typeof command.status === "string" ? command.status : undefined,
                          }))
                      : [],
                  }))
              : [],
            autoFixes: stringList(localExecutionValue.autoFixes),
            scriptsExecuted: localExecutionValue.scriptsExecuted === true,
          }
        : undefined,
      localPatchApproval: localPatchApprovalValue
        ? {
            status: typeof localPatchApprovalValue.status === "string" ? localPatchApprovalValue.status : undefined,
            gateStatus: typeof localPatchApprovalValue.gateStatus === "string" ? localPatchApprovalValue.gateStatus : undefined,
            reason: typeof localPatchApprovalValue.reason === "string" ? localPatchApprovalValue.reason : undefined,
            changedFiles: stringList(localPatchApprovalValue.changedFiles),
            scriptsExecuted: localPatchApprovalValue.scriptsExecuted === true,
            warnings: stringList(localPatchApprovalValue.warnings),
            approvedAt: typeof localPatchApprovalValue.approvedAt === "string" ? localPatchApprovalValue.approvedAt : undefined,
            commitCreated: localPatchApprovalValue.commitCreated === true,
            pushed: localPatchApprovalValue.pushed === true,
          }
        : undefined,
      sandboxVerification: sandboxVerificationValue
        ? {
            status: typeof sandboxVerificationValue.status === "string" ? sandboxVerificationValue.status : undefined,
            gateStatus: typeof sandboxVerificationValue.gateStatus === "string" ? sandboxVerificationValue.gateStatus : undefined,
            runtime: typeof sandboxVerificationValue.runtime === "string" ? sandboxVerificationValue.runtime : undefined,
            image: typeof sandboxVerificationValue.image === "string" ? sandboxVerificationValue.image : undefined,
            network: typeof sandboxVerificationValue.network === "string" ? sandboxVerificationValue.network : undefined,
            verificationCommands: stringList(sandboxVerificationValue.verificationCommands),
            commands: Array.isArray(sandboxVerificationValue.commands)
              ? sandboxVerificationValue.commands
                  .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
                  .map((item) => ({
                    command: typeof item.command === "string" ? item.command : undefined,
                    status: typeof item.status === "string" ? item.status : undefined,
                    exitCode: typeof item.exitCode === "number" || item.exitCode === null ? item.exitCode as number | null : undefined,
                    durationMs: typeof item.durationMs === "number" ? item.durationMs : undefined,
                  }))
              : [],
            deterministicRetries: Array.isArray(sandboxVerificationValue.deterministicRetries)
              ? sandboxVerificationValue.deterministicRetries
                  .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
                  .map((item) => ({
                    command: typeof item.command === "string" ? item.command : undefined,
                    trigger: typeof item.trigger === "string" ? item.trigger : undefined,
                    status: typeof item.status === "string" ? item.status : undefined,
                  }))
              : [],
            failureContexts: Array.isArray(sandboxVerificationValue.failureContexts)
              ? sandboxVerificationValue.failureContexts
                  .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
                  .map((item) => ({
                    command: typeof item.command === "string" ? item.command : undefined,
                    status: typeof item.status === "string" ? item.status : undefined,
                    exitCode: typeof item.exitCode === "number" || item.exitCode === null ? item.exitCode as number | null : undefined,
                    kind: typeof item.kind === "string" ? item.kind : undefined,
                    primaryFiles: stringList(item.primaryFiles),
                    errorCodes: stringList(item.errorCodes),
                    diagnostics: Array.isArray(item.diagnostics)
                      ? item.diagnostics
                          .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry))
                          .map((entry) => ({
                            kind: typeof entry.kind === "string" ? entry.kind : undefined,
                            file: typeof entry.file === "string" ? entry.file : undefined,
                            line: typeof entry.line === "number" ? entry.line : undefined,
                            column: typeof entry.column === "number" ? entry.column : undefined,
                            code: typeof entry.code === "string" ? entry.code : undefined,
                            symbol: typeof entry.symbol === "string" ? entry.symbol : undefined,
                            message: typeof entry.message === "string" ? entry.message : undefined,
                          }))
                      : [],
                    retry: item.retry && typeof item.retry === "object" && !Array.isArray(item.retry)
                      ? {
                          allowed: (item.retry as Record<string, unknown>).allowed === true,
                          reason: typeof (item.retry as Record<string, unknown>).reason === "string"
                            ? (item.retry as Record<string, unknown>).reason as string
                            : undefined,
                          command: typeof (item.retry as Record<string, unknown>).command === "string"
                            ? (item.retry as Record<string, unknown>).command as string
                            : undefined,
                        }
                      : undefined,
                    warnings: stringList(item.warnings),
                  }))
              : [],
            scriptsExecuted: sandboxVerificationValue.scriptsExecuted === true,
            warnings: stringList(sandboxVerificationValue.warnings),
            verifiedAt: typeof sandboxVerificationValue.verifiedAt === "string" ? sandboxVerificationValue.verifiedAt : undefined,
          }
        : undefined,
      failureRecoveryContext: failureRecoveryContextValue
        ? {
            status: typeof failureRecoveryContextValue.status === "string" ? failureRecoveryContextValue.status : undefined,
            nextAction: typeof failureRecoveryContextValue.nextAction === "string" ? failureRecoveryContextValue.nextAction : undefined,
            failureCommands: stringList(failureRecoveryContextValue.failureCommands),
            failureKinds: stringList(failureRecoveryContextValue.failureKinds),
            errorCodes: stringList(failureRecoveryContextValue.errorCodes),
            focusFiles: stringList(failureRecoveryContextValue.focusFiles),
            focusSymbols: Array.isArray(failureRecoveryContextValue.focusSymbols)
              ? failureRecoveryContextValue.focusSymbols
                  .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
                  .map((item) => ({
                    name: typeof item.name === "string" ? item.name : undefined,
                    kind: typeof item.kind === "string" ? item.kind : undefined,
                    file: typeof item.file === "string" ? item.file : undefined,
                    line: typeof item.line === "number" ? item.line : undefined,
                    exported: item.exported === true,
                  }))
              : [],
            dependencies: Array.isArray(failureRecoveryContextValue.dependencies)
              ? failureRecoveryContextValue.dependencies
                  .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
                  .map((item) => ({
                    file: typeof item.file === "string" ? item.file : undefined,
                    specifier: typeof item.specifier === "string" ? item.specifier : undefined,
                    resolvedFile: typeof item.resolvedFile === "string" ? item.resolvedFile : undefined,
                    kind: typeof item.kind === "string" ? item.kind : undefined,
                  }))
              : [],
            relatedTests: stringList(failureRecoveryContextValue.relatedTests),
            verificationCommands: stringList(failureRecoveryContextValue.verificationCommands),
            deterministicRetry:
              failureRecoveryContextValue.deterministicRetry &&
              typeof failureRecoveryContextValue.deterministicRetry === "object" &&
              !Array.isArray(failureRecoveryContextValue.deterministicRetry)
                ? {
                    attempted: (failureRecoveryContextValue.deterministicRetry as Record<string, unknown>).attempted === true,
                    exhausted: (failureRecoveryContextValue.deterministicRetry as Record<string, unknown>).exhausted === true,
                    commands: stringList((failureRecoveryContextValue.deterministicRetry as Record<string, unknown>).commands),
                  }
                : undefined,
            warnings: stringList(failureRecoveryContextValue.warnings),
          }
        : undefined,
      localRecovery: localRecoveryValue
        ? {
            status: typeof localRecoveryValue.status === "string" ? localRecoveryValue.status : undefined,
            reason: typeof localRecoveryValue.reason === "string" ? localRecoveryValue.reason : undefined,
            attempts: Array.isArray(localRecoveryValue.attempts)
              ? localRecoveryValue.attempts
                  .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
                  .map((item) => ({
                    attempt: typeof item.attempt === "number" ? item.attempt : undefined,
                    planStatus: typeof item.planStatus === "string" ? item.planStatus : undefined,
                    operations: typeof item.operations === "number" ? item.operations : undefined,
                    strategies: stringList(item.strategies),
                    sandboxStatus: typeof item.sandboxStatus === "string" ? item.sandboxStatus : undefined,
                    changedFiles: stringList(item.changedFiles),
                    reason: typeof item.reason === "string" ? item.reason : undefined,
                  }))
              : [],
            originalPatchSha256: typeof localRecoveryValue.originalPatchSha256 === "string" ? localRecoveryValue.originalPatchSha256 : undefined,
            recoveredPatchSha256: typeof localRecoveryValue.recoveredPatchSha256 === "string" ? localRecoveryValue.recoveredPatchSha256 : undefined,
            baseHeadSha: typeof localRecoveryValue.baseHeadSha === "string" ? localRecoveryValue.baseHeadSha : undefined,
            changedFiles: stringList(localRecoveryValue.changedFiles),
            sandboxVerification: typeof localRecoveryValue.sandboxVerification === "string" ? localRecoveryValue.sandboxVerification : undefined,
            aiInvoked: localRecoveryValue.aiInvoked === true,
            commitCreated: localRecoveryValue.commitCreated === true,
            pushed: localRecoveryValue.pushed === true,
            completedAt: typeof localRecoveryValue.completedAt === "string" ? localRecoveryValue.completedAt : undefined,
          }
        : undefined,
      aiHandoff: aiHandoffValue
        ? (() => {
            const packageValue =
              aiHandoffValue.package &&
              typeof aiHandoffValue.package === "object" &&
              !Array.isArray(aiHandoffValue.package)
                ? aiHandoffValue.package as Record<string, unknown>
                : null;
            const policyValue =
              packageValue?.policy &&
              typeof packageValue.policy === "object" &&
              !Array.isArray(packageValue.policy)
                ? packageValue.policy as Record<string, unknown>
                : null;
            return {
              status: typeof aiHandoffValue.status === "string" ? aiHandoffValue.status : undefined,
              gateStatus: typeof aiHandoffValue.gateStatus === "string" ? aiHandoffValue.gateStatus : undefined,
              packageHash: typeof aiHandoffValue.packageHash === "string" ? aiHandoffValue.packageHash : undefined,
              preparedAt: typeof aiHandoffValue.preparedAt === "string" ? aiHandoffValue.preparedAt : undefined,
              approvedAt: typeof aiHandoffValue.approvedAt === "string" || aiHandoffValue.approvedAt === null
                ? aiHandoffValue.approvedAt as string | null
                : undefined,
              expiresAt: typeof aiHandoffValue.expiresAt === "string" || aiHandoffValue.expiresAt === null
                ? aiHandoffValue.expiresAt as string | null
                : undefined,
              revokedAt: typeof aiHandoffValue.revokedAt === "string" || aiHandoffValue.revokedAt === null
                ? aiHandoffValue.revokedAt as string | null
                : undefined,
              modelInvoked: aiHandoffValue.modelInvoked === true,
              package: packageValue
                ? {
                    allowedFiles: stringList(packageValue.allowedFiles),
                    diagnostics: Array.isArray(packageValue.diagnostics)
                      ? packageValue.diagnostics
                          .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
                          .map((item) => ({
                            command: typeof item.command === "string" ? item.command : undefined,
                            kind: typeof item.kind === "string" ? item.kind : undefined,
                            file: typeof item.file === "string" ? item.file : undefined,
                            line: typeof item.line === "number" ? item.line : undefined,
                            column: typeof item.column === "number" ? item.column : undefined,
                            code: typeof item.code === "string" ? item.code : undefined,
                            symbol: typeof item.symbol === "string" ? item.symbol : undefined,
                            message: typeof item.message === "string" ? item.message : undefined,
                          }))
                      : [],
                    snippets: Array.isArray(packageValue.snippets)
                      ? packageValue.snippets
                          .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
                          .map((item) => ({
                            file: typeof item.file === "string" ? item.file : undefined,
                            startLine: typeof item.startLine === "number" ? item.startLine : undefined,
                            endLine: typeof item.endLine === "number" ? item.endLine : undefined,
                            reason: typeof item.reason === "string" ? item.reason : undefined,
                          }))
                      : [],
                    relatedTests: stringList(packageValue.relatedTests),
                    verificationCommands: stringList(packageValue.verificationCommands),
                    policy: policyValue
                      ? {
                          readOnlyContext: policyValue.readOnlyContext === true,
                          repositoryAccess: policyValue.repositoryAccess === true,
                          networkAccess: policyValue.networkAccess === true,
                          shellAccess: policyValue.shellAccess === true,
                          secretAccess: policyValue.secretAccess === true,
                          sourceWrite: policyValue.sourceWrite === true,
                          commitPushMerge: policyValue.commitPushMerge === true,
                          modelInvoked: policyValue.modelInvoked === true,
                          requiresExplicitApprovalBeforeModel: policyValue.requiresExplicitApprovalBeforeModel === true,
                          allowedFilesOnly: policyValue.allowedFilesOnly === true,
                        }
                      : undefined,
                  }
                : undefined,
            };
          })()
        : undefined,
      aiExecution:
        aiExecutionValue || aiProposalValue || aiPolicyValue || aiPatchValue || aiModelValue
          ? (() => {
              const proposalOperations = Array.isArray(aiProposalBodyValue?.operations)
                ? aiProposalBodyValue.operations.filter(
                    (item): item is Record<string, unknown> =>
                      Boolean(item) && typeof item === "object" && !Array.isArray(item),
                  )
                : [];
              const proposalFiles = [
                ...new Set(
                  proposalOperations
                    .map((item) =>
                      typeof item.file === "string"
                        ? item.file
                        : typeof item.path === "string"
                          ? item.path
                          : null,
                    )
                    .filter((item): item is string => Boolean(item)),
                ),
              ];
              const policyErrors = Array.isArray(aiPolicyValue?.errors)
                ? aiPolicyValue.errors
                    .filter(
                      (item): item is Record<string, unknown> =>
                        Boolean(item) && typeof item === "object" && !Array.isArray(item),
                    )
                    .map((item) => ({
                      code: typeof item.code === "string" ? item.code : undefined,
                      message: typeof item.message === "string" ? item.message : undefined,
                      path: typeof item.path === "string" ? item.path : undefined,
                    }))
                : [];
              const changedFiles = stringList(
                aiPatchValue?.changedFiles ?? aiExecutionValue?.changedFiles,
              );
              const totalTokens =
                typeof aiModelUsageValue?.totalTokens === "number"
                  ? aiModelUsageValue.totalTokens
                  : typeof aiModelValue?.totalTokens === "number"
                    ? aiModelValue.totalTokens
                    : undefined;
              return {
                status:
                  typeof aiExecutionValue?.status === "string"
                    ? aiExecutionValue.status
                    : typeof aiExecutionValue?.executionStatus === "string"
                      ? aiExecutionValue.executionStatus
                      : undefined,
                gateStatus:
                  typeof aiExecutionValue?.gateStatus === "string"
                    ? aiExecutionValue.gateStatus
                    : undefined,
                startedAt:
                  typeof aiExecutionValue?.startedAt === "string"
                    ? aiExecutionValue.startedAt
                    : undefined,
                completedAt:
                  typeof aiExecutionValue?.completedAt === "string"
                    ? aiExecutionValue.completedAt
                    : undefined,
                proposal:
                  aiProposalBodyValue ||
                  typeof aiExecutionValue?.proposalSummary === "string" ||
                  typeof aiExecutionValue?.proposalRationale === "string"
                    ? {
                        version:
                          typeof aiProposalValue?.version === "number"
                            ? aiProposalValue.version
                            : typeof aiExecutionValue?.proposalVersion === "number"
                              ? aiExecutionValue.proposalVersion
                              : undefined,
                        summary:
                          typeof aiProposalBodyValue?.summary === "string"
                            ? aiProposalBodyValue.summary
                            : typeof aiExecutionValue?.proposalSummary === "string"
                              ? aiExecutionValue.proposalSummary
                              : undefined,
                        rationale:
                          typeof aiProposalBodyValue?.rationale === "string"
                            ? aiProposalBodyValue.rationale
                            : typeof aiExecutionValue?.proposalRationale === "string"
                              ? aiExecutionValue.proposalRationale
                              : undefined,
                        operationCount: proposalOperations.length,
                        changedFiles: changedFiles.length > 0 ? changedFiles : proposalFiles,
                      }
                    : undefined,
                policyValidation:
                  aiPolicyValue || typeof aiExecutionValue?.policyStatus === "string"
                    ? {
                        ok:
                          typeof aiPolicyValue?.ok === "boolean"
                            ? aiPolicyValue.ok
                            : typeof aiPolicyValue?.passed === "boolean"
                              ? aiPolicyValue.passed
                              : aiExecutionValue?.policyStatus === "PASSED"
                                ? true
                                : aiExecutionValue?.policyStatus === "FAILED"
                                  ? false
                                  : undefined,
                        status:
                          typeof aiPolicyValue?.status === "string"
                            ? aiPolicyValue.status
                            : typeof aiExecutionValue?.policyStatus === "string"
                              ? aiExecutionValue.policyStatus
                              : undefined,
                        codes: policyErrors
                          .map((item) => item.code)
                          .filter((item): item is string => Boolean(item)),
                        errors: policyErrors,
                      }
                    : undefined,
                patch: aiPatchValue || typeof aiExecutionValue?.patch === "string"
                  ? {
                      status:
                        typeof aiPatchValue?.status === "string"
                          ? aiPatchValue.status
                          : undefined,
                      reason:
                        typeof aiPatchValue?.reason === "string"
                          ? aiPatchValue.reason
                          : undefined,
                      changedFiles,
                      diff:
                        typeof aiPatchValue?.patch === "string"
                          ? aiPatchValue.patch
                          : typeof aiPatchValue?.diff === "string"
                            ? aiPatchValue.diff
                            : typeof aiExecutionValue?.patch === "string"
                              ? aiExecutionValue.patch
                              : typeof aiExecutionValue?.diff === "string"
                                ? aiExecutionValue.diff
                                : undefined,
                      patchSha256:
                        typeof aiPatchValue?.patchSha256 === "string"
                          ? aiPatchValue.patchSha256
                          : undefined,
                      rolledBack: aiPatchValue?.rolledBack === true,
                      scriptsExecuted: aiPatchValue?.scriptsExecuted === true,
                      networkUsed: aiPatchValue?.networkUsed === true,
                    }
                  : undefined,
                model: aiModelValue
                  ? {
                      provider:
                        typeof aiModelValue.provider === "string"
                          ? aiModelValue.provider
                          : undefined,
                      model:
                        typeof aiModelValue.model === "string"
                          ? aiModelValue.model
                          : typeof aiModelValue.modelUsed === "string"
                            ? aiModelValue.modelUsed
                            : undefined,
                      inputTokens:
                        typeof aiModelUsageValue?.inputTokens === "number"
                          ? aiModelUsageValue.inputTokens
                          : undefined,
                      outputTokens:
                        typeof aiModelUsageValue?.outputTokens === "number"
                          ? aiModelUsageValue.outputTokens
                          : undefined,
                      totalTokens,
                      latencyMs:
                        typeof aiModelValue.latencyMs === "number"
                          ? aiModelValue.latencyMs
                          : undefined,
                      attempts:
                        typeof aiModelValue.attempts === "number"
                          ? aiModelValue.attempts
                          : undefined,
                      retries:
                        typeof aiModelValue.retries === "number"
                          ? aiModelValue.retries
                          : undefined,
                      fallbackUsed: aiModelValue.fallbackUsed === true,
                    }
                  : undefined,
              };
            })()
          : undefined,
      localCommitApproval: localCommitApprovalValue
        ? {
            status: typeof localCommitApprovalValue.status === "string" ? localCommitApprovalValue.status : undefined,
            branch: typeof localCommitApprovalValue.branch === "string" ? localCommitApprovalValue.branch : undefined,
            baseBranch: typeof localCommitApprovalValue.baseBranch === "string" ? localCommitApprovalValue.baseBranch : undefined,
            baseHeadSha: typeof localCommitApprovalValue.baseHeadSha === "string" ? localCommitApprovalValue.baseHeadSha : undefined,
            commitSha: typeof localCommitApprovalValue.commitSha === "string" ? localCommitApprovalValue.commitSha : undefined,
            pullRequestNumber: typeof localCommitApprovalValue.pullRequestNumber === "number" ? localCommitApprovalValue.pullRequestNumber : undefined,
            pullRequestUrl: typeof localCommitApprovalValue.pullRequestUrl === "string" ? localCommitApprovalValue.pullRequestUrl : undefined,
            commitCreated: localCommitApprovalValue.commitCreated === true,
            pushed: localCommitApprovalValue.pushed === true,
            autoMerged: localCommitApprovalValue.autoMerged === true,
            publishedAt: typeof localCommitApprovalValue.publishedAt === "string" ? localCommitApprovalValue.publishedAt : undefined,
          }
        : undefined,
      prVerification: prVerificationValue
        ? {
            status: typeof prVerificationValue.status === "string" ? prVerificationValue.status : undefined,
            gateStatus: typeof prVerificationValue.gateStatus === "string" ? prVerificationValue.gateStatus : undefined,
            reason: typeof prVerificationValue.reason === "string" ? prVerificationValue.reason : undefined,
            pullRequestNumber: typeof prVerificationValue.pullRequestNumber === "number" ? prVerificationValue.pullRequestNumber : undefined,
            pullRequestUrl: typeof prVerificationValue.pullRequestUrl === "string" ? prVerificationValue.pullRequestUrl : undefined,
            baseSha: typeof prVerificationValue.baseSha === "string" ? prVerificationValue.baseSha : undefined,
            headSha: typeof prVerificationValue.headSha === "string" ? prVerificationValue.headSha : undefined,
            checks: Array.isArray(prVerificationValue.checks)
              ? prVerificationValue.checks
                  .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
                  .map((item) => ({
                    name: typeof item.name === "string" ? item.name : undefined,
                    status: typeof item.status === "string" ? item.status : undefined,
                    conclusion: typeof item.conclusion === "string" || item.conclusion === null ? item.conclusion as string | null : undefined,
                  }))
              : [],
            combinedStatus: typeof prVerificationValue.combinedStatus === "string" || prVerificationValue.combinedStatus === null
              ? prVerificationValue.combinedStatus as string | null
              : undefined,
            mergeable: typeof prVerificationValue.mergeable === "boolean" || prVerificationValue.mergeable === null
              ? prVerificationValue.mergeable as boolean | null
              : undefined,
            mergeableState: typeof prVerificationValue.mergeableState === "string" || prVerificationValue.mergeableState === null
              ? prVerificationValue.mergeableState as string | null
              : undefined,
            draft: prVerificationValue.draft === true,
            verifiedAt: typeof prVerificationValue.verifiedAt === "string" ? prVerificationValue.verifiedAt : undefined,
          }
        : undefined,
      localMergeApproval: localMergeApprovalValue
        ? {
            status: typeof localMergeApprovalValue.status === "string" ? localMergeApprovalValue.status : undefined,
            pullRequestNumber: typeof localMergeApprovalValue.pullRequestNumber === "number" ? localMergeApprovalValue.pullRequestNumber : undefined,
            pullRequestUrl: typeof localMergeApprovalValue.pullRequestUrl === "string" ? localMergeApprovalValue.pullRequestUrl : undefined,
            sourceCommitSha: typeof localMergeApprovalValue.sourceCommitSha === "string" ? localMergeApprovalValue.sourceCommitSha : undefined,
            baseHeadSha: typeof localMergeApprovalValue.baseHeadSha === "string" ? localMergeApprovalValue.baseHeadSha : undefined,
            mergeCommitSha: typeof localMergeApprovalValue.mergeCommitSha === "string" ? localMergeApprovalValue.mergeCommitSha : undefined,
            explicitApproval: localMergeApprovalValue.explicitApproval === true,
            autoMerged: localMergeApprovalValue.autoMerged === true,
            mergedAt: typeof localMergeApprovalValue.mergedAt === "string" ? localMergeApprovalValue.mergedAt : undefined,
          }
        : undefined,
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

function GitHubRepositoryPicker({
  value,
  onChange,
  onDefaultBranch,
  onRepositoryName,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  onDefaultBranch: (branch: string) => void;
  onRepositoryName: (name: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [repositories, setRepositories] = useState<CodingGitHubRepository[]>([]);
  const [connectionMode, setConnectionMode] = useState<"authenticated" | "public" | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRepositories = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch<{
        repositories: CodingGitHubRepository[];
        connectionMode: "authenticated" | "public";
        privateRepositoriesAvailable: boolean;
      }>("/api/ai/coding/github/repositories");
      setRepositories(response.repositories);
      setConnectionMode(response.connectionMode);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Gagal memuat repository GitHub.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && repositories.length === 0 && !loading && !error) {
      void loadRepositories();
    }
  }, [open, repositories.length, loading, error, loadRepositories]);

  const selected = repositories.find((item) => item.fullName === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="h-10 w-full justify-between border-white/10 bg-[#091222] px-3 font-normal text-slate-100 hover:bg-white/[0.04] hover:text-slate-100"
          data-testid="button-coding-repository-picker"
        >
          <span className="flex min-w-0 items-center gap-2">
            <Github className="size-4 shrink-0 text-slate-500" />
            <span className={cn("truncate", !value && "text-slate-600")}>
              {value || "Cari repository GitHub…"}
            </span>
          </span>
          <ChevronDown className="size-4 shrink-0 text-slate-600" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] min-w-[360px] border-white/10 bg-[#0b1425] p-0 shadow-2xl"
      >
        <Command className="bg-transparent text-slate-100">
          <CommandInput
            placeholder="Cari owner / repository…"
            className="text-slate-100 placeholder:text-slate-600"
            data-testid="input-search-github-repositories"
          />
          <CommandList className="max-h-72">
            {loading ? (
              <div className="flex items-center justify-center gap-2 px-4 py-8 text-xs text-slate-500">
                <Loader2 className="size-4 animate-spin" />
                Memuat repository GitHub…
              </div>
            ) : error ? (
              <div className="space-y-3 px-4 py-5 text-center">
                <p className="text-xs leading-5 text-rose-300">{error}</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void loadRepositories()}
                  className="border-white/10 text-slate-300"
                >
                  <RefreshCw className="size-3.5" />
                  Coba lagi
                </Button>
              </div>
            ) : (
              <>
                <CommandEmpty>Tidak ada repository yang cocok.</CommandEmpty>
                <CommandGroup heading="Repository yang terhubung">
                  {repositories.map((repository) => (
                    <CommandItem
                      key={repository.fullName}
                      value={`${repository.fullName} ${repository.owner} ${repository.name}`}
                      onSelect={() => {
                        onChange(repository.fullName);
                        onDefaultBranch(repository.defaultBranch);
                        onRepositoryName(repository.name);
                        setOpen(false);
                      }}
                      className="cursor-pointer py-2.5 text-slate-300 data-[selected=true]:bg-cyan-300/10 data-[selected=true]:text-slate-100"
                      data-testid={`option-coding-repository-${repository.fullName.replace(/[^a-zA-Z0-9_-]/g, "-")}`}
                    >
                      <Check
                        className={cn(
                          "size-4 text-cyan-300",
                          value === repository.fullName ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium">
                          {repository.fullName}
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 text-[10px] text-slate-600">
                          <span>{repository.private ? "Private" : "Public"}</span>
                          <span>·</span>
                          <span>default: {repository.defaultBranch}</span>
                        </div>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
        {!error && connectionMode && (
          <div className="border-t border-white/[0.06] px-3 py-2 text-[10px] text-slate-600">
            {connectionMode === "authenticated"
              ? "GitHub authenticated · public + private repository"
              : "GitHub public · private repository membutuhkan token server"}
            {selected ? ` · dipilih: ${selected.fullName}` : ""}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function GitHubBranchPicker({
  repository,
  value,
  onChange,
  disabled,
}: {
  repository: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [branches, setBranches] = useState<CodingGitHubBranch[]>([]);
  const [loadedRepository, setLoadedRepository] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadBranches = useCallback(async () => {
    if (!repository || !repository.includes("/")) return;
    const [owner, name] = repository.split("/");
    if (!owner || !name) return;

    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch<{ branches: CodingGitHubBranch[] }>(
        `/api/ai/coding/github/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/branches`,
      );
      setBranches(response.branches);
      setLoadedRepository(repository);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Gagal memuat branch GitHub.",
      );
    } finally {
      setLoading(false);
    }
  }, [repository]);

  useEffect(() => {
    if (repository !== loadedRepository) {
      setBranches([]);
      setError(null);
    }
  }, [repository, loadedRepository]);

  useEffect(() => {
    if (
      open &&
      repository &&
      repository !== loadedRepository &&
      !loading &&
      !error
    ) {
      void loadBranches();
    }
  }, [open, repository, loadedRepository, loading, error, loadBranches]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled || !repository}
          className="h-10 w-full justify-between border-white/10 bg-[#091222] px-3 font-normal text-slate-100 hover:bg-white/[0.04] hover:text-slate-100 disabled:opacity-50"
          data-testid="button-coding-branch-picker"
        >
          <span className="flex min-w-0 items-center gap-2">
            <GitBranch className="size-4 shrink-0 text-slate-600" />
            <span className={cn("truncate", !value && "text-slate-600")}>
              {value || (repository ? "Pilih branch…" : "Pilih repository dulu")}
            </span>
          </span>
          <ChevronDown className="size-4 shrink-0 text-slate-600" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] min-w-[300px] border-white/10 bg-[#0b1425] p-0 shadow-2xl"
      >
        <Command className="bg-transparent text-slate-100">
          <CommandInput
            placeholder="Cari branch…"
            className="text-slate-100 placeholder:text-slate-600"
            data-testid="input-search-github-branches"
          />
          <CommandList className="max-h-64">
            {loading ? (
              <div className="flex items-center justify-center gap-2 px-4 py-8 text-xs text-slate-500">
                <Loader2 className="size-4 animate-spin" />
                Memuat branch…
              </div>
            ) : error ? (
              <div className="space-y-3 px-4 py-5 text-center">
                <p className="text-xs text-rose-300">{error}</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void loadBranches()}
                  className="border-white/10 text-slate-300"
                >
                  <RefreshCw className="size-3.5" />
                  Coba lagi
                </Button>
              </div>
            ) : (
              <>
                <CommandEmpty>Tidak ada branch yang cocok.</CommandEmpty>
                <CommandGroup heading="Branch GitHub">
                  {branches.map((branchItem) => (
                    <CommandItem
                      key={branchItem.name}
                      value={branchItem.name}
                      onSelect={() => {
                        onChange(branchItem.name);
                        setOpen(false);
                      }}
                      className="cursor-pointer text-slate-300 data-[selected=true]:bg-cyan-300/10 data-[selected=true]:text-slate-100"
                      data-testid={`option-coding-branch-${branchItem.name.replace(/[^a-zA-Z0-9_-]/g, "-")}`}
                    >
                      <Check
                        className={cn(
                          "size-4 text-cyan-300",
                          value === branchItem.name ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate">{branchItem.name}</span>
                      {branchItem.protected && (
                        <span className="rounded bg-amber-300/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-amber-300">
                          protected
                        </span>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
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
                <FormItem>
                  <FormLabel className="text-slate-300">{t("pages.codingWorkspace.repository")} <span className="text-cyan-300">*</span></FormLabel>
                  <FormControl>
                    <GitHubRepositoryPicker
                      value={field.value}
                      onChange={(nextRepository) => {
                        field.onChange(nextRepository);
                      }}
                      onDefaultBranch={(defaultBranch) => {
                        form.setValue("branch", defaultBranch, {
                          shouldDirty: true,
                          shouldValidate: true,
                        });
                      }}
                      onRepositoryName={(repositoryName) => {
                        if (!form.getValues("projectName").trim()) {
                          form.setValue("projectName", repositoryName, {
                            shouldDirty: true,
                            shouldValidate: true,
                          });
                        }
                      }}
                      disabled={createTask.isPending}
                    />
                  </FormControl>
                  <p className="text-[10px] text-slate-600">Search repository GitHub. Repo public tetap tersedia tanpa token; repo private muncul saat credential server aktif.</p>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="branch" render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-slate-300">{t("pages.codingWorkspace.branch")} <span className="text-cyan-300">*</span></FormLabel>
                  <FormControl>
                    <GitHubBranchPicker
                      repository={form.watch("repository")}
                      value={field.value}
                      onChange={field.onChange}
                      disabled={createTask.isPending}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
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

function TaskDetailPanel({ detail, isLoading, isError, onRetry, onClose, onAiExecutionQueued }: { detail?: CodingTaskDetail; isLoading: boolean; isError: boolean; onRetry: () => void; onClose: () => void; onAiExecutionQueued: () => void }) {
  const { t, lang } = useLang();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const updateTask = useUpdateCodingTask();
  const startCodingRun = useStartCodingRun();
  const [status, setStatus] = useState<CodingTaskStatus>(CodingTaskStatus.PENDING);
  const [summary, setSummary] = useState("");
  const [commitSha, setCommitSha] = useState("");
  const [approvePending, setApprovePending] = useState(false);
  const [localPatchPending, setLocalPatchPending] = useState(false);
  const [sandboxPending, setSandboxPending] = useState(false);
  const [recoveryPending, setRecoveryPending] = useState(false);
  const [handoffPreparePending, setHandoffPreparePending] = useState(false);
  const [handoffApprovePending, setHandoffApprovePending] = useState(false);
  const [handoffRevokePending, setHandoffRevokePending] = useState(false);
  const [aiRunPending, setAiRunPending] = useState(false);
  const [aiPatchReviewPending, setAiPatchReviewPending] = useState(false);
  const [commitPending, setCommitPending] = useState(false);
  const [prVerifyPending, setPrVerifyPending] = useState(false);
  const [mergePending, setMergePending] = useState(false);

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
  const displayedResultSummary = analyzerResult?.localPatchApproval
    ? task.resultSummary
    : analyzerResult?.summary ?? task.resultSummary;
  const canApprovePlan =
    task.status === CodingTaskStatus.READY_REVIEW &&
    analyzerResult?.orchestration?.nextAction === "APPROVE_PLAN" &&
    analyzerResult?.implementationPlan?.approvalRequired === true &&
    !hasActiveRun;
  const canApproveLocalPatch =
    task.status === CodingTaskStatus.READY_REVIEW &&
    analyzerResult?.orchestration?.nextAction === "REVIEW_LOCAL_PATCH" &&
    analyzerResult?.localExecution?.status === "APPLIED" &&
    analyzerResult.localExecution.rolledBack !== true &&
    !hasActiveRun;
  const canRunSandboxVerification =
    task.status === CodingTaskStatus.READY_REVIEW &&
    analyzerResult?.orchestration?.nextAction === "RUN_SANDBOX_VERIFICATION" &&
    analyzerResult?.localPatchApproval?.gateStatus === "PATCH_VALIDATED" &&
    analyzerResult.localPatchApproval.commitCreated !== true &&
    analyzerResult.localPatchApproval.pushed !== true &&
    !hasActiveRun;
  const canRunLocalRecovery =
    task.status === CodingTaskStatus.READY_REVIEW &&
    analyzerResult?.orchestration?.nextAction === "LOCAL_RECOVERY_REQUIRED" &&
    analyzerResult?.failureRecoveryContext?.nextAction === "LOCAL_RECOVERY_REQUIRED" &&
    analyzerResult?.sandboxVerification?.status === "FAILED" &&
    !hasActiveRun;
  const canPrepareAiHandoff =
    task.status === CodingTaskStatus.READY_REVIEW &&
    analyzerResult?.orchestration?.nextAction === "AI_REQUIRED" &&
    analyzerResult?.localRecovery?.status === "AI_REQUIRED" &&
    analyzerResult.localRecovery.aiInvoked !== true &&
    !hasActiveRun;
  const canApproveAiHandoff =
    task.status === CodingTaskStatus.READY_REVIEW &&
    analyzerResult?.orchestration?.nextAction === "APPROVE_AI_HANDOFF" &&
    analyzerResult?.aiHandoff?.status === "PREPARED" &&
    analyzerResult.aiHandoff.gateStatus === "AWAITING_EXPLICIT_APPROVAL" &&
    analyzerResult.aiHandoff.modelInvoked !== true &&
    !hasActiveRun;
  const canRevokeAiHandoff =
    task.status === CodingTaskStatus.READY_REVIEW &&
    Boolean(analyzerResult?.aiHandoff) &&
    ["PREPARED", "APPROVED"].includes(analyzerResult?.aiHandoff?.status ?? "") &&
    ["APPROVE_AI_HANDOFF", "AI_HANDOFF_APPROVED"].includes(
      analyzerResult?.orchestration?.nextAction ?? "",
    ) &&
    analyzerResult?.aiHandoff?.modelInvoked !== true &&
    !hasActiveRun;
  const currentNextAction = analyzerResult?.orchestration?.nextAction ?? "";
  const handoffExpiryMs = analyzerResult?.aiHandoff?.expiresAt
    ? Date.parse(analyzerResult.aiHandoff.expiresAt)
    : Number.NaN;
  const aiPolicyCodes = analyzerResult?.aiExecution?.policyValidation?.codes ?? [];
  const handoffExpired =
    (Number.isFinite(handoffExpiryMs) && handoffExpiryMs <= Date.now()) ||
    aiPolicyCodes.includes("EXPIRED_HANDOFF");
  const handoffStale =
    /STALE/i.test(analyzerResult?.aiHandoff?.status ?? "") ||
    /STALE/i.test(analyzerResult?.aiHandoff?.gateStatus ?? "") ||
    aiPolicyCodes.some((code) =>
      ["STALE_HANDOFF", "BASE_SHA_MISMATCH", "PATCH_SHA_MISMATCH", "PACKAGE_HASH_MISMATCH"].includes(code),
    );
  const handoffRevoked =
    analyzerResult?.aiHandoff?.status === "REVOKED" ||
    analyzerResult?.aiHandoff?.gateStatus === "REVOKED" ||
    Boolean(analyzerResult?.aiHandoff?.revokedAt);
  const canRunConstrainedAi =
    task.status === CodingTaskStatus.READY_REVIEW &&
    currentNextAction === "AI_HANDOFF_APPROVED" &&
    analyzerResult?.aiHandoff?.status === "APPROVED" &&
    analyzerResult.aiHandoff.gateStatus === "EXPLICITLY_APPROVED" &&
    analyzerResult.aiHandoff.modelInvoked !== true &&
    !handoffExpired &&
    !handoffStale &&
    !handoffRevoked &&
    !hasActiveRun;
  const canApproveAiPatch =
    task.status === CodingTaskStatus.READY_REVIEW &&
    currentNextAction === "REVIEW_AI_PATCH" &&
    analyzerResult?.aiExecution?.policyValidation?.ok === true &&
    analyzerResult?.aiExecution?.patch?.status === "APPLIED" &&
    analyzerResult.aiExecution.patch.rolledBack !== true &&
    analyzerResult.aiExecution.patch.scriptsExecuted !== true &&
    analyzerResult.aiExecution.patch.networkUsed !== true &&
    !hasActiveRun;
  const explicitGateActions = [
    "APPROVE_PLAN",
    "REVIEW_LOCAL_PATCH",
    "RUN_SANDBOX_VERIFICATION",
    "LOCAL_RECOVERY_REQUIRED",
    "AI_REQUIRED",
    "APPROVE_AI_HANDOFF",
    "AI_HANDOFF_APPROVED",
    "REVIEW_AI_PATCH",
    "APPROVE_COMMIT",
    "REVIEW_PR",
    "APPROVE_MERGE",
  ];
  const explicitGateLocked = explicitGateActions.includes(currentNextAction);
  const canRunAgent =
    !hasActiveRun &&
    !explicitGateLocked &&
    (task.status === CodingTaskStatus.PENDING || task.status === CodingTaskStatus.FAILED);
  const aiPipelineVisible =
    Boolean(analyzerResult?.aiHandoff) ||
    Boolean(analyzerResult?.aiExecution) ||
    ["AI_REQUIRED", "APPROVE_AI_HANDOFF", "AI_HANDOFF_APPROVED", "REVIEW_AI_PATCH"].includes(
      currentNextAction,
    );
  const aiStageIndex =
    currentNextAction === "AI_REQUIRED"
      ? 0
      : currentNextAction === "APPROVE_AI_HANDOFF"
        ? 3
        : currentNextAction === "AI_HANDOFF_APPROVED"
          ? 5
          : currentNextAction === "REVIEW_AI_PATCH"
            ? 7
            : currentNextAction === "RUN_SANDBOX_VERIFICATION" && Boolean(analyzerResult?.aiExecution)
              ? 8
              : analyzerResult?.aiExecution?.patch?.status === "APPLIED"
                ? 7
                : analyzerResult?.aiHandoff?.status === "APPROVED"
                  ? 5
                  : analyzerResult?.aiHandoff?.status === "PREPARED"
                    ? 3
                    : 0;
  const canApproveCommit =
    task.status === CodingTaskStatus.READY_REVIEW &&
    analyzerResult?.orchestration?.nextAction === "APPROVE_COMMIT" &&
    analyzerResult?.localPatchApproval?.gateStatus === "PATCH_VALIDATED" &&
    analyzerResult?.sandboxVerification?.gateStatus === "SANDBOX_VERIFIED" &&
    analyzerResult.sandboxVerification.status === "PASSED" &&
    analyzerResult.localPatchApproval.commitCreated !== true &&
    analyzerResult.localPatchApproval.pushed !== true &&
    !hasActiveRun;
  const canVerifyPullRequest =
    task.status === CodingTaskStatus.PR_CREATED &&
    analyzerResult?.orchestration?.nextAction === "REVIEW_PR" &&
    analyzerResult?.localCommitApproval?.status === "PUBLISHED" &&
    !hasActiveRun;
  const canApproveMerge =
    task.status === CodingTaskStatus.PR_CREATED &&
    analyzerResult?.orchestration?.nextAction === "APPROVE_MERGE" &&
    analyzerResult?.prVerification?.status === "PASSED" &&
    analyzerResult.prVerification.gateStatus === "PR_VERIFIED" &&
    !hasActiveRun;
  const runAgent = () => {
    if (!canRunAgent) return;
    startCodingRun.mutate(
      { id: task.id },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({ queryKey: getGetCodingTaskQueryKey(task.id) });
          void queryClient.invalidateQueries({ queryKey: getListCodingTasksQueryKey() });
          toast({
            title: t("pages.codingWorkspace.runStarted"),
            description: "Local Coding Engine: index → context → deterministic executor → AI only if required",
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

  const approveLocalPatch = async () => {
    setLocalPatchPending(true);
    try {
      const response = await fetch(`/api/ai/coding/tasks/${task.id}/approve-local-patch`, {
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
        title: "Local patch validated",
        description: "Patch still applies to the latest remote HEAD and passed static verification. Sandboxed repository verification is required before commit approval.",
      });
    } catch (error) {
      toast({
        title: "Local patch validation failed",
        description: error instanceof Error ? error.message : "Patch approval failed",
        variant: "destructive",
      });
    } finally {
      setLocalPatchPending(false);
    }
  };

  const runSandboxVerification = async () => {
    setSandboxPending(true);
    try {
      const response = await fetch(`/api/ai/coding/tasks/${task.id}/run-sandbox-verification`, {
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
        title: "Sandbox verification started",
        description: "Repository checks are running with network disabled, scrubbed environment, and bounded Docker resources.",
      });
    } catch (error) {
      toast({
        title: "Could not start sandbox verification",
        description: error instanceof Error ? error.message : "Sandbox verification failed",
        variant: "destructive",
      });
    } finally {
      setSandboxPending(false);
    }
  };

  const runLocalRecovery = async () => {
    setRecoveryPending(true);
    try {
      const response = await fetch(`/api/ai/coding/tasks/${task.id}/run-local-recovery`, {
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
        title: "Deterministic recovery started",
        description: "Compiler-backed recovery is running in an isolated clone. It will return a new review-only patch or stop at AI_REQUIRED.",
      });
    } catch (error) {
      toast({
        title: "Could not start deterministic recovery",
        description: error instanceof Error ? error.message : "Local recovery failed",
        variant: "destructive",
      });
    } finally {
      setRecoveryPending(false);
    }
  };

  const prepareAiHandoff = async () => {
    setHandoffPreparePending(true);
    try {
      const response = await fetch(`/api/ai/coding/tasks/${task.id}/prepare-ai-handoff`, {
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
        title: "AI handoff preparation started",
        description: "Preparing a bounded read-only package. No model is being invoked.",
      });
    } catch (error) {
      toast({
        title: "Could not prepare AI handoff",
        description: error instanceof Error ? error.message : "AI handoff preparation failed",
        variant: "destructive",
      });
    } finally {
      setHandoffPreparePending(false);
    }
  };

  const approveAiHandoff = async () => {
    setHandoffApprovePending(true);
    try {
      const response = await fetch(`/api/ai/coding/tasks/${task.id}/approve-ai-handoff`, {
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
        title: "AI handoff explicitly approved",
        description: "Package integrity and remote HEAD were rechecked. Model execution remains locked.",
      });
    } catch (error) {
      toast({
        title: "Could not approve AI handoff",
        description: error instanceof Error ? error.message : "AI handoff approval failed",
        variant: "destructive",
      });
    } finally {
      setHandoffApprovePending(false);
    }
  };

  const revokeAiHandoff = async () => {
    setHandoffRevokePending(true);
    try {
      const response = await fetch(`/api/ai/coding/tasks/${task.id}/revoke-ai-handoff`, {
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
        title: "AI handoff revoked",
        description: "The approved/prepared package is locked again. No model was invoked.",
      });
    } catch (error) {
      toast({
        title: "Could not revoke AI handoff",
        description: error instanceof Error ? error.message : "AI handoff revocation failed",
        variant: "destructive",
      });
    } finally {
      setHandoffRevokePending(false);
    }
  };

  const runConstrainedAi = async () => {
    if (!canRunConstrainedAi) return;
    setAiRunPending(true);
    try {
      const response = await fetch(`/api/ai/coding/tasks/${task.id}/run-ai-execution`, {
        method: "POST",
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error ?? `HTTP ${response.status}`);
      }
      const queued = await response.json() as { jobId?: number; jobCode?: string; status?: string };
      onAiExecutionQueued();
      void queryClient.invalidateQueries({ queryKey: getGetCodingTaskQueryKey(task.id) });
      void queryClient.invalidateQueries({ queryKey: getListCodingTasksQueryKey() });
      toast({
        title: "Constrained AI queued",
        description:
          `Execution job ${queued.jobCode ?? queued.jobId ?? "queued"} is waiting for the dedicated coding worker. The worker will revalidate the approved lease before one bounded model call; tools, shell, repository, network, filesystem, secrets, and Git actions remain disabled.`,
      });
    } catch (error) {
      toast({
        title: "Could not run constrained AI",
        description: error instanceof Error ? error.message : "Constrained AI execution failed",
        variant: "destructive",
      });
    } finally {
      setAiRunPending(false);
    }
  };

  const approveAiPatch = async () => {
    if (!canApproveAiPatch) return;
    setAiPatchReviewPending(true);
    try {
      const response = await fetch(`/api/ai/coding/tasks/${task.id}/approve-ai-patch`, {
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
        title: "AI patch explicitly approved",
        description: "The candidate patch remains uncommitted and must pass sandbox verification before downstream commit/PR gates.",
      });
    } catch (error) {
      toast({
        title: "Could not approve AI patch",
        description: error instanceof Error ? error.message : "AI patch approval failed",
        variant: "destructive",
      });
    } finally {
      setAiPatchReviewPending(false);
    }
  };

  const approveCommit = async () => {
    setCommitPending(true);
    try {
      const response = await fetch(`/api/ai/coding/tasks/${task.id}/approve-commit`, {
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
        title: "Commit gate started",
        description: "Creating an isolated task branch, commit, and pull request. The base branch will not be modified or merged automatically.",
      });
    } catch (error) {
      toast({
        title: "Could not start commit gate",
        description: error instanceof Error ? error.message : "Commit approval failed",
        variant: "destructive",
      });
    } finally {
      setCommitPending(false);
    }
  };

  const verifyPullRequest = async () => {
    setPrVerifyPending(true);
    try {
      const response = await fetch(`/api/ai/coding/tasks/${task.id}/verify-pull-request`, {
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
        title: "PR verification started",
        description: "Checking PR head, base, changed files, mergeability, and GitHub CI before merge approval is unlocked.",
      });
    } catch (error) {
      toast({
        title: "Could not verify pull request",
        description: error instanceof Error ? error.message : "PR verification failed",
        variant: "destructive",
      });
    } finally {
      setPrVerifyPending(false);
    }
  };

  const approveMerge = async () => {
    setMergePending(true);
    try {
      const response = await fetch(`/api/ai/coding/tasks/${task.id}/approve-merge`, {
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
        title: "Explicit merge gate started",
        description: "The PR will be re-verified against the approved commit and CI immediately before GitHub merge.",
      });
    } catch (error) {
      toast({
        title: "Could not start merge",
        description: error instanceof Error ? error.message : "Merge approval failed",
        variant: "destructive",
      });
    } finally {
      setMergePending(false);
    }
  };

  const update = () => {
    const updateStatus = explicitGateLocked ? task.status : status;
    const updateCommitSha = explicitGateLocked ? task.commitSha : commitSha || null;
    updateTask.mutate({ id: task.id, data: { status: updateStatus, resultSummary: summary || null, commitSha: updateCommitSha } }, {
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
              {analyzerResult?.localExecutionPlan && (
                <div className="space-y-3 rounded-lg border border-emerald-300/15 bg-emerald-300/[0.025] p-3" data-testid="panel-local-coding-executor">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-300">Local Coding Executor</div>
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        "rounded-full border px-2 py-1 text-[9px] font-semibold uppercase tracking-wider",
                        analyzerResult.localExecution?.status === "APPLIED"
                          ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-300"
                          : analyzerResult.localExecutionPlan.status === "AI_REQUIRED"
                            ? "border-amber-300/20 bg-amber-300/10 text-amber-300"
                            : "border-slate-300/20 bg-slate-300/10 text-slate-400",
                      )}>
                        {analyzerResult.localExecution?.status ?? analyzerResult.localExecutionPlan.status ?? "PENDING"}
                      </span>
                      {canApproveLocalPatch && (
                        <Button
                          type="button"
                          size="sm"
                          onClick={approveLocalPatch}
                          disabled={localPatchPending}
                          className="h-7 bg-emerald-300 px-2.5 text-[10px] font-semibold text-[#08221b] hover:bg-emerald-200"
                          data-testid="button-approve-local-patch"
                        >
                          {localPatchPending
                            ? <><Loader2 className="size-3 animate-spin" />Validating</>
                            : <><CheckCircle2 className="size-3" />Validate Local Patch</>}
                        </Button>
                      )}
                    </div>
                  </div>
                  {(analyzerResult.localExecution?.reason ?? analyzerResult.localExecutionPlan.reason) && (
                    <p className="text-xs leading-5 text-slate-400">
                      {analyzerResult.localExecution?.reason ?? analyzerResult.localExecutionPlan.reason}
                    </p>
                  )}
                  {(analyzerResult.localExecution?.changedFiles.length ?? analyzerResult.localExecutionPlan.targetFiles.length) > 0 && (
                    <div>
                      <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-[0.11em] text-slate-600">
                        {analyzerResult.localExecution?.changedFiles.length ? "Changed files" : "Target files"}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {(analyzerResult.localExecution?.changedFiles.length
                          ? analyzerResult.localExecution.changedFiles
                          : analyzerResult.localExecutionPlan.targetFiles
                        ).map((file) => (
                          <code key={file} className="rounded border border-white/[0.06] px-2 py-1 text-[9px] text-slate-300">{file}</code>
                        ))}
                      </div>
                    </div>
                  )}
                  {analyzerResult.localExecution && (
                    <div className="grid gap-2 sm:grid-cols-3" data-testid="panel-local-verification-summary">
                      <div className="rounded-md border border-white/[0.05] bg-white/[0.02] p-2">
                        <div className="text-[9px] uppercase tracking-wider text-slate-600">Verification attempts</div>
                        <div className="mt-1 font-mono text-sm text-emerald-300">{analyzerResult.localExecution.verificationAttempts.length}</div>
                      </div>
                      <div className="rounded-md border border-white/[0.05] bg-white/[0.02] p-2">
                        <div className="text-[9px] uppercase tracking-wider text-slate-600">Auto-fixes</div>
                        <div className="mt-1 font-mono text-sm text-emerald-300">{analyzerResult.localExecution.autoFixes.length}</div>
                      </div>
                      <div className="rounded-md border border-white/[0.05] bg-white/[0.02] p-2">
                        <div className="text-[9px] uppercase tracking-wider text-slate-600">Repo scripts</div>
                        <div className="mt-1 font-mono text-sm text-slate-300">{analyzerResult.localExecution.scriptsExecuted ? "executed" : "fail-closed"}</div>
                      </div>
                    </div>
                  )}
                  {analyzerResult.localExecution?.autoFixes.length ? (
                    <div>
                      <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-[0.11em] text-slate-600">Deterministic auto-fixes</div>
                      <div className="flex flex-wrap gap-1.5">
                        {analyzerResult.localExecution.autoFixes.map((fix) => (
                          <code key={fix} className="rounded border border-emerald-300/10 bg-emerald-300/[0.035] px-2 py-1 text-[9px] text-emerald-300">{fix}</code>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {analyzerResult.localExecution?.verificationAttempts.some((attempt) => attempt.staticIssues.length > 0) && (
                    <div className="space-y-1.5">
                      <div className="text-[9px] font-semibold uppercase tracking-[0.11em] text-slate-600">Static verification issues</div>
                      {analyzerResult.localExecution.verificationAttempts.flatMap((attempt) =>
                        attempt.staticIssues.map((issue, index) => (
                          <div key={`${attempt.attempt ?? 0}-${issue.file ?? "file"}-${index}`} className="rounded-md border border-rose-300/10 bg-rose-300/[0.03] p-2 text-[10px] leading-4 text-rose-200">
                            <span className="font-mono">{issue.file ?? "unknown"}{issue.line ? `:${issue.line}` : ""}</span>
                            {issue.kind ? <span className="ml-2 uppercase text-rose-300">{issue.kind}</span> : null}
                            {issue.detail ? <span className="ml-2 text-slate-400">{issue.detail}</span> : null}
                          </div>
                        )),
                      )}
                    </div>
                  )}
                  {analyzerResult.localExecution?.patch && (
                    <div>
                      <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-[0.11em] text-slate-600">Review-only patch</div>
                      <pre className="max-h-80 overflow-auto whitespace-pre rounded-md border border-white/[0.06] bg-[#07101d] p-3 font-mono text-[10px] leading-4 text-slate-300" data-testid="text-local-coding-patch">
                        {analyzerResult.localExecution.patch}
                      </pre>
                    </div>
                  )}
                  {analyzerResult.localPatchApproval?.status === "APPLIED" && (
                    <div className="rounded-md border border-cyan-300/15 bg-cyan-300/[0.035] p-3" data-testid="panel-local-patch-approved">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-cyan-300">Local Patch Approved & Revalidated</div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-2 py-1 text-[9px] font-semibold uppercase tracking-wider text-cyan-300">
                            Next: {analyzerResult.orchestration?.nextAction
                              ?? (analyzerResult.localMergeApproval?.status === "MERGED" ? "DONE" : "REVIEW")}
                          </span>
                          {canRunSandboxVerification && (
                            <Button
                              type="button"
                              size="sm"
                              onClick={runSandboxVerification}
                              disabled={sandboxPending}
                              className="h-7 bg-emerald-300 px-2.5 text-[10px] font-semibold text-[#08221b] hover:bg-emerald-200"
                              data-testid="button-run-sandbox-verification"
                            >
                              {sandboxPending
                                ? <><Loader2 className="size-3 animate-spin" />Starting sandbox</>
                                : <><TerminalSquare className="size-3" />Run Sandboxed Verification</>}
                            </Button>
                          )}
                          {canApproveCommit && (
                            <Button
                              type="button"
                              size="sm"
                              onClick={approveCommit}
                              disabled={commitPending}
                              className="h-7 bg-cyan-300 px-2.5 text-[10px] font-semibold text-[#062028] hover:bg-cyan-200"
                              data-testid="button-approve-local-commit"
                            >
                              {commitPending
                                ? <><Loader2 className="size-3 animate-spin" />Creating PR</>
                                : <><GitCommitHorizontal className="size-3" />Approve Commit & Create PR</>}
                            </Button>
                          )}
                        </div>
                      </div>
                      <p className="mt-2 text-[10px] leading-4 text-slate-400">
                        Remote HEAD matched the analyzed SHA and deterministic static verification passed. Repository scripts can run only inside the hardened sandbox; the commit gate remains locked until that gate passes.
                      </p>
                      {analyzerResult.sandboxVerification && (
                        <div className="mt-3 rounded border border-white/[0.06] bg-[#07101d] p-2" data-testid="panel-sandbox-verification">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-[9px] uppercase tracking-wider text-slate-600">Sandbox verification</div>
                            <span className={cn(
                              "rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider",
                              analyzerResult.sandboxVerification.status === "PASSED"
                                ? "bg-emerald-300/10 text-emerald-300"
                                : analyzerResult.sandboxVerification.status === "BLOCKED"
                                  ? "bg-amber-300/10 text-amber-300"
                                  : "bg-rose-300/10 text-rose-300",
                            )}>
                              {analyzerResult.sandboxVerification.status ?? "PENDING"}
                            </span>
                          </div>
                          <div className="mt-2 grid gap-2 sm:grid-cols-3">
                            <div>
                              <div className="text-[9px] uppercase text-slate-600">Runtime</div>
                              <div className="mt-1 font-mono text-[10px] text-slate-300">{analyzerResult.sandboxVerification.runtime ?? "docker"}</div>
                            </div>
                            <div>
                              <div className="text-[9px] uppercase text-slate-600">Network</div>
                              <div className="mt-1 font-mono text-[10px] text-emerald-300">{analyzerResult.sandboxVerification.network ?? "none"}</div>
                            </div>
                            <div>
                              <div className="text-[9px] uppercase text-slate-600">Scripts</div>
                              <div className="mt-1 font-mono text-[10px] text-slate-300">{analyzerResult.sandboxVerification.commands.length}</div>
                            </div>
                          </div>
                          {analyzerResult.sandboxVerification.commands.length > 0 && (
                            <div className="mt-2 space-y-1">
                              {analyzerResult.sandboxVerification.commands.map((command, index) => (
                                <div key={`${command.command ?? "command"}-${index}`} className="flex items-center justify-between gap-3 font-mono text-[10px]">
                                  <span className="truncate text-slate-400">{command.command ?? "verification"}</span>
                                  <span className={command.status === "PASSED" ? "text-emerald-300" : "text-rose-300"}>{command.status ?? "UNKNOWN"}</span>
                                </div>
                              ))}
                            </div>
                          )}
                          {analyzerResult.sandboxVerification.deterministicRetries.length > 0 && (
                            <div className="mt-2 rounded border border-amber-300/10 bg-amber-300/[0.025] p-2">
                              <div className="text-[9px] uppercase tracking-wider text-amber-300">Deterministic retries</div>
                              {analyzerResult.sandboxVerification.deterministicRetries.map((retry, index) => (
                                <div key={`${retry.command ?? "retry"}-${index}`} className="mt-1 flex items-center justify-between gap-3 font-mono text-[10px]">
                                  <span className="truncate text-slate-400">{retry.command ?? "verification"}</span>
                                  <span className={retry.status === "PASSED" ? "text-emerald-300" : "text-rose-300"}>
                                    {retry.trigger ?? "RETRY"} → {retry.status ?? "UNKNOWN"}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                          {analyzerResult.sandboxVerification.failureContexts.length > 0 && (
                            <div className="mt-2 space-y-2" data-testid="panel-sandbox-failure-context">
                              <div className="text-[9px] uppercase tracking-wider text-rose-300">Failure context</div>
                              {analyzerResult.sandboxVerification.failureContexts.map((failure, failureIndex) => (
                                <div key={`${failure.command ?? "failure"}-${failureIndex}`} className="rounded border border-rose-300/10 bg-rose-300/[0.025] p-2">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <span className="font-mono text-[10px] text-slate-300">{failure.command ?? "verification"}</span>
                                    <span className="text-[9px] font-semibold uppercase tracking-wider text-rose-300">{failure.kind ?? failure.status ?? "FAILED"}</span>
                                  </div>
                                  {failure.diagnostics.map((diagnostic, diagnosticIndex) => (
                                    <div key={`${diagnostic.file ?? "diagnostic"}-${diagnostic.line ?? 0}-${diagnosticIndex}`} className="mt-2 text-[10px] leading-4">
                                      <div className="font-mono text-slate-300">
                                        {diagnostic.file ?? "unknown"}
                                        {diagnostic.line ? `:${diagnostic.line}` : ""}
                                        {diagnostic.column ? `:${diagnostic.column}` : ""}
                                        {diagnostic.symbol ? <span className="ml-2 text-cyan-300">[{diagnostic.symbol}]</span> : null}
                                        {diagnostic.code ? <span className="ml-2 text-amber-300">{diagnostic.code}</span> : null}
                                      </div>
                                      {diagnostic.message ? <div className="mt-0.5 text-slate-500">{diagnostic.message}</div> : null}
                                    </div>
                                  ))}
                                  {failure.retry?.reason && (
                                    <p className="mt-2 text-[10px] leading-4 text-slate-500">{failure.retry.reason}</p>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                          {analyzerResult.failureRecoveryContext && (
                            <div className="mt-2 rounded border border-cyan-300/15 bg-cyan-300/[0.025] p-2" data-testid="panel-local-failure-recovery-context">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="text-[9px] uppercase tracking-wider text-cyan-300">Failure-directed recovery context</div>
                                <span className="rounded bg-cyan-300/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-cyan-300">
                                  {analyzerResult.failureRecoveryContext.status ?? "CONTEXT_REFINED"}
                                </span>
                              </div>
                              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                                <div>
                                  <div className="text-[9px] uppercase text-slate-600">Focus files</div>
                                  <div className="mt-1 font-mono text-[10px] text-slate-300">{analyzerResult.failureRecoveryContext.focusFiles.length}</div>
                                </div>
                                <div>
                                  <div className="text-[9px] uppercase text-slate-600">Symbols</div>
                                  <div className="mt-1 font-mono text-[10px] text-slate-300">{analyzerResult.failureRecoveryContext.focusSymbols.length}</div>
                                </div>
                                <div>
                                  <div className="text-[9px] uppercase text-slate-600">Related tests</div>
                                  <div className="mt-1 font-mono text-[10px] text-slate-300">{analyzerResult.failureRecoveryContext.relatedTests.length}</div>
                                </div>
                              </div>
                              {analyzerResult.failureRecoveryContext.focusFiles.length > 0 && (
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                  {analyzerResult.failureRecoveryContext.focusFiles.slice(0, 12).map((file) => (
                                    <code key={file} className="rounded border border-white/[0.06] bg-[#07101d] px-2 py-1 text-[9px] text-slate-400">{file}</code>
                                  ))}
                                </div>
                              )}
                              {analyzerResult.failureRecoveryContext.focusSymbols.length > 0 && (
                                <div className="mt-2 space-y-1">
                                  {analyzerResult.failureRecoveryContext.focusSymbols.slice(0, 12).map((symbol, index) => (
                                    <div key={`${symbol.file ?? "symbol"}-${symbol.name ?? index}-${index}`} className="flex items-center justify-between gap-3 font-mono text-[10px]">
                                      <span className="truncate text-slate-400">
                                        {symbol.file ?? "unknown"}{symbol.line ? `:${symbol.line}` : ""}
                                      </span>
                                      <span className="text-cyan-300">{symbol.name ?? symbol.kind ?? "symbol"}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                              {canRunLocalRecovery && (
                                <Button
                                  type="button"
                                  size="sm"
                                  onClick={runLocalRecovery}
                                  disabled={recoveryPending}
                                  className="mt-3 h-7 bg-cyan-300 px-2.5 text-[10px] font-semibold text-[#062028] hover:bg-cyan-200"
                                  data-testid="button-run-local-recovery"
                                >
                                  {recoveryPending
                                    ? <><Loader2 className="size-3 animate-spin" />Recovering</>
                                    : <><RotateCcw className="size-3" />Run Deterministic Recovery</>}
                                </Button>
                              )}
                              {analyzerResult.localRecovery && (
                                <div className="mt-3 rounded border border-white/[0.06] bg-[#07101d] p-2" data-testid="panel-local-recovery-result">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="text-[9px] uppercase tracking-wider text-slate-600">Local recovery executor</div>
                                    <span className={cn(
                                      "rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider",
                                      analyzerResult.localRecovery.status === "RECOVERY_PATCH_READY"
                                        ? "bg-emerald-300/10 text-emerald-300"
                                        : analyzerResult.localRecovery.status === "AI_REQUIRED"
                                          ? "bg-amber-300/10 text-amber-300"
                                          : "bg-slate-300/10 text-slate-400",
                                    )}>
                                      {analyzerResult.localRecovery.status ?? "PENDING"}
                                    </span>
                                  </div>
                                  <div className="mt-2 grid gap-2 sm:grid-cols-3">
                                    <div>
                                      <div className="text-[9px] uppercase text-slate-600">Attempts</div>
                                      <div className="mt-1 font-mono text-[10px] text-slate-300">{analyzerResult.localRecovery.attempts.length}</div>
                                    </div>
                                    <div>
                                      <div className="text-[9px] uppercase text-slate-600">Sandbox</div>
                                      <div className="mt-1 font-mono text-[10px] text-slate-300">{analyzerResult.localRecovery.sandboxVerification ?? "—"}</div>
                                    </div>
                                    <div>
                                      <div className="text-[9px] uppercase text-slate-600">AI invoked</div>
                                      <div className="mt-1 font-mono text-[10px] text-emerald-300">{analyzerResult.localRecovery.aiInvoked ? "yes" : "no"}</div>
                                    </div>
                                  </div>
                                  {analyzerResult.localRecovery.attempts.length > 0 && (
                                    <div className="mt-2 space-y-1">
                                      {analyzerResult.localRecovery.attempts.map((attempt, index) => (
                                        <div key={`${attempt.attempt ?? index}-${index}`} className="flex flex-wrap items-center justify-between gap-2 font-mono text-[10px]">
                                          <span className="text-slate-400">
                                            attempt {attempt.attempt ?? index + 1} · {attempt.operations ?? 0} op
                                          </span>
                                          <span className={attempt.sandboxStatus === "PASSED" ? "text-emerald-300" : "text-slate-500"}>
                                            {attempt.sandboxStatus ?? attempt.planStatus ?? "planned"}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                  {analyzerResult.localRecovery.reason && (
                                    <p className="mt-2 text-[10px] leading-4 text-slate-500">{analyzerResult.localRecovery.reason}</p>
                                  )}
                                </div>
                              )}
                              {canPrepareAiHandoff && (
                                <Button
                                  type="button"
                                  size="sm"
                                  onClick={prepareAiHandoff}
                                  disabled={handoffPreparePending}
                                  className="mt-3 h-7 bg-amber-300 px-2.5 text-[10px] font-semibold text-[#2b2100] hover:bg-amber-200"
                                  data-testid="button-prepare-ai-handoff"
                                >
                                  {handoffPreparePending
                                    ? <><Loader2 className="size-3 animate-spin" />Preparing handoff</>
                                    : <><ArrowUpRight className="size-3" />Prepare AI Handoff</>}
                                </Button>
                              )}
                              {aiPipelineVisible && (
                                <div className="mt-3 rounded-lg border border-cyan-300/10 bg-[#07101d] p-3" data-testid="panel-ai-pipeline-stages">
                                  <div className="mb-2 flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.12em] text-cyan-300">
                                    <Bot className="size-3" />
                                    Constrained AI pipeline
                                  </div>
                                  <div className="grid gap-1.5 sm:grid-cols-3">
                                    {[
                                      "AI Required",
                                      "Prepare AI Context",
                                      "AI Context Prepared",
                                      "Approve AI Handoff",
                                      "AI Handoff Approved",
                                      "Run Constrained AI",
                                      "AI Proposal Ready",
                                      "Review AI Patch",
                                      "Sandbox Verification",
                                    ].map((label, index) => {
                                      const completed = index < aiStageIndex;
                                      const active = index === aiStageIndex;
                                      return (
                                        <div
                                          key={label}
                                          className={cn(
                                            "flex items-center gap-2 rounded border px-2 py-1.5 text-[9px]",
                                            completed
                                              ? "border-emerald-300/15 bg-emerald-300/[0.04] text-emerald-300"
                                              : active
                                                ? "border-cyan-300/25 bg-cyan-300/[0.06] text-cyan-200"
                                                : "border-white/[0.05] bg-white/[0.015] text-slate-600",
                                          )}
                                        >
                                          <span className={cn(
                                            "flex size-4 shrink-0 items-center justify-center rounded-full border font-mono text-[8px]",
                                            completed
                                              ? "border-emerald-300/30"
                                              : active
                                                ? "border-cyan-300/40"
                                                : "border-white/10",
                                          )}>
                                            {completed ? "✓" : index + 1}
                                          </span>
                                          <span>{label}</span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}
                              {analyzerResult.aiHandoff && (
                                <div className="mt-3 rounded border border-amber-300/15 bg-amber-300/[0.025] p-3" data-testid="panel-ai-handoff-gate">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="text-[9px] uppercase tracking-wider text-amber-300">AI handoff gate</div>
                                    <span className={cn(
                                      "rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider",
                                      handoffExpired || handoffStale || handoffRevoked
                                        ? "bg-rose-300/10 text-rose-300"
                                        : analyzerResult.aiHandoff.status === "APPROVED"
                                          ? "bg-emerald-300/10 text-emerald-300"
                                          : "bg-amber-300/10 text-amber-300",
                                    )}>
                                      {handoffRevoked
                                        ? "REVOKED"
                                        : handoffExpired
                                          ? "EXPIRED"
                                          : handoffStale
                                            ? "STALE"
                                            : analyzerResult.aiHandoff.status ?? "PREPARED"}
                                    </span>
                                  </div>
                                  <div className="mt-2 grid gap-2 sm:grid-cols-4">
                                    <div>
                                      <div className="text-[9px] uppercase text-slate-600">Allowed files</div>
                                      <div className="mt-1 font-mono text-[10px] text-slate-300">{analyzerResult.aiHandoff.package?.allowedFiles.length ?? 0}</div>
                                    </div>
                                    <div>
                                      <div className="text-[9px] uppercase text-slate-600">Diagnostics</div>
                                      <div className="mt-1 font-mono text-[10px] text-slate-300">{analyzerResult.aiHandoff.package?.diagnostics.length ?? 0}</div>
                                    </div>
                                    <div>
                                      <div className="text-[9px] uppercase text-slate-600">Snippets</div>
                                      <div className="mt-1 font-mono text-[10px] text-slate-300">{analyzerResult.aiHandoff.package?.snippets.length ?? 0}</div>
                                    </div>
                                    <div>
                                      <div className="text-[9px] uppercase text-slate-600">Model invoked</div>
                                      <div className="mt-1 font-mono text-[10px] text-emerald-300">{analyzerResult.aiHandoff.modelInvoked ? "yes" : "no"}</div>
                                    </div>
                                  </div>
                                  {analyzerResult.aiHandoff.packageHash && (
                                    <div className="mt-2">
                                      <div className="text-[9px] uppercase text-slate-600">Package hash</div>
                                      <div
                                        className="mt-1 font-mono text-[10px] text-slate-300"
                                        title={analyzerResult.aiHandoff.packageHash}
                                        data-testid="text-ai-handoff-package-hash"
                                      >
                                        {analyzerResult.aiHandoff.packageHash.slice(0, 12)}
                                      </div>
                                    </div>
                                  )}
                                  {analyzerResult.aiHandoff.expiresAt && (
                                    <div className="mt-2">
                                      <div className="text-[9px] uppercase text-slate-600">Approval lease expires</div>
                                      <div className={cn(
                                        "mt-1 font-mono text-[10px]",
                                        handoffExpired ? "text-rose-300" : "text-amber-300",
                                      )}>
                                        {new Date(analyzerResult.aiHandoff.expiresAt).toLocaleString()}
                                        {handoffExpired ? " · EXPIRED" : ""}
                                      </div>
                                    </div>
                                  )}
                                  {analyzerResult.aiHandoff.revokedAt && (
                                    <div className="mt-2">
                                      <div className="text-[9px] uppercase text-slate-600">Revoked</div>
                                      <div className="mt-1 font-mono text-[10px] text-rose-300">
                                        {new Date(analyzerResult.aiHandoff.revokedAt).toLocaleString()}
                                      </div>
                                    </div>
                                  )}
                                  {analyzerResult.aiHandoff.package?.allowedFiles.length ? (
                                    <div className="mt-2 flex flex-wrap gap-1.5">
                                      {analyzerResult.aiHandoff.package.allowedFiles.map((file) => (
                                        <code key={file} className="rounded border border-white/[0.06] bg-[#07101d] px-2 py-1 text-[9px] text-slate-400">{file}</code>
                                      ))}
                                    </div>
                                  ) : null}
                                  {analyzerResult.aiHandoff.package?.diagnostics.length ? (
                                    <div className="mt-3 rounded border border-white/[0.06] bg-[#07101d] p-2" data-testid="panel-ai-handoff-diagnostics">
                                      <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-wider text-slate-600">
                                        Diagnostics
                                      </div>
                                      <div className="max-h-40 space-y-1 overflow-auto">
                                        {analyzerResult.aiHandoff.package.diagnostics.slice(0, 12).map((diagnostic, index) => (
                                          <div key={`${diagnostic.file ?? "diagnostic"}-${diagnostic.line ?? 0}-${index}`} className="rounded border border-white/[0.04] bg-black/10 px-2 py-1.5">
                                            <div className="flex flex-wrap gap-x-2 font-mono text-[9px] text-cyan-300">
                                              {diagnostic.file && <span>{diagnostic.file}{diagnostic.line ? `:${diagnostic.line}` : ""}{diagnostic.column ? `:${diagnostic.column}` : ""}</span>}
                                              {diagnostic.code && <span>{diagnostic.code}</span>}
                                              {diagnostic.kind && <span className="text-slate-500">{diagnostic.kind}</span>}
                                            </div>
                                            {diagnostic.message && <div className="mt-1 text-[9px] leading-4 text-slate-500">{diagnostic.message}</div>}
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  ) : null}
                                  <div className="mt-3 flex items-start gap-2 rounded border border-amber-300/15 bg-amber-300/[0.035] p-2.5 text-[10px] leading-4 text-amber-100">
                                    <LockKeyhole className="mt-0.5 size-3.5 shrink-0 text-amber-300" />
                                    <span>
                                      Model access is non-agentic: no shell, repository connector, filesystem, browser/network, secrets/env, commit, push, or merge access. It may return structured proposal data only.
                                    </span>
                                  </div>
                                  <div className="mt-3 flex flex-wrap gap-2">
                                    {canApproveAiHandoff && (
                                      <Button
                                        type="button"
                                        size="sm"
                                        onClick={approveAiHandoff}
                                        disabled={handoffApprovePending}
                                        className="h-7 bg-emerald-300 px-2.5 text-[10px] font-semibold text-[#08221b] hover:bg-emerald-200"
                                        data-testid="button-approve-ai-handoff"
                                      >
                                        {handoffApprovePending
                                          ? <><Loader2 className="size-3 animate-spin" />Approving handoff</>
                                          : <><CheckCircle2 className="size-3" />Approve AI Handoff</>}
                                      </Button>
                                    )}
                                    {canRunConstrainedAi && (
                                      <Button
                                        type="button"
                                        size="sm"
                                        onClick={runConstrainedAi}
                                        disabled={aiRunPending}
                                        className="h-7 bg-cyan-300 px-2.5 text-[10px] font-semibold text-[#062028] hover:bg-cyan-200"
                                        data-testid="button-run-constrained-ai"
                                      >
                                        {aiRunPending
                                          ? <><Loader2 className="size-3 animate-spin" />Running constrained AI</>
                                          : <><Bot className="size-3" />Run Constrained AI</>}
                                      </Button>
                                    )}
                                    {canRevokeAiHandoff && (
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        onClick={revokeAiHandoff}
                                        disabled={handoffRevokePending}
                                        className="h-7 border-rose-300/20 bg-transparent px-2.5 text-[10px] font-semibold text-rose-300 hover:bg-rose-300/10 hover:text-rose-200"
                                        data-testid="button-revoke-ai-handoff"
                                      >
                                        {handoffRevokePending
                                          ? <><Loader2 className="size-3 animate-spin" />Revoking</>
                                          : <><RotateCcw className="size-3" />Revoke Handoff</>}
                                      </Button>
                                    )}
                                  </div>
                                </div>
                              )}
                              {analyzerResult.aiExecution && (
                                <div className="mt-3 space-y-3 rounded-lg border border-cyan-300/15 bg-cyan-300/[0.025] p-3" data-testid="panel-ai-proposal-review">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.12em] text-cyan-300">
                                      <FileDiff className="size-3" />
                                      AI Proposal Ready
                                    </div>
                                    <span className={cn(
                                      "rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider",
                                      analyzerResult.aiExecution.policyValidation?.ok === false
                                        ? "bg-rose-300/10 text-rose-300"
                                        : analyzerResult.aiExecution.patch?.status === "APPLIED"
                                          ? "bg-emerald-300/10 text-emerald-300"
                                          : "bg-slate-300/10 text-slate-400",
                                    )}>
                                      {analyzerResult.aiExecution.status ?? analyzerResult.aiExecution.patch?.status ?? "PROPOSAL"}
                                    </span>
                                  </div>

                                  <div className="grid gap-2 sm:grid-cols-3">
                                    <div className="rounded border border-white/[0.06] bg-[#07101d] p-2">
                                      <div className="text-[9px] uppercase tracking-wider text-slate-600">Policy validation</div>
                                      <div className={cn(
                                        "mt-1 flex items-center gap-1.5 font-mono text-[10px]",
                                        analyzerResult.aiExecution.policyValidation?.ok === true
                                          ? "text-emerald-300"
                                          : analyzerResult.aiExecution.policyValidation?.ok === false
                                            ? "text-rose-300"
                                            : "text-slate-400",
                                      )}>
                                        {analyzerResult.aiExecution.policyValidation?.ok === true
                                          ? <ShieldCheck className="size-3" />
                                          : <ShieldAlert className="size-3" />}
                                        {analyzerResult.aiExecution.policyValidation?.ok === true
                                          ? "PASS"
                                          : analyzerResult.aiExecution.policyValidation?.ok === false
                                            ? "BLOCKED"
                                            : analyzerResult.aiExecution.policyValidation?.status ?? "PENDING"}
                                      </div>
                                    </div>
                                    <div className="rounded border border-white/[0.06] bg-[#07101d] p-2">
                                      <div className="text-[9px] uppercase tracking-wider text-slate-600">Operations</div>
                                      <div className="mt-1 font-mono text-[10px] text-slate-300">{analyzerResult.aiExecution.proposal?.operationCount ?? 0}</div>
                                    </div>
                                    <div className="rounded border border-white/[0.06] bg-[#07101d] p-2">
                                      <div className="text-[9px] uppercase tracking-wider text-slate-600">Changed files</div>
                                      <div className="mt-1 font-mono text-[10px] text-slate-300">
                                        {analyzerResult.aiExecution.patch?.changedFiles.length ?? analyzerResult.aiExecution.proposal?.changedFiles.length ?? 0}
                                      </div>
                                    </div>
                                  </div>

                                  {analyzerResult.aiExecution.proposal?.summary && (
                                    <div>
                                      <div className="mb-1 text-[9px] uppercase tracking-wider text-slate-600">Proposal summary</div>
                                      <p className="text-[10px] leading-4 text-slate-300">{analyzerResult.aiExecution.proposal.summary}</p>
                                      {analyzerResult.aiExecution.proposal.rationale && (
                                        <p className="mt-1 text-[10px] leading-4 text-slate-500">{analyzerResult.aiExecution.proposal.rationale}</p>
                                      )}
                                    </div>
                                  )}

                                  {(analyzerResult.aiExecution.patch?.changedFiles.length || analyzerResult.aiExecution.proposal?.changedFiles.length) ? (
                                    <div>
                                      <div className="mb-1.5 text-[9px] uppercase tracking-wider text-slate-600">Changed files</div>
                                      <div className="flex flex-wrap gap-1.5">
                                        {(analyzerResult.aiExecution.patch?.changedFiles.length
                                          ? analyzerResult.aiExecution.patch.changedFiles
                                          : analyzerResult.aiExecution.proposal?.changedFiles ?? []
                                        ).map((file) => (
                                          <code key={file} className="rounded border border-white/[0.06] bg-[#07101d] px-2 py-1 text-[9px] text-slate-400">{file}</code>
                                        ))}
                                      </div>
                                    </div>
                                  ) : null}

                                  {analyzerResult.aiExecution.policyValidation?.errors.length ? (
                                    <div className="rounded border border-rose-300/15 bg-rose-300/[0.03] p-2">
                                      <div className="mb-1 text-[9px] uppercase tracking-wider text-rose-300">Policy violations</div>
                                      <div className="space-y-1">
                                        {analyzerResult.aiExecution.policyValidation.errors.map((error, index) => (
                                          <div key={`${error.code ?? "policy"}-${index}`} className="text-[9px] leading-4 text-rose-200">
                                            <span className="font-mono text-rose-300">{error.code ?? "POLICY_BLOCK"}</span>
                                            {error.path ? <span className="text-slate-500"> · {error.path}</span> : null}
                                            {error.message ? <span className="text-slate-400"> · {error.message}</span> : null}
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  ) : null}

                                  {analyzerResult.aiExecution.model && (
                                    <div className="grid gap-2 sm:grid-cols-4" data-testid="panel-ai-model-metadata">
                                      <div className="rounded border border-white/[0.06] bg-[#07101d] p-2">
                                        <div className="text-[9px] uppercase tracking-wider text-slate-600">Provider / model</div>
                                        <div className="mt-1 truncate font-mono text-[9px] text-cyan-300">
                                          {analyzerResult.aiExecution.model.provider ?? "—"} / {analyzerResult.aiExecution.model.model ?? "—"}
                                        </div>
                                      </div>
                                      <div className="rounded border border-white/[0.06] bg-[#07101d] p-2">
                                        <div className="text-[9px] uppercase tracking-wider text-slate-600">Tokens in / out / total</div>
                                        <div className="mt-1 font-mono text-[9px] text-slate-300">
                                          {analyzerResult.aiExecution.model.inputTokens ?? "—"} / {analyzerResult.aiExecution.model.outputTokens ?? "—"} / {analyzerResult.aiExecution.model.totalTokens ?? "—"}
                                        </div>
                                      </div>
                                      <div className="rounded border border-white/[0.06] bg-[#07101d] p-2">
                                        <div className="text-[9px] uppercase tracking-wider text-slate-600">Latency</div>
                                        <div className="mt-1 font-mono text-[10px] text-slate-300">
                                          {typeof analyzerResult.aiExecution.model.latencyMs === "number"
                                            ? `${analyzerResult.aiExecution.model.latencyMs} ms`
                                            : "—"}
                                        </div>
                                      </div>
                                      <div className="rounded border border-white/[0.06] bg-[#07101d] p-2">
                                        <div className="text-[9px] uppercase tracking-wider text-slate-600">Invocation</div>
                                        <div className="mt-1 font-mono text-[9px] text-slate-300">
                                          {analyzerResult.aiExecution.model.attempts ?? 1} attempt · {analyzerResult.aiExecution.model.retries ?? 0} retry
                                        </div>
                                      </div>
                                    </div>
                                  )}

                                  {analyzerResult.aiExecution.patch?.diff && (
                                    <details className="rounded border border-white/[0.06] bg-[#07101d] p-2" open={currentNextAction === "REVIEW_AI_PATCH"}>
                                      <summary className="cursor-pointer text-[9px] font-semibold uppercase tracking-wider text-cyan-300">
                                        Candidate patch / diff
                                      </summary>
                                      <pre className="mt-2 max-h-80 overflow-auto whitespace-pre font-mono text-[9px] leading-4 text-slate-400" data-testid="text-ai-candidate-patch">
                                        {analyzerResult.aiExecution.patch.diff}
                                      </pre>
                                    </details>
                                  )}

                                  <div className="flex items-start gap-2 rounded border border-amber-300/15 bg-amber-300/[0.035] p-2 text-[10px] leading-4 text-amber-100">
                                    <LockKeyhole className="mt-0.5 size-3.5 shrink-0 text-amber-300" />
                                    <span>
                                      This is a candidate patch only. The model cannot write the production repository, execute shell/tests, access network or secrets, commit, push, or merge.
                                    </span>
                                  </div>

                                  {canApproveAiPatch && (
                                    <Button
                                      type="button"
                                      size="sm"
                                      onClick={approveAiPatch}
                                      disabled={aiPatchReviewPending}
                                      className="h-7 bg-emerald-300 px-2.5 text-[10px] font-semibold text-[#08221b] hover:bg-emerald-200"
                                      data-testid="button-approve-ai-patch"
                                    >
                                      {aiPatchReviewPending
                                        ? <><Loader2 className="size-3 animate-spin" />Approving AI patch</>
                                        : <><ShieldCheck className="size-3" />Approve AI Patch for Sandbox</>}
                                    </Button>
                                  )}
                                </div>
                              )}
                              <CodingAiObservabilityPanel taskId={task.id} />
                              <CodingMissionControlPanel taskId={task.id} dispatchBaseSha={analyzerResult?.contextPackage?.headSha} />
                              {analyzerResult.failureRecoveryContext.warnings.length > 0 && (
                                <p className="mt-2 text-[10px] leading-4 text-slate-500">
                                  {analyzerResult.failureRecoveryContext.warnings.join(" ")}
                                </p>
                              )}
                            </div>
                          )}
                          {analyzerResult.sandboxVerification.warnings.length > 0 && (
                            <p className="mt-2 text-[10px] leading-4 text-amber-200">
                              {analyzerResult.sandboxVerification.warnings.join(" ")}
                            </p>
                          )}
                        </div>
                      )}
                      {analyzerResult.localCommitApproval?.status === "PUBLISHED" && (
                        <div className="mt-3 grid gap-2 sm:grid-cols-2" data-testid="panel-local-commit-published">
                          <div className="rounded border border-white/[0.06] bg-[#07101d] p-2">
                            <div className="text-[9px] uppercase tracking-wider text-slate-600">Task branch</div>
                            <div className="mt-1 truncate font-mono text-[10px] text-cyan-300">{analyzerResult.localCommitApproval.branch ?? "—"}</div>
                          </div>
                          <div className="rounded border border-white/[0.06] bg-[#07101d] p-2">
                            <div className="text-[9px] uppercase tracking-wider text-slate-600">Commit</div>
                            <div className="mt-1 truncate font-mono text-[10px] text-emerald-300">{analyzerResult.localCommitApproval.commitSha?.slice(0, 12) ?? "—"}</div>
                          </div>
                          <div className="sm:col-span-2 rounded border border-white/[0.06] bg-[#07101d] p-2">
                            <div className="text-[9px] uppercase tracking-wider text-slate-600">Pull request</div>
                            {analyzerResult.localCommitApproval.pullRequestUrl?.startsWith("https://github.com/") ? (
                              <a
                                href={analyzerResult.localCommitApproval.pullRequestUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="mt-1 inline-flex items-center gap-1 font-mono text-[10px] text-cyan-300 hover:text-cyan-200"
                                data-testid="link-local-coding-pull-request"
                              >
                                #{analyzerResult.localCommitApproval.pullRequestNumber ?? "PR"} <ArrowUpRight className="size-3" />
                              </a>
                            ) : (
                              <div className="mt-1 font-mono text-[10px] text-slate-500">PR_CREATED</div>
                            )}
                          </div>
                          <div className="sm:col-span-2 flex flex-wrap items-center gap-2">
                            {canVerifyPullRequest && (
                              <Button
                                type="button"
                                size="sm"
                                onClick={verifyPullRequest}
                                disabled={prVerifyPending}
                                className="h-7 bg-emerald-300 px-2.5 text-[10px] font-semibold text-[#08221b] hover:bg-emerald-200"
                                data-testid="button-verify-pull-request"
                              >
                                {prVerifyPending
                                  ? <><Loader2 className="size-3 animate-spin" />Checking PR</>
                                  : <><CheckCircle2 className="size-3" />Verify PR & CI</>}
                              </Button>
                            )}
                            {canApproveMerge && (
                              <Button
                                type="button"
                                size="sm"
                                onClick={approveMerge}
                                disabled={mergePending}
                                className="h-7 bg-cyan-300 px-2.5 text-[10px] font-semibold text-[#062028] hover:bg-cyan-200"
                                data-testid="button-approve-pull-request-merge"
                              >
                                {mergePending
                                  ? <><Loader2 className="size-3 animate-spin" />Merging</>
                                  : <><GitCommitHorizontal className="size-3" />Approve Merge</>}
                              </Button>
                            )}
                          </div>
                          {analyzerResult.prVerification && (
                            <div className="sm:col-span-2 rounded border border-white/[0.06] bg-[#07101d] p-2" data-testid="panel-pr-verification">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="text-[9px] uppercase tracking-wider text-slate-600">PR integrity + CI</div>
                                <span className={cn(
                                  "rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider",
                                  analyzerResult.prVerification.status === "PASSED"
                                    ? "bg-emerald-300/10 text-emerald-300"
                                    : analyzerResult.prVerification.status === "PENDING"
                                      ? "bg-amber-300/10 text-amber-300"
                                      : "bg-rose-300/10 text-rose-300",
                                )}>
                                  {analyzerResult.prVerification.status ?? "UNKNOWN"}
                                </span>
                              </div>
                              {analyzerResult.prVerification.reason && (
                                <p className="mt-1 text-[10px] leading-4 text-slate-400">{analyzerResult.prVerification.reason}</p>
                              )}
                              {analyzerResult.prVerification.checks.length > 0 && (
                                <div className="mt-2 space-y-1">
                                  {analyzerResult.prVerification.checks.map((check, index) => (
                                    <div key={`${check.name ?? "check"}-${index}`} className="flex items-center justify-between gap-3 font-mono text-[10px]">
                                      <span className="truncate text-slate-400">{check.name ?? "GitHub check"}</span>
                                      <span className={check.conclusion === "success" || check.conclusion === "neutral" || check.conclusion === "skipped" ? "text-emerald-300" : check.status === "completed" ? "text-rose-300" : "text-amber-300"}>
                                        {check.conclusion ?? check.status ?? "pending"}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                          {analyzerResult.localMergeApproval?.status === "MERGED" && (
                            <div className="sm:col-span-2 rounded border border-emerald-300/15 bg-emerald-300/[0.04] p-2" data-testid="panel-explicit-merge-complete">
                              <div className="text-[9px] uppercase tracking-wider text-emerald-300">Merged with explicit approval</div>
                              <div className="mt-1 font-mono text-[10px] text-slate-300">
                                Merge commit {analyzerResult.localMergeApproval.mergeCommitSha?.slice(0, 12) ?? "—"} · auto-merge disabled
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  {analyzerResult.localExecutionPlan.status === "AI_REQUIRED" && (
                    <p className="rounded-md border border-amber-300/10 bg-amber-300/[0.035] p-2 text-[10px] leading-4 text-amber-200">
                      Local executor made no code changes. The bounded context can be handed to AI reasoning only for the semantic work that remains.
                    </p>
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
          <section className="rounded-lg border border-cyan-300/15 bg-cyan-300/[0.04] p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><div className="text-sm font-medium text-slate-200">{t("pages.codingWorkspace.runAgent")}</div><p className="mt-1 text-xs leading-5 text-slate-500">{t("pages.codingWorkspace.runAgentHint")}</p></div><Button onClick={runAgent} disabled={startCodingRun.isPending || !canRunAgent} className="shrink-0 bg-cyan-300 text-[#062028] hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-60" data-testid="button-run-coding-agent">{startCodingRun.isPending || hasActiveRun ? <><Loader2 className="animate-spin" />{t("pages.codingWorkspace.runningAgent")}</> : explicitGateLocked ? <><LockKeyhole />Explicit gate required</> : <><TerminalSquare />{t("pages.codingWorkspace.runAgent")}</>}</Button></div></section>
          <section><div className="mb-3 flex items-center justify-between"><div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500"><FileCode2 className="size-3.5 text-cyan-300" />{t("pages.codingWorkspace.changes")}</div><span className="font-mono text-[10px] text-slate-600">{detail.changes.length.toString().padStart(2, "0")}</span></div>{detail.changes.length === 0 ? <p className="rounded-lg border border-dashed border-white/10 px-3 py-5 text-center text-xs text-slate-600">{t("pages.codingWorkspace.noChanges")}</p> : <div className="space-y-2">{detail.changes.map((change) => <div key={change.id} className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-[#091222] p-3" data-testid={`card-coding-change-${change.id}`}><span className={cn("flex size-7 shrink-0 items-center justify-center rounded-md text-[10px] font-bold", change.changeType === "ADDED" ? "bg-emerald-400/10 text-emerald-300" : change.changeType === "DELETED" ? "bg-rose-400/10 text-rose-300" : "bg-cyan-400/10 text-cyan-300")}>{change.changeType === "ADDED" ? "+" : change.changeType === "DELETED" ? "−" : "M"}</span><div className="min-w-0 flex-1"><div className="truncate font-mono text-xs text-slate-300">{change.filePath}</div><div className="mt-1 text-[10px] uppercase tracking-wider text-slate-600">{t(`pages.codingWorkspace.changeTypes.${change.changeType.toLowerCase()}`)} · {formatDate(change.createdAt, lang)}</div></div></div>)}</div>}</section>
        </div>
         <section className="border-t border-white/[0.07] pt-5"><div className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500"><GitCommitHorizontal className="size-3.5 text-cyan-300" />{t("pages.codingWorkspace.updateStatus")}</div><div className="grid gap-3 sm:grid-cols-2"><label className="space-y-2 text-xs text-slate-500"><span>{t("pages.codingWorkspace.status")}</span><select value={status} onChange={(event) => setStatus(event.target.value as CodingTaskStatus)} disabled={explicitGateLocked} className="h-9 w-full rounded-md border border-white/10 bg-[#091222] px-3 text-xs text-slate-200 outline-none focus:border-cyan-300/50 disabled:cursor-not-allowed disabled:opacity-50" data-testid="select-coding-status">{STATUSES.map((item) => <option key={item} value={item}>{t(`pages.codingWorkspace.statuses.${item.toLowerCase()}`)}</option>)}</select></label><label className="space-y-2 text-xs text-slate-500"><span>{t("pages.codingWorkspace.commitSha")}</span><div className="relative"><Copy className="pointer-events-none absolute left-3 top-2.5 size-3.5 text-slate-600" /><Input value={commitSha} onChange={(event) => setCommitSha(event.target.value)} disabled={explicitGateLocked} className="h-9 border-white/10 bg-[#091222] pl-9 font-mono text-xs text-slate-200 disabled:cursor-not-allowed disabled:opacity-50" placeholder="optional" data-testid="input-coding-commit-sha" /></div></label></div>{explicitGateLocked && <div className="mt-2 flex items-center gap-1.5 text-[10px] text-amber-300"><LockKeyhole className="size-3" />Status and commit SHA are locked while <span className="font-mono">{currentNextAction}</span> requires its explicit gate action.</div>}<label className="mt-3 block space-y-2 text-xs text-slate-500"><span>{t("pages.codingWorkspace.resultSummary")}</span><Textarea value={summary} onChange={(event) => setSummary(event.target.value)} rows={3} className="resize-y border-white/10 bg-[#091222] text-xs leading-5 text-slate-200 placeholder:text-slate-600" placeholder="Add a concise outcome for reviewers." data-testid="input-coding-result-summary" /></label><Button onClick={update} disabled={updateTask.isPending} className="mt-3 bg-cyan-300 text-[#062028] hover:bg-cyan-200" data-testid="button-update-coding-task">{updateTask.isPending ? <><Loader2 className="animate-spin" />{t("pages.codingWorkspace.updating")}</> : <><CheckCircle2 />{t("pages.codingWorkspace.saveUpdate")}</>}</Button></section>
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
  const [queuedAiBaselineRunCount, setQueuedAiBaselineRunCount] = useState<number | null>(null);
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
  const aiExecutionRunCount =
    detailQuery.data?.runs.filter((run) => run.agentName === "AI Execution Gate").length ?? 0;
  const queuedAiPolling = queuedAiBaselineRunCount !== null;

  useEffect(() => {
    if (
      queuedAiBaselineRunCount !== null &&
      aiExecutionRunCount > queuedAiBaselineRunCount
    ) {
      setQueuedAiBaselineRunCount(null);
    }
  }, [aiExecutionRunCount, queuedAiBaselineRunCount]);

  useEffect(() => {
    setQueuedAiBaselineRunCount(null);
  }, [selectedId]);

  const activeCount = (tasks ?? []).filter((task) => ACTIVE_STATUSES.has(task.status)).length;
  const readyCount = (tasks ?? []).filter((task) => task.status === CodingTaskStatus.READY_REVIEW || task.status === CodingTaskStatus.PR_CREATED).length;
  const completedCount = (tasks ?? []).filter((task) => task.status === CodingTaskStatus.COMPLETED).length;

  const pollCodingTask = useCallback(() => {
    void detailQuery.refetch();
    void queryClient.invalidateQueries({ queryKey: getListCodingTasksQueryKey() });
  }, [detailQuery.refetch, queryClient]);
  useCodingTaskPolling(
    Boolean(selectedId) && (hasActiveRun || queuedAiPolling),
    pollCodingTask,
  );

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
          <div className={cn(!selectedId && "hidden xl:block")}>{selectedId ? <TaskDetailPanel
            detail={detailQuery.data}
            isLoading={detailQuery.isLoading}
            isError={detailQuery.isError}
            onRetry={() => detailQuery.refetch()}
            onClose={() => setLocation("/coding-workspace")}
            onAiExecutionQueued={() => setQueuedAiBaselineRunCount(aiExecutionRunCount)}
          /> : <Card className="min-h-[420px] border-white/[0.08] bg-[#0c1628]"><CardContent className="flex min-h-[420px] flex-col items-center justify-center p-8 text-center"><div className="mb-4 flex size-12 items-center justify-center rounded-2xl border border-cyan-300/20 bg-cyan-300/10 text-cyan-300"><Code2 className="size-5" /></div><p className="font-display text-lg text-slate-100">{isLoading ? t("pages.codingWorkspace.loading") : t("pages.codingWorkspace.selectTask")}</p></CardContent></Card>}</div>
        </div>
        <div className="mt-5 flex items-center gap-2 text-[10px] uppercase tracking-[0.15em] text-slate-700"><div className="h-px flex-1 bg-white/[0.05]" /><span>Travelintrips engineering / coding intake</span><div className="h-px flex-1 bg-white/[0.05]" /></div>
      </div>
      <CreateTaskDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={openFreshTask} />
    </div>
  );
}