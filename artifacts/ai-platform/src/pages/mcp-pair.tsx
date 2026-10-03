import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function McpPairApproval() {
  const initialCode = useMemo(() => new URLSearchParams(window.location.search).get("code")?.trim() ?? "", []);
  const [code, setCode] = useState(initialCode);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [approved, setApproved] = useState(false);

  async function approve() {
    const normalized = code.replace(/\D/g, "").slice(0, 8);
    if (!/^\d{8}$/.test(normalized)) {
      setMessage("Masukkan kode pairing 8 digit.");
      return;
    }
    setSubmitting(true);
    setMessage(null);
    try {
      const body = new URLSearchParams({ code: normalized });
      const res = await fetch("/api/ai/core-chat/oauth/pair/approve", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
      const text = await res.text();
      if (!res.ok) {
        setMessage(text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || "Approval gagal.");
        return;
      }
      setApproved(true);
      setMessage("Berhasil. Kembali ke jendela Authenticate ChatGPT; koneksi akan lanjut otomatis.");
    } catch {
      setMessage("Approval gagal. Coba lagi.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Hubungkan ChatGPT ke AI Core</CardTitle>
          <CardDescription>Masukkan kode pairing yang tampil di jendela Authenticate ChatGPT.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={8}
            value={code}
            disabled={approved}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
            className="text-center text-2xl font-bold tracking-[0.35em]"
            data-testid="input-mcp-pair-code"
          />
          {message && <p className="text-sm text-muted-foreground">{message}</p>}
          <Button className="w-full" disabled={submitting || approved} onClick={approve} data-testid="button-mcp-pair-approve">
            {approved ? "Sudah Disetujui" : submitting ? "Menyetujui..." : "Approve & Hubungkan"}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Approval hanya berlaku untuk pairing aktif dan akun internal AI Core yang sedang login.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
