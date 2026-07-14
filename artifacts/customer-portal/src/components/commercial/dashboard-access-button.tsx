/**
 * "Buka Dashboard" action for commercial pages (pricing / results) once a
 * request has reached "in_production" or "done". The public request-detail
 * endpoint never returns the customer's dashboardToken (tokens are hashed
 * and intentionally non-recoverable — see customer-portal.ts), so this
 * button re-derives access on demand via POST /api/public/customer/request-access
 * using the email already on the request, then navigates to the returned
 * dashboardUrl. This is what makes the "cek ... dashboard Anda" copy on
 * those pages an actual, clickable link instead of a dead reference.
 */
import { useState } from "react";
import { LayoutDashboard, Loader2 } from "lucide-react";
import { useRequestCustomerAccess } from "@/hooks/use-customer";

export function DashboardAccessButton({ email, className }: { email: string; className?: string }) {
  const requestAccess = useRequestCustomerAccess();
  const [error, setError] = useState<string | null>(null);

  const handleClick = () => {
    setError(null);
    requestAccess.mutate(
      { data: { email } },
      {
        onSuccess: (res) => {
          window.location.href = res.dashboardUrl;
        },
        onError: (err) => {
          setError((err as Error).message || "Gagal membuka dashboard. Coba lagi nanti.");
        },
      },
    );
  };

  return (
    <div className={className}>
      <button
        type="button"
        onClick={handleClick}
        disabled={requestAccess.isPending}
        className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-full text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {requestAccess.isPending ? (
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
        ) : (
          <LayoutDashboard className="w-4 h-4" aria-hidden="true" />
        )}
        Buka Dashboard
      </button>
      {error && <p className="text-xs text-destructive mt-2" role="alert">{error}</p>}
    </div>
  );
}
