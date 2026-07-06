import { useState } from "react";
import { useListKnowledgeBases } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Database, Plus, Search, FileText, DatabaseZap } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from "date-fns";

export default function Knowledge() {
  const { data: knowledgeBases, isLoading } = useListKnowledgeBases();

  return (
    <div className="p-8 max-w-[1600px] mx-auto space-y-8 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Knowledge Base</h1>
          <p className="text-muted-foreground mt-1">Manage vector embeddings and document collections.</p>
        </div>
        <Button className="font-mono text-xs uppercase tracking-wider" variant="default">
          <Plus className="size-4 mr-2" /> New Knowledge Base
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="col-span-1 space-y-4">
           {isLoading ? (
             <div className="py-12 text-center text-muted-foreground font-mono text-sm border border-border/50 rounded-lg bg-card/50 backdrop-blur">Loading...</div>
           ) : (
             knowledgeBases?.map(kb => (
               <Card key={kb.id} className="border-border/50 bg-card/50 backdrop-blur hover:border-primary/30 transition-colors cursor-pointer group">
                  <CardHeader className="p-4 pb-2">
                    <CardTitle className="text-sm font-semibold flex items-center justify-between">
                      <span className="truncate pr-2">{kb.name}</span>
                      <Database className="size-4 text-primary opacity-70 group-hover:opacity-100" />
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 pt-2">
                    <div className="text-xs text-muted-foreground line-clamp-2 mb-3">
                      {kb.description || 'No description.'}
                    </div>
                    <div className="flex items-center justify-between">
                      <Badge variant="outline" className="font-mono text-[10px] uppercase border-primary/20 text-primary bg-primary/5">{kb.documentCount} docs</Badge>
                      <span className="text-[10px] font-mono text-muted-foreground">{kb.embeddingModel}</span>
                    </div>
                  </CardContent>
               </Card>
             ))
           )}
        </div>

        <div className="col-span-1 md:col-span-3">
           <Card className="border-border/50 bg-card/50 backdrop-blur h-full">
            <CardHeader className="flex flex-row items-center justify-between pb-4">
              <CardTitle className="text-sm font-medium font-mono uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <FileText className="size-4" /> Documents
              </CardTitle>
              <div className="flex items-center gap-4">
                <div className="relative">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search documents..."
                    className="pl-8 w-[250px] bg-background/50 h-8 text-xs font-mono border-border/50"
                  />
                </div>
                <Button variant="outline" size="sm" className="h-8 font-mono text-xs uppercase tracking-wider">
                  <Plus className="size-3 mr-2" /> Add Doc
                </Button>
              </div>
            </CardHeader>
            <CardContent>
               <div className="py-24 text-center flex flex-col items-center justify-center text-muted-foreground">
                 <DatabaseZap className="size-12 mb-4 opacity-20" />
                 <p className="font-mono text-sm uppercase tracking-wider">Select a Knowledge Base</p>
                 <p className="text-xs mt-2 max-w-sm">Choose a knowledge base from the sidebar to view and manage its indexed documents.</p>
               </div>
            </CardContent>
           </Card>
        </div>
      </div>
    </div>
  );
}