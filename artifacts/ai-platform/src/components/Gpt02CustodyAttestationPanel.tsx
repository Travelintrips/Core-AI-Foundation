import { useRef, useState } from "react";
import { useInternalAuth } from "@/hooks/use-internal-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const DEV_ORIGIN = "https://dev.cstlogistic.co.id";
const SERVICE = "openclaw-vps-dev-consumer";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const BINDING = /^[a-f0-9]{64}$/;
const TARGET = {
  audience: "CST-DEV/GPT02/READER-CUSTODY/WORKER-ATTESTATION/v2",
  project: "xssrfshdrtdfupgqwfdw",
  scope: "GPT02_READER_CREDENTIAL_CUSTODY_CST_DEV",
  principal: "openclaw-vps-main",
  service: SERVICE,
  issuer: "CST_DEV_AGENT_CREDENTIAL_ADMIN",
} as const;

export type Gpt02CustodyCredential = {
  id: string;
  name: string;
  scopes: string[];
  isActive: boolean;
};

type PublicEnvelope = {
  receipt: typeof TARGET & {
    credentialId: string;
    credentialBinding: string;
    notBefore: number;
    expiresAt: number;
  };
  signature: string;
};

function exactObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
}

// This is a response-shape check for displaying public evidence. The server
// verifies the signing key; the custody verifier still authenticates the proof.
function publicEnvelope(value: unknown, id: string, binding: string): PublicEnvelope | null {
  if (!exactObject(value, ["receipt", "signature"]) ||
      typeof value.signature !== "string" || !/^[A-Za-z0-9_-]{85}[AQgw]$/.test(value.signature)) return null;
  const receipt = value.receipt;
  if (!exactObject(receipt, [...Object.keys(TARGET), "credentialId", "credentialBinding", "notBefore", "expiresAt"]) ||
      Object.entries(TARGET).some(([key, expected]) => receipt[key] !== expected) ||
      receipt.credentialId !== id || receipt.credentialBinding !== binding ||
      typeof receipt.notBefore !== "number" || !Number.isSafeInteger(receipt.notBefore) || receipt.notBefore < 0 ||
      typeof receipt.expiresAt !== "number" || !Number.isSafeInteger(receipt.expiresAt) ||
      receipt.expiresAt <= receipt.notBefore || receipt.expiresAt - receipt.notBefore > 60 * 60 * 1000 ||
      receipt.expiresAt <= Date.now()) return null;
  return value as PublicEnvelope;
}

function issuanceFailure(status: number): string {
  if (status === 401) return "Sesi Owner tidak berlaku. Masuk kembali melalui login internal.";
  if (status === 403) return "Penerbitan ditolak. Diperlukan sesi Owner internal yang aktif di Core DEV.";
  if (status === 409) return "Kredensial atau binding sudah berubah atau kedaluwarsa. Ambil binding publik terbaru sebelum mencoba lagi.";
  if (status === 404) return "Penerbit custody belum diaktifkan di Core DEV.";
  return `Bukti custody belum tersedia (HTTP ${status}). Periksa kesiapan penerbit sebelum mencoba lagi.`;
}

export function Gpt02CustodyAttestationPanel({ credentials, credentialsReady }: {
  credentials: readonly Gpt02CustodyCredential[];
  credentialsReady: boolean;
}) {
  const { user, loading: sessionLoading } = useInternalAuth();
  const [binding, setBinding] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ ownerId: number; envelope: PublicEnvelope } | null>(null);
  const inFlight = useRef(false);
  const owner = !sessionLoading && user?.role === "owner" && user.accountType === "internal" &&
    user.status === "active" && user.mustChangePassword === false;
  const isDev = window.location.origin === DEV_ORIGIN;
  const candidates = credentials.filter((item) => item && item.name === SERVICE && item.isActive === true &&
    typeof item.id === "string" && UUID.test(item.id) && Array.isArray(item.scopes) &&
    (item.scopes.includes("agent:presence") || item.scopes.includes("*")));
  const credential = candidates.length === 1 ? candidates[0] : undefined;
  const expectedBinding = binding.trim();
  const canIssue = owner && isDev && credentialsReady && !!credential && BINDING.test(expectedBinding);
  const envelope = owner && isDev && result !== null && result.ownerId === user?.id &&
    result.envelope.receipt.credentialId === credential?.id &&
    result.envelope.receipt.credentialBinding === expectedBinding ? result.envelope : null;

  async function issue() {
    if (!canIssue || !credential || !user || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch(`/api/ai/agent-runtime/credentials/${credential.id}/custody-attestation`, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedCredentialBinding: expectedBinding }),
      });
      if (response.status !== 201) {
        setError(issuanceFailure(response.status));
        return;
      }
      if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "") ||
          !response.headers.get("cache-control")?.split(",").some((value) => value.trim().toLowerCase() === "no-store")) {
        setError("Respons penerbit tidak sesuai kontrak bukti publik. Tidak ada berkas yang ditampilkan.");
        return;
      }
      const proof = publicEnvelope(await response.json(), credential.id, expectedBinding);
      if (!proof) {
        setError("Respons penerbit tidak sesuai kontrak bukti publik. Tidak ada berkas yang ditampilkan.");
        return;
      }
      setResult({ ownerId: user.id, envelope: proof });
    } catch {
      setError("Hasil penerbitan belum dapat dipastikan. Periksa audit penerbit sebelum mengirim ulang.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  function download() {
    if (!envelope || busy) return;
    let url: string | undefined;
    try {
      url = URL.createObjectURL(new Blob([JSON.stringify(envelope, null, 2) + "\n"], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "worker-attestation.json";
      document.body.appendChild(link);
      try { link.click(); } finally { link.remove(); }
    } catch {
      setError("Unduhan belum berhasil. Bukti publik tetap tersedia di bawah untuk disimpan.");
    } finally {
      if (url) {
        const downloadUrl = url;
        window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
      }
    }
  }

  return (
    <section aria-labelledby="gpt02-custody-heading" className="space-y-3 rounded-md border p-4">
      <h3 id="gpt02-custody-heading" className="text-sm font-semibold">Bukti custody worker GPT02 — DEV</h3>
      {!owner ? (
        <p role="status" className="text-sm text-muted-foreground">
          {sessionLoading ? "Memeriksa sesi internal…" : "Masuk sebagai Owner internal yang aktif untuk menerbitkan bukti custody. Akun admin tidak memiliki izin ini."}
        </p>
      ) : !isDev ? (
        <p role="status" className="text-sm text-muted-foreground">Penerbitan tersedia di https://dev.cstlogistic.co.id.</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Terbitkan bukti publik untuk {SERVICE} dengan sesi Owner saat ini.
            Gunakan binding publik dari permintaan attestation worker yang terbaru.
          </p>
          <p className="break-all text-sm">
            Kredensial: {credentialsReady && credential ? credential.id : "Belum tersedia. Muat ulang daftar kredensial aktif."}
          </p>
          <div className="space-y-2">
            <Label htmlFor="gpt02-custody-binding">Binding kredensial publik (64 karakter heksadesimal)</Label>
            <Input id="gpt02-custody-binding" value={binding} maxLength={64} autoComplete="off" spellCheck={false}
              disabled={busy || !credentialsReady || !credential}
              aria-describedby="gpt02-custody-binding-help"
              onChange={(event) => { setBinding(event.target.value); setResult(null); setError(""); }} />
            <p id="gpt02-custody-binding-help" className="text-xs text-muted-foreground">
              Tempel nilai credentialBinding dari paket unsigned worker.
            </p>
          </div>
          <Button type="button" disabled={!canIssue || busy} onClick={() => void issue()}>
            {busy ? "Menerbitkan bukti…" : "Terbitkan bukti custody worker"}
          </Button>
          {envelope && (
            <div className="space-y-3 rounded-md border p-3">
              <div role="status" className="space-y-1 text-sm">
                <p>Bukti publik diterbitkan. Berlaku sampai {new Date(envelope.receipt.expiresAt).toLocaleString()}.</p>
                <p>Verifikasi reader E2E masih belum dilakukan. Pemasangan bukti dan verifikasi DBA merupakan langkah terpisah.</p>
              </div>
              <Button type="button" variant="outline" disabled={busy} onClick={download}>Unduh bukti publik JSON</Button>
              <details>
                <summary className="cursor-pointer text-sm">Lihat bukti publik JSON</summary>
                <pre aria-label="Bukti custody publik JSON" className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(envelope, null, 2)}</pre>
              </details>
            </div>
          )}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </>
      )}
    </section>
  );
}
