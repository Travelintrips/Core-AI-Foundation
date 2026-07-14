/**
 * workspace/favorites.tsx — V4.3 Portfolio Gallery & Live Preview (Team 1)
 *
 * Customer workspace view of favorited portfolios + Brand-DNA-aware
 * recommendations, backed by the new Team-1-owned portfolio-gallery routes.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { WorkspaceLayout } from "@/components/workspace-layout";
import { Heart, Sparkles, Star, Eye, Loader2, Trash2 } from "lucide-react";

interface GalleryCard {
  id: number;
  title: string;
  industry: string;
  style: string;
  coverImage: string | null;
  rating: string | null;
  views: number;
  slug?: string | null;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json() as Promise<T>;
}

function PortfolioRow({ item, onRemove, removing }: { item: GalleryCard; onRemove?: (id: number) => void; removing?: boolean }) {
  return (
    <div className="flex items-center gap-4 p-3 rounded-xl border border-card-border bg-card">
      <div className="w-16 h-16 rounded-lg bg-muted overflow-hidden shrink-0">
        {item.coverImage && <img src={item.coverImage} alt={item.title} className="w-full h-full object-cover" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm truncate">{item.title}</p>
        <p className="text-xs text-muted-foreground">{item.industry} · {item.style}</p>
        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
          <span className="flex items-center gap-1"><Eye className="w-3 h-3" />{item.views}</span>
          {item.rating && <span className="flex items-center gap-1"><Star className="w-3 h-3 text-amber-400" />{parseFloat(item.rating).toFixed(1)}</span>}
        </div>
      </div>
      {onRemove && (
        <button onClick={() => onRemove(item.id)} disabled={removing} className="p-2 text-muted-foreground hover:text-destructive transition-colors">
          {removing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
        </button>
      )}
    </div>
  );
}

export default function WorkspaceFavoritesPage({ params }: { params: { token: string } }) {
  const { token } = params;
  const queryClient = useQueryClient();
  const favKey = ["workspace-portfolio-favorites", token];

  const { data: favData, isLoading: favLoading } = useQuery<{ items: GalleryCard[] }>({
    queryKey: favKey,
    queryFn: () => fetchJson(`/api/public/customer/workspace/${token}/portfolio-gallery/favorites`),
  });

  const { data: recData, isLoading: recLoading } = useQuery<{ basedOnBrandDna: boolean; items: GalleryCard[] }>({
    queryKey: ["workspace-portfolio-recommended", token],
    queryFn: () => fetchJson(`/api/public/customer/workspace/${token}/portfolio-gallery/recommended`),
  });

  const removeMutation = useMutation({
    mutationFn: (portfolioId: number) =>
      fetchJson(`/api/public/customer/workspace/${token}/portfolio-gallery/favorites/${portfolioId}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: favKey }),
  });

  const favorites = favData?.items ?? [];
  const recommendations = recData?.items ?? [];

  return (
    <WorkspaceLayout token={token}>
      <div className="space-y-8">
        <div>
          <h1 className="text-xl font-serif font-semibold flex items-center gap-2">
            <Heart className="w-5 h-5 text-primary" /> Favorite Portfolios
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Portfolios you've saved while browsing the gallery.</p>
        </div>

        {favLoading && <p className="text-sm text-muted-foreground">Loading favorites…</p>}
        {!favLoading && favorites.length === 0 && (
          <p className="text-sm text-muted-foreground">No favorites yet. Browse the <a href="/gallery" className="text-primary underline">Portfolio Gallery</a> and save the ones you like.</p>
        )}
        <div className="grid gap-3">
          {favorites.map((f) => (
            <PortfolioRow key={f.id} item={f} onRemove={(id) => removeMutation.mutate(id)} removing={removeMutation.isPending && removeMutation.variables === f.id} />
          ))}
        </div>

        <div>
          <h2 className="text-lg font-serif font-semibold flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" /> Recommended for your brand
          </h2>
          <p className="text-sm text-muted-foreground mt-1 mb-3">
            {recData?.basedOnBrandDna ? "Matched using your Brand DNA profile." : "Popular portfolios to explore."}
          </p>
          {recLoading && <p className="text-sm text-muted-foreground">Loading recommendations…</p>}
          <div className="grid gap-3">
            {recommendations.map((r) => <PortfolioRow key={r.id} item={r} />)}
          </div>
        </div>
      </div>
    </WorkspaceLayout>
  );
}
