import { useListWorkflows } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { GitMerge, Plus, Search, Play, Settings2, MoreHorizontal } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from "date-fns";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export default function Workflows() {
  const { data: workflows, isLoading } = useListWorkflows();

  return (
    <div className="p-8 max-w-[1600px] mx-auto space-y-8 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Workflows</h1>
          <p className="text-muted-foreground mt-1">Multi-step AI chains and routing logic.</p>
        </div>
        <Button className="font-mono text-xs uppercase tracking-wider" variant="default">
          <Plus className="size-4 mr-2" /> New Workflow
        </Button>
      </div>

      <Card className="border-border/50 bg-card/50 backdrop-blur">
        <CardHeader className="flex flex-row items-center justify-between pb-4">
          <CardTitle className="text-sm font-medium font-mono uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <GitMerge className="size-4" /> Workflow Engine
          </CardTitle>
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search workflows..."
              className="pl-8 w-[250px] bg-background/50 h-8 text-xs font-mono"
            />
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
             <div className="py-12 text-center text-muted-foreground font-mono text-sm">Loading workflows...</div>
          ) : workflows?.length === 0 ? (
             <div className="py-12 text-center text-muted-foreground font-mono text-sm">No workflows configured. Create one to get started.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-border/50 hover:bg-transparent">
                  <TableHead className="font-mono text-xs uppercase text-muted-foreground">Name</TableHead>
                  <TableHead className="font-mono text-xs uppercase text-muted-foreground">Status</TableHead>
                  <TableHead className="font-mono text-xs uppercase text-muted-foreground">Trigger</TableHead>
                  <TableHead className="font-mono text-xs uppercase text-muted-foreground text-right">Steps</TableHead>
                  <TableHead className="font-mono text-xs uppercase text-muted-foreground text-right">Executions</TableHead>
                  <TableHead className="font-mono text-xs uppercase text-muted-foreground">Updated</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {workflows?.map((wf) => (
                  <TableRow key={wf.id} className="border-border/50 group cursor-pointer hover:bg-secondary/30">
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium text-foreground">{wf.name}</span>
                        {wf.description && <span className="text-xs text-muted-foreground truncate max-w-[300px]">{wf.description}</span>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`font-mono text-[10px] uppercase px-1.5 py-0 h-5 ${
                        wf.status === 'active' ? 'border-green-500/30 text-green-400 bg-green-500/10' :
                        wf.status === 'draft' ? 'border-yellow-500/30 text-yellow-400 bg-yellow-500/10' :
                        'border-muted text-muted-foreground'
                      }`}>
                        {wf.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{wf.triggerType || 'manual'}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{wf.steps?.length || 0}</TableCell>
                    <TableCell className="text-right font-mono text-xs text-muted-foreground">{wf.executionCount?.toLocaleString() || 0}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{format(new Date(wf.updatedAt), 'MMM d, yyyy')}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-primary hover:text-primary hover:bg-primary/10">
                          <Play className="size-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <Settings2 className="size-4 text-muted-foreground" />
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreHorizontal className="size-4 text-muted-foreground" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="bg-popover border-border">
                            <DropdownMenuItem className="font-mono text-xs cursor-pointer">Edit visually</DropdownMenuItem>
                            <DropdownMenuItem className="font-mono text-xs cursor-pointer">View JSON</DropdownMenuItem>
                            <DropdownMenuItem className="font-mono text-xs text-destructive focus:text-destructive cursor-pointer">Delete</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
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