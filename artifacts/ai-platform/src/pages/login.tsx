import { useState } from "react";
import { useLocation } from "wouter";
import { useInternalAuth } from "@/hooks/use-internal-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export default function Login() {
  const { user } = useInternalAuth();
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);
  const [resetSubmitting, setResetSubmitting] = useState(false);

  if (user && !user.mustChangePassword) {
    navigate("/");
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setMessage(null);
    try {
      const res = await fetch("/api/internal/auth/request-magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      setMessage(data.message ?? data.error ?? "Permintaan login diproses.");
    } catch {
      setMessage("Gagal mengirim link login. Silakan coba lagi.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResetPassword() {
    const normalizedEmail = email.trim();
    if (!normalizedEmail) {
      setMessage("Masukkan email terlebih dahulu.");
      return;
    }
    setResetSubmitting(true);
    setMessage(null);
    try {
      const res = await fetch("/api/internal/auth/request-password-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail }),
      });
      const data = await res.json().catch(() => ({}));
      setMessage(data.message ?? data.error ?? "Permintaan reset password diproses.");
    } catch {
      setMessage("Gagal mengirim link reset password. Silakan coba lagi.");
    } finally {
      setResetSubmitting(false);
    }
  }

  async function handlePasswordLogin() {
    if (!email.trim() || !password) {
      setMessage("Masukkan email dan password.");
      return;
    }
    setPasswordSubmitting(true);
    setMessage(null);
    try {
      const res = await fetch("/api/internal/auth/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(data.error ?? "Login gagal.");
        return;
      }
      navigate("/");
    } catch {
      setMessage("Tidak dapat menghubungi layanan login.");
    } finally {
      setPasswordSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Login Portal AI</CardTitle>
          <CardDescription>Masukkan email. Link login tanpa password akan dikirim ke email Anda.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="email" required value={email}
                onChange={(e) => setEmail(e.target.value)} data-testid="input-email" />
            </div>
            {message && <p className="text-sm text-muted-foreground">{message}</p>}
            <Button type="submit" className="w-full" disabled={submitting || passwordSubmitting || resetSubmitting} data-testid="button-login">
              {submitting ? "Mengirim..." : "Kirim link login"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={submitting || passwordSubmitting || resetSubmitting}
              onClick={handleResetPassword}
              data-testid="button-reset-password"
            >
              {resetSubmitting ? "Mengirim..." : "Kirim ulang link reset password"}
            </Button>
            <div className="space-y-2">
              <Label htmlFor="password">Password (jika sudah memiliki akun)</Label>
              <Input id="password" type="password" autoComplete="current-password"
                value={password} onChange={(e) => setPassword(e.target.value)}
                data-testid="input-password" />
            </div>
            <Button type="button" variant="outline" className="w-full"
              disabled={submitting || passwordSubmitting || resetSubmitting || !email.trim() || !password}
              onClick={handlePasswordLogin} data-testid="button-password-login">
              {passwordSubmitting ? "Masuk..." : "Login dengan password"}
            </Button>
            <p className="text-center text-xs text-muted-foreground">Link berlaku 10 menit. Password tidak diperlukan.</p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
