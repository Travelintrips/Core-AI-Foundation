import { useState } from "react";
import { useListAuditLogs } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ShieldAlert, Filter } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from "date-fns";
import { useLang } from "@/lib/i18n";

export default function Audit() {
  const { t } = useLang();
  const { data: auditPage, isLoading } = useListAuditLogs({ limit: 50 });

  return (
    <div className="p-8 max-w-[1600px] mx-auto space-y-8 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("pages.audit.title")}</h1>
          <p className="text-muted-foreground mt-1">{t("pages.audit.subtitle")}</p>
        </div>
      </div>

      <Card className="border-border/50 bg-card/50 backdrop-blur">
        <CardHeader className="flex flex-row items-center justify-between pb-4">
          <CardTitle className="text-sm font-medium font-mono uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <ShieldAlert className="size-4" /> Security Events
          </CardTitle>
          <div className="flex items-center gap-4">
            <Button variant="outline" size="sm" className="h-8 font-mono text-xs uppercase tracking-wider border-border/50">
              <Filter className="size-3 mr-2" /> Filter
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
             <div className="py-12 text-center text-muted-foreground font-mono text-sm">{t("pages.audit.loading")}</div>
          ) : auditPage?.items?.length === 0 ? (
             <div className="py-12 text-center text-muted-foreground font-mono text-sm">{t("pages.audit.empty")}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-border/50 hover:bg-transparent">
                  <TableHead className="font-mono text-xs uppercase text-muted-foreground">{t("pages.audit.table.timestamp")}</TableHead>
                  <TableHead className="font-mono text-xs uppercase text-muted-foreground">{t("pages.audit.table.module")}</TableHead>
                  <TableHead className="font-mono text-xs uppercase text-muted-foreground">{t("pages.audit.table.action")}</TableHead>
                  <TableHead className="font-mono text-xs uppercase text-muted-foreground">{t("pages.audit.table.actor")}</TableHead>
                  <TableHead className="font-mono text-xs uppercase text-muted-foreground">{t("pages.audit.table.target")}</TableHead>
                  <TableHead className="font-mono text-xs uppercase text-muted-foreground text-right">{t("pages.audit.table.status")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {auditPage?.items?.map((log) => (
                  <TableRow key={log.id} className="border-border/50 hover:bg-secondary/30">
                    <TableCell className="font-mono text-xs text-muted-foreground whitespace-nowrap">
                      {format(new Date(log.createdAt), 'yyyy-MM-dd HH:mm:ss')}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-mono text-[10px] uppercase border-primary/20 text-primary bg-primary/5">{log.module}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-foreground font-medium">
                      {log.action}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {log.actorId || 'system'}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {log.resourceType && log.resourceId ? `${log.resourceType}:${log.resourceId}` : '-'}
                    </TableCell>
                    <TableCell className="text-right">
                      <span className={`text-[10px] uppercase tracking-widest font-mono ${
                        log.status === 'success' ? 'text-green-400' : 
                        log.status === 'failure' ? 'text-destructive' : 
                        'text-yellow-400'
                      }`}>
                        {log.status || 'unknown'}
                      </span>
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
