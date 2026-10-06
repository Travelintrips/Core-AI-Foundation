import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownLeft, ArrowUpRight, Bot, RefreshCw, Search, Wifi } from "lucide-react";
import { format } from "date-fns";
import { apiFetch } from "@/lib/apiFetch";
import { useLang } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type ActivityItem = {
  id: string;
  conversationId: string | null;
  role: "user" | "assistant" | "system";
  direction: "chatgpt_to_ai_core" | "ai_core_to_chatgpt" | "system";
  content: string;
  route: string | null;
  kind: string | null;
  status: string | null;
  taskId: string | null;
  projectName: string | null;
  repository: string | null;
  branch: string | null;
  createdAt: string | null;
};

type ActivityResponse = {
  items: ActivityItem[];
  count: number;
  generatedAt: string;
};

function shortId(value: string | null) {
  if (!value) return "-";
  return value.length > 18 ? `${value.slice(0, 9)}…${value.slice(-6)}` : value;
}

export default function AiCoreActivityPage() {
  const { lang } = useLang();
  const [query, setQuery] = useState("");
  const [conversationFilter, setConversationFilter] = useState("");

  const activity = useQuery({
    queryKey: ["ai-core-activity", conversationFilter],
    queryFn: () => {
      const params = new URLSearchParams({ limit: "250" });
      if (conversationFilter.trim()) params.set("conversationId", conversationFilter.trim());
      return apiFetch<ActivityResponse>(`/api/ai/core-chat/activity?${params.toString()}`);
    },
    refetchInterval: 2_000,
    refetchIntervalInBackground: true,
    staleTime: 1_000,
  });

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return activity.data?.items ?? [];
    return (activity.data?.items ?? []).filter((item) =>
      [
        item.content,
        item.conversationId,
        item.route,
        item.status,
        item.taskId,
        item.projectName,
        item.repository,
        item.branch,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle)),
    );
  }, [activity.data?.items, query]);

  const copy = lang === "id"
    ? {
        eyebrow: "Monitor komunikasi internal",
        title: "ChatGPT ↔ AI Core Activity",
        subtitle: "Lihat perintah dari ChatGPT ke AI Core dan balasan AI Core secara live dalam satu timeline.",
        search: "Cari isi pesan, task, route, repository…",
        conversation: "Filter conversationId (opsional)",
        live: "Live · refresh 2 detik",
        refresh: "Refresh",
        empty: "Belum ada aktivitas yang cocok.",
        error: "Timeline aktivitas AI Core tidak dapat dimuat.",
        outbound: "ChatGPT → AI Core",
        inbound: "AI Core → ChatGPT",
        system: "System",
        session: "Sesi",
        route: "Route",
        task: "Task",
      }
    : {
        eyebrow: "Internal communication monitor",
        title: "ChatGPT ↔ AI Core Activity",
        subtitle: "See ChatGPT requests to AI Core and AI Core replies live in one timeline.",
        search: "Search message, task, route, repository…",
        conversation: "Filter conversationId (optional)",
        live: "Live · refresh every 2 seconds",
        refresh: "Refresh",
        empty: "No matching activity yet.",
        error: "AI Core activity timeline could not be loaded.",
        outbound: "ChatGPT → AI Core",
        inbound: "AI Core → ChatGPT",
        system: "System",
        session: "Session",
        route: "Route",
        task: "Task",
      };

  return (
    <div className="p-6 md:p-8 max-w-[1500px] mx-auto w-full space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="text-[11px] font-mono uppercase tracking-[0.2em] text-violet-300 mb-2">
            {copy.eyebrow}
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">{copy.title}</h1>
          <p className="text-muted-foreground mt-1 max-w-3xl">{copy.subtitle}</p>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant="outline" className="h-8 gap-2 border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
            <Wifi className="size-3.5" />
            {copy.live}
          </Badge>
          <Button variant="outline" size="sm" onClick={() => activity.refetch()} disabled={activity.isFetching}>
            <RefreshCw className={`size-4 mr-2 ${activity.isFetching ? "animate-spin" : ""}`} />
            {copy.refresh}
          </Button>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_360px]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={copy.search}
            className="pl-9"
          />
        </div>
        <Input
          value={conversationFilter}
          onChange={(event) => setConversationFilter(event.target.value)}
          placeholder={copy.conversation}
          className="font-mono text-xs"
        />
      </div>

      {activity.isError ? (
        <Card className="border-destructive/30">
          <CardContent className="py-10 text-center text-destructive">{copy.error}</CardContent>
        </Card>
      ) : filtered.length === 0 && !activity.isLoading ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">{copy.empty}</CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((item) => {
            const outbound = item.direction === "chatgpt_to_ai_core";
            const inbound = item.direction === "ai_core_to_chatgpt";
            const label = outbound ? copy.outbound : inbound ? copy.inbound : copy.system;

            return (
              <Card
                key={item.id}
                className={outbound
                  ? "border-sky-500/20 bg-sky-500/[0.035]"
                  : inbound
                    ? "border-violet-500/20 bg-violet-500/[0.035]"
                    : "border-border/50"}
              >
                <CardHeader className="pb-3">
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <span className={`size-7 rounded-full flex items-center justify-center ${
                        outbound ? "bg-sky-500/15 text-sky-300" : inbound ? "bg-violet-500/15 text-violet-300" : "bg-muted text-muted-foreground"
                      }`}>
                        {outbound ? <ArrowUpRight className="size-4" /> : inbound ? <ArrowDownLeft className="size-4" /> : <Bot className="size-4" />}
                      </span>
                      {label}
                      {item.status && (
                        <Badge variant="outline" className="font-mono text-[10px] uppercase">
                          {item.status}
                        </Badge>
                      )}
                    </CardTitle>
                    <div className="text-xs font-mono text-muted-foreground">
                      {item.createdAt ? format(new Date(item.createdAt), "yyyy-MM-dd HH:mm:ss") : "-"}
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="space-y-3">
                  <div className="whitespace-pre-wrap break-words text-sm leading-6 text-foreground">
                    {item.content}
                  </div>

                  <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-border/40 pt-3 text-[11px] font-mono text-muted-foreground">
                    <span>{copy.session}: {shortId(item.conversationId)}</span>
                    {item.route && <span>{copy.route}: {item.route}</span>}
                    {item.taskId && (
                      <a className="hover:text-primary underline-offset-2 hover:underline" href={`/coding-workspace/${item.taskId}`}>
                        {copy.task}: {shortId(item.taskId)}
                      </a>
                    )}
                    {item.repository && <span>{item.repository}{item.branch ? ` @ ${item.branch}` : ""}</span>}
                    {item.projectName && <span>{item.projectName}</span>}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
