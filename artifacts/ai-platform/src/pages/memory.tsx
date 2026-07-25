import { useState } from "react";
import { useListMemoryEntries } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Cpu, Search, Hash, Clock, BrainCircuit, BoxSelect } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from "date-fns";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLang } from "@/lib/i18n";

export default function Memory() {
  const { t } = useLang();
  const [memoryType, setMemoryType] = useState<string>("all");
  const { data: memoryEntries, isLoading } = useListMemoryEntries();

  const getMemoryIcon = (type: string) => {
    switch (type) {
      case 'short_term': return <Clock className="size-3" />;
      case 'long_term': return <Database className="size-3" />;
      case 'episodic': return <BrainCircuit className="size-3" />;
      case 'semantic': return <BoxSelect className="size-3" />;
      default: return <Cpu className="size-3" />;
    }
  };

  const getMemoryColor = (type: string) => {
    switch (type) {
      case 'short_term': return 'border-yellow-500/30 text-yellow-400 bg-yellow-500/10';
      case 'long_term': return 'border-blue-500/30 text-blue-400 bg-blue-500/10';
      case 'episodic': return 'border-purple-500/30 text-purple-400 bg-purple-500/10';
      case 'semantic': return 'border-green-500/30 text-green-400 bg-green-500/10';
      default: return 'border-primary/30 text-primary bg-primary/10';
    }
  };

  return (
    <div className="p-8 max-w-[1600px] mx-auto space-y-8 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("pages.memory.title")}</h1>
          <p className="text-muted-foreground mt-1">{t("pages.memory.subtitle")}</p>
        </div>
      </div>

      <Card className="border-border/50 bg-card/50 backdrop-blur">
        <CardHeader className="flex flex-row items-center justify-between pb-4">
          <CardTitle className="text-sm font-medium font-mono uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <Cpu className="size-4" /> State Graph
          </CardTitle>
          <div className="flex items-center gap-4">
            <Select value={memoryType} onValueChange={setMemoryType}>
              <SelectTrigger className="w-[150px] h-8 bg-background/50 font-mono text-xs border-border/50">
                <SelectValue placeholder={t("pages.memory.typeFilter")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="font-mono text-xs">{t("pages.memory.allTypes")}</SelectItem>
                <SelectItem value="short_term" className="font-mono text-xs text-yellow-400">{t("pages.memory.types.shortTerm")}</SelectItem>
                <SelectItem value="long_term" className="font-mono text-xs text-blue-400">{t("pages.memory.types.longTerm")}</SelectItem>
                <SelectItem value="episodic" className="font-mono text-xs text-purple-400">{t("pages.memory.types.episodic")}</SelectItem>
                <SelectItem value="semantic" className="font-mono text-xs text-green-400">{t("pages.memory.types.semantic")}</SelectItem>
              </SelectContent>
            </Select>
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t("pages.memory.searchPh")}
                className="pl-8 w-[250px] bg-background/50 h-8 text-xs font-mono border-border/50"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
             <div className="py-12 text-center text-muted-foreground font-mono text-sm">{t("pages.memory.loading")}</div>
          ) : memoryEntries?.length === 0 ? (
             <div className="py-12 text-center text-muted-foreground font-mono text-sm">{t("pages.memory.empty")}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-border/50 hover:bg-transparent">
                  <TableHead className="font-mono text-xs uppercase text-muted-foreground">{t("pages.memory.table.entity")}</TableHead>
                  <TableHead className="font-mono text-xs uppercase text-muted-foreground">{t("pages.memory.table.type")}</TableHead>
                  <TableHead className="font-mono text-xs uppercase text-muted-foreground">{t("pages.memory.table.keyCtx")}</TableHead>
                  <TableHead className="font-mono text-xs uppercase text-muted-foreground text-right">{t("pages.memory.table.importance")}</TableHead>
                  <TableHead className="font-mono text-xs uppercase text-muted-foreground text-right">{t("pages.memory.table.stored")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {memoryEntries?.map((entry) => (
                  <TableRow key={entry.id} className="border-border/50 group cursor-pointer hover:bg-secondary/30">
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <span className="font-mono text-xs text-primary">{entry.agentId}</span>
                        {entry.sessionId && <span className="font-mono text-[10px] text-muted-foreground">s:{entry.sessionId.substring(0,8)}</span>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`font-mono text-[10px] uppercase px-1.5 py-0 h-5 flex items-center gap-1 w-fit ${getMemoryColor(entry.memoryType)}`}>
                        {getMemoryIcon(entry.memoryType)}
                        {entry.memoryType.replace('_', ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1 max-w-[400px]">
                        {entry.key && <span className="font-mono text-xs font-semibold text-foreground">{entry.key}</span>}
                        <span className="text-xs text-muted-foreground truncate">{entry.content}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1 font-mono text-xs text-muted-foreground">
                        <Hash className="size-3" />
                        {entry.importance !== null && entry.importance !== undefined ? (entry.importance * 100).toFixed(0) : '-'}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs text-muted-foreground">
                      {format(new Date(entry.createdAt), 'MMM d, HH:mm')}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// Fallback icon definition since Database might be missing from scope in the upper import
function Database(props: any) {
  return <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/></svg>;
}
