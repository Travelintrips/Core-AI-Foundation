/**
 * CtaButton — "Start this project" CTA.
 * Tracks the click, then navigates to the service page.
 */
import { ArrowRight, Loader2 } from 'lucide-react';
import { useTrackCtaClick } from '@/hooks/use-gallery-v2';
import { useLocation } from 'wouter';

interface Props {
  portfolioId: number;
  serviceId: number;
  label?: string;
  source?: string;
  variant?: 'primary' | 'ghost';
  className?: string;
}

export function CtaButton({ portfolioId, serviceId, label = 'Mulai Proyek Ini', source = 'gallery', variant = 'primary', className = '' }: Props) {
  const [, navigate] = useLocation();
  const track = useTrackCtaClick();

  async function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    try {
      await track.mutateAsync({ portfolioId, source });
    } catch {
      // fire-and-forget tracking; navigate regardless
    }
    navigate(`/services/${serviceId}`);
  }

  const base = variant === 'primary'
    ? 'inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors'
    : 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-primary text-primary text-sm font-medium hover:bg-primary/5 transition-colors';

  return (
    <button onClick={handleClick} disabled={track.isPending} className={`${base} ${className}`}>
      {track.isPending
        ? <Loader2 className="w-4 h-4 animate-spin" />
        : <ArrowRight className="w-4 h-4" />}
      {label}
    </button>
  );
}
