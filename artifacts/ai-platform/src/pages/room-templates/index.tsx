/**
 * WP-01 — Admin: Room Template Library — Catalog Management
 *
 * Features: list, search, filters (room type / status), sorting, pagination,
 * create, archive, restore, duplicate, publish, navigate to detail.
 */
import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  LayoutTemplate, Plus, Search, Filter, Archive, RefreshCw,
  Copy, Eye, CheckCircle, Loader2, ChevronLeft, ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";

const API_BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
const ADMIN_KEY = import.meta.env.VITE_ADMIN_API_KEY as string | undefined;

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      ...(opts?.body ? { "Content-Type": "application/json" } : {}),
      ...(ADMIN_KEY ? { "x-admin-api-key": ADMIN_KEY } : {}),
      ...(opts?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const b = await res.json() as { error?: { message?: string } | string }; msg = typeof b.error === "string" ? b.error : (b.error?.message ?? msg); } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

interface RoomTemplate {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  roomTypeId: string;
  styleId: string | null;
  status: string;
  version: number;
  tenantId: string | null;
  publishedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  tags: string[];
}

interface RoomType {
  id: string;
  code: string;
  label: string;
  labelId: string;
  icon: string;
}

interface PaginationMeta {
  total: number;
  page: number;
  pageSize: number;
  hasNext: boolean;
}

const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  draft:     { label: "Draft",      variant: "secondary" },
  published: { label: "Published",  variant: "default" },
  archived:  { label: "Archived",   variant: "destructive" },
};

export default function RoomTemplatesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [search, setSearch]     = useState("");
  const [roomTypeId, setRoomTypeId] = useState("");
  const [status, setStatus]     = useState("");
  const [sortBy, setSortBy]     = useState("updated_at");
  const [sortDir, setSortDir]   = useState("desc");
  const [page, setPage]         = useState(1);
  const pageSize = 20;

  const queryKey = ["room-templates", { search, roomTypeId, status, sortBy, sortDir, page }];

  const { data, isLoading, isError } = useQuery<{ data: RoomTemplate[]; pagination: PaginationMeta }>({
    queryKey,
    queryFn: () => {
      const params = new URLSearchParams({
        page: String(page), pageSize: String(pageSize),
        sortBy, sortDir,
        ...(search     && { search }),
        ...(roomTypeId && { roomTypeId }),
        ...(status     && { status }),
      });
      return apiFetch(`/api/ai/room-templates?${params}`);
    },
  });

  const { data: roomTypes } = useQuery<{ data: RoomType[] }>({
    queryKey: ["room-types"],
    queryFn: () => apiFetch("/api/ai/room-types"),
    staleTime: 300_000,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["room-templates"] });

  const publishMut = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/ai/room-templates/${id}/publish`, { method: "POST" }),
    onSuccess: () => { toast({ title: "Template published" }); invalidate(); },
    onError: (e: Error) => toast({ title: "Publish failed", description: e.message, variant: "destructive" }),
  });

  const archiveMut = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/ai/room-templates/${id}/archive`, { method: "POST" }),
    onSuccess: () => { toast({ title: "Template archived" }); invalidate(); },
    onError: (e: Error) => toast({ title: "Archive failed", description: e.message, variant: "destructive" }),
  });

  const restoreMut = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/ai/room-templates/${id}/restore`, { method: "POST" }),
    onSuccess: () => { toast({ title: "Template restored to draft" }); invalidate(); },
    onError: (e: Error) => toast({ title: "Restore failed", description: e.message, variant: "destructive" }),
  });

  const duplicateMut = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/ai/room-templates/${id}/duplicate`, { method: "POST" }),
    onSuccess: () => { toast({ title: "Template duplicated as draft" }); invalidate(); },
    onError: (e: Error) => toast({ title: "Duplicate failed", description: e.message, variant: "destructive" }),
  });

  const seedMut = useMutation({
    mutationFn: () => apiFetch<{ seeded: Record<string, number> }>("/api/ai/room-templates/seed", { method: "POST" }),
    onSuccess: (r) => {
      toast({ title: "Catalog seeded", description: `Types: ${r.seeded.roomTypes}, Styles: ${r.seeded.roomStyles}, Themes: ${r.seeded.roomThemes}, Templates: ${r.seeded.templates}` });
      queryClient.invalidateQueries({ queryKey: ["room-types"] });
      invalidate();
    },
    onError: (e: Error) => toast({ title: "Seed failed", description: e.message, variant: "destructive" }),
  });

  const templates = data?.data ?? [];
  const pagination = data?.pagination;
  const typeMap = Object.fromEntries((roomTypes?.data ?? []).map(t => [t.id, t]));

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <LayoutTemplate className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Room Template Library</h1>
            <p className="text-sm text-muted-foreground">WP-01 — Phase 6 Catalog Foundation</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => seedMut.mutate()} disabled={seedMut.isPending}>
            {seedMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Seed Catalog
          </Button>
          <Link href="/room-templates/new">
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1" /> New Template
            </Button>
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search templates..."
            className="pl-8"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <Select value={roomTypeId} onValueChange={v => { setRoomTypeId(v === "_all" ? "" : v); setPage(1); }}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="All room types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">All room types</SelectItem>
            {(roomTypes?.data ?? []).map(rt => (
              <SelectItem key={rt.id} value={rt.id}>{rt.icon} {rt.labelId || rt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={v => { setStatus(v === "_all" ? "" : v); setPage(1); }}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">All statuses</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="published">Published</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
          </SelectContent>
        </Select>
        <Select value={`${sortBy}:${sortDir}`} onValueChange={v => { const [b, d] = v.split(":"); setSortBy(b!); setSortDir(d!); }}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="updated_at:desc">Newest updated</SelectItem>
            <SelectItem value="created_at:desc">Newest created</SelectItem>
            <SelectItem value="name:asc">Name A–Z</SelectItem>
            <SelectItem value="status:asc">Status</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : isError ? (
        <div className="text-center py-12 text-destructive">Failed to load templates.</div>
      ) : templates.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <LayoutTemplate className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p>No templates found. Try seeding the catalog or creating a new template.</p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Room Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Scope</TableHead>
                <TableHead>Tags</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.map(t => {
                const rt = typeMap[t.roomTypeId];
                const cfg = STATUS_CONFIG[t.status] ?? { label: t.status, variant: "outline" as const };
                return (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">
                      <Link href={`/room-templates/${t.id}`} className="hover:underline text-primary">
                        {t.name}
                      </Link>
                      <div className="text-xs text-muted-foreground font-mono">{t.slug}</div>
                    </TableCell>
                    <TableCell>{rt ? `${rt.icon} ${rt.labelId || rt.label}` : t.roomTypeId.slice(0, 8)}</TableCell>
                    <TableCell><Badge variant={cfg.variant}>{cfg.label}</Badge></TableCell>
                    <TableCell>v{t.version}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {t.tenantId ? "Tenant" : "Platform"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {t.tags.slice(0, 3).map(tag => (
                          <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
                        ))}
                        {t.tags.length > 3 && <Badge variant="secondary" className="text-xs">+{t.tags.length - 3}</Badge>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Link href={`/room-templates/${t.id}`}>
                          <Button variant="ghost" size="icon" title="View / Edit">
                            <Eye className="h-4 w-4" />
                          </Button>
                        </Link>
                        {t.status === "draft" && (
                          <Button variant="ghost" size="icon" title="Publish"
                            onClick={() => publishMut.mutate(t.id)}
                            disabled={publishMut.isPending}>
                            <CheckCircle className="h-4 w-4 text-green-600" />
                          </Button>
                        )}
                        {t.status !== "archived" && (
                          <Button variant="ghost" size="icon" title="Archive"
                            onClick={() => archiveMut.mutate(t.id)}
                            disabled={archiveMut.isPending}>
                            <Archive className="h-4 w-4 text-amber-600" />
                          </Button>
                        )}
                        {t.status === "archived" && (
                          <Button variant="ghost" size="icon" title="Restore"
                            onClick={() => restoreMut.mutate(t.id)}
                            disabled={restoreMut.isPending}>
                            <RefreshCw className="h-4 w-4 text-blue-600" />
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" title="Duplicate"
                          onClick={() => duplicateMut.mutate(t.id)}
                          disabled={duplicateMut.isPending}>
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Pagination */}
      {pagination && pagination.total > pageSize && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{pagination.total} templates total</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage(p => p - 1)} disabled={page === 1}>
              <ChevronLeft className="h-4 w-4" /> Prev
            </Button>
            <span className="px-2 py-1">Page {page}</span>
            <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={!pagination.hasNext}>
              Next <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
