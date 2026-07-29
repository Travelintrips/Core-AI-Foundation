/**
 * WP-01 — Customer: Room Template Browser
 *
 * Features: browse published templates, search, filter by room type & style,
 * sorting, pagination, navigate to template detail.
 * Auth: public (no credentials required — B1–B3 are public exceptions).
 */
import { lazy, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { LayoutTemplate, Search, Filter, Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { SEOMeta } from "@/components/SEOMeta";

const API_BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

async function publicFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

interface RoomTemplate {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  roomTypeId: string;
  styleId: string | null;
  dimensions: { widthCm: number; depthCm: number; heightCm: number };
  previewImageUrl: string | null;
  thumbnailUrl: string | null;
  tags: string[];
  status: string;
  version: number;
}

interface RoomType  { id: string; code: string; label: string; labelId: string; icon: string; }
interface RoomStyle { id: string; name: string; nameId?: string; slug: string; }

export default function RoomTemplateBrowserPage() {
  const [search, setSearch]     = useState("");
  const [roomTypeId, setRoomTypeId] = useState("");
  const [page, setPage]         = useState(1);
  const pageSize = 12;

  const { data: roomTypes } = useQuery<{ data: RoomType[] }>({
    queryKey: ["room-types-public"],
    queryFn: () => publicFetch("/api/ai/room-types"),
    staleTime: 600_000,
  });

  const { data: roomStyles } = useQuery<{ data: RoomStyle[] }>({
    queryKey: ["room-styles-public"],
    queryFn: () => publicFetch("/api/ai/room-styles?status=active"),
    staleTime: 600_000,
  });

  const queryKey = ["room-templates-public", { search, roomTypeId, page }];
  const { data, isLoading, isError } = useQuery<{ data: RoomTemplate[]; pagination: { total: number; hasNext: boolean } }>({
    queryKey,
    queryFn: () => {
      const params = new URLSearchParams({
        page: String(page), pageSize: String(pageSize),
        status: "published",
        ...(search     && { search }),
        ...(roomTypeId && { roomTypeId }),
      });
      return publicFetch(`/api/ai/room-catalog/templates?${params}`);
    },
  });

  const templates = data?.data ?? [];
  const typeMap  = Object.fromEntries((roomTypes?.data ?? []).map(t => [t.id, t]));
  const styleMap = Object.fromEntries((roomStyles?.data ?? []).map(s => [s.id, s]));

  return (
    <div className="min-h-screen bg-background">
      <SEOMeta
        title="Template Ruangan & Interior"
        description="Temukan template ruangan terbaik untuk berbagai jenis ruang — dari modern minimalis hingga tradisional klasik. Visualisasikan ruangan impian Anda."
        canonical="/room-templates"
      />
      {/* Hero */}
      <div className="bg-gradient-to-br from-slate-900 to-slate-800 text-white py-12 px-4">
        <div className="max-w-5xl mx-auto text-center">
          <div className="flex justify-center mb-4">
            <LayoutTemplate className="h-10 w-10 opacity-80" />
          </div>
          <h1 className="text-3xl font-bold mb-2">Temukan Template Ruangan</h1>
          <p className="text-slate-300 text-sm max-w-lg mx-auto">
            Jelajahi koleksi template ruangan kami untuk memulai desain interior impian Anda.
          </p>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
        {/* Filters */}
        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Cari template..."
              className="pl-8"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
            />
          </div>
          <Select value={roomTypeId} onValueChange={v => { setRoomTypeId(v === "_all" ? "" : v); setPage(1); }}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Semua tipe ruang" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_all">Semua tipe ruang</SelectItem>
              {(roomTypes?.data ?? []).map(rt => (
                <SelectItem key={rt.id} value={rt.id}>{rt.icon} {rt.labelId || rt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Room Type Quick Filters */}
        <div className="flex gap-2 flex-wrap">
          <Button
            variant={roomTypeId === "" ? "default" : "outline"}
            size="sm"
            onClick={() => { setRoomTypeId(""); setPage(1); }}
          >
            Semua
          </Button>
          {(roomTypes?.data ?? []).map(rt => (
            <Button
              key={rt.id}
              variant={roomTypeId === rt.id ? "default" : "outline"}
              size="sm"
              onClick={() => { setRoomTypeId(rt.id); setPage(1); }}
            >
              {rt.icon} {rt.labelId || rt.label}
            </Button>
          ))}
        </div>

        {/* Grid */}
        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : isError ? (
          <div className="text-center py-16 text-muted-foreground">
            Gagal memuat template. Silakan coba lagi.
          </div>
        ) : templates.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <LayoutTemplate className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>Belum ada template yang tersedia.</p>
            {search && <p className="text-sm mt-1">Coba kata kunci yang berbeda.</p>}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {templates.map(t => {
              const rt = typeMap[t.roomTypeId];
              const st = t.styleId ? styleMap[t.styleId] : null;
              return (
                <Link key={t.id} href={`/room-templates/${t.id}`}>
                  <div className="border rounded-xl overflow-hidden hover:shadow-md transition-shadow cursor-pointer group">
                    {t.previewImageUrl || t.thumbnailUrl ? (
                      <div className="aspect-video bg-muted overflow-hidden">
                        <img
                          src={t.previewImageUrl ?? t.thumbnailUrl ?? ""}
                          alt={t.name}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                      </div>
                    ) : (
                      <div className="aspect-video bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center">
                        <span className="text-4xl opacity-60">{rt?.icon ?? "🏠"}</span>
                      </div>
                    )}
                    <div className="p-4">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <h3 className="font-semibold text-sm leading-tight group-hover:text-primary transition-colors line-clamp-2">
                          {t.name}
                        </h3>
                      </div>
                      <div className="flex flex-wrap gap-1 mb-2">
                        {rt && <Badge variant="outline" className="text-xs">{rt.icon} {rt.labelId || rt.label}</Badge>}
                        {st && <Badge variant="secondary" className="text-xs">{st.name}</Badge>}
                      </div>
                      {t.description && (
                        <p className="text-xs text-muted-foreground line-clamp-2">{t.description}</p>
                      )}
                      <div className="mt-2 text-xs text-muted-foreground">
                        {t.dimensions.widthCm}×{t.dimensions.depthCm}×{t.dimensions.heightCm} cm
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {data?.pagination && data.pagination.total > pageSize && (
          <div className="flex items-center justify-center gap-3 pt-4">
            <Button variant="outline" size="sm" onClick={() => setPage(p => p - 1)} disabled={page === 1}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm text-muted-foreground">Halaman {page}</span>
            <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={!data.pagination.hasNext}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
