import { useState } from "react";
import {
  useListAgents,
  useListAgentCapabilities,
  useCreateAgent,
  useDeleteAgent,
  useAddAgentCapability,
  useDeleteAgentCapability,
  getListAgentsQueryKey,
  getListAgentCapabilitiesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLang } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Users,
  Plus,
  Search,
  MoreHorizontal,
  Trash2,
  Sparkles,
  ChevronRight,
  X,
  Zap,
} from "lucide-react";
import { format } from "date-fns";
import { useListProviders, useListModels } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

// ── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    active: "border-green-500/30 text-green-400 bg-green-500/10",
    inactive: "border-muted text-muted-foreground",
    draft: "border-yellow-500/30 text-yellow-400 bg-yellow-500/10",
  };
  return (
    <Badge
      variant="outline"
      className={`font-mono text-[10px] uppercase ${styles[status] ?? styles.draft}`}
    >
      {status}
    </Badge>
  );
}

// ── Capability panel ──────────────────────────────────────────────────────────

function CapabilityPanel({ agentId, agentName }: { agentId: number; agentName: string }) {
  const { data: caps, isLoading } = useListAgentCapabilities(agentId);
  const addCap = useAddAgentCapability();
  const deleteCap = useDeleteAgentCapability();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useLang();

  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState("");

  const grouped = (caps ?? []).reduce<Record<string, typeof caps>>((acc, cap) => {
    const key = cap!.category ?? "General";
    if (!acc[key]) acc[key] = [];
    acc[key]!.push(cap);
    return acc;
  }, {});

  const handleAdd = async () => {
    if (!newName.trim()) return;
    await addCap.mutateAsync(
      { id: agentId, data: { name: newName.trim(), category: newCategory.trim() || undefined } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListAgentCapabilitiesQueryKey(agentId) });
          setNewName("");
          setNewCategory("");
          toast({ title: t("pages.agents.toast.capAdded") });
        },
        onError: () => toast({ title: t("pages.agents.toast.capFailed"), variant: "destructive" }),
      },
    );
  };

  const handleDelete = async (capId: number) => {
    await deleteCap.mutateAsync(
      { id: agentId, capId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListAgentCapabilitiesQueryKey(agentId) });
          toast({ title: t("pages.agents.toast.capRemoved") });
        },
        onError: () => toast({ title: t("pages.agents.toast.capFailed"), variant: "destructive" }),
      },
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 text-primary" />
        <h3 className="font-semibold text-sm">
          <span className="text-primary">{agentName}</span>
          <span className="text-muted-foreground ml-2 font-mono text-xs">capabilities</span>
        </h3>
        <Badge variant="secondary" className="font-mono text-[10px] ml-auto">
          {caps?.length ?? 0} skills
        </Badge>
      </div>

      {/* Add new */}
      <div className="flex gap-2">
        <Input
          placeholder="Capability name (e.g. Brand Strategy)"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          className="bg-background/50 flex-1"
        />
        <Input
          placeholder="Category (optional)"
          value={newCategory}
          onChange={(e) => setNewCategory(e.target.value)}
          className="bg-background/50 w-[160px]"
        />
        <Button
          size="sm"
          onClick={handleAdd}
          disabled={!newName.trim() || addCap.isPending}
          className="font-mono text-xs uppercase tracking-wider"
        >
          <Plus className="size-3 mr-1" /> Add
        </Button>
      </div>

      {/* Grouped capabilities */}
      {isLoading ? (
        <div className="py-8 text-center text-muted-foreground font-mono text-sm">{t("pages.agents.empty.loading")}</div>
      ) : (caps ?? []).length === 0 ? (
        <div className="py-10 text-center space-y-2">
          <Zap className="size-8 text-muted-foreground/30 mx-auto" />
          <p className="text-muted-foreground text-sm">{t("pages.agents.empty.noCaps")}</p>
          <p className="text-muted-foreground/60 text-xs font-mono">Add skills this agent can perform.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped).map(([category, items]) => (
            <div key={category}>
              <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2 px-1">
                {category}
              </p>
              <div className="flex flex-wrap gap-2">
                {(items ?? []).map((cap) => (
                  <div
                    key={cap!.id}
                    className="group flex items-center gap-1.5 bg-primary/5 border border-primary/20 rounded-md px-2.5 py-1 text-sm text-primary hover:bg-primary/10 transition-colors"
                  >
                    <span>{cap!.name}</span>
                    <button
                      onClick={() => handleDelete(cap!.id)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity hover:text-destructive ml-1"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Create agent dialog ───────────────────────────────────────────────────────

function CreateAgentDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const createAgent = useCreateAgent();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useLang();
  const { data: providers } = useListProviders();
  const { data: models } = useListModels();

  const [form, setForm] = useState({
    name: "",
    slug: "",
    role: "",
    description: "",
    providerId: "",
    modelId: "",
    priority: "100",
    temperature: "0.7",
    maxTokens: "",
    status: "active" as "active" | "inactive" | "draft",
    version: "1.0.0",
    owner: "",
    allowedTools: "",
  });

  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const autoSlug = (name: string) =>
    name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");

  const handleSubmit = async () => {
    if (!form.name.trim() || !form.slug.trim() || !form.role.trim()) {
      toast({ title: t("pages.agents.toast.nameRequired"), variant: "destructive" });
      return;
    }
    await createAgent.mutateAsync(
      {
        data: {
          name: form.name,
          slug: form.slug,
          role: form.role,
          description: form.description || undefined,
          providerId: form.providerId ? Number(form.providerId) : undefined,
          modelId: form.modelId ? Number(form.modelId) : undefined,
          priority: form.priority ? Number(form.priority) : 100,
          temperature: form.temperature ? Number(form.temperature) : undefined,
          maxTokens: form.maxTokens ? Number(form.maxTokens) : undefined,
          status: form.status,
          version: form.version || "1.0.0",
          owner: form.owner || undefined,
          allowedTools: form.allowedTools ? form.allowedTools.split(",").map((tool) => tool.trim()).filter(Boolean) : [],
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListAgentsQueryKey() });
          toast({ title: t("pages.agents.toast.created") });
          onClose();
        },
        onError: () => toast({ title: t("pages.agents.toast.createFailed"), variant: "destructive" }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl bg-card border-border max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm uppercase tracking-wider">{t("pages.agents.dialog.title")}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4 py-2">
          {/* Name */}
          <div className="space-y-1.5">
            <Label className="font-mono text-xs uppercase text-muted-foreground">{t("pages.agents.dialog.name")} *</Label>
            <Input
              placeholder={t("pages.agents.dialog.namePh")}
              value={form.name}
              onChange={(e) => {
                set("name")(e.target.value);
                if (!form.slug || form.slug === autoSlug(form.name)) {
                  set("slug")(autoSlug(e.target.value));
                }
              }}
              className="bg-background/50"
            />
          </div>

          {/* Slug */}
          <div className="space-y-1.5">
            <Label className="font-mono text-xs uppercase text-muted-foreground">{t("pages.agents.dialog.slug")} *</Label>
            <Input
              placeholder={t("pages.agents.dialog.slugPh")}
              value={form.slug}
              onChange={(e) => set("slug")(e.target.value)}
              className="bg-background/50 font-mono text-sm"
            />
          </div>

          {/* Role */}
          <div className="col-span-2 space-y-1.5">
            <Label className="font-mono text-xs uppercase text-muted-foreground">{t("pages.agents.dialog.role")} *</Label>
            <Input
              placeholder={t("pages.agents.dialog.rolePh")}
              value={form.role}
              onChange={(e) => set("role")(e.target.value)}
              className="bg-background/50"
            />
          </div>

          {/* Description */}
          <div className="col-span-2 space-y-1.5">
            <Label className="font-mono text-xs uppercase text-muted-foreground">{t("pages.agents.dialog.description")}</Label>
            <Textarea
              placeholder={t("pages.agents.dialog.descPh")}
              value={form.description}
              onChange={(e) => set("description")(e.target.value)}
              className="bg-background/50 resize-none"
              rows={2}
            />
          </div>

          {/* Provider */}
          <div className="space-y-1.5">
            <Label className="font-mono text-xs uppercase text-muted-foreground">{t("pages.agents.dialog.provider")}</Label>
            <Select value={form.providerId} onValueChange={set("providerId")}>
              <SelectTrigger className="bg-background/50">
                <SelectValue placeholder="Select provider" />
              </SelectTrigger>
              <SelectContent>
                {(providers ?? []).map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Model */}
          <div className="space-y-1.5">
            <Label className="font-mono text-xs uppercase text-muted-foreground">{t("pages.agents.dialog.model")}</Label>
            <Select value={form.modelId} onValueChange={set("modelId")}>
              <SelectTrigger className="bg-background/50">
                <SelectValue placeholder="Select model" />
              </SelectTrigger>
              <SelectContent>
                {(models ?? [])
                  .filter((m) => !form.providerId || String(m.providerId) === form.providerId)
                  .map((m) => (
                    <SelectItem key={m.id} value={String(m.id)}>{m.name}</SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          {/* Priority */}
          <div className="space-y-1.5">
            <Label className="font-mono text-xs uppercase text-muted-foreground">{t("pages.agents.dialog.priority")}</Label>
            <Input
              type="number"
              placeholder="100"
              value={form.priority}
              onChange={(e) => set("priority")(e.target.value)}
              className="bg-background/50"
            />
          </div>

          {/* Temperature */}
          <div className="space-y-1.5">
            <Label className="font-mono text-xs uppercase text-muted-foreground">{t("pages.agents.dialog.temperature")}</Label>
            <Input
              type="number"
              step="0.1"
              min="0"
              max="2"
              placeholder="0.7"
              value={form.temperature}
              onChange={(e) => set("temperature")(e.target.value)}
              className="bg-background/50"
            />
          </div>

          {/* Max Tokens */}
          <div className="space-y-1.5">
            <Label className="font-mono text-xs uppercase text-muted-foreground">Max Tokens</Label>
            <Input
              type="number"
              placeholder="4096"
              value={form.maxTokens}
              onChange={(e) => set("maxTokens")(e.target.value)}
              className="bg-background/50"
            />
          </div>

          {/* Status */}
          <div className="space-y-1.5">
            <Label className="font-mono text-xs uppercase text-muted-foreground">Status</Label>
            <Select value={form.status} onValueChange={(v) => set("status")(v)}>
              <SelectTrigger className="bg-background/50">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Version */}
          <div className="space-y-1.5">
            <Label className="font-mono text-xs uppercase text-muted-foreground">Version</Label>
            <Input
              placeholder="1.0.0"
              value={form.version}
              onChange={(e) => set("version")(e.target.value)}
              className="bg-background/50 font-mono text-sm"
            />
          </div>

          {/* Owner */}
          <div className="space-y-1.5">
            <Label className="font-mono text-xs uppercase text-muted-foreground">Owner</Label>
            <Input
              placeholder="team@company.com"
              value={form.owner}
              onChange={(e) => set("owner")(e.target.value)}
              className="bg-background/50"
            />
          </div>

          {/* Allowed Tools */}
          <div className="col-span-2 space-y-1.5">
            <Label className="font-mono text-xs uppercase text-muted-foreground">
              Allowed Tools <span className="text-muted-foreground/60">(comma-separated)</span>
            </Label>
            <Input
              placeholder="web_search, code_interpreter, image_gen"
              value={form.allowedTools}
              onChange={(e) => set("allowedTools")(e.target.value)}
              className="bg-background/50"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} className="font-mono text-xs uppercase tracking-wider">
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={createAgent.isPending}
            className="font-mono text-xs uppercase tracking-wider"
          >
            <Plus className="size-3 mr-1.5" />
            {createAgent.isPending ? "Creating…" : "Create Agent"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Agents() {
  const { data: agents, isLoading } = useListAgents();
  const deleteAgent = useDeleteAgent();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [search, setSearch] = useState("");
  const [selectedAgent, setSelectedAgent] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("agents");

  const filtered = (agents ?? []).filter(
    (a) =>
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      a.role.toLowerCase().includes(search.toLowerCase()) ||
      (a.owner ?? "").toLowerCase().includes(search.toLowerCase()),
  );

  const selected = agents?.find((a) => a.id === selectedAgent) ?? null;

  const handleDelete = async (id: number) => {
    await deleteAgent.mutateAsync(
      { id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListAgentsQueryKey() });
          if (selectedAgent === id) setSelectedAgent(null);
          toast({ title: "Agent deleted" });
        },
        onError: () => toast({ title: "Failed to delete agent", variant: "destructive" }),
      },
    );
  };

  return (
    <div className="p-8 max-w-[1600px] mx-auto space-y-8 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">AI Agents</h1>
          <p className="text-muted-foreground mt-1">
            Register and manage your AI agent workforce.
          </p>
        </div>
        <Button
          onClick={() => setCreateOpen(true)}
          className="font-mono text-xs uppercase tracking-wider"
        >
          <Plus className="size-4 mr-2" /> Register Agent
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-[300px] grid-cols-2 mb-8">
          <TabsTrigger value="agents" className="font-mono text-xs uppercase tracking-wider">
            Agents
          </TabsTrigger>
          <TabsTrigger value="capabilities" className="font-mono text-xs uppercase tracking-wider">
            Capabilities
          </TabsTrigger>
        </TabsList>

        {/* ── Agents tab ────────────────────────────────────────────────────── */}
        <TabsContent value="agents">
          <div className="flex gap-6">
            {/* Agent list */}
            <div className={`flex-1 min-w-0 transition-all ${selected ? "max-w-[60%]" : ""}`}>
              <Card className="border-border/50 bg-card/50 backdrop-blur">
                <CardHeader className="flex flex-row items-center justify-between pb-4">
                  <CardTitle className="text-sm font-medium font-mono uppercase tracking-wider text-muted-foreground">
                    Agent Registry
                  </CardTitle>
                  <div className="relative">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search agents…"
                      className="pl-8 w-[240px] bg-background/50"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  {isLoading ? (
                    <div className="py-12 text-center text-muted-foreground font-mono text-sm">
                      Loading agents…
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow className="border-border/50 hover:bg-transparent">
                          <TableHead className="font-mono text-xs uppercase text-muted-foreground pl-6">Agent</TableHead>
                          <TableHead className="font-mono text-xs uppercase text-muted-foreground">Provider / Model</TableHead>
                          <TableHead className="font-mono text-xs uppercase text-muted-foreground text-right">Priority</TableHead>
                          <TableHead className="font-mono text-xs uppercase text-muted-foreground">Status</TableHead>
                          <TableHead className="font-mono text-xs uppercase text-muted-foreground">Version</TableHead>
                          <TableHead className="text-right" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filtered.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={6} className="py-12 text-center">
                              <Users className="size-8 text-muted-foreground/30 mx-auto mb-2" />
                              <p className="text-muted-foreground font-mono text-sm">No agents registered</p>
                              <p className="text-muted-foreground/60 text-xs mt-1">
                                Click "Register Agent" to add your first AI agent.
                              </p>
                            </TableCell>
                          </TableRow>
                        ) : (
                          filtered.map((agent) => (
                            <TableRow
                              key={agent.id}
                              className={`border-border/50 group cursor-pointer transition-colors ${
                                selectedAgent === agent.id ? "bg-primary/5" : "hover:bg-muted/30"
                              }`}
                              onClick={() =>
                                setSelectedAgent(selectedAgent === agent.id ? null : agent.id)
                              }
                            >
                              <TableCell className="pl-6">
                                <div className="flex items-center gap-3">
                                  <div className="size-8 rounded bg-primary/10 border border-primary/20 flex items-center justify-center text-primary flex-shrink-0">
                                    <Users className="size-4" />
                                  </div>
                                  <div>
                                    <p className="font-medium text-sm">{agent.name}</p>
                                    <p className="text-xs text-muted-foreground">{agent.role}</p>
                                  </div>
                                  {selectedAgent === agent.id && (
                                    <ChevronRight className="size-3 text-primary ml-auto" />
                                  )}
                                </div>
                              </TableCell>
                              <TableCell>
                                <div className="text-sm text-muted-foreground">
                                  <p>{agent.providerName ?? <span className="opacity-40">—</span>}</p>
                                  <p className="text-xs font-mono">{agent.modelName ?? ""}</p>
                                </div>
                              </TableCell>
                              <TableCell className="text-right font-mono text-sm">
                                {agent.priority}
                              </TableCell>
                              <TableCell>
                                <StatusBadge status={agent.status} />
                              </TableCell>
                              <TableCell className="font-mono text-xs text-muted-foreground">
                                v{agent.version}
                              </TableCell>
                              <TableCell
                                className="text-right pr-4"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                                    >
                                      <MoreHorizontal className="h-4 w-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end" className="bg-popover border-border">
                                    <DropdownMenuItem
                                      className="font-mono text-xs text-destructive focus:text-destructive cursor-pointer"
                                      onClick={() => handleDelete(agent.id)}
                                    >
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
            </div>

            {/* Agent detail panel */}
            {selected && (
              <div className="w-[380px] flex-shrink-0 animate-in slide-in-from-right-4 duration-300">
                <Card className="border-border/50 bg-card/50 backdrop-blur h-full">
                  <CardHeader className="pb-3 flex flex-row items-start justify-between">
                    <div>
                      <CardTitle className="text-base font-semibold">{selected.name}</CardTitle>
                      <p className="text-xs text-muted-foreground mt-0.5">{selected.role}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground"
                      onClick={() => setSelectedAgent(null)}
                    >
                      <X className="size-4" />
                    </Button>
                  </CardHeader>
                  <CardContent className="space-y-4 text-sm">
                    {/* Key fields */}
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        ["Provider", selected.providerName ?? "—"],
                        ["Model", selected.modelName ?? "—"],
                        ["Priority", String(selected.priority)],
                        ["Temperature", selected.temperature != null ? String(selected.temperature) : "—"],
                        ["Max Tokens", selected.maxTokens != null ? selected.maxTokens.toLocaleString() : "—"],
                        ["Version", `v${selected.version}`],
                        ["Owner", selected.owner ?? "—"],
                        ["Status", selected.status],
                      ].map(([label, value]) => (
                        <div key={label} className="space-y-0.5">
                          <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/70">{label}</p>
                          <p className="font-medium text-xs truncate">{value}</p>
                        </div>
                      ))}
                    </div>

                    {/* Description */}
                    {selected.description && (
                      <div className="border-t border-border/50 pt-3">
                        <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/70 mb-1">Description</p>
                        <p className="text-xs text-muted-foreground leading-relaxed">{selected.description}</p>
                      </div>
                    )}

                    {/* Allowed tools */}
                    {selected.allowedTools.length > 0 && (
                      <div className="border-t border-border/50 pt-3">
                        <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/70 mb-2">Allowed Tools</p>
                        <div className="flex flex-wrap gap-1">
                          {selected.allowedTools.map((t) => (
                            <Badge
                              key={t}
                              variant="secondary"
                              className="font-mono text-[10px] bg-secondary/50"
                            >
                              {t}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Capabilities shortcut */}
                    <div className="border-t border-border/50 pt-3">
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full font-mono text-xs uppercase tracking-wider border-primary/20 text-primary hover:bg-primary/10"
                        onClick={() => {
                          setActiveTab("capabilities");
                        }}
                      >
                        <Sparkles className="size-3 mr-1.5" /> Manage Capabilities
                      </Button>
                    </div>

                    <p className="text-[10px] font-mono text-muted-foreground/50">
                      Updated {format(new Date(selected.updatedAt), "MMM d, yyyy · HH:mm")}
                    </p>
                  </CardContent>
                </Card>
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── Capabilities tab ──────────────────────────────────────────────── */}
        <TabsContent value="capabilities">
          <div className="grid grid-cols-[280px_1fr] gap-6">
            {/* Agent picker */}
            <Card className="border-border/50 bg-card/50 backdrop-blur self-start">
              <CardHeader className="pb-3">
                <CardTitle className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                  Select Agent
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {isLoading ? (
                  <div className="py-6 text-center text-muted-foreground font-mono text-xs">Loading…</div>
                ) : (agents ?? []).length === 0 ? (
                  <div className="py-6 text-center text-muted-foreground font-mono text-xs px-4">
                    No agents yet. Register one first.
                  </div>
                ) : (
                  <div className="pb-2">
                    {(agents ?? []).map((agent) => (
                      <button
                        key={agent.id}
                        onClick={() => setSelectedAgent(agent.id)}
                        className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                          selectedAgent === agent.id
                            ? "bg-primary/10 text-primary"
                            : "hover:bg-muted/30 text-foreground"
                        }`}
                      >
                        <div className={`size-7 rounded border flex items-center justify-center flex-shrink-0 ${
                          selectedAgent === agent.id ? "bg-primary/10 border-primary/30" : "bg-muted/50 border-border/50"
                        }`}>
                          <Users className="size-3.5" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{agent.name}</p>
                          <p className="text-[10px] text-muted-foreground truncate">{agent.role}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Capability editor */}
            <Card className="border-border/50 bg-card/50 backdrop-blur">
              <CardContent className="p-6">
                {!selectedAgent ? (
                  <div className="py-16 text-center space-y-3">
                    <Sparkles className="size-10 text-muted-foreground/20 mx-auto" />
                    <p className="text-muted-foreground text-sm">Select an agent to manage its capabilities</p>
                    <p className="text-muted-foreground/60 text-xs font-mono">
                      Each agent can have multiple skills grouped by category
                    </p>
                  </div>
                ) : (
                  <CapabilityPanel
                    agentId={selectedAgent}
                    agentName={agents?.find((a) => a.id === selectedAgent)?.name ?? "Agent"}
                  />
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      <CreateAgentDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
