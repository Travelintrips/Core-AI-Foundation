import { useEffect, useState } from "react";
import { WorkspaceLayout } from "@/components/workspace-layout";
import { useWorkspaceProfile, useUpdateWorkspaceProfile, type WorkspaceProfile } from "@/hooks/use-workspace";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Save } from "lucide-react";

const FIELDS: { key: keyof WorkspaceProfile; label: string; multiline?: boolean }[] = [
  { key: "companyName", label: "Company Name" },
  { key: "address", label: "Address", multiline: true },
  { key: "picName", label: "Person in Charge (PIC)" },
  { key: "picPhone", label: "PIC Phone" },
  { key: "billingEmail", label: "Billing Email" },
  { key: "taxId", label: "Tax ID (NPWP)" },
  { key: "paymentMethodNotes", label: "Payment Method Notes", multiline: true },
  { key: "brandPreferences", label: "Brand Preferences", multiline: true },
];

export default function WorkspaceProfilePage({ params }: { params: { token: string } }) {
  const { token } = params;
  const { data, isLoading } = useWorkspaceProfile(token);
  const update = useUpdateWorkspaceProfile(token);
  const { toast } = useToast();
  const [form, setForm] = useState<Partial<WorkspaceProfile>>({});

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  async function handleSave() {
    try {
      await update.mutateAsync(form);
      toast({ title: "Profile updated" });
    } catch (e) {
      toast({ title: "Could not save", description: (e as Error).message, variant: "destructive" });
    }
  }

  if (isLoading) {
    return (
      <WorkspaceLayout token={token}>
        <div className="flex items-center justify-center py-24"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
      </WorkspaceLayout>
    );
  }

  return (
    <WorkspaceLayout token={token}>
      <div className="mb-6">
        <h1 className="text-3xl font-serif font-medium mb-1">Customer Profile</h1>
        <p className="text-muted-foreground">Keep your company and billing details up to date.</p>
      </div>

      <div className="bg-card border border-card-border rounded-2xl p-6 max-w-2xl">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-6">
          <div>
            <p className="text-xs text-muted-foreground mb-1">Name</p>
            <p className="font-medium">{data?.clientName}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Email</p>
            <p className="font-medium">{data?.clientEmail}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {FIELDS.map((f) => (
            <div key={f.key} className={f.multiline ? "sm:col-span-2" : ""}>
              <label className="text-xs text-muted-foreground mb-1 block">{f.label}</label>
              {f.multiline ? (
                <textarea
                  value={(form[f.key] as string) ?? ""}
                  onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
                  rows={2}
                  className="w-full px-3 py-2 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  data-testid={`input-profile-${f.key}`}
                />
              ) : (
                <input
                  value={(form[f.key] as string) ?? ""}
                  onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  data-testid={`input-profile-${f.key}`}
                />
              )}
            </div>
          ))}
        </div>

        <button
          onClick={handleSave}
          disabled={update.isPending}
          className="mt-6 inline-flex items-center gap-2 text-sm font-medium bg-foreground text-background px-5 py-2.5 rounded-full hover:bg-foreground/90 transition-colors disabled:opacity-50"
          data-testid="button-save-profile"
        >
          {update.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save changes
        </button>
      </div>
    </WorkspaceLayout>
  );
}
