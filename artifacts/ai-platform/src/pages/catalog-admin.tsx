import { useState } from "react";
import {
  useListServiceCategories,
  useCreateServiceCategory,
  useUpdateServiceCategory,
  useDeleteServiceCategory,
  useListServices,
  useCreateService,
  useUpdateService,
  useDeleteService,
  useListServiceRequests,
  useUpdateServiceRequestStatus,
  useGetCatalogAnalytics,
  useGetService,
  useCreateServicePackage,
  useUpdateServicePackage,
  useDeleteServicePackage,
  getListServiceCategoriesQueryKey,
  getListServicesQueryKey,
  getListServiceRequestsQueryKey,
  getGetServiceQueryKey,
  type AiServiceCategory,
  type AiService,
  type AiServicePackage,
  type ServiceRequestStatus,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { LayoutGrid, Plus, Pencil, Trash2, BarChart2, ClipboardList, Boxes, Package, Search, X } from "lucide-react";

const REQUEST_STATUSES: ServiceRequestStatus[] = [
  "draft", "brief_in_progress", "brief_completed", "pricing_calculated",
  "quotation_ready", "waiting_customer_approval", "waiting_commercial_gate",
  "approved", "rejected", "revision_requested", "expired",
  "in_progress", "orchestrating", "pending", "waiting_review",
  "completed", "converted_to_project", "cancelled",
];

function StatBox({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="border border-border rounded-lg bg-card px-4 py-3">
      <div className="text-lg font-semibold leading-none">{value}</div>
      <div className="text-xs text-muted-foreground mt-1">{label}</div>
    </div>
  );
}

function CategoriesTab() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: categories = [], isLoading } = useListServiceCategories();
  const [editing, setEditing] = useState<AiServiceCategory | null>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({ code: "", name: "", description: "", icon: "", displayOrder: 0 });

  const filtered = categories.filter((c) => {
    const q = search.toLowerCase();
    return !q || c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q);
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListServiceCategoriesQueryKey() });

  const createMutation = useCreateServiceCategory({ mutation: { onSuccess: () => { invalidate(); setOpen(false); } } });
  const updateMutation = useUpdateServiceCategory({ mutation: { onSuccess: () => { invalidate(); setOpen(false); } } });
  const deleteMutation = useDeleteServiceCategory({
    mutation: {
      onSuccess: () => invalidate(),
      onError: (err: unknown) => toast({ title: "Delete failed", description: err instanceof Error ? err.message : "Category may have services attached.", variant: "destructive" }),
    },
  });

  function openCreate() {
    setEditing(null);
    setForm({ code: "", name: "", description: "", icon: "", displayOrder: categories.length });
    setOpen(true);
  }
  function openEdit(c: AiServiceCategory) {
    setEditing(c);
    setForm({ code: c.code, name: c.name, description: c.description ?? "", icon: c.icon ?? "", displayOrder: c.displayOrder });
    setOpen(true);
  }
  function save() {
    if (editing) {
      updateMutation.mutate({ id: editing.id, data: { code: editing.code, name: form.name, description: form.description, icon: form.icon, displayOrder: form.displayOrder } });
    } else {
      createMutation.mutate({ data: { code: form.code || form.name.toLowerCase().replace(/\s+/g, "-"), name: form.name, description: form.description, icon: form.icon, displayOrder: form.displayOrder } });
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
          <Input
            className="pl-8 h-8 text-sm"
            placeholder="Cari nama atau kode…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="search-categories"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="size-3.5" />
            </button>
          )}
        </div>
        {search && <span className="text-xs text-muted-foreground">{filtered.length} hasil</span>}
        <div className="ml-auto">
          <Button size="sm" className="gap-1" onClick={openCreate} data-testid="button-add-category"><Plus className="size-3.5" /> Add category</Button>
        </div>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Code</TableHead>
            <TableHead>Order</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>}
          {!isLoading && filtered.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Tidak ada hasil.</TableCell></TableRow>}
          {filtered.map((c) => (
            <TableRow key={c.id} data-testid={`row-category-${c.code}`}>
              <TableCell className="font-medium">{c.name}</TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">{c.code}</TableCell>
              <TableCell>{c.displayOrder}</TableCell>
              <TableCell className="text-right space-x-1">
                <Button size="icon" variant="ghost" className="size-7" onClick={() => openEdit(c)} data-testid={`button-edit-category-${c.code}`}><Pencil className="size-3.5" /></Button>
                <Button size="icon" variant="ghost" className="size-7 text-destructive" onClick={() => deleteMutation.mutate({ id: c.id })} data-testid={`button-delete-category-${c.code}`}><Trash2 className="size-3.5" /></Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit category" : "Add category"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {!editing && <Input placeholder="Code (e.g. creative)" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} data-testid="input-category-code" />}
            <Input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="input-category-name" />
            <Input placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} data-testid="input-category-description" />
            <Input placeholder="Icon (lucide name)" value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value })} data-testid="input-category-icon" />
            <Input type="number" placeholder="Display order" value={form.displayOrder} onChange={(e) => setForm({ ...form, displayOrder: Number(e.target.value) })} data-testid="input-category-order" />
            <Button className="w-full" onClick={save} disabled={createMutation.isPending || updateMutation.isPending} data-testid="button-save-category">Save</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ServicesTab() {
  const queryClient = useQueryClient();
  const { data: categories = [] } = useListServiceCategories();
  const { data: services = [], isLoading } = useListServices();
  const [editing, setEditing] = useState<AiService | null>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [form, setForm] = useState({
    categoryId: 0, serviceCode: "", serviceName: "", shortDescription: "",
    pricingModel: "one_time", startingPrice: "", estimatedDelivery: "", status: "active",
    serviceFlow: "custom_project" as "fixed_price" | "custom_project" | "enterprise",
  });

  const filtered = services.filter((s) => {
    const q = search.toLowerCase();
    const matchSearch = !q || s.serviceName.toLowerCase().includes(q) || s.serviceCode.toLowerCase().includes(q);
    const matchCat = filterCategory === "all" || s.categoryId === Number(filterCategory);
    return matchSearch && matchCat;
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListServicesQueryKey() });
  const createMutation = useCreateService({ mutation: { onSuccess: () => { invalidate(); setOpen(false); } } });
  const updateMutation = useUpdateService({ mutation: { onSuccess: () => { invalidate(); setOpen(false); } } });
  const deleteMutation = useDeleteService({ mutation: { onSuccess: () => invalidate() } });

  function openCreate() {
    setEditing(null);
    setForm({ categoryId: categories[0]?.id ?? 0, serviceCode: "", serviceName: "", shortDescription: "", pricingModel: "one_time", startingPrice: "", estimatedDelivery: "", status: "active", serviceFlow: "custom_project" });
    setOpen(true);
  }
  function openEdit(s: AiService) {
    setEditing(s);
    setForm({
      categoryId: s.categoryId, serviceCode: s.serviceCode, serviceName: s.serviceName,
      shortDescription: s.shortDescription ?? "", pricingModel: s.pricingModel, startingPrice: s.startingPrice ?? "",
      estimatedDelivery: s.estimatedDelivery ?? "", status: s.status,
      serviceFlow: (s.serviceFlow ?? "custom_project") as "fixed_price" | "custom_project" | "enterprise",
    });
    setOpen(true);
  }
  function save() {
    const data = {
      categoryId: form.categoryId, serviceCode: form.serviceCode, serviceName: form.serviceName,
      shortDescription: form.shortDescription, pricingModel: form.pricingModel, startingPrice: form.startingPrice || undefined,
      estimatedDelivery: form.estimatedDelivery, status: form.status, serviceFlow: form.serviceFlow,
    };
    if (editing) updateMutation.mutate({ id: editing.id, data });
    else createMutation.mutate({ data });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
          <Input
            className="pl-8 h-8 text-sm"
            placeholder="Cari nama layanan…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="search-services"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="size-3.5" />
            </button>
          )}
        </div>
        <Select value={filterCategory} onValueChange={setFilterCategory}>
          <SelectTrigger className="h-8 text-sm w-44" data-testid="filter-services-category">
            <SelectValue placeholder="Semua kategori" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua kategori</SelectItem>
            {categories.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        {(search || filterCategory !== "all") && (
          <span className="text-xs text-muted-foreground">{filtered.length} hasil</span>
        )}
        <div className="ml-auto">
          <Button size="sm" className="gap-1" onClick={openCreate} data-testid="button-add-service"><Plus className="size-3.5" /> Add service</Button>
        </div>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Category</TableHead>
            <TableHead>Pricing</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>}
          {!isLoading && filtered.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Tidak ada hasil.</TableCell></TableRow>}
          {filtered.map((s) => (
            <TableRow key={s.id} data-testid={`row-service-${s.serviceCode}`}>
              <TableCell className="font-medium">{s.serviceName}</TableCell>
              <TableCell className="text-xs text-muted-foreground">{categories.find((c) => c.id === s.categoryId)?.name ?? "—"}</TableCell>
              <TableCell className="text-xs">{s.startingPrice ? `${Number(s.startingPrice).toLocaleString()}` : "—"} · {s.pricingModel}</TableCell>
              <TableCell>
                <Badge variant={s.serviceFlow === "fixed_price" ? "default" : "outline"} className="text-xs capitalize">
                  {s.serviceFlow === "fixed_price" ? "Standard (checkout)" : s.serviceFlow === "enterprise" ? "Enterprise" : "Custom project"}
                </Badge>
              </TableCell>
              <TableCell><Badge variant="outline" className="text-xs capitalize">{s.status}</Badge></TableCell>
              <TableCell className="text-right space-x-1">
                <Button size="icon" variant="ghost" className="size-7" onClick={() => openEdit(s)} data-testid={`button-edit-service-${s.serviceCode}`}><Pencil className="size-3.5" /></Button>
                <Button size="icon" variant="ghost" className="size-7 text-destructive" onClick={() => deleteMutation.mutate({ id: s.id })} data-testid={`button-delete-service-${s.serviceCode}`}><Trash2 className="size-3.5" /></Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit service" : "Add service"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Select value={String(form.categoryId)} onValueChange={(v) => setForm({ ...form, categoryId: Number(v) })}>
              <SelectTrigger data-testid="select-service-category"><SelectValue placeholder="Category" /></SelectTrigger>
              <SelectContent>
                {categories.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {!editing && <Input placeholder="Service code" value={form.serviceCode} onChange={(e) => setForm({ ...form, serviceCode: e.target.value })} data-testid="input-service-code" />}
            <Input placeholder="Service name" value={form.serviceName} onChange={(e) => setForm({ ...form, serviceName: e.target.value })} data-testid="input-service-name" />
            <Input placeholder="Short description" value={form.shortDescription} onChange={(e) => setForm({ ...form, shortDescription: e.target.value })} data-testid="input-service-description" />
            <Select value={form.pricingModel} onValueChange={(v) => setForm({ ...form, pricingModel: v })}>
              <SelectTrigger data-testid="select-service-pricing-model"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="one_time">One Time</SelectItem>
                <SelectItem value="monthly_subscription">Monthly Subscription</SelectItem>
                <SelectItem value="yearly_subscription">Yearly Subscription</SelectItem>
                <SelectItem value="enterprise_custom">Enterprise Custom</SelectItem>
              </SelectContent>
            </Select>
            <Input placeholder="Starting price (USD)" value={form.startingPrice} onChange={(e) => setForm({ ...form, startingPrice: e.target.value })} data-testid="input-service-price" />
            <Input placeholder="Estimated delivery (e.g. 3-5 days)" value={form.estimatedDelivery} onChange={(e) => setForm({ ...form, estimatedDelivery: e.target.value })} data-testid="input-service-delivery" />
            <div>
              <Select value={form.serviceFlow} onValueChange={(v) => setForm({ ...form, serviceFlow: v as typeof form.serviceFlow })}>
                <SelectTrigger data-testid="select-service-flow"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="fixed_price">Standard — fixed price, checkout only (no quotation)</SelectItem>
                  <SelectItem value="custom_project">Custom project — requirement form → quotation → approval</SelectItem>
                  <SelectItem value="enterprise">Enterprise — same as custom, higher-touch</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                "Standard" skips the quotation step entirely — customers pay directly from their package price and production starts once payment is verified.
              </p>
            </div>
            <Button className="w-full" onClick={save} disabled={createMutation.isPending || updateMutation.isPending} data-testid="button-save-service">Save</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PackagesTab() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: services = [] } = useListServices();
  const [selectedServiceId, setSelectedServiceId] = useState<number | null>(null);
  const [search, setSearch] = useState("");

  const { data: serviceDetail, isLoading, isFetching } = useGetService(selectedServiceId ?? 0, {
    query: { enabled: selectedServiceId != null, queryKey: getGetServiceQueryKey(selectedServiceId ?? 0) },
  });
  const packages: AiServicePackage[] = serviceDetail?.packages ?? [];
  const filtered = search
    ? packages.filter((p) => {
        const q = search.toLowerCase();
        return p.packageName.toLowerCase().includes(q) || (p.packageType ?? "").toLowerCase().includes(q);
      })
    : packages;

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AiServicePackage | null>(null);
  const [form, setForm] = useState({
    packageName: "", packageType: "basic",
    oneTimePrice: "", monthlyPrice: "", yearlyPrice: "",
    featuresJson: "", status: "active",
  });

  const invalidate = () => {
    if (selectedServiceId) queryClient.invalidateQueries({ queryKey: getGetServiceQueryKey(selectedServiceId) });
  };

  const createMutation = useCreateServicePackage({ mutation: { onSuccess: () => { invalidate(); setOpen(false); } } });
  const updateMutation = useUpdateServicePackage({ mutation: { onSuccess: () => { invalidate(); setOpen(false); } } });
  const deleteMutation = useDeleteServicePackage({
    mutation: {
      onSuccess: () => invalidate(),
      onError: () => toast({ title: "Delete failed", variant: "destructive" }),
    },
  });

  function parseFeatures(raw: string): string[] {
    return raw.split("\n").map((s) => s.trim()).filter(Boolean);
  }

  function openCreate() {
    setEditing(null);
    setForm({ packageName: "", packageType: "basic", oneTimePrice: "", monthlyPrice: "", yearlyPrice: "", featuresJson: "", status: "active" });
    setOpen(true);
  }

  function openEdit(p: AiServicePackage) {
    setEditing(p);
    setForm({
      packageName: p.packageName,
      packageType: p.packageType ?? "basic",
      oneTimePrice: p.oneTimePrice ?? "",
      monthlyPrice: p.monthlyPrice ?? "",
      yearlyPrice: p.yearlyPrice ?? "",
      featuresJson: (p.featuresJson ?? []).join("\n"),
      status: p.status ?? "active",
    });
    setOpen(true);
  }

  function save() {
    if (!selectedServiceId) return;
    const data = {
      packageName: form.packageName,
      packageType: form.packageType,
      oneTimePrice: form.oneTimePrice || undefined,
      monthlyPrice: form.monthlyPrice || undefined,
      yearlyPrice: form.yearlyPrice || undefined,
      featuresJson: parseFeatures(form.featuresJson),
      status: form.status,
    };
    if (editing) updateMutation.mutate({ id: editing.id, data });
    else createMutation.mutate({ id: selectedServiceId, data });
  }

  const formatPrice = (p?: string | null) => (p ? `Rp ${Number(p).toLocaleString("id-ID")}` : "—");

  return (
    <div className="space-y-4">
      {/* Top controls: service selector + search + add */}
      <div className="flex items-center gap-2 flex-wrap">
        <Select
          value={selectedServiceId != null ? String(selectedServiceId) : ""}
          onValueChange={(v) => { setSelectedServiceId(Number(v)); setSearch(""); }}
        >
          <SelectTrigger className="w-64 h-8 text-sm" data-testid="select-package-service">
            <SelectValue placeholder="Pilih layanan…" />
          </SelectTrigger>
          <SelectContent>
            {services.map((s) => (
              <SelectItem key={s.id} value={String(s.id)}>{s.serviceName}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {selectedServiceId != null && (
          <>
            <div className="relative flex-1 min-w-[160px] max-w-xs">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
              <Input
                className="pl-8 h-8 text-sm"
                placeholder="Cari nama paket…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                data-testid="search-packages"
              />
              {search && (
                <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X className="size-3.5" />
                </button>
              )}
            </div>
            {search && <span className="text-xs text-muted-foreground">{filtered.length} hasil</span>}
            <div className="ml-auto">
              <Button size="sm" className="gap-1" onClick={openCreate} data-testid="button-add-package">
                <Plus className="size-3.5" /> Tambah paket
              </Button>
            </div>
          </>
        )}
      </div>

      {selectedServiceId == null && (
        <div className="py-12 text-center text-sm text-muted-foreground">Pilih layanan di atas untuk melihat paketnya.</div>
      )}

      {selectedServiceId != null && (
        (isLoading || isFetching || !serviceDetail) ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nama Paket</TableHead>
                <TableHead>Tipe</TableHead>
                <TableHead>Harga Sekali Bayar</TableHead>
                <TableHead>Harga Bulanan</TableHead>
                <TableHead>Harga Tahunan</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">{search ? "Tidak ada hasil." : "Belum ada paket."}</TableCell></TableRow>
              )}
              {filtered.map((p) => (
                <TableRow key={p.id} data-testid={`row-package-${p.id}`}>
                  <TableCell className="font-medium">{p.packageName}</TableCell>
                  <TableCell className="text-xs text-muted-foreground capitalize">{p.packageType}</TableCell>
                  <TableCell className="text-sm">{formatPrice(p.oneTimePrice)}</TableCell>
                  <TableCell className="text-sm">{formatPrice(p.monthlyPrice)}</TableCell>
                  <TableCell className="text-sm">{formatPrice(p.yearlyPrice)}</TableCell>
                  <TableCell><Badge variant="outline" className="text-xs capitalize">{p.status}</Badge></TableCell>
                  <TableCell className="text-right space-x-1">
                    <Button size="icon" variant="ghost" className="size-7" onClick={() => openEdit(p)} data-testid={`button-edit-package-${p.id}`}><Pencil className="size-3.5" /></Button>
                    <Button size="icon" variant="ghost" className="size-7 text-destructive" onClick={() => deleteMutation.mutate({ id: p.id })} data-testid={`button-delete-package-${p.id}`}><Trash2 className="size-3.5" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Paket" : "Tambah Paket Baru"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Nama paket (e.g. Basic, Professional)" value={form.packageName} onChange={(e) => setForm({ ...form, packageName: e.target.value })} data-testid="input-package-name" />
            <Select value={form.packageType} onValueChange={(v) => setForm({ ...form, packageType: v })}>
              <SelectTrigger data-testid="select-package-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="basic">Basic</SelectItem>
                <SelectItem value="standard">Standard</SelectItem>
                <SelectItem value="professional">Professional</SelectItem>
                <SelectItem value="premium">Premium</SelectItem>
                <SelectItem value="enterprise">Enterprise</SelectItem>
                <SelectItem value="custom">Custom</SelectItem>
              </SelectContent>
            </Select>
            <div className="grid grid-cols-1 gap-2">
              <Input placeholder="Harga sekali bayar (e.g. 5000000)" value={form.oneTimePrice} onChange={(e) => setForm({ ...form, oneTimePrice: e.target.value })} data-testid="input-package-one-time-price" />
              <Input placeholder="Harga bulanan (e.g. 1500000)" value={form.monthlyPrice} onChange={(e) => setForm({ ...form, monthlyPrice: e.target.value })} data-testid="input-package-monthly-price" />
              <Input placeholder="Harga tahunan (e.g. 15000000)" value={form.yearlyPrice} onChange={(e) => setForm({ ...form, yearlyPrice: e.target.value })} data-testid="input-package-yearly-price" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Fitur (satu per baris)</label>
              <textarea
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[80px] resize-y focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder={"Logo design\n3 revisi\nFile PNG & PDF"}
                value={form.featuresJson}
                onChange={(e) => setForm({ ...form, featuresJson: e.target.value })}
                data-testid="input-package-features"
              />
            </div>
            <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
              <SelectTrigger data-testid="select-package-status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
            <Button className="w-full" onClick={save} disabled={createMutation.isPending || updateMutation.isPending} data-testid="button-save-package">
              Simpan
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RequestsTab() {
  const queryClient = useQueryClient();
  const { data: requests = [], isLoading } = useListServiceRequests();
  const { data: services = [] } = useListServices();
  const [search, setSearch] = useState("");
  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListServiceRequestsQueryKey() });
  const statusMutation = useUpdateServiceRequestStatus({ mutation: { onSuccess: () => invalidate() } });

  const filtered = requests.filter((r) => {
    const q = search.toLowerCase();
    const serviceName = services.find((s) => s.id === r.serviceId)?.serviceName ?? "";
    return !q
      || (r.customerName ?? "").toLowerCase().includes(q)
      || (r.customerEmail ?? "").toLowerCase().includes(q)
      || serviceName.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
          <Input
            className="pl-8 h-8 text-sm"
            placeholder="Cari customer atau layanan…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="search-requests"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="size-3.5" />
            </button>
          )}
        </div>
        {search && <span className="text-xs text-muted-foreground">{filtered.length} hasil</span>}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Customer</TableHead>
            <TableHead>Service</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Submitted</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>}
          {!isLoading && filtered.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">{search ? "Tidak ada hasil." : "No requests yet."}</TableCell></TableRow>}
          {filtered.map((r) => (
            <TableRow key={r.id} data-testid={`row-request-${r.requestId}`}>
              <TableCell>
                <div className="font-medium">{r.customerName}</div>
                <div className="text-xs text-muted-foreground">{r.customerEmail}</div>
              </TableCell>
              <TableCell className="text-sm">{services.find((s) => s.id === r.serviceId)?.serviceName ?? `#${r.serviceId}`}</TableCell>
              <TableCell>
                <Select value={r.status} onValueChange={(v) => statusMutation.mutate({ id: r.id, data: { status: v as ServiceRequestStatus } })}>
                  <SelectTrigger className="h-7 w-36 text-xs" data-testid={`select-request-status-${r.requestId}`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {REQUEST_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleString()}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function AnalyticsTab() {
  const { data: analytics, isLoading } = useGetCatalogAnalytics();
  if (isLoading) return <div className="text-sm text-muted-foreground py-8 text-center">Loading analytics…</div>;
  if (!analytics) return null;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatBox label="Total requests" value={analytics.totalRequests ?? 0} />
        <StatBox label="Completed" value={analytics.completedRequests ?? 0} />
        <StatBox label="Conversion rate" value={`${analytics.conversionRate}%`} />
        <StatBox label="Avg delivery (days)" value={analytics.averageDeliveryTimeDays ?? "—"} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <div className="text-sm font-medium mb-2">Most requested services</div>
          <Table>
            <TableHeader><TableRow><TableHead>Service</TableHead><TableHead className="text-right">Requests</TableHead></TableRow></TableHeader>
            <TableBody>
              {analytics.mostRequestedServices.length === 0 && <TableRow><TableCell colSpan={2} className="text-center text-muted-foreground">No requests yet.</TableCell></TableRow>}
              {analytics.mostRequestedServices.map((s) => (
                <TableRow key={s.serviceId}><TableCell>{s.serviceName}</TableCell><TableCell className="text-right">{s.requestCount}</TableCell></TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <div>
          <div className="text-sm font-medium mb-2">Revenue per category</div>
          <Table>
            <TableHeader><TableRow><TableHead>Category</TableHead><TableHead className="text-right">Est. revenue</TableHead></TableRow></TableHeader>
            <TableBody>
              {analytics.revenuePerCategory.length === 0 && <TableRow><TableCell colSpan={2} className="text-center text-muted-foreground">No revenue yet.</TableCell></TableRow>}
              {analytics.revenuePerCategory.map((c) => (
                <TableRow key={c.categoryId}><TableCell>{c.categoryName}</TableCell><TableCell className="text-right">${c.estimatedRevenue.toLocaleString()}</TableCell></TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {analytics.mostPopularPackage && (
        <div className="border border-border rounded-lg bg-card p-4">
          <div className="text-sm font-medium mb-1">Most popular package</div>
          <div className="text-sm text-muted-foreground">{analytics.mostPopularPackage.packageName} — {analytics.mostPopularPackage.requestCount} requests</div>
        </div>
      )}
    </div>
  );
}

export default function CatalogAdmin() {
  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      <div className="flex items-center gap-3">
        <div className="size-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
          <LayoutGrid className="size-5" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">Service Catalog Admin</h1>
          <p className="text-sm text-muted-foreground">Manage categories, services, requests, and view catalog analytics.</p>
        </div>
      </div>

      <Tabs defaultValue="categories">
        <TabsList>
          <TabsTrigger value="categories" className="gap-1"><Boxes className="size-3.5" /> Categories</TabsTrigger>
          <TabsTrigger value="services" className="gap-1"><LayoutGrid className="size-3.5" /> Services</TabsTrigger>
          <TabsTrigger value="packages" className="gap-1"><Package className="size-3.5" /> Packages & Harga</TabsTrigger>
          <TabsTrigger value="requests" className="gap-1"><ClipboardList className="size-3.5" /> Requests</TabsTrigger>
          <TabsTrigger value="analytics" className="gap-1"><BarChart2 className="size-3.5" /> Analytics</TabsTrigger>
        </TabsList>
        <TabsContent value="categories" className="mt-4"><CategoriesTab /></TabsContent>
        <TabsContent value="services" className="mt-4"><ServicesTab /></TabsContent>
        <TabsContent value="packages" className="mt-4"><PackagesTab /></TabsContent>
        <TabsContent value="requests" className="mt-4"><RequestsTab /></TabsContent>
        <TabsContent value="analytics" className="mt-4"><AnalyticsTab /></TabsContent>
      </Tabs>
    </div>
  );
}
