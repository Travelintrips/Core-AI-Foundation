import { useState } from "react";
import { useListOrchestratorSessions, useOrchestratorExecute, useListModels } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Play, Terminal, Zap, MessageSquare, Loader2, Clock, Hash, Badge } from "lucide-react";
import { format } from "date-fns";

export default function Orchestrator() {
  const { data: sessions, isLoading: sessionsLoading } = useListOrchestratorSessions();
  const { data: models } = useListModels();
  const executeMutation = useOrchestratorExecute();

  const [prompt, setPrompt] = useState("");
  const [selectedModelId, setSelectedModelId] = useState<string>("auto");
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  
  const [history, setHistory] = useState<{role: 'user' | 'assistant', content: string, meta?: any}[]>([]);

  const handleExecute = async () => {
    if (!prompt.trim() || executeMutation.isPending) return;

    const userMessage = prompt;
    setHistory(prev => [...prev, { role: 'user', content: userMessage }]);
    setPrompt("");

    try {
      const result = await executeMutation.mutateAsync({
        data: {
          prompt: userMessage,
          modelId: selectedModelId === "auto" ? null : parseInt(selectedModelId),
          sessionId: activeSessionId
        }
      });

      if (!activeSessionId) {
        setActiveSessionId(result.sessionId);
      }

      setHistory(prev => [...prev, { 
        role: 'assistant', 
        content: result.content,
        meta: {
          model: result.modelUsed,
          tokens: result.tokensUsed,
          latency: result.latencyMs
        }
      }]);
    } catch (error) {
      console.error("Execution failed:", error);
      setHistory(prev => [...prev, { role: 'assistant', content: "Error executing request. Check console." }]);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleExecute();
    }
  };

  return (
    <div className="p-8 max-w-[1600px] mx-auto space-y-8 animate-in fade-in duration-500 h-[calc(100vh-2rem)] flex flex-col">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Orchestrator</h1>
        <p className="text-muted-foreground mt-1">Interactive playground and request router.</p>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-4 gap-6 min-h-0">
        
        {/* Chat / Interaction Area */}
        <Card className="col-span-1 lg:col-span-3 border-border/50 bg-card/50 backdrop-blur flex flex-col">
          <CardHeader className="border-b border-border/50 pb-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium font-mono uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <Terminal className="size-4" /> Console
                {activeSessionId && <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded ml-2">{activeSessionId.substring(0,8)}</span>}
              </CardTitle>
              <div className="flex items-center gap-4">
                <Select value={selectedModelId} onValueChange={setSelectedModelId}>
                  <SelectTrigger className="w-[200px] h-8 bg-background/50 font-mono text-xs border-border/50">
                    <SelectValue placeholder="Select routing..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto" className="font-mono text-xs text-primary font-bold">Auto-Route (Best)</SelectItem>
                    {models?.filter(m => m.isActive).map(m => (
                      <SelectItem key={m.id} value={m.id.toString()} className="font-mono text-xs">{m.providerName} / {m.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="outline" size="sm" className="h-8 font-mono text-xs" onClick={() => { setHistory([]); setActiveSessionId(null); }}>Clear</Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex-1 overflow-hidden p-0 relative flex flex-col">
            <ScrollArea className="flex-1 p-6">
              {history.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-muted-foreground opacity-50 mt-32">
                  <Zap className="size-12 mb-4 text-primary" />
                  <p className="font-mono text-sm uppercase tracking-wider">Awaiting Input</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {history.map((msg, i) => (
                    <div key={i} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                      <div className={`max-w-[80%] rounded-lg p-4 ${msg.role === 'user' ? 'bg-primary/20 border border-primary/30 text-foreground' : 'bg-secondary/50 border border-border/50 text-foreground'}`}>
                        <pre className="whitespace-pre-wrap font-sans text-sm">{msg.content}</pre>
                      </div>
                      {msg.meta && (
                        <div className="flex items-center gap-3 mt-2 text-[10px] font-mono text-muted-foreground px-1">
                          <span className="flex items-center gap-1"><Code2 className="size-3" /> {msg.meta.model}</span>
                          <span className="flex items-center gap-1"><Hash className="size-3" /> {msg.meta.tokens} tkns</span>
                          <span className="flex items-center gap-1"><Clock className="size-3" /> {msg.meta.latency}ms</span>
                        </div>
                      )}
                    </div>
                  ))}
                  {executeMutation.isPending && (
                    <div className="flex items-start">
                       <div className="bg-secondary/20 border border-border/30 rounded-lg p-4 flex items-center gap-3">
                          <Loader2 className="size-4 animate-spin text-primary" />
                          <span className="font-mono text-xs text-muted-foreground animate-pulse">Executing via routing layer...</span>
                       </div>
                    </div>
                  )}
                </div>
              )}
            </ScrollArea>
          </CardContent>
          <CardFooter className="border-t border-border/50 p-4 bg-background/20">
            <div className="relative w-full flex items-end gap-2">
              <Textarea 
                placeholder="Enter prompt..." 
                className="min-h-[80px] w-full resize-none font-mono text-sm bg-background/50 focus-visible:ring-primary/50"
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={executeMutation.isPending}
              />
              <Button 
                className="h-[80px] w-[80px] shrink-0 font-mono text-xs uppercase tracking-wider" 
                onClick={handleExecute}
                disabled={!prompt.trim() || executeMutation.isPending}
              >
                {executeMutation.isPending ? <Loader2 className="size-5 animate-spin" /> : <Play className="size-5" />}
              </Button>
            </div>
          </CardFooter>
        </Card>

        {/* Sessions Sidebar */}
        <Card className="border-border/50 bg-card/50 backdrop-blur flex flex-col">
          <CardHeader className="border-b border-border/50 pb-4">
            <CardTitle className="text-sm font-medium font-mono uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <MessageSquare className="size-4" /> Recent Sessions
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 flex-1 overflow-hidden">
            <ScrollArea className="h-full">
              {sessionsLoading ? (
                <div className="p-4 text-center text-muted-foreground font-mono text-xs">Loading sessions...</div>
              ) : sessions?.length === 0 ? (
                <div className="p-4 text-center text-muted-foreground font-mono text-xs">No recent sessions</div>
              ) : (
                <div className="divide-y divide-border/50">
                  {sessions?.map(session => (
                    <div 
                      key={session.id} 
                      className={`p-4 hover:bg-secondary/30 cursor-pointer transition-colors ${activeSessionId === session.sessionId ? 'bg-secondary/50 border-l-2 border-l-primary' : ''}`}
                      onClick={() => setActiveSessionId(session.sessionId)}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-mono text-xs text-foreground truncate">{session.sessionId.substring(0,8)}</span>
                        <span className="font-mono text-[10px] text-muted-foreground">{format(new Date(session.createdAt), 'MMM d, HH:mm')}</span>
                      </div>
                      <div className="flex items-center gap-2 text-[10px] font-mono">
                        <Badge variant="outline" className="border-primary/20 text-primary bg-primary/5 text-[8px] px-1 h-4">{session.lastModelUsed || 'auto'}</Badge>
                        <span className="text-muted-foreground">{session.totalRequests} reqs</span>
                        <span className="text-muted-foreground">{session.totalTokens} tkns</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

      </div>
    </div>
  );
}

// Icon helper since lucide doesn't export Code2 in the specific version it seems, fallback to Terminal or something similar if needed
function Code2(props: any) {
  return <Terminal {...props} />
}