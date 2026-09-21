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
            <Button type="submit" className="w-full" disabled={submitting} data-testid="button-login">
              {submitting ? "Mengirim..." : "Kirim link login"}
            </Button>
            <p className="text-center text-xs text-muted-foreground">Link berlaku 10 menit. Password tidak diperlukan.</p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
