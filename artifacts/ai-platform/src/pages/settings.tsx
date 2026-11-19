import { useEffect, useState } from "react";
import HandshakeSopSettings from "@/components/HandshakeSopSettings";
import { useListSettings } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Settings2, Eye, EyeOff, Edit2, Bell, Save, X, AlertTriangle } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { preflightPchpEncryption, encryptPchpWorkerToken, downloadEncryptedPchpCredential } from "@/lib/pchp-token-transport";

const ADMIN_KEY = import.meta.env["VITE_ADMIN_API_KEY"] as string | undefined;

async function updateSetting(key: string, value: string): Promise<void> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (ADMIN_KEY) headers["x-admin-api-key"] = ADMIN_KEY;
  const res = await fetch(`/api/ai/settings/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ value }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Failed to save setting: ${text}`);
  }
}

// ── Provider Health Alert Settings Panel ─────────────────────────────────────

const ALERT_KEYS = [
  "provider_alert.enabled",
  "provider_alert.failure_threshold",
  "provider_alert.poll_interval_minutes",
  "provider_alert.email",
  "provider_alert.webhook_url",
] as const;

type AlertKey = typeof ALERT_KEYS[number];

function ProviderAlertSettings() {
  const queryClient = useQueryClient();
  const { data: allSettings } = useListSettings();

  const alertSettings = Object.fromEntries(
    ALERT_KEYS.map((k) => [k, allSettings?.find((s: { key: string }) => s.key === k)?.value ?? ""])
  ) as Record<AlertKey, string>;

  const [draft, setDraft] = useState<Record<AlertKey, string> | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const values = draft ?? alertSettings;

  function startEdit() {
    setDraft({ ...alertSettings });
    setEditing(true);
    setError(null);
  }

  function cancelEdit() {
    setDraft(null);
    setEditing(false);
    setError(null);
  }

  async function saveAll() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      await Promise.all(
        ALERT_KEYS.map((k) => updateSetting(k, draft[k] ?? ""))
      );
      await queryClient.invalidateQueries({ queryKey: ["/api/ai/settings"] });
      setDraft(null);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const isEnabled = values["provider_alert.enabled"] === "true";

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur">
      <CardHeader className="pb-4 border-b border-border/50">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium font-mono uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <Bell className="size-4" /> Provider Health Alerts
          </CardTitle>
          <div className="flex items-center gap-2">
            {editing ? (
              <>
                <Button variant="ghost" size="sm" onClick={cancelEdit} disabled={saving}>
                  <X className="size-3 mr-1" /> Cancel
                </Button>
                <Button size="sm" onClick={saveAll} disabled={saving}>
                  <Save className="size-3 mr-1" /> {saving ? "Saving…" : "Save"}
                </Button>
              </>
            ) : (
              <Button variant="ghost" size="sm" onClick={startEdit}>
                <Edit2 className="size-3 mr-1" /> Edit
              </Button>
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Automatically ping all providers and send alerts when failures exceed the threshold.
        </p>
      </CardHeader>
      <CardContent className="p-6 space-y-5">
        {error && (
          <div className="flex items-center gap-2 text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded px-3 py-2">
            <AlertTriangle className="size-3 shrink-0" /> {error}
          </div>
        )}

        {/* Enable toggle */}
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-sm font-medium">Enable alerts</Label>
            <p className="text-xs text-muted-foreground">Background poller sends alerts when providers go down</p>
          </div>
          {editing ? (
            <Switch
              checked={values["provider_alert.enabled"] === "true"}
              onCheckedChange={(checked) =>
                setDraft((d) => ({ ...d!, "provider_alert.enabled": checked ? "true" : "false" }))
              }
            />
          ) : (
            <Badge variant={isEnabled ? "default" : "secondary"} className="font-mono text-xs">
              {isEnabled ? "Enabled" : "Disabled"}
            </Badge>
          )}
        </div>

        {/* Threshold */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex-1">
            <Label className="text-sm font-medium">Failure threshold</Label>
            <p className="text-xs text-muted-foreground">Alert fires after this many consecutive failures</p>
          </div>
          {editing ? (
            <Input
              type="number"
              min={1}
              max={20}
              className="w-24 h-8 text-xs font-mono"
              value={values["provider_alert.failure_threshold"]}
              onChange={(e) =>
                setDraft((d) => ({ ...d!, "provider_alert.failure_threshold": e.target.value }))
              }
            />
          ) : (
            <span className="font-mono text-sm font-bold">
              {values["provider_alert.failure_threshold"] || "3"}
            </span>
          )}
        </div>

        {/* Poll interval */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex-1">
            <Label className="text-sm font-medium">Poll interval (minutes)</Label>
            <p className="text-xs text-muted-foreground">How often to ping all providers</p>
          </div>
          {editing ? (
            <Input
              type="number"
              min={1}
              max={60}
              className="w-24 h-8 text-xs font-mono"
              value={values["provider_alert.poll_interval_minutes"]}
              onChange={(e) =>
                setDraft((d) => ({ ...d!, "provider_alert.poll_interval_minutes": e.target.value }))
              }
            />
          ) : (
            <span className="font-mono text-sm font-bold">
              {values["provider_alert.poll_interval_minutes"] || "5"} min
            </span>
          )}
        </div>

        {/* Alert email */}
        <div className="space-y-1">
          <Label className="text-sm font-medium">Alert email(s)</Label>
          <p className="text-xs text-muted-foreground">Comma-separated email addresses to notify</p>
          {editing ? (
            <Input
              className="h-8 text-xs font-mono"
              placeholder="admin@example.com, ops@example.com"
              value={values["provider_alert.email"]}
              onChange={(e) =>
                setDraft((d) => ({ ...d!, "provider_alert.email": e.target.value }))
              }
            />
          ) : (
            <div className="font-mono text-xs bg-background/50 px-3 py-2 rounded border border-border/50 text-muted-foreground min-h-[32px]">
              {values["provider_alert.email"] || <span className="italic opacity-50">not configured</span>}
            </div>
          )}
        </div>

        {/* Webhook URL */}
        <div className="space-y-1">
          <Label className="text-sm font-medium">Webhook URL</Label>
          <p className="text-xs text-muted-foreground">HTTPS endpoint to POST alert payloads to</p>
          {editing ? (
            <Input
              className="h-8 text-xs font-mono"
              placeholder="https://hooks.example.com/provider-alerts"
              value={values["provider_alert.webhook_url"]}
              onChange={(e) =>
                setDraft((d) => ({ ...d!, "provider_alert.webhook_url": e.target.value }))
              }
            />
          ) : (
            <div className="font-mono text-xs bg-background/50 px-3 py-2 rounded border border-border/50 text-muted-foreground min-h-[32px] truncate">
              {values["provider_alert.webhook_url"] || <span className="italic opacity-50">not configured</span>}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}


function DevPingTestPanel() {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState("");
  const isDev = typeof window !== "undefined" && window.location.hostname === "dev.cstlogistic.co.id";

  async function sendPing() {
    if (!isDev || pending) return;
    if (!window.confirm("Send one read-only PING to openclaw-pc-worker on AI Core DEV?")) return;
    setPending(true);
    setResult("");
    try {
      const externalCommandId = "dev-pchp-ping-" + crypto.randomUUID();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (ADMIN_KEY) headers["x-admin-api-key"] = ADMIN_KEY;
      const response = await fetch("/api/ai/coding/bridge/commands", {
        method: "POST",
        credentials: "same-origin",
        headers,
        body: JSON.stringify({
          externalCommandId,
          instruction: "PING",
          source: "chatgpt-dev-test",
          commandType: "EXTERNAL_AGENT_WORK",
          assignedClientId: "openclaw-pc-worker",
          metadata: { diagnostic: true, environment: "DEV", noProd: true },
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setResult("HTTP " + response.status + ": " + (payload.error ?? "Request rejected"));
        return;
      }
      const commandId = payload.command?.id ?? payload.commandId;
      setResult("Queued: " + (commandId ?? externalCommandId) + ". Check PC HP bridge for callback_persisted.");
    } catch (error) {
      setResult("Request failed: " + (error instanceof Error ? error.message : "Unknown error"));
    } finally {
      setPending(false);
    }
  }

  if (!isDev) return null;
  return (
    <Card>
      <CardHeader><CardTitle>DEV PC Worker PING Test</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">Submit one PING to openclaw-pc-worker. DEV only; does not run shell commands or modify PROD.</p>
        <Button disabled={pending} onClick={() => void sendPing()}>
          {pending ? "Sending..." : "Test PING DEV"}
        </Button>
        {result && <p role="status" className="text-sm font-mono break-all">{result}</p>}
      </CardContent>
    </Card>
  );
}

function AgentCredentialsPanel() {
  const [items, setItems] = useState<Array<{ id: string; name: string; scopes: string[]; isActive: boolean }>>([]);
  const [issued, setIssued] = useState("");
  // Retain only the encrypted ciphertext in this page session for a direct user-initiated retry.
  const [encryptedPchpDownload, setEncryptedPchpDownload] = useState("");
  const [pchpTest, setPchpTest] = useState<{
    commandId: string; correlationId: string; clientId: string; status: string;
    callbackReceived: boolean; assistantReplyVerified: boolean;
  } | null>(null);
  const [pchpTestError, setPchpTestError] = useState("");
  const [pchpTestBusy, setPchpTestBusy] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);
  useEffect(() => { void refresh(); }, []);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (ADMIN_KEY) headers["x-admin-api-key"] = ADMIN_KEY;
  async function refresh() {
    setRefreshing(true);
    setError("");
    setLastRefresh(null);
    try {
      const response = await fetch("/api/ai/agent-runtime/credentials", { headers, credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error("Cannot load agent credentials (" + response.status + ")");
      const body = await response.json();
      if (!Array.isArray(body.credentials)) throw new Error("Invalid credentials response");
      setItems(body.credentials);
      setLastRefresh(new Date().toLocaleTimeString());
    } catch (err) {
      setError(String(err));
    } finally {
      setRefreshing(false);
    }
  }
  async function issue(name: "openclaw-pc-worker-3" | "openclaw-pc-worker-dev" | "openclaw-travelintrips-dev" | "openclaw-vps-dev-consumer" | "openclaw-dell-chatgpt-wake-dev" | "openclaw-pchp-dev") {
    setLoading(true); setError(""); setIssued(""); setEncryptedPchpDownload("");
    try {
      // Validate encrypted delivery BEFORE issuing a one-time worker secret.
      if (name === "openclaw-pchp-dev") await preflightPchpEncryption();
      const response = await fetch("/api/ai/agent-runtime/credentials", {
        method: "POST", headers, credentials: "same-origin",
        body: JSON.stringify({ name, scopes: (name === "openclaw-vps-dev-consumer" || name === "openclaw-pc-worker-dev" || name === "openclaw-travelintrips-dev" || name === "openclaw-pchp-dev") ? ["agent:presence", "agent:work"] : ["agent:presence", "agent:work", "model:chat"] }),
      });
      if (!response.ok) throw new Error("Issuing credential failed (" + response.status + ")");
      const body = await response.json();
      if (name === "openclaw-pchp-dev") {
        const encrypted = await encryptPchpWorkerToken(body.token);
        setEncryptedPchpDownload(encrypted);
        // Best-effort automatic download; browser may block downloads after an async request.
        // The manual button below uses a fresh user gesture, without exposing plaintext.
        try { downloadEncryptedPchpCredential(encrypted); } catch {
          setError("Automatic PCHP download was blocked. Use the manual encrypted download button below.");
        }
      } else {
        setIssued(body.token);
      }
      await refresh();
    } catch (err) { setError(String(err)); } finally { setLoading(false); }
  }
  async function startPchpSopTest() {
    if (pchpTestBusy || pchpTest) return;
    setPchpTestBusy(true);
    setPchpTestError("");
    try {
      if (window.location.hostname !== "dev.cstlogistic.co.id") throw new Error("Uji hanya tersedia di AI Core DEV");
      const correlationId = "ai-task:HS_PCHP_20261025:5:" + crypto.randomUUID().replaceAll("-", "");
      const response = await fetch("/api/ai/coding/bridge/ai-task-chatgpt-dispatch", {
        method: "POST", credentials: "same-origin", headers, cache: "no-store",
        body: JSON.stringify({
          accountAlias: "GPT02",
          targetWorkerId: "openclaw-pchp-dev",
          jobAlias: "HS_PCHP_20261025",
          correlationId,
          instruction: "Uji Handshake SOP HS-PCHP-20261025 melalui AI Core DEV dan OpenClaw PCHP. Balas pada percakapan GPT02 dengan SOP_PCHP_E2E_ACK_20261025 dan satu kalimat SOP Resource-First, Human-Last. Jangan mengubah data, konfigurasi, atau melakukan deployment.",
        }),
      });
      const body: unknown = await response.json().catch(() => null);
      const reply = body && typeof body === "object" ? body as Record<string, unknown> : {};
      if (!response.ok) throw new Error("Pengiriman uji gagal (HTTP " + response.status + "): " + String(reply.error ?? "Unknown error"));
      if (reply.clientId !== "openclaw-pchp-dev" || typeof reply.commandId !== "string" ||
          reply.correlationId !== correlationId) throw new Error("Worker PCHP tidak terkonfirmasi; uji tidak boleh dinyatakan PASS");
      setPchpTest({
        commandId: reply.commandId, correlationId, clientId: reply.clientId,
        status: "QUEUED", callbackReceived: false, assistantReplyVerified: false,
      });
    } catch (err) {
      setPchpTestError(String(err));
    } finally {
      setPchpTestBusy(false);
    }
  }
  async function checkPchpSopTest() {
    if (!pchpTest || pchpTestBusy) return;
    setPchpTestBusy(true);
    setPchpTestError("");
    try {
      const query = new URLSearchParams({
        commandId: pchpTest.commandId, correlationId: pchpTest.correlationId,
      });
      const response = await fetch("/api/ai/coding/bridge/ai-task-chatgpt-timeline?" + query, {
        credentials: "same-origin", headers, cache: "no-store",
      });
      if (!response.ok) throw new Error("Pemeriksaan callback gagal (HTTP " + response.status + ")");
      const body: unknown = await response.json();
      if (!body || typeof body !== "object") throw new Error("Respons timeline tidak valid");
      const timeline = body as Record<string, unknown>;
      const metadata = timeline.commandMetadata as Record<string, unknown> | null;
      if (timeline.commandId !== pchpTest.commandId || metadata?.assignedClientId !== "openclaw-pchp-dev" ||
          metadata?.targetConversationId !== "6ada4099-af8c-83ec-9fed-8626d3ac9617") {
        throw new Error("Binding percakapan atau worker tidak cocok; verifikasi ditolak");
      }
      const responses = Array.isArray(timeline.responses) ? timeline.responses : [];
      const completed = responses.filter((r: unknown) =>
        r && typeof r === "object" && (r as Record<string, unknown>).kind === "COMPLETED"
      );
      const attested = completed.some((r: unknown) => {
        const item = r as Record<string, unknown>;
        const evidence = item.metadata as Record<string, unknown> | null;
        return evidence?.chatgptSubmitted === true &&
          evidence?.verifiedAssistantReply === true &&
          typeof item.message === "string" && item.message.includes("SOP_PCHP_E2E_ACK_20261025");
      });
      setPchpTest({
        ...pchpTest,
        status: typeof timeline.status === "string" ? timeline.status : "UNKNOWN",
        callbackReceived: completed.length > 0,
        assistantReplyVerified: attested,
      });
    } catch (err) {
      setPchpTestError(String(err));
    } finally {
      setPchpTestBusy(false);
    }
  }
  async function revoke(id: string) {
    if (!window.confirm("Revoke this worker credential? Running workers using it will disconnect.")) return;
    setLoading(true); setError(""); setIssued(""); setEncryptedPchpDownload("");
    try {
      const response = await fetch("/api/ai/agent-runtime/credentials/" + encodeURIComponent(id) + "/revoke", {
        method: "POST", headers, credentials: "same-origin",
      });
      if (!response.ok) throw new Error("Revocation failed (" + response.status + ")");
      await refresh();
    } catch (err) { setError(String(err)); } finally { setLoading(false); }
  }
  return (
    <Card>
      <CardHeader><CardTitle>Agent Credentials</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-3 rounded-md border p-4">
          <p className="text-sm font-semibold">Uji Handshake SOP PCHP — tanpa Console</p>
          <p className="text-sm text-muted-foreground">
            Uji satu kali dari sesi admin ini. Target dikunci ke OpenClaw PCHP dan percakapan GPT02 DEV;
            hasil antrean saja bukan bukti balasan ChatGPT.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => void startPchpSopTest()} disabled={pchpTestBusy || !!pchpTest}>
              {pchpTestBusy && !pchpTest ? "Mengirim uji…" : "Jalankan Uji SOP PCHP"}
            </Button>
            {pchpTest && <Button type="button" variant="outline" onClick={() => void checkPchpSopTest()} disabled={pchpTestBusy}>
              {pchpTestBusy ? "Memeriksa…" : "Periksa balasan SOP"}
            </Button>}
          </div>
          {pchpTest && <div role="status" className="space-y-1 text-sm">
            <p>Worker: <strong>{pchpTest.clientId}</strong></p>
            <p>Command ID: <span className="break-all">{pchpTest.commandId}</span></p>
            <p>Status pekerjaan: {pchpTest.status}</p>
            <p>Callback tersimpan: {pchpTest.callbackReceived ? "Ya" : "Belum diverifikasi"}</p>
            <p>Balasan ChatGPT terverifikasi: <strong>{pchpTest.assistantReplyVerified ? "PASS" : "BELUM PASS"}</strong></p>
          </div>}
          {pchpTestError && <p role="alert" className="text-sm text-destructive">{pchpTestError}</p>}
        </div>
        <p className="text-sm text-muted-foreground">Issue a scoped credential for PCHP DEV, PC Worker DEV, Travelintrips DEV, PC Worker 3, the isolated VPS DEV consumer, or the DELL ChatGPT wake worker. Secrets are displayed only once; store in approved secret management.</p>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3 [&>button]:h-auto [&>button]:min-h-12 [&>button]:w-full [&>button]:whitespace-normal [&>button]:px-4 [&>button]:py-3 [&>button]:text-center [&>button]:text-sm">
          <Button className="col-span-full" onClick={() => void issue("openclaw-pchp-dev")} disabled={loading || refreshing || items.some(item => item.name === "openclaw-pchp-dev" && item.isActive)}>Issue PCHP Wake DEV (encrypted)</Button>
          <Button onClick={() => void issue("openclaw-pc-worker-dev")} disabled={loading || refreshing || items.some(item => item.name === "openclaw-pc-worker-dev" && item.isActive)}>Issue PC DEV credential</Button>
          <Button onClick={() => void issue("openclaw-travelintrips-dev")} disabled={loading || refreshing || items.some(item => item.name === "openclaw-travelintrips-dev" && item.isActive)}>Issue Travelintrips DEV credential</Button>
          <Button onClick={() => void issue("openclaw-pc-worker-3")} disabled={loading || refreshing || items.some(item => item.name === "openclaw-pc-worker-3" && item.isActive)}>Issue Worker 3 credential</Button>
          <Button onClick={() => void issue("openclaw-vps-dev-consumer")} disabled={loading || refreshing || items.some(item => item.name === "openclaw-vps-dev-consumer" && item.isActive)}>Issue VPS DEV credential</Button>
          <Button onClick={() => void issue("openclaw-dell-chatgpt-wake-dev")} disabled={loading || refreshing || items.some(item => item.name === "openclaw-dell-chatgpt-wake-dev" && item.isActive)}>Issue DELL Wake DEV credential</Button>
          <Button variant="outline" onClick={() => void refresh()} disabled={refreshing}>{refreshing ? "Refreshing…" : "Refresh credentials"}</Button>
        </div>
        {encryptedPchpDownload && (
          <div role="status" className="space-y-2 rounded-md border p-3">
            <p className="text-sm">PCHP DEV credential issued and encrypted. The plaintext is intentionally not shown. If the automatic download did not appear, download the encrypted file directly here before leaving this page.</p>
            <Button type="button" variant="outline" onClick={() => downloadEncryptedPchpCredential(encryptedPchpDownload)}>Download PCHP encrypted credential (.b64)</Button>
          </div>
        )}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {lastRefresh && !error && <p role="status" className="text-sm text-muted-foreground">Credentials refreshed at {lastRefresh}. {items.length} credential(s) found.</p>}
        {issued && <div className="space-y-2"><Label htmlFor="issued-worker-token">One-time token (store securely; do not send via chat)</Label><Input id="issued-worker-token" value={issued} readOnly autoComplete="off" /><Button variant="outline" onClick={() => setIssued("")}>Hide token</Button></div>}
        {items.map(item => <div key={item.id} className="flex items-center justify-between gap-3 border-b py-2 text-sm">
          <span>{item.name} — {item.isActive ? "Active" : "Revoked"} ({item.scopes.join(", ")})</span>
          {item.isActive && <Button variant="outline" disabled={loading} onClick={() => void revoke(item.id)}>Revoke</Button>}
        </div>)}
      </CardContent>
    </Card>
  );
}

// ── Main Settings page ────────────────────────────────────────────────────────

export default function Settings() {
  const { data: settings, isLoading } = useListSettings();
  const [visibleSecrets, setVisibleSecrets] = useState<Record<string, boolean>>({});

  const toggleSecret = (key: string) => {
    setVisibleSecrets(prev => ({ ...prev, [key]: !prev[key] }));
  };

  type Setting = NonNullable<typeof settings>[number];
  // Exclude provider_alert.* from the generic table — they have their own panel
  const filteredSettings = settings?.filter((s: Setting) => !s.key.startsWith("provider_alert."));

  const groupedSettings = filteredSettings?.reduce((acc: Record<string, Setting[]>, setting: Setting) => {
    const cat = setting.category || 'general';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(setting);
    return acc;
  }, {} as Record<string, Setting[]>);

  return (
    <div className="p-8 max-w-[1600px] mx-auto space-y-8 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Platform Settings</h1>
          <p className="text-muted-foreground mt-1">Global configuration and environment variables.</p>
        </div>
      </div>

      {/* Provider Health Alert config */}
      <AgentCredentialsPanel />
      <DevPingTestPanel />
      <HandshakeSopSettings />
      <ProviderAlertSettings />

      <div className="space-y-8">
        {isLoading ? (
           <div className="py-12 text-center text-muted-foreground font-mono text-sm border border-border/50 rounded-lg bg-card/50 backdrop-blur">Loading configuration...</div>
        ) : filteredSettings?.length === 0 ? (
           <div className="py-12 text-center text-muted-foreground font-mono text-sm border border-border/50 rounded-lg bg-card/50 backdrop-blur">No settings configured.</div>
        ) : (
          Object.entries(groupedSettings || {}).map(([category, items]: [string, Setting[]]) => (
            <Card key={category} className="border-border/50 bg-card/50 backdrop-blur">
              <CardHeader className="pb-4 border-b border-border/50">
                <CardTitle className="text-sm font-medium font-mono uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                  <Settings2 className="size-4" /> {category} Config
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border/50 hover:bg-transparent">
                      <TableHead className="w-[30%] font-mono text-xs uppercase text-muted-foreground pl-6">Key</TableHead>
                      <TableHead className="w-[50%] font-mono text-xs uppercase text-muted-foreground">Value</TableHead>
                      <TableHead className="w-[10%] font-mono text-xs uppercase text-muted-foreground text-center">Type</TableHead>
                      <TableHead className="w-[10%] font-mono text-xs uppercase text-muted-foreground text-right pr-6"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((setting) => (
                      <TableRow key={setting.id} className="border-border/50 group hover:bg-secondary/30">
                        <TableCell className="pl-6">
                          <div className="flex flex-col gap-1">
                            <span className="font-mono text-xs font-bold text-foreground">{setting.key}</span>
                            {setting.description && <span className="text-[10px] text-muted-foreground">{setting.description}</span>}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2 max-w-[400px]">
                            {setting.isSecret && !visibleSecrets[setting.key] ? (
                              <div className="font-mono text-xs text-muted-foreground tracking-widest bg-background/50 px-2 py-1 rounded border border-border/50 flex-1">
                                ••••••••••••••••
                              </div>
                            ) : (
                              <div className="font-mono text-xs text-foreground bg-background/50 px-2 py-1 rounded border border-border/50 flex-1 truncate">
                                {setting.value}
                              </div>
                            )}
                            {setting.isSecret && (
                              <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground" onClick={() => toggleSecret(setting.key)}>
                                {visibleSecrets[setting.key] ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
                              </Button>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="outline" className="font-mono text-[10px] uppercase border-border/50 text-muted-foreground bg-background/50">
                            {setting.valueType}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right pr-6">
                          <Button variant="ghost" size="icon" className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Edit2 className="size-3 text-muted-foreground hover:text-foreground" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
