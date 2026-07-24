import { useState, useEffect, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListProviders,
  useListModels,
  useUpdateProvider,
  useHealthCheckAllProviders,
  useHealthCheckProvider,
  getListProvidersQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  Box,
  Plus,
  Search,
  Server,
  MoreHorizontal,
  Pencil,
  Trash2,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertCircle,
  KeyRound,
  Activity,
  Clock,
  AlertTriangle,
  ShieldCheck,
  PowerOff,
  Power,
  Wifi,
  WifiOff,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { format, formatDistanceToNow } from "date-fns";
import { SiReplicate, SiMistralai } from "react-icons/si";
import { Cpu } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

/** How often the health panel auto-refreshes (ms) */
const AUTO_REFRESH_MS = 30_000;

function ProviderIcon({ slug }: { slug: string }) {
  switch (slug.toLowerCase()) {
    case "openai":
      return <Cpu className="size-4 text-green-400" />;
    case "anthropic":
      return <Cpu className="size-4 text-orange-400" />;
    case "gemini":
    case "google-gemini":
    case "google":
      return <Cpu className="size-4 text-blue-400" />;
    case "replicate":
      return <SiReplicate className="size-4" />;
    case "mistral":
      return <SiMistralai className="size-4" />;
    default:
      return <Server className="size-4" />;
  }
}

/** Health badge is based solely on health-check results, not admin isActive flag */
function HealthStatusBadge({
  consecutiveFailures,
  lastCheckedAt,
  keyConfigured,
}: {
  consecutiveFailures: number;
  lastCheckedAt?: Date | null;
  keyConfigured?: boolean;
}) {
  if (!lastCheckedAt) {
    return (
      <Badge
        variant="outline"
        className="border-muted/50 text-muted-foreground font-mono text-[10px] uppercase"
      >
        <Clock className="size-3 mr-1" /> Never checked
      </Badge>
    );
  }
  if (!keyConfigured) {
    return (
      <Badge
        variant="outline"
        className="border-orange-500/40 text-orange-400 bg-orange-500/10 font-mono text-[10px] uppercase"
      >
        <KeyRound className="size-3 mr-1" /> No API key
      </Badge>
    );
  }
  if (consecutiveFailures >= 3) {
    return (
      <Badge
        variant="outline"
        className="border-red-500/40 text-red-400 bg-red-500/10 font-mono text-[10px] uppercase"
      >
        <XCircle className="size-3 mr-1" /> Down ({consecutiveFailures}×)
      </Badge>
    );
  }
  if (consecutiveFailures > 0) {
    return (
      <Badge
        variant="outline"
        className="border-yellow-500/40 text-yellow-400 bg-yellow-500/10 font-mono text-[10px] uppercase"
      >
        <AlertTriangle className="size-3 mr-1" /> Degraded
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="border-green-500/30 text-green-400 bg-green-500/10 font-mono text-[10px] uppercase"
    >
      <CheckCircle2 className="size-3 mr-1" /> Healthy
    </Badge>
  );
}

export default function Registry() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: providers, isLoading: providersLoading } = useListProviders();
  const { data: models, isLoading: modelsLoading } = useListModels();

  const [providerSearch, setProviderSearch] = useState("");
  const [modelSearch, setModelSearch] = useState("");
  const [countdown, setCountdown] = useState(AUTO_REFRESH_MS / 1000);

  const checkAll = useHealthCheckAllProviders();
  const checkOne = useHealthCheckProvider();
  const updateProvider = useUpdateProvider();

  // ── Helpers ─────────────────────────────────────────────────────────────────

  const refreshProviders = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getListProvidersQueryKey() });
  }, [queryClient]);

  const runCheckAll = useCallback(async () => {
    try {
      await checkAll.mutateAsync();
      refreshProviders();
      toast({ title: "All provider checks complete" });
    } catch {
      toast({ title: "Check failed", variant: "destructive" });
    }
  }, [checkAll, refreshProviders, toast]);
      const resp = await fetch(`${BASE}/api/ai/providers/${providerId}/health-check`, {
        method: "POST",

      });
      const data: HealthResult = await resp.json();
      setResults(prev => ({ ...prev, [providerId]: data }));

  const runCheckOne = useCallback(
    async (id: number, name: string) => {
      try {
        const result = await checkOne.mutateAsync({ id });
        refreshProviders();
        // Use pingOk (runtime health) not isActive (admin enable/disable flag)
        if (result.pingOk) {
          toast({
            title: `${name} is healthy`,
            description: `HTTP ${result.httpStatus} — responded OK`,
          });
        } else {
          toast({
            title: `${name} is down`,
            description: result.error ?? `HTTP ${result.httpStatus ?? "timeout"}`,
            variant: "destructive",
          });
        }
      } catch {
        toast({
          title: "Check error",
          description: `Could not reach ${name}`,
          variant: "destructive",
        });
      }
    },
    [checkOne, refreshProviders, toast],
  );

  const toggleProvider = useCallback(
    async (id: number, name: string, currentActive: boolean) => {
      try {
        await updateProvider.mutateAsync({ id, data: { isActive: !currentActive } });
        refreshProviders();
        toast({
          title: currentActive ? `${name} disabled` : `${name} enabled`,
          description: currentActive
            ? "Provider will no longer receive new jobs."
            : "Provider is now eligible for new jobs.",
        });
      } catch {
        toast({ title: "Update failed", variant: "destructive" });
      }
    },
    [updateProvider, refreshProviders, toast],
  );

  // ── Auto-refresh countdown ────────────────────────────────────────────────

  useEffect(() => {
    setCountdown(AUTO_REFRESH_MS / 1000);
    const interval = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          refreshProviders();
          return AUTO_REFRESH_MS / 1000;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [refreshProviders]);

  // ── Derived summary stats ────────────────────────────────────────────────

  const totalProviders = providers?.length ?? 0;
  // Summary stats are based on health-check results, independent of admin isActive flag
  const healthyCount =
    providers?.filter((p) => p.lastCheckedAt != null && p.consecutiveFailures === 0 && p.keyConfigured).length ?? 0;
  const unhealthyCount =
    providers?.filter((p) => p.lastCheckedAt != null && (p.consecutiveFailures > 0 || !p.keyConfigured)).length ?? 0;
  const uncheckedCount = providers?.filter((p) => p.lastCheckedAt == null).length ?? 0;

  const filteredProviders =
    providers?.filter(
      (p) =>
        p.name.toLowerCase().includes(providerSearch.toLowerCase()) ||
        p.slug.toLowerCase().includes(providerSearch.toLowerCase()),
    ) ?? [];

  const filteredModels =
    models?.filter(
      (m) =>
        m.name.toLowerCase().includes(modelSearch.toLowerCase()) ||
        m.modelId.toLowerCase().includes(modelSearch.toLowerCase()),
    ) ?? [];

  return (
    <TooltipProvider>
      <div className="p-8 max-w-[1600px] mx-auto space-y-8 animate-in fade-in duration-500">
        {/* ── Page header ── */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">AI Registry</h1>
            <p className="text-muted-foreground mt-1">
              Manage connected AI providers and available models.
            </p>
          </div>
        </div>

        {/* ── Health Monitor Panel ── */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="size-4 text-primary" />
              <h2 className="text-sm font-semibold font-mono uppercase tracking-wider">
                Provider Health Monitor
              </h2>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground font-mono">
                Auto-refresh in {countdown}s
              </span>
              <Button
                variant="outline"
                size="sm"
                className="font-mono text-xs uppercase tracking-wider"
                onClick={runCheckAll}
                disabled={checkAll.isPending}
              >
                <RefreshCw
                  className={cn(
                    "size-3.5 mr-1.5",
                    checkAll.isPending && "animate-spin",
                  )}
                />
                {checkAll.isPending ? "Checking…" : "Check All Now"}
              </Button>
            </div>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-4 gap-4">
            <Card className="border-border/50 bg-card/50">
              <CardContent className="pt-4 pb-4">
                <div className="text-xs font-mono uppercase text-muted-foreground mb-1">
                  Total
                </div>
                <div className="text-2xl font-bold">{totalProviders}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Registered providers
                </div>
              </CardContent>
            </Card>
            <Card className="border-green-500/20 bg-green-500/5">
              <CardContent className="pt-4 pb-4">
                <div className="text-xs font-mono uppercase text-green-400/70 mb-1">
                  Healthy
                </div>
                <div className="text-2xl font-bold text-green-400">
                  {healthyCount}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Responding normally
                </div>
              </CardContent>
            </Card>
            <Card
              className={cn(
                "border-border/50 bg-card/50",
                unhealthyCount > 0 && "border-red-500/30 bg-red-500/5",
              )}
            >
              <CardContent className="pt-4 pb-4">
                <div
                  className={cn(
                    "text-xs font-mono uppercase mb-1",
                    unhealthyCount > 0
                      ? "text-red-400/70"
                      : "text-muted-foreground",
                  )}
                >
                  Unhealthy
                </div>
                <div
                  className={cn(
                    "text-2xl font-bold",
                    unhealthyCount > 0 ? "text-red-400" : "text-muted-foreground",
                  )}
                >
                  {unhealthyCount}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Last check failed
                </div>
              </CardContent>
            </Card>
            <Card className="border-border/50 bg-card/50">
              <CardContent className="pt-4 pb-4">
                <div className="text-xs font-mono uppercase text-muted-foreground mb-1">
                  Unchecked
                </div>
                <div className="text-2xl font-bold text-muted-foreground">
                  {uncheckedCount}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Never tested
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Per-provider health cards */}
          {!providersLoading && providers && providers.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {providers.map((p) => {
                const isChecking =
                  checkOne.isPending &&
                  (checkOne.variables as { id: number } | undefined)?.id === p.id;
                const failures = p.consecutiveFailures ?? 0;
                // Health state is independent of admin isActive (enable/disable)
                const isHealthy = p.lastCheckedAt != null && failures === 0 && p.keyConfigured;
                const isDegraded = p.lastCheckedAt != null && (failures > 0 || !p.keyConfigured);

                return (
                  <Card
                    key={p.id}
                    className={cn(
                      "border-border/50 bg-card/50 transition-colors",
                      isDegraded && failures >= 3 && "border-red-500/30 bg-red-500/5",
                      isDegraded && failures < 3 && "border-yellow-500/25 bg-yellow-500/5",
                      isHealthy && "border-green-500/20",
                    )}
                  >
                    <CardContent className="pt-4 pb-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="size-8 rounded bg-primary/10 flex-shrink-0 flex items-center justify-center text-primary border border-primary/20">
                            <ProviderIcon slug={p.slug} />
                          </div>
                          <div className="min-w-0">
                            <div className="font-medium text-sm truncate">{p.name}</div>
                            <div className="font-mono text-[10px] text-muted-foreground truncate">
                              {p.slug}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <HealthStatusBadge
                            consecutiveFailures={failures}
                            lastCheckedAt={p.lastCheckedAt ? new Date(p.lastCheckedAt) : null}
                            keyConfigured={p.keyConfigured}
                          />
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => runCheckOne(p.id, p.name)}
                                disabled={isChecking || checkAll.isPending}
                              >
                                <RefreshCw
                                  className={cn(
                                    "size-3.5",
                                    isChecking && "animate-spin",
                                  )}
                                />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent className="font-mono text-xs">
                              Run health check
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      </div>

                      <div className="mt-3 space-y-1.5">
                        {/* Key configured */}
                        <div className="flex items-center gap-1.5 text-[11px]">
                          <KeyRound
                            className={cn(
                              "size-3",
                              p.keyConfigured
                                ? "text-green-400"
                                : "text-muted-foreground",
                            )}
                          />
                          <span className="text-muted-foreground">API Key:</span>
                          <span
                            className={cn(
                              "font-mono",
                              p.keyConfigured
                                ? "text-green-400"
                                : "text-red-400",
                            )}
                          >
                            {p.keyConfigured
                              ? `${p.apiKeyEnvVar} ✓`
                              : p.apiKeyEnvVar
                                ? `${p.apiKeyEnvVar} — NOT SET`
                                : "No env var configured"}
                          </span>
                        </div>

                        {/* Last checked */}
                        <div className="flex items-center gap-1.5 text-[11px]">
                          <Clock className="size-3 text-muted-foreground" />
                          <span className="text-muted-foreground">Last check:</span>
                          <span className="font-mono text-foreground">
                            {p.lastCheckedAt
                              ? formatDistanceToNow(new Date(p.lastCheckedAt), {
                                  addSuffix: true,
                                })
                              : "Never"}
                          </span>
                        </div>

                        {/* Last success */}
                        <div className="flex items-center gap-1.5 text-[11px]">
                          <ShieldCheck className="size-3 text-muted-foreground" />
                          <span className="text-muted-foreground">Last success:</span>
                          <span
                            className={cn(
                              "font-mono",
                              p.lastSuccessAt ? "text-green-400" : "text-muted-foreground",
                            )}
                          >
                            {p.lastSuccessAt
                              ? formatDistanceToNow(new Date(p.lastSuccessAt), {
                                  addSuffix: true,
                                })
                              : "Never"}
                          </span>
                        </div>

                        {/* Consecutive failures */}
                        {failures > 0 && (
                          <div className="flex items-center gap-1.5 text-[11px]">
                            <AlertCircle className="size-3 text-red-400" />
                            <span className="text-muted-foreground">Consecutive failures:</span>
                            <span className="font-mono text-red-400 font-semibold">
                              {failures}
                            </span>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Registry tabs ── */}
        <Tabs defaultValue="providers" className="w-full">
          <TabsList className="grid w-[400px] grid-cols-2 mb-8">
            <TabsTrigger value="providers" className="font-mono text-xs uppercase tracking-wider">
              Providers
            </TabsTrigger>
            <TabsTrigger value="models" className="font-mono text-xs uppercase tracking-wider">
              Models
            </TabsTrigger>
          </TabsList>

          {/* ── Providers tab ── */}
          <TabsContent value="providers" className="space-y-4">
            <Card className="border-border/50 bg-card/50 backdrop-blur">
              <CardHeader className="flex flex-row items-center justify-between pb-4">
                <div className="space-y-1">
                  <CardTitle className="text-sm font-medium font-mono uppercase tracking-wider text-muted-foreground">
                    Configured Providers
                  </CardTitle>
                </div>
                <div className="flex items-center space-x-2">
                  <div className="relative">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search providers..."
                      className="pl-8 w-[250px] bg-background/50"
                      value={providerSearch}
                      onChange={(e) => setProviderSearch(e.target.value)}
                    />
                  </div>
                  <Button
                    variant="outline"
                    className="font-mono text-xs uppercase tracking-wider"
                    onClick={runCheckAll}
                    disabled={checkAll.isPending}
                  >
                    <RefreshCw
                      className={cn(
                        "size-4 mr-2",
                        checkAll.isPending && "animate-spin",
                      )}
                    />
                    Check All
                  </Button>
                  <Button
                    className="font-mono text-xs uppercase tracking-wider"
                    variant="secondary"
                  >
                    <Plus className="size-4 mr-2" /> Add Provider
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {providersLoading ? (
                  <div className="py-12 text-center text-muted-foreground font-mono text-sm">
                    Loading providers...
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="border-border/50 hover:bg-transparent">
                        <TableHead className="font-mono text-xs uppercase text-muted-foreground">
                          Provider
                        </TableHead>
                        <TableHead className="font-mono text-xs uppercase text-muted-foreground">
                          Base URL
                        </TableHead>
                        <TableHead className="font-mono text-xs uppercase text-muted-foreground">
                          API Key
                        </TableHead>
                        <TableHead className="font-mono text-xs uppercase text-muted-foreground">
                          Health
                        </TableHead>
                        <TableHead className="font-mono text-xs uppercase text-muted-foreground">
                          Last Check
                        </TableHead>
                        <TableHead className="font-mono text-xs uppercase text-muted-foreground">
                          Failures
                        </TableHead>
                        <TableHead className="text-right"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredProviders.length === 0 ? (
                        <TableRow>
                          <TableCell
                            colSpan={7}
                            className="py-8 text-center text-muted-foreground font-mono text-sm"
                          >
                            No providers found
                          </TableCell>
                        </TableRow>
                      ) : (
                        filteredProviders.map((provider) => {
                          const isChecking =
                            checkOne.isPending &&
                            (checkOne.variables as { id: number } | undefined)
                              ?.id === provider.id;
                          const keyOk = provider.keyConfigured;
                          const failures = provider.consecutiveFailures ?? 0;
                          // Row highlight based on health data, independent of admin isActive flag
                          const rowUnhealthy = provider.lastCheckedAt != null && (failures > 0 || !keyOk);

                          return (
                            <TableRow
                              key={provider.id}
                              className={cn(
                                "border-border/50 group",
                                rowUnhealthy &&
                                  failures >= 3 &&
                                  "bg-red-500/5 hover:bg-red-500/10",
                              )}
                            >
                              {/* Provider name */}
                              <TableCell className="font-medium">
                                <div className="flex items-center gap-2">
                                  <div className="size-8 rounded bg-primary/10 flex items-center justify-center text-primary border border-primary/20">
                                    <ProviderIcon slug={provider.slug} />
                                  </div>
                                  <div className="flex flex-col">
                                    <span>{provider.name}</span>
                                    <span className="text-xs text-muted-foreground font-mono">
                                      {provider.slug}
                                    </span>
                                  </div>
                                </div>
                              </TableCell>

                              {/* Base URL */}
                              <TableCell className="font-mono text-xs text-muted-foreground truncate max-w-[200px]">
                                {provider.baseUrl}
                              </TableCell>

                              {/* API Key */}
                              <TableCell>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <div className="flex items-center gap-1.5 cursor-default">
                                      <KeyRound
                                        className={cn(
                                          "size-3.5",
                                          keyOk
                                            ? "text-green-400"
                                            : "text-muted-foreground",
                                        )}
                                      />
                                      <span
                                        className={cn(
                                          "font-mono text-[10px] uppercase",
                                          keyOk
                                            ? "text-green-400"
                                            : "text-red-400",
                                        )}
                                      >
                                        {keyOk ? "Set" : "Missing"}
                                      </span>
                                    </div>
                                  </TooltipTrigger>
                                  <TooltipContent side="top" className="font-mono text-xs">
                                    {provider.apiKeyEnvVar
                                      ? `Secret: ${provider.apiKeyEnvVar}`
                                      : "No env var configured"}
                                  </TooltipContent>
                                </Tooltip>
                              </TableCell>

                              {/* Health status — separate from admin isActive flag */}
                              <TableCell>
                                <div className="flex flex-col gap-1">
                                  <HealthStatusBadge
                                    consecutiveFailures={failures}
                                    lastCheckedAt={provider.lastCheckedAt ? new Date(provider.lastCheckedAt) : null}
                                    keyConfigured={keyOk}
                                  />
                                  {!provider.isActive && (
                                    <Badge variant="outline" className="border-muted text-muted-foreground font-mono text-[10px] uppercase w-fit">
                                      <PowerOff className="size-2.5 mr-1" /> Disabled
                                    </Badge>
                                  )}
                                </div>
                              </TableCell>

                              {/* Last check time */}
                              <TableCell className="text-xs text-muted-foreground font-mono">
                                {provider.lastCheckedAt ? (
                                  <Tooltip>
                                    <TooltipTrigger className="cursor-default">
                                      {formatDistanceToNow(
                                        new Date(provider.lastCheckedAt),
                                        { addSuffix: true },
                                      )}
                                    </TooltipTrigger>
                                    <TooltipContent className="font-mono text-xs">
                                      {format(
                                        new Date(provider.lastCheckedAt),
                                        "MMM d, yyyy HH:mm:ss",
                                      )}
                                    </TooltipContent>
                                  </Tooltip>
                                ) : (
                                  <span className="text-muted-foreground/50">—</span>
                                )}
                              </TableCell>

                              {/* Consecutive failures */}
                              <TableCell className="font-mono text-xs">
                                {failures > 0 ? (
                                  <span className="text-red-400 font-semibold">
                                    {failures}×
                                  </span>
                                ) : provider.lastCheckedAt ? (
                                  <span className="text-green-400">0</span>
                                ) : (
                                  <span className="text-muted-foreground/50">—</span>
                                )}
                              </TableCell>

                              {/* Actions */}
                              <TableCell className="text-right">
                                <div className="flex items-center justify-end gap-1">
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                                        onClick={() =>
                                          runCheckOne(provider.id, provider.name)
                                        }
                                        disabled={isChecking || checkAll.isPending}
                                      >
                                        <RefreshCw
                                          className={cn(
                                            "size-3.5",
                                            isChecking && "animate-spin",
                                          )}
                                        />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent
                                      side="left"
                                      className="font-mono text-xs"
                                    >
                                      Run health check
                                    </TooltipContent>
                                  </Tooltip>
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button
                                        variant="ghost"
                                        className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                                      >
                                        <span className="sr-only">Open menu</span>
                                        <MoreHorizontal className="h-4 w-4" />
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent
                                      align="end"
                                      className="bg-popover border-border"
                                    >
                                      <DropdownMenuItem
                                        className="font-mono text-xs cursor-pointer"
                                        onClick={() =>
                                          runCheckOne(provider.id, provider.name)
                                        }
                                      >
                                        <RefreshCw className="mr-2 h-3 w-3" /> Check
                                        Health
                                      </DropdownMenuItem>
                                      <DropdownMenuSeparator />
                                      <DropdownMenuItem
                                        className={cn(
                                          "font-mono text-xs cursor-pointer",
                                          provider.isActive
                                            ? "text-yellow-500 focus:text-yellow-500"
                                            : "text-green-500 focus:text-green-500",
                                        )}
                                        onClick={() =>
                                          toggleProvider(
                                            provider.id,
                                            provider.name,
                                            provider.isActive,
                                          )
                                        }
                                        disabled={updateProvider.isPending}
                                      >
                                        {provider.isActive ? (
                                          <>
                                            <PowerOff className="mr-2 h-3 w-3" />{" "}
                                            Disable Provider
                                          </>
                                        ) : (
                                          <>
                                            <Power className="mr-2 h-3 w-3" /> Enable
                                            Provider
                                          </>
                                        )}
                                      </DropdownMenuItem>
                                      <DropdownMenuSeparator />
                                      <DropdownMenuItem className="font-mono text-xs cursor-pointer">
                                        <Pencil className="mr-2 h-3 w-3" /> Edit
                                      </DropdownMenuItem>
                                      <DropdownMenuItem className="font-mono text-xs text-destructive focus:text-destructive cursor-pointer">
                                        <Trash2 className="mr-2 h-3 w-3" /> Delete
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })
                      )}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Models tab ── */}
          <TabsContent value="models" className="space-y-4">
            <Card className="border-border/50 bg-card/50 backdrop-blur">
              <CardHeader className="flex flex-row items-center justify-between pb-4">
                <div className="space-y-1">
                  <CardTitle className="text-sm font-medium font-mono uppercase tracking-wider text-muted-foreground">
                    Available Models
                  </CardTitle>
                </div>
                <div className="flex items-center space-x-2">
                  <div className="relative">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search models..."
                      className="pl-8 w-[250px] bg-background/50"
                      value={modelSearch}
                      onChange={(e) => setModelSearch(e.target.value)}
                    />
                  </div>
                  <Button
                    className="font-mono text-xs uppercase tracking-wider"
                    variant="secondary"
                  >
                    <Plus className="size-4 mr-2" /> Add Model
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {modelsLoading ? (
                  <div className="py-12 text-center text-muted-foreground font-mono text-sm">
                    Loading models...
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="border-border/50 hover:bg-transparent">
                        <TableHead className="font-mono text-xs uppercase text-muted-foreground">
                          Model
                        </TableHead>
                        <TableHead className="font-mono text-xs uppercase text-muted-foreground">
                          Provider
                        </TableHead>
                        <TableHead className="font-mono text-xs uppercase text-muted-foreground">
                          Capabilities
                        </TableHead>
                        <TableHead className="font-mono text-xs uppercase text-muted-foreground text-right">
                          Context
                        </TableHead>
                        <TableHead className="text-right"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredModels.length === 0 ? (
                        <TableRow>
                          <TableCell
                            colSpan={5}
                            className="py-8 text-center text-muted-foreground font-mono text-sm"
                          >
                            No models found
                          </TableCell>
                        </TableRow>
                      ) : (
                        filteredModels.map((model) => (
                          <TableRow key={model.id} className="border-border/50 group">
                            <TableCell className="font-medium">
                              <div className="flex flex-col">
                                <span className="flex items-center gap-2">
                                  {model.name}
                                  {!model.isActive && (
                                    <Badge
                                      variant="outline"
                                      className="border-muted text-muted-foreground font-mono text-[8px] px-1 py-0 h-4 uppercase"
                                    >
                                      Disabled
                                    </Badge>
                                  )}
                                </span>
                                <span className="text-xs text-muted-foreground font-mono">
                                  {model.modelId}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell className="text-muted-foreground text-sm">
                              {model.providerName}
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-wrap gap-1">
                                {model.capabilities.map((cap) => (
                                  <Badge
                                    key={cap}
                                    variant="secondary"
                                    className="font-mono text-[10px] uppercase bg-secondary/50 hover:bg-secondary/50"
                                  >
                                    {cap}
                                  </Badge>
                                ))}
                              </div>
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs text-muted-foreground">
                              {model.contextWindow
                                ? `${(model.contextWindow / 1000).toFixed(0)}k`
                                : "-"}
                            </TableCell>
                            <TableCell className="text-right">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                                  >
                                    <span className="sr-only">Open menu</span>
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent
                                  align="end"
                                  className="bg-popover border-border"
                                >
                                  <DropdownMenuItem className="font-mono text-xs cursor-pointer">
                                    <Pencil className="mr-2 h-3 w-3" /> Edit
                                  </DropdownMenuItem>
                                  <DropdownMenuItem className="font-mono text-xs text-destructive focus:text-destructive cursor-pointer">
                                    <Trash2 className="mr-2 h-3 w-3" /> Delete
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </TooltipProvider>
  );
}
