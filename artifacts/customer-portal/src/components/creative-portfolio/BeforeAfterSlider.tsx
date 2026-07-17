/**
 * BeforeAfterSlider — drag/touch slider for before/after image comparison.
 * Extracted as a standalone component for reuse across gallery and inspiration feed.
 */
import { useState, useRef, useCallback } from 'react';

interface Props {
  before: string;
  after: string;
  className?: string;
}

export function BeforeAfterSlider({ before, after, className = '' }: Props) {
  const [pos, setPos] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const updatePos = useCallback((clientX: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
    setPos(x);
  }, []);

  return (
    <div
      ref={containerRef}
      className={`relative select-none rounded-xl overflow-hidden aspect-[4/3] cursor-ew-resize ${className}`}
      onMouseDown={(e) => { dragging.current = true; updatePos(e.clientX); }}
      onMouseMove={(e) => { if (dragging.current) updatePos(e.clientX); }}
      onMouseUp={() => { dragging.current = false; }}
      onMouseLeave={() => { dragging.current = false; }}
      onTouchStart={(e) => updatePos(e.touches[0].clientX)}
      onTouchMove={(e) => { e.preventDefault(); updatePos(e.touches[0].clientX); }}
    >
      {/* After (base) */}
      <img src={after} alt="After" className="absolute inset-0 w-full h-full object-cover" draggable={false} />
      {/* Before (clipped) */}
      <div className="absolute inset-0 overflow-hidden" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}>
        <img src={before} alt="Before" className="w-full h-full object-cover" draggable={false} />
      </div>
      {/* Divider */}
      <div
        className="absolute top-0 bottom-0 w-0.5 bg-white/90 shadow-[0_0_8px_rgba(0,0,0,0.4)] pointer-events-none"
        style={{ left: `${pos}%` }}
      >
        <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-9 h-9 rounded-full bg-white shadow-lg flex items-center justify-center border border-border">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M4 7H1M1 7L3 5M1 7L3 9M10 7H13M13 7L11 5M13 7L11 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>
      <span className="absolute top-3 left-3 px-2 py-0.5 rounded-full bg-black/50 text-white text-xs font-medium pointer-events-none">Before</span>
      <span className="absolute top-3 right-3 px-2 py-0.5 rounded-full bg-primary text-primary-foreground text-xs font-medium pointer-events-none">After</span>
    </div>
  );
}
