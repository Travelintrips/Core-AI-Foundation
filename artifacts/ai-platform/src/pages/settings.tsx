import { useState } from "react";
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
