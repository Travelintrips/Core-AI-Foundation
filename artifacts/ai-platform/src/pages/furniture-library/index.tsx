/**
 * WP-02 — Furniture Library Admin Page
 *
 * Admin management: list, search, filter, create, edit, delete, publish,
 * archive, restore, duplicate. Mirrors the room-templates admin pattern.
 */

import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { Plus, Search, Filter, RefreshCw, Package, CheckCircle, Archive, Trash2, Copy, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { useToast } from "@/hooks/use-toast";
import { useAdminApi } from "@/hooks/useAdminApi";

// ── Types ─────────────────────────────────────────────────────────────────────

interface FurnitureItem {
  id: string;
  code: string;
  name: string;
  slug: string;
  furnitureType?: string;
  style?: string;
  priceTier: string;
  status: string;
  version: number;
  categoryId: string;
  deletedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface PaginationMeta {
  total: number;
  page: number;
  pageSize: number;
  hasNext: boolean;
}

interface ListResult {
  data: FurnitureItem[];
  pagination: PaginationMeta;
}

interface FurnitureCategory {
  id: string;
  code: string;
  name: string;
  slug: string;
}

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft:     "secondary",
  published: "default",
  archived:  "outline",
};

const STATUS_LABELS: Record<string, string> = {
  draft:     "Draft",
  published: "Published",
  archived:  "Archived",
};

const PRICE_TIER_COLORS: Record<string, string> = {
  budget:  "bg-green-100 text-green-800",
  mid:     "bg-blue-100 text-blue-800",
  premium: "bg-purple-100 text-purple-800",
  luxury:  "bg-yellow-100 text-yellow-800",
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function FurnitureLibraryPage() {
  const [, navigate] = useLocation();
  const { apiFetch } = useAdminApi();
  const { toast } = useToast();

  const [items, setItems] = useState<FurnitureItem[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta>({ total: 0, page: 1, pageSize: 20, hasNext: false });
  const [categories, setCategories] = useState<FurnitureCategory[]>([]);
  const [loading, setLoading] = useState(false);

  // Filters
  const [search, setSearch]       = useState("");
  const [statusFilter, setStatus] = useState("all");
  const [categoryFilter, setCategory] = useState("all");
  const [priceTierFilter, setPriceTier] = useState("all");
  const [page, setPage] = useState(1);

  const apiJson = useCallback(async <T,>(url: string, opts?: RequestInit): Promise<T> => {
    const res = await apiFetch(url, opts);
    return res.json() as T;
  }, [apiFetch]);

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: "20",
        sortBy: "updated_at",
        sortDir: "desc",
      });
      if (search.trim())         params.set("search", search.trim());
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (categoryFilter !== "all") params.set("categoryId", categoryFilter);
      if (priceTierFilter !== "all") params.set("priceTier", priceTierFilter);

      const result = await apiJson<ListResult>(`/ai/furniture-library/items?${params}`);
      setItems(result.data);
      setPagination(result.pagination);
    } catch (err) {
      toast({ title: "Error", description: "Failed to load furniture items.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter, categoryFilter, priceTierFilter, apiFetch, toast]);

  const loadCategories = useCallback(async () => {
    try {
      const result = await apiJson<{ data: FurnitureCategory[] }>("/ai/furniture-library/categories");
      setCategories(result.data);
    } catch {}
  }, [apiFetch]);

  useEffect(() => { loadItems(); }, [loadItems]);
  useEffect(() => { loadCategories(); }, [loadCategories]);

  const handleAction = async (id: string, action: "publish" | "archive" | "restore" | "duplicate") => {
    try {
      await apiFetch(`/ai/furniture-library/items/${id}/${action}`, { method: "POST" });
      toast({ title: "Success", description: `Item ${action}ed successfully.` });
      loadItems();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Operation failed";
      toast({ title: "Error", description: msg, variant: "destructive" });
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Soft-delete this item? It can be restored later.")) return;
    try {
      await apiFetch(`/ai/furniture-library/items/${id}`, { method: "DELETE" });
      toast({ title: "Deleted", description: "Item soft-deleted successfully." });
      loadItems();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Delete failed";
      toast({ title: "Error", description: msg, variant: "destructive" });
    }
  };

  const handleSeed = async () => {
    try {
      const result = await apiJson<{ ok: boolean; seeded: Record<string, number> }>("/ai/furniture-library/seed", { method: "POST" });
      toast({ title: "Seeded", description: `Seeded: ${JSON.stringify(result.seeded)}` });
      loadItems();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Seed failed";
      toast({ title: "Error", description: msg, variant: "destructive" });
    }
  };

  const resetFilters = () => {
    setSearch(""); setStatus("all"); setCategory("all"); setPriceTier("all"); setPage(1);
  };

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Package className="w-6 h-6" />
            Furniture Library
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            WP-02 — Manage the furniture & object catalog
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleSeed}>
            <RefreshCw className="w-4 h-4 mr-1" /> Seed Catalog
          </Button>
          <Button size="sm" onClick={() => navigate("/furniture-library/new")}>
            <Plus className="w-4 h-4 mr-1" /> New Item
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {["draft", "published", "archived"].map((s) => {
          const count = items.filter(i => i.status === s).length;
          return (
            <Card key={s} className="cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => { setStatus(s); setPage(1); }}>
              <CardContent className="pt-4">
                <div className="text-2xl font-bold">{count}</div>
                <div className="text-sm text-muted-foreground capitalize">{s}</div>
              </CardContent>
            </Card>
          );
        })}
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold">{pagination.total}</div>
            <div className="text-sm text-muted-foreground">Total</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-3">
            <div className="flex-1 min-w-[200px] relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search by name, type, style…"
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(1); }}
                className="pl-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={v => { setStatus(v); setPage(1); }}>
              <SelectTrigger className="w-36">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="published">Published</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
              </SelectContent>
            </Select>
            <Select value={categoryFilter} onValueChange={v => { setCategory(v); setPage(1); }}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {categories.map(c => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={priceTierFilter} onValueChange={v => { setPriceTier(v); setPage(1); }}>
              <SelectTrigger className="w-36">
                <SelectValue placeholder="Price Tier" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Tiers</SelectItem>
                <SelectItem value="budget">Budget</SelectItem>
                <SelectItem value="mid">Mid</SelectItem>
                <SelectItem value="premium">Premium</SelectItem>
                <SelectItem value="luxury">Luxury</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="ghost" size="sm" onClick={resetFilters}>
              <Filter className="w-4 h-4 mr-1" /> Clear
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Style</TableHead>
                <TableHead>Tier</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Ver.</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                    No furniture items found. Use "Seed Catalog" to populate the library.
                  </TableCell>
                </TableRow>
              ) : items.map(item => (
                <TableRow key={item.id} className={item.deletedAt ? "opacity-50" : ""}>
                  <TableCell>
                    <button
                      className="font-medium text-left hover:underline"
                      onClick={() => navigate(`/furniture-library/${item.id}`)}
                    >
                      {item.name}
                    </button>
                    <div className="text-xs text-muted-foreground">{item.slug}</div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{item.code}</TableCell>
                  <TableCell className="text-sm">{item.furnitureType ?? "—"}</TableCell>
                  <TableCell className="text-sm">{item.style ?? "—"}</TableCell>
                  <TableCell>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PRICE_TIER_COLORS[item.priceTier] ?? ""}`}>
                      {item.priceTier}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANTS[item.status] ?? "secondary"}>
                      {STATUS_LABELS[item.status] ?? item.status}
                    </Badge>
                    {item.deletedAt && <Badge variant="destructive" className="ml-1 text-xs">deleted</Badge>}
                  </TableCell>
                  <TableCell className="text-sm">v{item.version}</TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8"
                        title="View/Edit" onClick={() => navigate(`/furniture-library/${item.id}`)}>
                        <Eye className="w-4 h-4" />
                      </Button>
                      {item.status === "draft" && !item.deletedAt && (
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-green-600"
                          title="Publish" onClick={() => handleAction(item.id, "publish")}>
                          <CheckCircle className="w-4 h-4" />
                        </Button>
                      )}
                      {item.status === "published" && !item.deletedAt && (
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-orange-600"
                          title="Archive" onClick={() => handleAction(item.id, "archive")}>
                          <Archive className="w-4 h-4" />
                        </Button>
                      )}
                      {item.status === "archived" && (
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-blue-600"
                          title="Restore" onClick={() => handleAction(item.id, "restore")}>
                          <RefreshCw className="w-4 h-4" />
                        </Button>
                      )}
                      {!item.deletedAt && (
                        <Button variant="ghost" size="icon" className="h-8 w-8"
                          title="Duplicate" onClick={() => handleAction(item.id, "duplicate")}>
                          <Copy className="w-4 h-4" />
                        </Button>
                      )}
                      {!item.deletedAt && (
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive"
                          title="Delete" onClick={() => handleDelete(item.id)}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                      {item.deletedAt && (
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-blue-600"
                          title="Restore from delete" onClick={() => handleAction(item.id, "restore")}>
                          <RefreshCw className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>

        {/* Pagination */}
        {pagination.total > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t">
            <p className="text-sm text-muted-foreground">
              {(pagination.page - 1) * pagination.pageSize + 1}–
              {Math.min(pagination.page * pagination.pageSize, pagination.total)} of {pagination.total}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1}
                onClick={() => setPage(p => p - 1)}>Previous</Button>
              <Button variant="outline" size="sm" disabled={!pagination.hasNext}
                onClick={() => setPage(p => p + 1)}>Next</Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
