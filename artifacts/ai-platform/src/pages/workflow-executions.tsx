import { useState } from "react";
import { useListWorkflowExecutions } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, Clock, CheckCircle2, XCircle, AlertCircle, RefreshCw } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format, formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function WorkflowExecutions() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const { data: executions, isLoading, refetch, isRefetching } = useListWorkflowExecutions({
    status: statusFilter === "all" ? null : statusFilter
  });

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed': return <CheckCircle2 className="size-4 text-green-400" />;
      case 'failed': return <XCircle className="size-4 text-destructive" />;
      case 'running': return <Activity className="size-4 text-primary animate-pulse" />;
      case 'pending': return <Clock className="size-4 text-yellow-400" />;
      default: return <AlertCircle className="size-4 text-muted-foreground" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'border-green-500/30 text-green-400 bg-green-500/10';
      case 'failed': return 'border-destructive/30 text-destructive bg-destructive/10';
      case 'running': return 'border-primary/30 text-primary bg-primary/10';
      case 'pending': return 'border-yellow-500/30 text-yellow-400 bg-yellow-500/10';
      default: return 'border-muted text-muted-foreground bg-muted/10';
    }
  };

  return (
    <div className="p-8 max-w-[1600px] mx-auto space-y-8 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Executions Log</h1>
          <p className="text-muted-foreground mt-1">Audit trail and state for all workflow runs.</p>
        </div>
      </div>

      <Card className="border-border/50 bg-card/50 backdrop-blur">
        <CardHeader className="flex flex-row items-center justify-between pb-4">
          <CardTitle className="text-sm font-medium font-mono uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <Activity className="size-4" /> Run History
          </CardTitle>
          <div className="flex items-center gap-4">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[150px] h-8 bg-background/50 font-mono text-xs border-border/50">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="font-mono text-xs">All Statuses</SelectItem>
                <SelectItem value="completed" className="font-mono text-xs text-green-400">Completed</SelectItem>
                <SelectItem value="failed" className="font-mono text-xs text-destructive">Failed</SelectItem>
                <SelectItem value="running" className="font-mono text-xs text-primary">Running</SelectItem>
                <SelectItem value="pending" className="font-mono text-xs text-yellow-400">Pending</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => refetch()} disabled={isRefetching}>
              <RefreshCw className={`size-4 ${isRefetching ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
             <div className="py-12 text-center text-muted-foreground font-mono text-sm">Loading execution logs...</div>
          ) : executions?.length === 0 ? (
             <div className="py-12 text-center text-muted-foreground font-mono text-sm">No executions found matching criteria.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-border/50 hover:bg-transparent">
                  <TableHead className="font-mono text-xs uppercase text-muted-foreground">Run ID</TableHead>
                  <TableHead className="font-mono text-xs uppercase text-muted-foreground">Workflow</TableHead>
                  <TableHead className="font-mono text-xs uppercase text-muted-foreground">Status</TableHead>
                  <TableHead className="font-mono text-xs uppercase text-muted-foreground text-right">Duration</TableHead>
                  <TableHead className="font-mono text-xs uppercase text-muted-foreground text-right">Tokens</TableHead>
                  <TableHead className="font-mono text-xs uppercase text-muted-foreground text-right">Started</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {executions?.map((exec) => (
                  <TableRow key={exec.id} className="border-border/50 cursor-pointer hover:bg-secondary/30">
                    <TableCell className="font-mono text-xs font-bold text-foreground">
                      #{exec.id}
                    </TableCell>
                    <TableCell className="font-medium text-sm">
                      {exec.workflowName || `Workflow ${exec.workflowId}`}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`font-mono text-[10px] uppercase px-1.5 py-0 h-5 flex items-center gap-1.5 w-fit ${getStatusColor(exec.status)}`}>
                        {getStatusIcon(exec.status)}
                        {exec.status}
                      </Badge>
                      {exec.status === 'failed' && exec.errorMessage && (
                        <div className="text-[10px] text-destructive mt-1 font-mono max-w-[200px] truncate" title={exec.errorMessage}>
                          {exec.errorMessage}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs text-muted-foreground">
                      {exec.durationMs ? `${(exec.durationMs / 1000).toFixed(2)}s` : '-'}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs text-muted-foreground">
                      {exec.tokensUsed?.toLocaleString() || '-'}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs text-muted-foreground">
                      <div className="flex flex-col items-end">
                        <span>{format(new Date(exec.createdAt), 'HH:mm:ss')}</span>
                        <span className="text-[9px] opacity-70">{formatDistanceToNow(new Date(exec.createdAt), { addSuffix: true })}</span>
                      </div>
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