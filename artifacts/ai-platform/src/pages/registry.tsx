import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListProviders,
  useListModels,
  getListProvidersQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Box, Plus, Search, Server, MoreHorizontal, Pencil, Trash2, RefreshCw, CheckCircle2, XCircle, AlertCircle, KeyRound } from "lucide-react";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { format } from "date-fns";
import { SiReplicate, SiMistralai } from "react-icons/si";
import { Cpu } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const BASE = "";

interface HealthResult {
  keyConfigured: boolean;
  httpStatus: number | null;
  isActive: boolean;
  error: string | null;
  envVar: string;
}

function ProviderIcon({ slug }: { slug: string }) {
  switch (slug.toLowerCase()) {
    case "openai":      return <Cpu className="size-4 text-green-400" />;
    case "anthropic":   return <Cpu className="size-4 text-orange-400" />;
    case "gemini":
    case "google-gemini":
    case "google":      return <Cpu className="size-4 text-blue-400" />;
    case "replicate":   return <SiReplicate className="size-4" />;
    case "mistral":     return <SiMistralai className="size-4" />;
    default:            return <Server className="size-4" />;
  }
}

export default function Registry() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: providers, isLoading: providersLoading } = useListProviders();
  const { data: models,    isLoading: modelsLoading }    = useListModels();

  const [providerSearch, setProviderSearch] = useState("");
  const [modelSearch,    setModelSearch]    = useState("");
  const [checking,       setChecking]       = useState<Record<number, boolean>>({});
  const [results,        setResults]        = useState<Record<number, HealthResult>>({});

  const filteredProviders = providers?.filter(p =>
    p.name.toLowerCase().includes(providerSearch.toLowerCase()) ||
    p.slug.toLowerCase().includes(providerSearch.toLowerCase())
  ) ?? [];

  const filteredModels = models?.filter(m =>
    m.name.toLowerCase().includes(modelSearch.toLowerCase()) ||
    m.modelId.toLowerCase().includes(modelSearch.toLowerCase())
  ) ?? [];

  async function checkHealth(providerId: number) {
    setChecking(prev => ({ ...prev, [providerId]: true }));
    try {
      const resp = await fetch(`${BASE}/api/ai/providers/${providerId}/health-check`, {
        method: "POST",

      });
      const data: HealthResult = await resp.json();
      setResults(prev => ({ ...prev, [providerId]: data }));

      // Refresh provider list so isActive badge updates
      await queryClient.invalidateQueries({ queryKey: getListProvidersQueryKey() });

      if (data.isActive) {
        toast({ title: "Health check passed", description: `Provider is reachable (HTTP ${data.httpStatus})` });
      } else {
        toast({
          title: "Health check failed",
          description: data.error ?? "Provider unreachable",
          variant: "destructive",
        });
      }
    } catch (err) {
      toast({ title: "Check error", description: String(err), variant: "destructive" });
    } finally {
      setChecking(prev => ({ ...prev, [providerId]: false }));
    }
  }

  async function checkAllHealth() {
    const ids = providers?.map(p => p.id) ?? [];
    await Promise.all(ids.map(id => checkHealth(id)));
  }

  return (
    <TooltipProvider>
      <div className="p-8 max-w-[1600px] mx-auto space-y-8 animate-in fade-in duration-500">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">AI Registry</h1>
            <p className="text-muted-foreground mt-1">Manage connected AI providers and available models.</p>
          </div>
        </div>

        <Tabs defaultValue="providers" className="w-full">
          <TabsList className="grid w-[400px] grid-cols-2 mb-8">
            <TabsTrigger value="providers" className="font-mono text-xs uppercase tracking-wider">Providers</TabsTrigger>
            <TabsTrigger value="models"    className="font-mono text-xs uppercase tracking-wider">Models</TabsTrigger>
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
                    onClick={checkAllHealth}
                    disabled={Object.values(checking).some(Boolean)}
                  >
                    <RefreshCw className={cn("size-4 mr-2", Object.values(checking).some(Boolean) && "animate-spin")} />
                    Check All
                  </Button>
                  <Button className="font-mono text-xs uppercase tracking-wider" variant="secondary">
                    <Plus className="size-4 mr-2" /> Add Provider
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {providersLoading ? (
                  <div className="py-12 text-center text-muted-foreground font-mono text-sm">Loading providers...</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="border-border/50 hover:bg-transparent">
                        <TableHead className="font-mono text-xs uppercase text-muted-foreground">Provider</TableHead>
                        <TableHead className="font-mono text-xs uppercase text-muted-foreground">Base URL</TableHead>
                        <TableHead className="font-mono text-xs uppercase text-muted-foreground">API Key</TableHead>
                        <TableHead className="font-mono text-xs uppercase text-muted-foreground">Status</TableHead>
                        <TableHead className="font-mono text-xs uppercase text-muted-foreground">Updated</TableHead>
                        <TableHead className="text-right"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredProviders.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={6} className="py-8 text-center text-muted-foreground font-mono text-sm">
                            No providers found
                          </TableCell>
                        </TableRow>
                      ) : filteredProviders.map((provider) => {
                        const result   = results[provider.id];
                        const isChecking = checking[provider.id];
                        // keyConfigured comes from the backend runtime check (process.env)
                        const keyOk = (provider as any).keyConfigured as boolean | undefined;

                        return (
                          <TableRow key={provider.id} className="border-border/50 group">
                            {/* Provider name */}
                            <TableCell className="font-medium">
                              <div className="flex items-center gap-2">
                                <div className="size-8 rounded bg-primary/10 flex items-center justify-center text-primary border border-primary/20">
                                  <ProviderIcon slug={provider.slug} />
                                </div>
                                <div className="flex flex-col">
                                  <span>{provider.name}</span>
                                  <span className="text-xs text-muted-foreground font-mono">{provider.slug}</span>
                                </div>
                              </div>
                            </TableCell>

                            {/* Base URL */}
                            <TableCell className="font-mono text-xs text-muted-foreground truncate max-w-[200px]">
                              {provider.baseUrl}
                            </TableCell>

                            {/* API Key configured indicator */}
                            <TableCell>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div className="flex items-center gap-1.5 cursor-default">
                                    <KeyRound className={cn("size-3.5", keyOk ? "text-green-400" : "text-muted-foreground")} />
                                    <span className={cn("font-mono text-[10px] uppercase", keyOk ? "text-green-400" : "text-muted-foreground")}>
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

                            {/* Status + last health check result */}
                            <TableCell>
                              <div className="flex flex-col gap-1">
                                {provider.isActive ? (
                                  <Badge variant="outline" className="border-green-500/30 text-green-400 bg-green-500/10 font-mono text-[10px] uppercase w-fit">
                                    Active
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="border-muted text-muted-foreground font-mono text-[10px] uppercase w-fit">
                                    Inactive
                                  </Badge>
                                )}
                                {result && (
                                  <div className={cn(
                                    "flex items-center gap-1 font-mono text-[10px]",
                                    result.isActive ? "text-green-400" : "text-red-400"
                                  )}>
                                    {result.isActive
                                      ? <CheckCircle2 className="size-3" />
                                      : <XCircle className="size-3" />}
                                    {result.isActive
                                      ? `HTTP ${result.httpStatus} OK`
                                      : result.error
                                        ? result.error.length > 40
                                          ? result.error.substring(0, 40) + "…"
                                          : result.error
                                        : `HTTP ${result.httpStatus}`}
                                  </div>
                                )}
                              </div>
                            </TableCell>

                            {/* Updated */}
                            <TableCell className="text-xs text-muted-foreground font-mono">
                              {format(new Date(provider.updatedAt), "MMM d, yyyy")}
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
                                      onClick={() => checkHealth(provider.id)}
                                      disabled={isChecking}
                                    >
                                      <RefreshCw className={cn("size-3.5", isChecking && "animate-spin")} />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent side="left" className="font-mono text-xs">
                                    Run health check
                                  </TooltipContent>
                                </Tooltip>
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                      <span className="sr-only">Open menu</span>
                                      <MoreHorizontal className="h-4 w-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end" className="bg-popover border-border">
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
                      })}
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
                  <Button className="font-mono text-xs uppercase tracking-wider" variant="secondary">
                    <Plus className="size-4 mr-2" /> Add Model
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {modelsLoading ? (
                  <div className="py-12 text-center text-muted-foreground font-mono text-sm">Loading models...</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="border-border/50 hover:bg-transparent">
                        <TableHead className="font-mono text-xs uppercase text-muted-foreground">Model</TableHead>
                        <TableHead className="font-mono text-xs uppercase text-muted-foreground">Provider</TableHead>
                        <TableHead className="font-mono text-xs uppercase text-muted-foreground">Capabilities</TableHead>
                        <TableHead className="font-mono text-xs uppercase text-muted-foreground text-right">Context</TableHead>
                        <TableHead className="text-right"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredModels.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={5} className="py-8 text-center text-muted-foreground font-mono text-sm">
                            No models found
                          </TableCell>
                        </TableRow>
                      ) : filteredModels.map((model) => (
                        <TableRow key={model.id} className="border-border/50 group">
                          <TableCell className="font-medium">
                            <div className="flex flex-col">
                              <span className="flex items-center gap-2">
                                {model.name}
                                {!model.isActive && (
                                  <Badge variant="outline" className="border-muted text-muted-foreground font-mono text-[8px] px-1 py-0 h-4 uppercase">
                                    Disabled
                                  </Badge>
                                )}
                              </span>
                              <span className="text-xs text-muted-foreground font-mono">{model.modelId}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-muted-foreground text-sm">{model.providerName}</TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {model.capabilities.map(cap => (
                                <Badge key={cap} variant="secondary" className="font-mono text-[10px] uppercase bg-secondary/50 hover:bg-secondary/50">
                                  {cap}
                                </Badge>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs text-muted-foreground">
                            {model.contextWindow ? `${(model.contextWindow / 1000).toFixed(0)}k` : "-"}
                          </TableCell>
                          <TableCell className="text-right">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <span className="sr-only">Open menu</span>
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="bg-popover border-border">
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
                      ))}
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
