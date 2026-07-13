import { type ReactNode } from "react";
import { Redirect } from "wouter";
import { useInternalAuth } from "@/hooks/use-internal-auth";
import { Loader2 } from "lucide-react";

function FullScreenLoading() {
  return (
    <div className="flex h-screen w-full items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}

/** Requires a valid session. Redirects to /login otherwise. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useInternalAuth();
  if (loading) return <FullScreenLoading />;
  if (!user) return <Redirect to="/login" />;
  if (user.mustChangePassword) return <Redirect to="/change-password" />;
  return <>{children}</>;
}

/**
 * Requires a valid session AND one of the given internal roles. The role
 * check here is a UX convenience only — the server re-verifies role/status
 * on every request and is the real authorization boundary.
 */
export function RequireInternalRole({
  roles,
  children,
}: {
  roles?: Array<"owner" | "admin" | "manager" | "internal_staff">;
  children: ReactNode;
}) {
  const { user, loading } = useInternalAuth();
  if (loading) return <FullScreenLoading />;
  if (!user) return <Redirect to="/login" />;
  if (user.mustChangePassword) return <Redirect to="/change-password" />;
  if (roles && !roles.includes(user.role)) {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center gap-2 text-center">
        <p className="text-lg font-semibold">403 — Access denied</p>
        <p className="text-sm text-muted-foreground">Your role ({user.role}) doesn't have access to this page.</p>
      </div>
    );
  }
  return <>{children}</>;
}
