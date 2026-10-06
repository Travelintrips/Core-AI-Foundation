import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Send, ShieldCheck, UserPlus, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useInternalAuth, type InternalRole, type InternalUser } from "@/hooks/use-internal-auth";
import { useToast } from "@/hooks/use-toast";
import { useLang } from "@/lib/i18n";

type ManagedStatus = "active" | "suspended";

const ROLE_LABELS: Record<InternalRole, string> = {
  owner: "Owner",
  admin: "Admin",
  manager: "Manager",
  internal_staff: "Internal Staff",
};

function formatDate(value: string | null | undefined, locale: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

async function readJson(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export default function UserManagement() {
  const { user: currentUser } = useInternalAuth();
  const { toast } = useToast();
  const { lang } = useLang();
  const locale = lang === "id" ? "id-ID" : "en-US";
  const copy = lang === "id"
    ? {
        title: "User Management",
        subtitle: "Kelola akun internal, role, status akses, dan link login.",
        accessDenied: "Halaman ini hanya dapat diakses oleh owner atau admin.",
        addUser: "Tambah User",
        email: "Email",
        role: "Role",
        create: "Buat & Kirim Link Login",
        creating: "Membuat…",
        search: "Cari email…",
        refresh: "Perbarui",
        user: "User",
        status: "Status",
        lastLogin: "Login Terakhir",
        createdAt: "Dibuat",
        actions: "Aksi",
        active: "Aktif",
        suspended: "Nonaktif",
        sendLink: "Kirim Link Login",
        sending: "Mengirim…",
        noUsers: "Tidak ada user yang cocok.",
        loading: "Memuat user…",
        total: "Total User",
        activeUsers: "User Aktif",
        admins: "Owner / Admin",
        suspendedUsers: "Nonaktif",
        ownerLocked: "Owner dilindungi dan tidak dapat diubah dari halaman ini.",
        adminRule: "Admin hanya dapat membuat Manager/Internal Staff. Hanya Owner yang dapat membuat atau mengubah Admin.",
        created: "User berhasil dibuat",
        inviteSent: "Link login sudah dikirim ke email user.",
        inviteFailed: "User dibuat, tetapi email link login gagal dikirim.",
        updated: "User berhasil diperbarui",
        linkSent: "Link login berhasil dikirim",
        genericError: "Operasi gagal. Silakan coba lagi.",
      }
    : {
        title: "User Management",
        subtitle: "Manage internal accounts, roles, access status, and login links.",
        accessDenied: "This page is restricted to owner or admin accounts.",
        addUser: "Add User",
        email: "Email",
        role: "Role",
        create: "Create & Send Login Link",
        creating: "Creating…",
        search: "Search email…",
        refresh: "Refresh",
        user: "User",
        status: "Status",
        lastLogin: "Last Login",
        createdAt: "Created",
        actions: "Actions",
        active: "Active",
        suspended: "Suspended",
        sendLink: "Send Login Link",
        sending: "Sending…",
        noUsers: "No matching users.",
        loading: "Loading users…",
        total: "Total Users",
        activeUsers: "Active Users",
        admins: "Owner / Admin",
        suspendedUsers: "Suspended",
        ownerLocked: "Owner accounts are protected and cannot be changed here.",
        adminRule: "Admins can only create Manager/Internal Staff. Only Owner can create or modify Admin accounts.",
        created: "User created",
        inviteSent: "A login link was sent to the user's email.",
        inviteFailed: "User was created, but the login email could not be sent.",
        updated: "User updated",
        linkSent: "Login link sent",
        genericError: "Operation failed. Please try again.",
      };

  const canManage = currentUser?.role === "owner" || currentUser?.role === "admin";
  const [users, setUsers] = useState<InternalUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [email, setEmail] = useState("");
  const [newRole, setNewRole] = useState<InternalRole>("internal_staff");
  const [creating, setCreating] = useState(false);
  const [busyUserId, setBusyUserId] = useState<number | null>(null);
  const [sendingUserId, setSendingUserId] = useState<number | null>(null);

  const loadUsers = useCallback(async () => {
    if (!canManage) return;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/internal/auth/users", { credentials: "include" });
      const body = await readJson(res);
      if (!res.ok) throw new Error(body?.error ?? copy.genericError);
      setUsers(Array.isArray(body?.users) ? body.users : []);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : copy.genericError);
    } finally {
      setLoading(false);
    }
  }, [canManage, copy.genericError]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter((user) =>
      user.email.toLowerCase().includes(q) ||
      user.role.toLowerCase().includes(q) ||
      user.status.toLowerCase().includes(q),
    );
  }, [search, users]);

  const stats = useMemo(() => ({
    total: users.length,
    active: users.filter((user) => user.status === "active").length,
    admins: users.filter((user) => user.role === "owner" || user.role === "admin").length,
    suspended: users.filter((user) => user.status === "suspended").length,
  }), [users]);

  const manageableRoles: InternalRole[] = currentUser?.role === "owner"
    ? ["admin", "manager", "internal_staff"]
    : ["manager", "internal_staff"];

  const canEditTarget = (target: InternalUser): boolean => {
    if (!currentUser) return false;
    if (target.role === "owner") return false;
    if (target.role === "admin" && currentUser.role !== "owner") return false;
    return currentUser.role === "owner" || currentUser.role === "admin";
  };

  async function createUser(event: React.FormEvent) {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) return;

    setCreating(true);
    try {
      const res = await fetch("/api/internal/auth/users", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail, role: newRole }),
      });
      const body = await readJson(res);
      if (!res.ok) throw new Error(body?.error ?? copy.genericError);
      setEmail("");
      setNewRole("internal_staff");
      await loadUsers();
      toast({
        title: copy.created,
        description: body?.inviteSent ? copy.inviteSent : copy.inviteFailed,
      });
    } catch (err) {
      toast({
        title: copy.genericError,
        description: err instanceof Error ? err.message : copy.genericError,
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  }

  async function updateUser(target: InternalUser, patch: { role?: InternalRole; status?: ManagedStatus }) {
    if (!canEditTarget(target)) return;
    setBusyUserId(target.id);
    try {
      const res = await fetch(`/api/internal/auth/users/${target.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const body = await readJson(res);
      if (!res.ok) throw new Error(body?.error ?? copy.genericError);
      setUsers((current) => current.map((item) => item.id === target.id ? body.user : item));
      toast({ title: copy.updated });
    } catch (err) {
      toast({
        title: copy.genericError,
        description: err instanceof Error ? err.message : copy.genericError,
        variant: "destructive",
      });
      await loadUsers();
    } finally {
      setBusyUserId(null);
    }
  }

  async function sendMagicLink(target: InternalUser) {
    setSendingUserId(target.id);
    try {
      const res = await fetch(`/api/internal/auth/users/${target.id}/send-magic-link`, {
        method: "POST",
        credentials: "include",
      });
      const body = await readJson(res);
      if (!res.ok) throw new Error(body?.error ?? copy.genericError);
      toast({ title: copy.linkSent, description: target.email });
    } catch (err) {
      toast({
        title: copy.genericError,
        description: err instanceof Error ? err.message : copy.genericError,
        variant: "destructive",
      });
    } finally {
      setSendingUserId(null);
    }
  }

  if (!canManage) {
    return (
      <div className="p-8 max-w-[1100px] mx-auto">
        <Card className="border-destructive/30 bg-card/60">
          <CardContent className="p-8 flex items-start gap-4">
            <ShieldCheck className="size-6 text-destructive mt-0.5" />
            <div>
              <h1 className="text-xl font-semibold">{copy.title}</h1>
              <p className="text-sm text-muted-foreground mt-2">{copy.accessDenied}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-[1600px] mx-auto space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <Users className="size-7" />
            {copy.title}
          </h1>
          <p className="text-muted-foreground mt-1">{copy.subtitle}</p>
        </div>
        <Button variant="outline" onClick={() => void loadUsers()} disabled={loading}>
          <RefreshCw className={`size-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          {copy.refresh}
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          [copy.total, stats.total],
          [copy.activeUsers, stats.active],
          [copy.admins, stats.admins],
          [copy.suspendedUsers, stats.suspended],
        ].map(([label, value]) => (
          <Card key={String(label)} className="border-border/50 bg-card/50">
            <CardContent className="p-5">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
              <div className="text-2xl font-bold mt-1">{value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-border/50 bg-card/50">
        <CardHeader className="border-b border-border/50">
          <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2">
            <UserPlus className="size-4" />
            {copy.addUser}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-5">
          <form onSubmit={createUser} className="grid gap-3 lg:grid-cols-[minmax(280px,1fr)_220px_auto]">
            <Input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder={copy.email}
              autoComplete="email"
              required
            />
            <select
              value={newRole}
              onChange={(event) => setNewRole(event.target.value as InternalRole)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              aria-label={copy.role}
            >
              {manageableRoles.map((role) => (
                <option key={role} value={role}>{ROLE_LABELS[role]}</option>
              ))}
            </select>
            <Button type="submit" disabled={creating || !email.trim()}>
              <UserPlus className="size-4 mr-2" />
              {creating ? copy.creating : copy.create}
            </Button>
          </form>
          <p className="text-xs text-muted-foreground mt-3">
            {currentUser?.role === "owner" ? copy.ownerLocked : copy.adminRule}
          </p>
        </CardContent>
      </Card>

      <Card className="border-border/50 bg-card/50">
        <CardHeader className="border-b border-border/50">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <CardTitle className="text-sm uppercase tracking-wider">{copy.title}</CardTitle>
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={copy.search}
              className="md:w-72"
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loadError ? (
            <div className="p-6 text-sm text-destructive">{loadError}</div>
          ) : loading && users.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">{copy.loading}</div>
          ) : filteredUsers.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">{copy.noUsers}</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{copy.user}</TableHead>
                    <TableHead>{copy.role}</TableHead>
                    <TableHead>{copy.status}</TableHead>
                    <TableHead>{copy.lastLogin}</TableHead>
                    <TableHead>{copy.createdAt}</TableHead>
                    <TableHead className="text-right">{copy.actions}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredUsers.map((target) => {
                    const editable = canEditTarget(target);
                    const rowBusy = busyUserId === target.id;
                    const sending = sendingUserId === target.id;
                    const roleOptions: InternalRole[] = currentUser?.role === "owner"
                      ? ["admin", "manager", "internal_staff"]
                      : ["manager", "internal_staff"];

                    return (
                      <TableRow key={target.id}>
                        <TableCell>
                          <div className="font-medium">{target.email}</div>
                          <div className="text-xs text-muted-foreground">ID {target.id}</div>
                        </TableCell>
                        <TableCell>
                          {target.role === "owner" ? (
                            <Badge variant="outline">Owner</Badge>
                          ) : (
                            <select
                              value={target.role}
                              onChange={(event) => void updateUser(target, { role: event.target.value as InternalRole })}
                              disabled={!editable || rowBusy}
                              className="h-8 rounded-md border border-input bg-background px-2 text-xs disabled:opacity-60"
                              aria-label={`${copy.role} ${target.email}`}
                            >
                              {roleOptions.map((role) => (
                                <option key={role} value={role}>{ROLE_LABELS[role]}</option>
                              ))}
                            </select>
                          )}
                        </TableCell>
                        <TableCell>
                          {target.role === "owner" ? (
                            <Badge>{copy.active}</Badge>
                          ) : (
                            <select
                              value={target.status}
                              onChange={(event) => void updateUser(target, { status: event.target.value as ManagedStatus })}
                              disabled={!editable || rowBusy || (currentUser?.id === target.id && target.status === "active")}
                              className="h-8 rounded-md border border-input bg-background px-2 text-xs disabled:opacity-60"
                              aria-label={`${copy.status} ${target.email}`}
                            >
                              <option value="active">{copy.active}</option>
                              <option value="suspended">{copy.suspended}</option>
                            </select>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {formatDate(target.lastLoginAt, locale)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {formatDate(target.createdAt, locale)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={target.status !== "active" || sending}
                            onClick={() => void sendMagicLink(target)}
                          >
                            <Send className="size-3.5 mr-2" />
                            {sending ? copy.sending : copy.sendLink}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="text-xs text-muted-foreground">
        {copy.adminRule}
      </div>
    </div>
  );
}
