import { useState } from "react";
import { useParams, Link } from "wouter";
import {
  useGetService,
  useRequestService,
} from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  Building2,
  Clock,
  ListChecks,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Users,
  Workflow,
} from "lucide-react";

export default function ServiceDetail() {
  const { id } = useParams<{ id: string }>();
  const serviceId = parseInt(id ?? "", 10);
  const { toast } = useToast();

  const { data: service, isLoading } = useGetService(serviceId, {
    query: { enabled: !Number.isNaN(serviceId), queryKey: ["catalog-service", serviceId] },
  });

  const [requestOpen, setRequestOpen] = useState(false);
  const [selectedPackageId, setSelectedPackageId] = useState<number | null>(null);
  const [form, setForm] = useState({ customerName: "", customerEmail: "", companyName: "", notes: "" });

  const requestMutation = useRequestService({
    mutation: {
      onSuccess: () => {
        toast({ title: "Request submitted", description: "Our AI Orchestrator will route this to the right department shortly." });
        setRequestOpen(false);
        setForm({ customerName: "", customerEmail: "", companyName: "", notes: "" });
      },
      onError: (err: unknown) =>
        toast({ title: "Request failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" }),
    },
  });

  if (isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading service…</div>;
  }

  if (!service) {
    return (
      <div className="p-6">
        <Link href="/services">
          <Button variant="outline" size="sm" className="gap-1"><ArrowLeft className="size-3.5" /> Back to catalog</Button>
        </Link>
        <div className="text-sm text-muted-foreground mt-6">Service not found.</div>
      </div>
    );
  }

  const packages = service.packages ?? [];

  function openRequest(packageId: number | null) {
    setSelectedPackageId(packageId);
    setRequestOpen(true);
  }

  function submitRequest() {
    if (!service) return;
    if (!form.customerName || !form.customerEmail) {
      toast({ title: "Missing info", description: "Name and email are required.", variant: "destructive" });
      return;
    }
    requestMutation.mutate({
      id: service.id,
      data: {
        packageId: selectedPackageId ?? undefined,
        pricingModelSelected: service.pricingModel,
        customerName: form.customerName,
        customerEmail: form.customerEmail,
        companyName: form.companyName || undefined,
        notes: form.notes || undefined,
      },
    });
  }

  return (
    <div className="p-6 h-full overflow-y-auto">
      <Link href="/services">
        <Button variant="outline" size="sm" className="gap-1 mb-4"><ArrowLeft className="size-3.5" /> Back to catalog</Button>
      </Link>

      <div className="flex items-start justify-between gap-4 flex-wrap mb-2">
        <div>
          <h1 className="text-xl font-semibold" data-testid="text-service-name">{service.serviceName}</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">{service.fullDescription ?? service.shortDescription}</p>
        </div>
        <Button onClick={() => openRequest(null)} data-testid="button-request-service">Request this service</Button>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap mb-6">
        {service.humanReview ? (
          <Badge variant="outline" className="text-xs bg-blue-500/10 text-blue-400 border-blue-500/20 gap-1"><ShieldCheck className="size-3" /> Human Review</Badge>
        ) : (
          <Badge variant="outline" className="text-xs bg-purple-500/10 text-purple-400 border-purple-500/20 gap-1"><Sparkles className="size-3" /> AI Only</Badge>
        )}
        {service.subscriptionSupported && (
          <Badge variant="outline" className="text-xs bg-green-500/10 text-green-400 border-green-500/20 gap-1"><RefreshCw className="size-3" /> Subscription</Badge>
        )}
        {service.enterpriseSupported && <Badge variant="outline" className="text-xs">Enterprise</Badge>}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="border border-border rounded-lg bg-card p-4">
            <div className="flex items-center gap-2 text-sm font-medium mb-2"><Workflow className="size-4 text-primary" /> Workflow</div>
            <p className="text-sm text-muted-foreground">{service.workflowSummary ?? "—"}</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="border border-border rounded-lg bg-card p-4">
              <div className="flex items-center gap-2 text-sm font-medium mb-2"><Building2 className="size-4 text-primary" /> Department</div>
              <p className="text-sm text-muted-foreground">{service.department ?? "—"}</p>
            </div>
            <div className="border border-border rounded-lg bg-card p-4">
              <div className="flex items-center gap-2 text-sm font-medium mb-2"><Clock className="size-4 text-primary" /> Estimated time</div>
              <p className="text-sm text-muted-foreground">{service.estimatedDelivery ?? "—"}</p>
            </div>
          </div>

          <div className="border border-border rounded-lg bg-card p-4">
            <div className="flex items-center gap-2 text-sm font-medium mb-2"><Users className="size-4 text-primary" /> AI employees involved</div>
            <div className="flex flex-wrap gap-1.5">
              {(service.aiEmployeesInvolved ?? []).map((e) => (
                <Badge key={e} variant="outline" className="text-xs">{e}</Badge>
              ))}
              {(!service.aiEmployeesInvolved || service.aiEmployeesInvolved.length === 0) && (
                <span className="text-sm text-muted-foreground">—</span>
              )}
            </div>
          </div>

          <div className="border border-border rounded-lg bg-card p-4">
            <div className="flex items-center gap-2 text-sm font-medium mb-2"><ListChecks className="size-4 text-primary" /> Deliverables</div>
            <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-0.5">
              {(service.deliverables ?? []).map((d) => <li key={d}>{d}</li>)}
              {(!service.deliverables || service.deliverables.length === 0) && <li>—</li>}
            </ul>
          </div>

          <div className="border border-border rounded-lg bg-card p-4">
            <div className="text-sm font-medium mb-2">Revision policy</div>
            <p className="text-sm text-muted-foreground">{service.revisionPolicy ?? "—"}</p>
          </div>
        </div>

        <div className="space-y-3">
          <div className="text-sm font-medium">Pricing options</div>
          {packages.length === 0 && <div className="text-sm text-muted-foreground">No pricing packages published yet.</div>}
          {packages.map((p) => (
            <div key={p.id} className="border border-border rounded-lg bg-card p-4 flex flex-col gap-2" data-testid={`card-package-${p.packageType}`}>
              <div className="flex items-center justify-between">
                <span className="font-medium">{p.packageName}</span>
                <Badge variant="outline" className="text-xs capitalize">{p.packageType}</Badge>
              </div>
              <div className="text-lg font-semibold">
                {p.oneTimePrice ? `$${Number(p.oneTimePrice).toLocaleString()}` : p.monthlyPrice ? `$${Number(p.monthlyPrice).toLocaleString()}/mo` : "Custom"}
              </div>
              {p.yearlyPrice && <div className="text-xs text-muted-foreground">or ${Number(p.yearlyPrice).toLocaleString()}/yr</div>}
              <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-0.5">
                {(p.featuresJson ?? []).map((f) => <li key={f}>{f}</li>)}
              </ul>
              <Button size="sm" variant="outline" className="mt-1" onClick={() => openRequest(p.id)} data-testid={`button-select-package-${p.packageType}`}>
                Select
              </Button>
            </div>
          ))}
        </div>
      </div>

      <Dialog open={requestOpen} onOpenChange={setRequestOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request: {service.serviceName}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Your name" value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })} data-testid="input-customer-name" />
            <Input placeholder="Email" type="email" value={form.customerEmail} onChange={(e) => setForm({ ...form, customerEmail: e.target.value })} data-testid="input-customer-email" />
            <Input placeholder="Company (optional)" value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} data-testid="input-company-name" />
            <Textarea placeholder="Notes for the AI Orchestrator (optional)" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} data-testid="input-notes" />
            <Button className="w-full" onClick={submitRequest} disabled={requestMutation.isPending} data-testid="button-submit-request">
              {requestMutation.isPending ? "Submitting…" : "Submit request"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
