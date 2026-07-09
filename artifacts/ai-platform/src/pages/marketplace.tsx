import { useMemo, useState } from "react";
import {
  useGetMarketplaceSkills,
  useGetMarketplaceTools,
  useGetMarketplaceInstalled,
  useGetMarketplaceAnalytics,
  useInstallMarketplacePackage,
  useEnableMarketplacePackage,
  useDisableMarketplacePackage,
  useUpgradeMarketplacePackage,
  useUninstallMarketplacePackage,
  useHealthCheckTool,
  type AiSkillPackage,
  type AiToolPackage,
  type AiInstalledPackage,
  type PackageType,
} from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Blocks,
  Boxes,
  CheckCircle2,
  Cpu,
  Download,
  HeartPulse,
  Loader2,
  Package,
  Plug,
  Power,
  PowerOff,
  Store,
  Trash2,
  TrendingUp,
} from "lucide-react";

const TENANT_ID = "default";

const HEALTH_COLORS: Record<string, string> = {
  healthy: "bg-green-500/10 text-green-400 border-green-500/20",
  degraded: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  down: "bg-red-500/10 text-red-400 border-red-500/20",
  unknown: "bg-muted/30 text-muted-foreground border-border",
};

function StatBox({ label, value, icon: Icon }: { label: string; value: number | string; icon: typeof Package }) {
  return (
    <div className="border border-border rounded-lg bg-card px-4 py-3 flex items-center gap-3">
      <div className="size-8 rounded-md bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
        <Icon className="size-4" />
      </div>
      <div>
        <div className="text-lg font-semibold leading-none">{value}</div>
        <div className="text-xs text-muted-foreground mt-1">{label}</div>
      </div>
    </div>
  );
}

function PackageCard({
  code,
  name,
  category,
  description,
  version,
  packageType,
  installed,
  enabled,
  installedVersion,
  healthStatus,
  onInstall,
  onEnable,
  onDisable,
  onUpgrade,
  onUninstall,
  onHealthCheck,
  isPending,
}: {
  code: string;
  name: string;
  category: string | null;
  description: string | null;
  version: string;
  packageType: PackageType;
  installed: boolean;
  enabled?: boolean;
  installedVersion?: string;
  healthStatus?: string;
  onInstall: () => void;
  onEnable: () => void;
  onDisable: () => void;
  onUpgrade: () => void;
  onUninstall: () => void;
  onHealthCheck?: () => void;
  isPending: boolean;
}) {
  const outOfDate = installed && installedVersion !== version;

  return (
    <div className="border border-border rounded-lg bg-card p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {packageType === "skill" ? <Blocks className="size-4 text-primary shrink-0" /> : <Plug className="size-4 text-primary shrink-0" />}
            <span className="font-medium truncate">{name}</span>
          </div>
          <div className="text-xs text-muted-foreground font-mono mt-0.5">{code} · v{version}</div>
        </div>
        {category && (
          <Badge variant="outline" className="text-xs shrink-0 capitalize">
            {category}
          </Badge>
        )}
      </div>

      {description && <p className="text-sm text-muted-foreground line-clamp-2">{description}</p>}

      <div className="flex items-center gap-2 flex-wrap">
        {installed ? (
          <Badge variant="outline" className={cn("text-xs", enabled ? "bg-green-500/10 text-green-400 border-green-500/20" : "bg-muted/30 text-muted-foreground")}>
            {enabled ? "Enabled" : "Disabled"} · v{installedVersion}
          </Badge>
        ) : (
          <Badge variant="outline" className="text-xs bg-muted/30 text-muted-foreground">
            Not installed
          </Badge>
        )}
        {packageType === "tool" && healthStatus && (
          <Badge variant="outline" className={cn("text-xs", HEALTH_COLORS[healthStatus])}>
            <HeartPulse className="size-3 mr-1" />
            {healthStatus}
          </Badge>
        )}
        {outOfDate && (
          <Badge variant="outline" className="text-xs bg-blue-500/10 text-blue-400 border-blue-500/20">
            Update available
          </Badge>
        )}
      </div>

      <div className="flex items-center gap-2 mt-auto pt-1">
        {!installed && (
          <Button size="sm" className="h-7 text-xs gap-1" onClick={onInstall} disabled={isPending}>
            {isPending ? <Loader2 className="size-3 animate-spin" /> : <Download className="size-3" />}
            Install
          </Button>
        )}
        {installed && (
          <>
            {enabled ? (
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={onDisable} disabled={isPending}>
                <PowerOff className="size-3" /> Disable
              </Button>
            ) : (
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={onEnable} disabled={isPending}>
                <Power className="size-3" /> Enable
              </Button>
            )}
            {outOfDate && (
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={onUpgrade} disabled={isPending}>
                <TrendingUp className="size-3" /> Upgrade
              </Button>
            )}
            {packageType === "tool" && onHealthCheck && (
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={onHealthCheck} disabled={isPending}>
                <HeartPulse className="size-3" /> Check
              </Button>
            )}
            <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-destructive hover:text-destructive ml-auto" onClick={onUninstall} disabled={isPending}>
              <Trash2 className="size-3" /> Remove
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

export default function Marketplace() {
  const { toast } = useToast();
  const [tab, setTab] = useState<"skills" | "tools" | "installed">("skills");

  const { data: skills = [], isLoading: skillsLoading } = useGetMarketplaceSkills();
  const { data: tools = [], isLoading: toolsLoading } = useGetMarketplaceTools();
  const { data: installed = [], isLoading: installedLoading } = useGetMarketplaceInstalled(TENANT_ID);
  const { data: analytics } = useGetMarketplaceAnalytics(TENANT_ID);

  const installMutation = useInstallMarketplacePackage({
    mutation: {
      onError: (err: unknown) => toast({ title: "Install failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" }),
    },
  });
  const enableMutation = useEnableMarketplacePackage();
  const disableMutation = useDisableMarketplacePackage();
  const upgradeMutation = useUpgradeMarketplacePackage();
  const uninstallMutation = useUninstallMarketplacePackage();
  const healthCheckMutation = useHealthCheckTool();

  const installedByKey = useMemo(() => {
    const map = new Map<string, AiInstalledPackage>();
    for (const i of installed) map.set(`${i.packageType}:${i.packageId}`, i);
    return map;
  }, [installed]);

  const isBusy = installMutation.isPending || enableMutation.isPending || disableMutation.isPending || upgradeMutation.isPending || uninstallMutation.isPending || healthCheckMutation.isPending;

  function actionsFor(packageType: PackageType, pkg: AiSkillPackage | AiToolPackage) {
    const inst = installedByKey.get(`${packageType}:${pkg.id}`);
    return {
      installed: !!inst,
      enabled: inst?.enabled,
      installedVersion: inst?.installedVersion,
      onInstall: () => installMutation.mutate({ tenantId: TENANT_ID, packageType, packageId: pkg.id }),
      onEnable: () => enableMutation.mutate({ packageType, id: pkg.id, tenantId: TENANT_ID }),
      onDisable: () => disableMutation.mutate({ packageType, id: pkg.id, tenantId: TENANT_ID }),
      onUpgrade: () => upgradeMutation.mutate({ packageType, id: pkg.id, tenantId: TENANT_ID }),
      onUninstall: () => uninstallMutation.mutate({ packageType, id: pkg.id, tenantId: TENANT_ID }),
    };
  }

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      <div className="flex items-center gap-3">
        <div className="size-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
          <Store className="size-5" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">AI Skills Marketplace</h1>
          <p className="text-sm text-muted-foreground">Install, configure, and manage AI Skills, Tools, and Connectors — per tenant, without touching core platform code.</p>
        </div>
      </div>

      {analytics && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatBox label="Skill packages" value={analytics.totalSkillPackages} icon={Blocks} />
          <StatBox label="Tool packages" value={analytics.totalToolPackages} icon={Plug} />
          <StatBox label="Installed skills" value={`${analytics.enabledSkills}/${analytics.installedSkills}`} icon={CheckCircle2} />
          <StatBox label="Installed tools" value={`${analytics.enabledTools}/${analytics.installedTools}`} icon={Boxes} />
        </div>
      )}

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="skills">AI Skills</TabsTrigger>
          <TabsTrigger value="tools">Tools &amp; Connectors</TabsTrigger>
          <TabsTrigger value="installed">Installed ({installed.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="skills" className="mt-4">
          {skillsLoading ? (
            <div className="text-sm text-muted-foreground py-8 text-center">Loading skill catalog…</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {skills.map((s) => {
                const a = actionsFor("skill", s);
                return <PackageCard key={s.id} code={s.skillCode} name={s.skillName} category={s.category} description={s.description} version={s.version} packageType="skill" isPending={isBusy} {...a} />;
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="tools" className="mt-4">
          {toolsLoading ? (
            <div className="text-sm text-muted-foreground py-8 text-center">Loading tool catalog…</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {tools.map((t) => {
                const a = actionsFor("tool", t);
                return (
                  <PackageCard
                    key={t.id}
                    code={t.toolCode}
                    name={t.toolName}
                    category={t.category}
                    description={t.provider ? `Provider: ${t.provider}` : null}
                    version={t.version}
                    packageType="tool"
                    healthStatus={t.healthStatus}
                    onHealthCheck={() => healthCheckMutation.mutate(t.id)}
                    isPending={isBusy}
                    {...a}
                  />
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="installed" className="mt-4">
          {installedLoading ? (
            <div className="text-sm text-muted-foreground py-8 text-center">Loading installed packages…</div>
          ) : installed.length === 0 ? (
            <div className="text-sm text-muted-foreground py-8 text-center flex flex-col items-center gap-2">
              <Cpu className="size-6 opacity-40" />
              Nothing installed yet — browse AI Skills or Tools to get started.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {installed.map((i) => {
                const catalog = i.catalog;
                if (!catalog) return null;
                const isSkill = i.packageType === "skill";
                const code = isSkill ? (catalog as AiSkillPackage).skillCode : (catalog as AiToolPackage).toolCode;
                const name = isSkill ? (catalog as AiSkillPackage).skillName : (catalog as AiToolPackage).toolName;
                return (
                  <PackageCard
                    key={`${i.packageType}-${i.packageId}`}
                    code={code}
                    name={name}
                    category={catalog.category}
                    description={isSkill ? (catalog as AiSkillPackage).description : `Provider: ${(catalog as AiToolPackage).provider ?? "—"}`}
                    version={catalog.version}
                    packageType={i.packageType}
                    installed
                    enabled={i.enabled}
                    installedVersion={i.installedVersion}
                    healthStatus={!isSkill ? (catalog as AiToolPackage).healthStatus : undefined}
                    onInstall={() => {}}
                    onEnable={() => enableMutation.mutate({ packageType: i.packageType, id: i.packageId, tenantId: TENANT_ID })}
                    onDisable={() => disableMutation.mutate({ packageType: i.packageType, id: i.packageId, tenantId: TENANT_ID })}
                    onUpgrade={() => upgradeMutation.mutate({ packageType: i.packageType, id: i.packageId, tenantId: TENANT_ID })}
                    onUninstall={() => uninstallMutation.mutate({ packageType: i.packageType, id: i.packageId, tenantId: TENANT_ID })}
                    onHealthCheck={!isSkill ? () => healthCheckMutation.mutate(i.packageId) : undefined}
                    isPending={isBusy}
                  />
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
