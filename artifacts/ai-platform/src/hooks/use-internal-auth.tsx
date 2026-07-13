import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";

export type InternalRole = "owner" | "admin" | "manager" | "internal_staff";

export interface InternalUser {
  id: number;
  email: string;
  role: InternalRole;
  accountType: string;
  status: string;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

interface AuthState {
  user: InternalUser | null;
  loading: boolean;
  error: string | null;
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<{ ok: boolean; error?: string }>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function readJson(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export function InternalAuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, loading: true, error: null });

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/internal/auth/me", { credentials: "include" });
      if (!res.ok) {
        setState({ user: null, loading: false, error: null });
        return;
      }
      const body = await readJson(res);
      setState({ user: body?.user ?? null, loading: false, error: null });
    } catch (err) {
      setState({ user: null, loading: false, error: err instanceof Error ? err.message : "Failed to load session" });
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await fetch("/api/internal/auth/login", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const body = await readJson(res);
    if (!res.ok) {
      return { ok: false, error: body?.error ?? "Login failed" };
    }
    setState({ user: body?.user ?? null, loading: false, error: null });
    return { ok: true };
  }, []);

  const logout = useCallback(async () => {
    await fetch("/api/internal/auth/logout", { method: "POST", credentials: "include" });
    setState({ user: null, loading: false, error: null });
  }, []);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    const res = await fetch("/api/internal/auth/change-password", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const body = await readJson(res);
    if (!res.ok) {
      return { ok: false, error: body?.error ?? "Failed to change password" };
    }
    setState((prev) => ({ ...prev, user: body?.user ?? prev.user }));
    return { ok: true };
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, login, logout, changePassword, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useInternalAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useInternalAuth must be used within InternalAuthProvider");
  return ctx;
}
