import { useState } from "react";
import { Link } from "wouter";
import { WorkspaceLayout } from "@/components/workspace-layout";
import { useWorkspaceProfile, useUpdateWorkspaceProfile } from "@/hooks/use-workspace";
import { useToast } from "@/hooks/use-toast";
import {
  User, Shield, Bell, Globe, Palette, Key, Loader2, Save,
  ChevronRight, Check, ArrowLeft,
} from "lucide-react";

const CATEGORIES = [
  { key: "account",       label: "Account",       icon: User },
  { key: "security",      label: "Security",       icon: Shield },
  { key: "notifications", label: "Notifications",  icon: Bell },
  { key: "language",      label: "Language",       icon: Globe },
  { key: "appearance",    label: "Appearance",     icon: Palette },
  { key: "api",           label: "API & Webhooks", icon: Key },
];

const LANGUAGES = [
  { code: "id", label: "Bahasa Indonesia" },
  { code: "en", label: "English (US)" },
];

const TIMEZONES = [
  "Asia/Jakarta (WIB, UTC+7)",
  "Asia/Makassar (WITA, UTC+8)",
  "Asia/Jayapura (WIT, UTC+9)",
  "UTC",
];

const CURRENCIES = [
  "IDR — Indonesian Rupiah",
  "USD — US Dollar",
  "SGD — Singapore Dollar",
];

function SectionHeading({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-6">
      <h2 className="text-lg font-semibold">{title}</h2>
      {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
    </div>
  );
}

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-6 py-4 border-b border-border/50 last:border-0">
      <label className="text-sm font-medium text-foreground sm:w-48 shrink-0 pt-0.5">{label}</label>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex w-10 h-6 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40 ${
        checked ? "bg-primary" : "bg-muted-foreground/30"
      }`}
    >
      <span
        className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-4" : "translate-x-0"
        }`}
      />
    </button>
  );
}

function SelectInput({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full sm:max-w-xs px-3 py-2 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
    >
      {options.map((o) => (
        <option key={o} value={o}>{o}</option>
      ))}
    </select>
  );
}

export default function WorkspaceSettingsPage({ params }: { params: { token: string } }) {
  const { token } = params;
  const [activeCategory, setActiveCategory] = useState("account");
  const { data: profile, isLoading } = useWorkspaceProfile(token);
  const update = useUpdateWorkspaceProfile(token);
  const { toast } = useToast();

  const [lang, setLang] = useState("id");
  const [timezone, setTimezone] = useState(TIMEZONES[0]);
  const [currency, setCurrency] = useState(CURRENCIES[0]);
  const [theme, setTheme] = useState<"system" | "light" | "dark">("system");
  const [notifEmail, setNotifEmail] = useState(true);
  const [notifWhatsapp, setNotifWhatsapp] = useState(false);
  const [notifBrowser, setNotifBrowser] = useState(true);
  const [notifDigest, setNotifDigest] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    try {
      await update.mutateAsync({ brandPreferences: profile?.brandPreferences ?? "" });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      toast({ title: "Settings saved" });
    } catch (e) {
      toast({ title: "Save failed", description: (e as Error).message, variant: "destructive" });
    }
  }

  const ActiveIcon = CATEGORIES.find((c) => c.key === activeCategory)?.icon ?? User;

  return (
    <WorkspaceLayout token={token}>
      <Link href={`/workspace/${token}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6 group">
        <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
        Kembali ke Dashboard
      </Link>
      <div className="mb-6">
        <h1 className="text-3xl font-serif font-medium mb-1">Settings</h1>
        <p className="text-muted-foreground">Manage your account preferences and configurations.</p>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Category nav */}
        <aside className="lg:w-56 shrink-0">
          <nav className="bg-card border border-card-border rounded-2xl overflow-hidden">
            {CATEGORIES.map((cat) => {
              const Icon = cat.icon;
              const isActive = activeCategory === cat.key;
              return (
                <button
                  key={cat.key}
                  onClick={() => setActiveCategory(cat.key)}
                  className={`w-full flex items-center justify-between gap-3 px-4 py-3.5 text-sm font-medium transition-colors border-b border-border/40 last:border-0 ${
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                  }`}
                  data-testid={`settings-nav-${cat.key}`}
                >
                  <span className="flex items-center gap-2.5">
                    <Icon className="w-4 h-4 shrink-0" />
                    {cat.label}
                  </span>
                  <ChevronRight className={`w-3.5 h-3.5 transition-transform ${isActive ? "rotate-90 opacity-100" : "opacity-30"}`} />
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Settings panel */}
        <div className="flex-1 bg-card border border-card-border rounded-2xl p-6 min-w-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-7 h-7 animate-spin text-primary" />
            </div>
          ) : (
            <>
              {/* Account */}
              {activeCategory === "account" && (
                <>
                  <SectionHeading title="Account Settings" description="Your identity and basic account details." />
                  <div className="divide-y divide-border/40">
                    <FormRow label="Full Name">
                      <p className="text-sm font-medium py-1">{profile?.clientName ?? "—"}</p>
                      <p className="text-xs text-muted-foreground">Contact support to change your name.</p>
                    </FormRow>
                    <FormRow label="Email Address">
                      <p className="text-sm font-medium py-1">{profile?.clientEmail ?? "—"}</p>
                      <p className="text-xs text-muted-foreground">Contact support to update your email.</p>
                    </FormRow>
                    <FormRow label="Company">
                      <input
                        defaultValue={profile?.companyName ?? ""}
                        className="w-full sm:max-w-xs px-3 py-2 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                        placeholder="Company name"
                        data-testid="input-settings-company"
                      />
                    </FormRow>
                    <FormRow label="PIC Name">
                      <input
                        defaultValue={profile?.picName ?? ""}
                        className="w-full sm:max-w-xs px-3 py-2 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                        placeholder="Person in charge"
                        data-testid="input-settings-pic"
                      />
                    </FormRow>
                    <FormRow label="PIC Phone">
                      <input
                        defaultValue={profile?.picPhone ?? ""}
                        className="w-full sm:max-w-xs px-3 py-2 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                        placeholder="+62 ..."
                        data-testid="input-settings-phone"
                      />
                    </FormRow>
                  </div>
                </>
              )}

              {/* Security */}
              {activeCategory === "security" && (
                <>
                  <SectionHeading title="Security" description="Manage access and session settings." />
                  <div className="divide-y divide-border/40">
                    <FormRow label="Access Token">
                      <div className="flex items-center gap-2">
                        <input
                          readOnly
                          value={`${token.slice(0, 8)}••••••••••••••••`}
                          className="w-full sm:max-w-xs px-3 py-2 rounded-xl border border-border bg-background text-sm font-mono"
                        />
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">This token grants access to your workspace. Keep it safe.</p>
                    </FormRow>
                    <FormRow label="Session Expiry">
                      <p className="text-sm py-1">90 days from last activity</p>
                    </FormRow>
                    <FormRow label="Active Sessions">
                      <p className="text-sm py-1 text-muted-foreground">Session management is handled by your account administrator.</p>
                    </FormRow>
                  </div>
                </>
              )}

              {/* Notifications */}
              {activeCategory === "notifications" && (
                <>
                  <SectionHeading title="Notification Preferences" description="Choose when and how you receive updates." />
                  <div className="divide-y divide-border/40">
                    <FormRow label="Email Notifications">
                      <div className="flex items-center gap-3">
                        <Toggle checked={notifEmail} onChange={setNotifEmail} />
                        <span className="text-sm text-muted-foreground">Project updates, payments, reviews</span>
                      </div>
                    </FormRow>
                    <FormRow label="WhatsApp Updates">
                      <div className="flex items-center gap-3">
                        <Toggle checked={notifWhatsapp} onChange={setNotifWhatsapp} />
                        <span className="text-sm text-muted-foreground">Real-time status alerts via WhatsApp</span>
                      </div>
                    </FormRow>
                    <FormRow label="Browser Push">
                      <div className="flex items-center gap-3">
                        <Toggle checked={notifBrowser} onChange={setNotifBrowser} />
                        <span className="text-sm text-muted-foreground">In-browser desktop notifications</span>
                      </div>
                    </FormRow>
                    <FormRow label="Weekly Digest">
                      <div className="flex items-center gap-3">
                        <Toggle checked={notifDigest} onChange={setNotifDigest} />
                        <span className="text-sm text-muted-foreground">Summary email every Monday</span>
                      </div>
                    </FormRow>
                  </div>
                </>
              )}

              {/* Language */}
              {activeCategory === "language" && (
                <>
                  <SectionHeading title="Language & Region" description="Display language, timezone, and currency." />
                  <div className="divide-y divide-border/40">
                    <FormRow label="Display Language">
                      <div className="flex gap-2 flex-wrap">
                        {LANGUAGES.map((l) => (
                          <button
                            key={l.code}
                            onClick={() => setLang(l.code)}
                            className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-medium transition-colors ${
                              lang === l.code
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border hover:border-primary/40"
                            }`}
                          >
                            {lang === l.code && <Check className="w-3.5 h-3.5" />}
                            {l.label}
                          </button>
                        ))}
                      </div>
                    </FormRow>
                    <FormRow label="Timezone">
                      <SelectInput value={timezone} onChange={setTimezone} options={TIMEZONES} />
                    </FormRow>
                    <FormRow label="Currency Display">
                      <SelectInput value={currency} onChange={setCurrency} options={CURRENCIES} />
                    </FormRow>
                  </div>
                </>
              )}

              {/* Appearance */}
              {activeCategory === "appearance" && (
                <>
                  <SectionHeading title="Appearance" description="Customize the look and feel of your workspace." />
                  <div className="divide-y divide-border/40">
                    <FormRow label="Theme">
                      <div className="flex gap-2 flex-wrap">
                        {(["system", "light", "dark"] as const).map((t) => (
                          <button
                            key={t}
                            onClick={() => setTheme(t)}
                            className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-medium capitalize transition-colors ${
                              theme === t
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border hover:border-primary/40"
                            }`}
                          >
                            {theme === t && <Check className="w-3.5 h-3.5" />}
                            {t}
                          </button>
                        ))}
                      </div>
                    </FormRow>
                    <FormRow label="Density">
                      <p className="text-sm text-muted-foreground py-1">Compact layout options coming soon.</p>
                    </FormRow>
                  </div>
                </>
              )}

              {/* API */}
              {activeCategory === "api" && (
                <>
                  <SectionHeading title="API & Webhooks" description="Integrate your workspace with external tools." />
                  <div className="divide-y divide-border/40">
                    <FormRow label="Workspace Token">
                      <div className="flex items-center gap-2">
                        <input
                          readOnly
                          value={token}
                          className="w-full sm:max-w-md px-3 py-2 rounded-xl border border-border bg-background text-xs font-mono"
                          data-testid="input-api-token"
                        />
                        <button
                          onClick={() => { navigator.clipboard.writeText(token); toast({ title: "Copied!" }); }}
                          className="shrink-0 px-3 py-2 rounded-xl border border-border text-xs hover:bg-muted transition-colors"
                        >
                          Copy
                        </button>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">Use as Bearer token for the public API.</p>
                    </FormRow>
                    <FormRow label="Webhook URL">
                      <input
                        defaultValue={profile?.paymentMethodNotes ?? ""}
                        placeholder="https://your-system.com/webhook"
                        className="w-full sm:max-w-md px-3 py-2 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                        data-testid="input-settings-webhook"
                      />
                      <p className="text-xs text-muted-foreground mt-1">We'll POST status events to this URL.</p>
                    </FormRow>
                    <FormRow label="API Base URL">
                      <code className="text-xs bg-muted px-2 py-1 rounded-lg">/api/public/customer/workspace/{token}</code>
                    </FormRow>
                  </div>
                </>
              )}

              {/* Save row */}
              <div className="flex items-center gap-3 mt-8 pt-6 border-t border-border/40">
                <button
                  onClick={handleSave}
                  disabled={update.isPending}
                  data-testid="button-settings-save"
                  className="inline-flex items-center gap-2 text-sm font-medium bg-foreground text-background px-5 py-2.5 rounded-full hover:bg-foreground/90 transition-colors disabled:opacity-50"
                >
                  {update.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : saved ? (
                    <Check className="w-4 h-4" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  {saved ? "Saved!" : "Save Settings"}
                </button>
                <button
                  onClick={() => toast({ title: "Settings reset to defaults" })}
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors px-4 py-2.5 rounded-full hover:bg-muted"
                >
                  Reset to defaults
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </WorkspaceLayout>
  );
}
