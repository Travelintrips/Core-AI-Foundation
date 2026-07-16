/**
 * FavoriteButton — optimistic heart toggle for portfolio cards.
 * Requires a workspace token for auth. Renders nothing if no token.
 */
import { Heart } from 'lucide-react';
import { useToggleFavorite } from '@/hooks/use-gallery-v2';

interface Props {
  portfolioId: number;
  isFavorited: boolean;
  token: string | undefined;
  className?: string;
}

export function FavoriteButton({ portfolioId, isFavorited, token, className = '' }: Props) {
  const { add, remove } = useToggleFavorite(token);
  if (!token) return null;

  const loading = add.isPending || remove.isPending;

  function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    if (loading) return;
    if (isFavorited) {
      remove.mutate(portfolioId);
    } else {
      add.mutate(portfolioId);
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={loading}
      aria-label={isFavorited ? 'Remove from favorites' : 'Add to favorites'}
      className={`p-1.5 rounded-full transition-all ${
        isFavorited
          ? 'bg-rose-500/20 text-rose-400 hover:bg-rose-500/30'
          : 'bg-black/30 text-white/70 hover:bg-black/50 hover:text-white'
      } ${loading ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}
    >
      <Heart className={`w-4 h-4 transition-transform ${isFavorited ? 'fill-rose-400 scale-110' : ''}`} />
    </button>
  );
}
