import { useEffect, useState } from "react";
import { Link } from "wouter";
import { WorkspaceLayout } from "@/components/workspace-layout";
import { useWorkspaceProfile, useUpdateWorkspaceProfile, type WorkspaceProfile } from "@/hooks/use-workspace";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Save, Building2, User, CreditCard, Palette, Check, ArrowLeft } from "lucide-react";

function FieldInput({
  label,
  value,
  onChange,
  multiline,
  placeholder,
  readOnly,
  testId,
}: {
  label: string;
  value: string;
  onChange?: (v: string) => void;
  multiline?: boolean;
  placeholder?: string;
  readOnly?: boolean;
  testId?: string;
}) {
  const cls =
    "w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60 disabled:cursor-not-allowed";

  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground block mb-1.5">{label}</label>
      {multiline ? (
        <textarea
          value={value}
          onChange={onChange ? (e) => onChange(e.target.value) : undefined}
          readOnly={readOnly}
          rows={3}
          placeholder={placeholder}
          className={cls}
          data-testid={testId}
        />
      ) : (
        <input
          value={value}
          onChange={onChange ? (e) => onChange(e.target.value) : undefined}
          readOnly={readOnly}
          placeholder={placeholder}
          className={cls}
          data-testid={testId}
        />
      )}
    </div>
  );
}

function Section({ title, icon: Icon, children }: { title: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="bg-card border border-card-border rounded-2xl p-6">
      <h2 className="text-base font-semibold flex items-center gap-2 mb-5">
        <Icon className="w-4 h-4 text-primary" />
        {title}
      </h2>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

export default function WorkspaceProfilePage({ params }: { params: { token: string } }) {
  const { token } = params;
  const { data, isLoading } = useWorkspaceProfile(token);
  const update = useUpdateWorkspaceProfile(token);
  const { toast } = useToast();
  const [form, setForm] = useState<Partial<WorkspaceProfile>>({});
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  function set<K extends keyof WorkspaceProfile>(key: K, value: string) {
    setForm((s) => ({ ...s, [key]: value }));
  }

  async function handleSave() {
    try {
      await update.mutateAsync(form);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      toast({ title: "Profile updated successfully" });
    } catch (e) {
      toast({ title: "Could not save", description: (e as Error).message, variant: "destructive" });
    }
  }

  if (isLoading) {
    return (
      <WorkspaceLayout token={token}>
        <div className="flex items-center justify-center py-24">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </WorkspaceLayout>
    );
  }

  return (
    <WorkspaceLayout token={token}>
      {/* Header */}
      <Link href={`/workspace/${token}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6 group">
        <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
        Kembali ke Dashboard
      </Link>
      <div className="mb-6">
        <h1 className="text-3xl font-serif font-medium mb-1">My Profile</h1>
        <p className="text-muted-foreground">Keep your company and billing details up to date.</p>
      </div>

      {/* Profile identity card */}
      <div className="bg-card border border-card-border rounded-2xl p-6 mb-6 flex items-center gap-5">
        <div className="w-16 h-16 rounded-2xl bg-primary/10 text-primary flex items-center justify-center text-2xl font-bold shrink-0">
          {(data?.clientName ?? "?").charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0">
          <h2 className="text-xl font-semibold truncate">{data?.clientName ?? "—"}</h2>
          <p className="text-sm text-muted-foreground truncate">{data?.clientEmail ?? "—"}</p>
          {data?.companyName && (
            <p className="text-sm text-muted-foreground/70 truncate mt-0.5">{data.companyName}</p>
          )}
        </div>
      </div>

      {/* Two-column form grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-6">
        {/* Personal info */}
        <Section title="Contact Information" icon={User}>
          <FieldInput
            label="Full Name"
            value={data?.clientName ?? ""}
            readOnly
            placeholder="Your full name"
            testId="input-profile-clientName"
          />
          <FieldInput
            label="Email Address"
            value={data?.clientEmail ?? ""}
            readOnly
            placeholder="email@company.com"
            testId="input-profile-clientEmail"
          />
          <FieldInput
            label="Person in Charge (PIC)"
            value={(form.picName as string) ?? ""}
            onChange={(v) => set("picName", v)}
            placeholder="Name of primary contact"
            testId="input-profile-picName"
          />
          <FieldInput
            label="PIC Phone"
            value={(form.picPhone as string) ?? ""}
            onChange={(v) => set("picPhone", v)}
            placeholder="+62 812-3456-7890"
            testId="input-profile-picPhone"
          />
        </Section>

        {/* Company info */}
        <Section title="Company Information" icon={Building2}>
          <FieldInput
            label="Company Name"
            value={(form.companyName as string) ?? ""}
            onChange={(v) => set("companyName", v)}
            placeholder="PT. Your Company"
            testId="input-profile-companyName"
          />
          <FieldInput
            label="Tax ID (NPWP)"
            value={(form.taxId as string) ?? ""}
            onChange={(v) => set("taxId", v)}
            placeholder="00.000.000.0-000.000"
            testId="input-profile-taxId"
          />
          <FieldInput
            label="Billing Email"
            value={(form.billingEmail as string) ?? ""}
            onChange={(v) => set("billingEmail", v)}
            placeholder="billing@company.com"
            testId="input-profile-billingEmail"
          />
          <FieldInput
            label="Address"
            value={(form.address as string) ?? ""}
            onChange={(v) => set("address", v)}
            multiline
            placeholder="Full company address"
            testId="input-profile-address"
          />
        </Section>

        {/* Payment notes */}
        <Section title="Payment Preferences" icon={CreditCard}>
          <FieldInput
            label="Preferred Payment Method"
            value={(form.paymentMethodNotes as string) ?? ""}
            onChange={(v) => set("paymentMethodNotes", v)}
            multiline
            placeholder="e.g. BCA Virtual Account, Transfer to BCA 1234567890 a/n PT Your Company"
            testId="input-profile-paymentMethodNotes"
          />
        </Section>

        {/* Brand preferences */}
        <Section title="Brand Preferences" icon={Palette}>
          <FieldInput
            label="Brand & Style Notes"
            value={(form.brandPreferences as string) ?? ""}
            onChange={(v) => set("brandPreferences", v)}
            multiline
            placeholder="Describe your brand voice, color preferences, style guidelines, or any special requirements for AI-generated content..."
            testId="input-profile-brandPreferences"
          />
        </Section>
      </div>

      {/* Save button */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={update.isPending}
          data-testid="button-save-profile"
          className="inline-flex items-center gap-2 text-sm font-medium bg-foreground text-background px-6 py-2.5 rounded-full hover:bg-foreground/90 transition-colors disabled:opacity-50"
        >
          {update.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : saved ? (
            <Check className="w-4 h-4" />
          ) : (
            <Save className="w-4 h-4" />
          )}
          {saved ? "Saved!" : "Save Changes"}
        </button>
        <p className="text-xs text-muted-foreground">
          Name and email can only be changed by contacting support.
        </p>
      </div>
    </WorkspaceLayout>
  );
}
