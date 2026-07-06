import { useState } from "react";
import { useListPrompts } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileText, Plus, Search, History, Check, Copy } from "lucide-react";
import { Input } from "@/components/ui/input";
import { format } from "date-fns";

export default function Prompts() {
  const [categoryFilter, setCategoryFilter] = useState("");
  const { data: prompts, isLoading } = useListPrompts({
    category: categoryFilter || null
  });

  return (
    <div className="p-8 max-w-[1600px] mx-auto space-y-8 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Prompt Library</h1>
          <p className="text-muted-foreground mt-1">Version-controlled templates and system instructions.</p>
        </div>
        <Button className="font-mono text-xs uppercase tracking-wider" variant="default">
          <Plus className="size-4 mr-2" /> New Prompt
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {/* Sidebar / Filters */}
        <div className="col-span-1 space-y-6">
          <Card className="border-border/50 bg-card/50 backdrop-blur">
            <CardHeader className="pb-4">
              <CardTitle className="text-sm font-medium font-mono uppercase tracking-wider text-muted-foreground">Directory</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search..."
                  className="pl-8 bg-background/50 h-8 text-xs font-mono border-border/50"
                />
              </div>
              <div className="space-y-1">
                {/* Simulated categories based on typical prompt management */}
                <div className={`text-sm font-mono px-2 py-1.5 rounded cursor-pointer ${!categoryFilter ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-secondary/50'}`} onClick={() => setCategoryFilter("")}>All Prompts</div>
                <div className={`text-sm font-mono px-2 py-1.5 rounded cursor-pointer ${categoryFilter === 'system' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-secondary/50'}`} onClick={() => setCategoryFilter("system")}>System Instructions</div>
                <div className={`text-sm font-mono px-2 py-1.5 rounded cursor-pointer ${categoryFilter === 'extraction' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-secondary/50'}`} onClick={() => setCategoryFilter("extraction")}>Data Extraction</div>
                <div className={`text-sm font-mono px-2 py-1.5 rounded cursor-pointer ${categoryFilter === 'chat' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-secondary/50'}`} onClick={() => setCategoryFilter("chat")}>Chat Behaviors</div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Main List */}
        <div className="col-span-1 md:col-span-3 space-y-4">
          {isLoading ? (
             <div className="py-12 text-center text-muted-foreground font-mono text-sm border border-border/50 rounded-lg bg-card/50 backdrop-blur">Loading library...</div>
          ) : prompts?.length === 0 ? (
             <div className="py-12 text-center text-muted-foreground font-mono text-sm border border-border/50 rounded-lg bg-card/50 backdrop-blur">No prompts found.</div>
          ) : (
            prompts?.map(prompt => (
              <Card key={prompt.id} className="border-border/50 bg-card/50 backdrop-blur hover:border-primary/30 transition-colors group cursor-pointer">
                <CardContent className="p-5 flex flex-col gap-4">
                  <div className="flex justify-between items-start">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-3">
                        <h3 className="font-semibold text-foreground text-lg">{prompt.name}</h3>
                        <Badge variant="outline" className="font-mono text-[10px] uppercase border-primary/20 text-primary bg-primary/5">v{prompt.version}</Badge>
                        {prompt.isActive && <Badge variant="outline" className="font-mono text-[10px] uppercase border-green-500/30 text-green-400 bg-green-500/10">Active</Badge>}
                      </div>
                      <span className="text-sm text-muted-foreground">{prompt.description || 'No description provided.'}</span>
                    </div>
                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button variant="ghost" size="icon" className="h-8 w-8"><History className="size-4" /></Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8"><Copy className="size-4" /></Button>
                    </div>
                  </div>
                  
                  <div className="bg-background/50 border border-border/50 rounded p-3 text-sm font-mono text-foreground/80 line-clamp-2 max-h-[80px] overflow-hidden text-ellipsis whitespace-pre-wrap">
                    {prompt.content}
                  </div>

                  <div className="flex justify-between items-center mt-2">
                    <div className="flex gap-2">
                      <Badge variant="secondary" className="font-mono text-[10px] uppercase bg-secondary/50 text-muted-foreground">{prompt.category}</Badge>
                      {prompt.variables && prompt.variables.map(v => (
                         <Badge key={v} variant="outline" className="font-mono text-[10px] border-border text-foreground/60">&#123;{v}&#125;</Badge>
                      ))}
                    </div>
                    <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
                      Updated {format(new Date(prompt.updatedAt), 'MMM d, yyyy')} • {prompt.usageCount?.toLocaleString() || 0} Uses
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>
    </div>
  );
}