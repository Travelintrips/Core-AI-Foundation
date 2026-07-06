import { useState } from "react";
import {
  useListKnowledgeBases,
  useListKnowledgeDocuments,
  useCreateKnowledgeBase,
  useDeleteKnowledgeBase,
  useAddKnowledgeDocument,
  useDeleteKnowledgeDocument,
  getListKnowledgeBasesQueryKey,
  getListKnowledgeDocumentsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Database,
  Plus,
  FileText,
  Trash2,
  MoreHorizontal,
  BookOpen,
  Link,
  AlignLeft,
  DatabaseZap,
  Globe,
} from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

// ── Embedding model options ───────────────────────────────────────────────────

const EMBEDDING_MODELS = [
  { value: "text-embedding-3-small", label: "OpenAI text-embedding-3-small" },
  { value: "text-embedding-3-large", label: "OpenAI text-embedding-3-large" },
  { value: "text-embedding-ada-002", label: "OpenAI ada-002 (legacy)" },
];

const CONTENT_TYPES = [
  { value: "text",     label: "Plain Text",  icon: AlignLeft },
  { value: "markdown", label: "Markdown",    icon: FileText },
  { value: "url",      label: "URL",         icon: Globe },
];

// ── Documents sub-panel ───────────────────────────────────────────────────────

function DocumentsPanel({ kbId, kbName }: { kbId: number; kbName: string }) {
  const { data: docs, isLoading } = useListKnowledgeDocuments(kbId);
  const addDoc = useAddKnowledgeDocument();
  const deleteDoc = useDeleteKnowledgeDocument();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [addOpen, setAddOpen] = useState(false);
  const [docForm, setDocForm] = useState({ title: "", contentType: "text", content: "", sourceUrl: "" });

  const setDocField = (k: keyof typeof docForm) => (v: string) =>
    setDocForm((f) => ({ ...f, [k]: v }));

  const handleAdd = async () => {
    if (!docForm.title.trim()) { toast({ title: "Title is required", variant: "destructive" }); return; }
    if (docForm.contentType === "url" && !docForm.sourceUrl.trim()) {
      toast({ title: "URL is required for URL type", variant: "destructive" }); return;
    }
    if (docForm.contentType !== "url" && !docForm.content.trim()) {
      toast({ title: "Content is required", variant: "destructive" }); return;
    }
    try {
      await addDoc.mutateAsync(
        {
          id: kbId,
          data: {
            title: docForm.title,
            contentType: docForm.contentType as "text" | "url" | "file" | "markdown",
            content: docForm.contentType !== "url" ? docForm.content : undefined,
            sourceUrl: docForm.sourceUrl || undefined,
          },
        },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListKnowledgeDocumentsQueryKey(kbId) });
            toast({ title: "Document added" });
            setAddOpen(false);
            setDocForm({ title: "", contentType: "text", content: "", sourceUrl: "" });
          },
        },
      );
    } catch {
      toast({ title: "Failed to add document", variant: "destructive" });
    }
  };

  const handleDelete = async (docId: number) => {
    try {
      await deleteDoc.mutateAsync(
        { kbId, docId },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListKnowledgeDocumentsQueryKey(kbId) });
            toast({ title: "Document removed" });
          },
        },
      );
    } catch {
      toast({ title: "Failed to delete", variant: "destructive" });
    }
  };

  const STATUS_STYLES: Record<string, string> = {
    indexed:    "border-green-500/30 text-green-400 bg-green-500/10",
    pending:    "border-yellow-500/30 text-yellow-400 bg-yellow-500/10",
    processing: "border-blue-500/30 text-blue-400 bg-blue-500/10",
    failed:     "border-destructive/30 text-destructive bg-destructive/10",
  };

  const CT_ICONS: Record<string, React.ElementType> = { url: Globe, markdown: FileText, text: AlignLeft, file: BookOpen };

  return (
    <>
      <CardHeader className="flex flex-row items-center justify-between pb-4">
        <div>
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Database className="size-4 text-primary" />
            {kbName}
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5 font-mono">{docs?.length ?? 0} documents indexed</p>
        </div>
        <Button size="sm" onClick={() => setAddOpen(true)} className="font-mono text-xs uppercase tracking-wider">
          <Plus className="size-3 mr-1.5" /> Add Document
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="py-12 text-center text-muted-foreground font-mono text-sm">Loading documents…</div>
        ) : (docs ?? []).length === 0 ? (
          <div className="py-16 text-center space-y-2">
            <DatabaseZap className="size-10 text-muted-foreground/20 mx-auto" />
            <p className="text-muted-foreground font-mono text-sm">No documents yet</p>
            <p className="text-muted-foreground/60 text-xs">Add text, markdown, or URLs to index into this knowledge base.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {(docs ?? []).map((doc) => {
              const Icon = CT_ICONS[doc.contentType] ?? AlignLeft;
              return (
                <div key={doc.id} className="flex items-start gap-3 p-3 rounded-lg border border-border/30 bg-background/30 group hover:bg-background/50 transition-colors">
                  <div className="size-8 rounded bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
                    <Icon className="size-3.5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="text-sm font-medium truncate">{doc.title}</p>
                      <Badge variant="outline" className={`font-mono text-[10px] flex-shrink-0 ${STATUS_STYLES[doc.status] ?? ""}`}>
                        {doc.status}
                      </Badge>
                      <Badge variant="outline" className="font-mono text-[10px] border-border/50 text-muted-foreground flex-shrink-0">
                        {doc.contentType}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 text-[10px] font-mono text-muted-foreground/60">
                      {doc.chunkCount != null && <span>{doc.chunkCount} chunks</span>}
                      {doc.sourceUrl && (
                        <a href={doc.sourceUrl} target="_blank" rel="noreferrer" className="flex items-center gap-0.5 hover:text-primary truncate max-w-[200px]">
                          <Link className="size-2.5" />{doc.sourceUrl}
                        </a>
                      )}
                      <span>{format(new Date(doc.createdAt), "MMM d, yyyy")}</span>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                    onClick={() => handleDelete(doc.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      {/* Add document dialog */}
      <Dialog open={addOpen} onOpenChange={(v) => !v && setAddOpen(false)}>
        <DialogContent className="max-w-xl bg-card border-border">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm uppercase tracking-wider">Add Document</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="font-mono text-xs uppercase text-muted-foreground">Title *</Label>
              <Input placeholder="Brand Guidelines Overview" value={docForm.title} onChange={(e) => setDocField("title")(e.target.value)} className="bg-background/50" />
            </div>
            <div className="space-y-1.5">
              <Label className="font-mono text-xs uppercase text-muted-foreground">Content Type</Label>
              <div className="flex gap-2">
                {CONTENT_TYPES.map(({ value, label, icon: Icon }) => (
                  <button
                    key={value}
                    onClick={() => setDocField("contentType")(value)}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md border text-xs font-mono transition-colors ${
                      docForm.contentType === value
                        ? "bg-primary/10 border-primary/30 text-primary"
                        : "border-border/50 text-muted-foreground hover:bg-muted/30"
                    }`}
                  >
                    <Icon className="size-3.5" /> {label}
                  </button>
                ))}
              </div>
            </div>
            {docForm.contentType === "url" ? (
              <div className="space-y-1.5">
                <Label className="font-mono text-xs uppercase text-muted-foreground">URL *</Label>
                <Input placeholder="https://..." value={docForm.sourceUrl} onChange={(e) => setDocField("sourceUrl")(e.target.value)} className="bg-background/50 font-mono text-sm" />
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label className="font-mono text-xs uppercase text-muted-foreground">Content *</Label>
                <Textarea
                  placeholder="Paste your content here…"
                  value={docForm.content}
                  onChange={(e) => setDocField("content")(e.target.value)}
                  className="bg-background/50 resize-none font-mono text-xs"
                  rows={8}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddOpen(false)} className="font-mono text-xs uppercase tracking-wider">Cancel</Button>
            <Button onClick={handleAdd} disabled={addDoc.isPending} className="font-mono text-xs uppercase tracking-wider">
              <Plus className="size-3 mr-1.5" />{addDoc.isPending ? "Adding…" : "Add Document"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Create KB dialog ──────────────────────────────────────────────────────────

function CreateKBDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useCreateKnowledgeBase();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState({ name: "", description: "", embeddingModel: "text-embedding-3-small" });
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = async () => {
    if (!form.name.trim()) { toast({ title: "Name is required", variant: "destructive" }); return; }
    try {
      await create.mutateAsync(
        { data: { name: form.name, description: form.description || undefined, embeddingModel: form.embeddingModel, isActive: true } },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListKnowledgeBasesQueryKey() });
            toast({ title: "Knowledge base created" });
            onClose();
            setForm({ name: "", description: "", embeddingModel: "text-embedding-3-small" });
          },
        },
      );
    } catch {
      toast({ title: "Failed to create", variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md bg-card border-border">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm uppercase tracking-wider">New Knowledge Base</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="font-mono text-xs uppercase text-muted-foreground">Name *</Label>
            <Input placeholder="Branding" value={form.name} onChange={(e) => set("name")(e.target.value)} className="bg-background/50" />
          </div>
          <div className="space-y-1.5">
            <Label className="font-mono text-xs uppercase text-muted-foreground">Description</Label>
            <Textarea placeholder="What knowledge does this base contain?" value={form.description} onChange={(e) => set("description")(e.target.value)} className="bg-background/50 resize-none" rows={2} />
          </div>
          <div className="space-y-1.5">
            <Label className="font-mono text-xs uppercase text-muted-foreground">Embedding Model</Label>
            <Select value={form.embeddingModel} onValueChange={set("embeddingModel")}>
              <SelectTrigger className="bg-background/50"><SelectValue /></SelectTrigger>
              <SelectContent>
                {EMBEDDING_MODELS.map((m) => (
                  <SelectItem key={m.value} value={m.value} className="text-xs">{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} className="font-mono text-xs uppercase tracking-wider">Cancel</Button>
          <Button onClick={handleSubmit} disabled={create.isPending} className="font-mono text-xs uppercase tracking-wider">
            <Plus className="size-3 mr-1.5" />{create.isPending ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Knowledge() {
  const { data: knowledgeBases, isLoading } = useListKnowledgeBases();
  const deleteKB = useDeleteKnowledgeBase();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const selected = knowledgeBases?.find((kb) => kb.id === selectedId) ?? null;

  const handleDelete = async (id: number) => {
    try {
      await deleteKB.mutateAsync(
        { id },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListKnowledgeBasesQueryKey() });
            if (selectedId === id) setSelectedId(null);
            toast({ title: "Knowledge base deleted" });
          },
        },
      );
    } catch {
      toast({ title: "Failed to delete", variant: "destructive" });
    }
  };

  return (
    <div className="p-8 max-w-[1600px] mx-auto space-y-8 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Knowledge Base</h1>
          <p className="text-muted-foreground mt-1">Indexed document collections for AI context retrieval.</p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="font-mono text-xs uppercase tracking-wider">
          <Plus className="size-4 mr-2" /> New Knowledge Base
        </Button>
      </div>

      <div className="grid grid-cols-[280px_1fr] gap-6 items-start">
        {/* KB list */}
        <Card className="border-border/50 bg-card/50 backdrop-blur">
          <CardHeader className="pb-3">
            <CardTitle className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
              Collections
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="py-8 text-center text-muted-foreground font-mono text-xs">Loading…</div>
            ) : (knowledgeBases ?? []).length === 0 ? (
              <div className="py-10 text-center px-4 space-y-2">
                <Database className="size-8 text-muted-foreground/20 mx-auto" />
                <p className="text-muted-foreground text-xs font-mono">No knowledge bases yet</p>
              </div>
            ) : (
              <div className="pb-2">
                {(knowledgeBases ?? []).map((kb) => (
                  <div
                    key={kb.id}
                    className={`group flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors ${
                      selectedId === kb.id ? "bg-primary/10" : "hover:bg-muted/30"
                    }`}
                    onClick={() => setSelectedId(kb.id === selectedId ? null : kb.id)}
                  >
                    <div className={`size-8 rounded border flex items-center justify-center flex-shrink-0 ${
                      selectedId === kb.id ? "bg-primary/10 border-primary/30" : "bg-muted/50 border-border/50"
                    }`}>
                      <Database className={`size-3.5 ${selectedId === kb.id ? "text-primary" : "text-muted-foreground"}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium truncate ${selectedId === kb.id ? "text-primary" : ""}`}>{kb.name}</p>
                      <p className="text-[10px] font-mono text-muted-foreground truncate">{kb.embeddingModel.replace("text-embedding-", "")}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      {!kb.isActive && (
                        <Badge variant="outline" className="font-mono text-[10px] h-4 border-muted text-muted-foreground">off</Badge>
                      )}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                          <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity">
                            <MoreHorizontal className="size-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="bg-popover border-border">
                          <DropdownMenuItem
                            className="font-mono text-xs text-destructive focus:text-destructive cursor-pointer"
                            onClick={(e) => { e.stopPropagation(); handleDelete(kb.id); }}
                          >
                            <Trash2 className="mr-2 h-3 w-3" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Documents panel */}
        <Card className="border-border/50 bg-card/50 backdrop-blur min-h-[400px]">
          {!selected ? (
            <div className="py-24 flex flex-col items-center justify-center text-center">
              <DatabaseZap className="size-12 text-muted-foreground/20 mb-4" />
              <p className="font-mono text-sm uppercase tracking-wider text-muted-foreground">Select a Knowledge Base</p>
              <p className="text-xs text-muted-foreground/60 mt-2 max-w-xs">
                Choose a collection from the sidebar to view and manage its indexed documents.
              </p>
            </div>
          ) : (
            <DocumentsPanel kbId={selected.id} kbName={selected.name} />
          )}
        </Card>
      </div>

      <CreateKBDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
