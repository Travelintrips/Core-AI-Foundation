import { useState } from "react";
import { useListSettings } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Settings2, Eye, EyeOff, Edit2 } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";

export default function Settings() {
  const { data: settings, isLoading } = useListSettings();
  const [visibleSecrets, setVisibleSecrets] = useState<Record<string, boolean>>({});

  const toggleSecret = (key: string) => {
    setVisibleSecrets(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const groupedSettings = settings?.reduce((acc, setting) => {
    const cat = setting.category || 'general';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(setting);
    return acc;
  }, {} as Record<string, typeof settings>);

  return (
    <div className="p-8 max-w-[1600px] mx-auto space-y-8 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Platform Settings</h1>
          <p className="text-muted-foreground mt-1">Global configuration and environment variables.</p>
        </div>
      </div>

      <div className="space-y-8">
        {isLoading ? (
           <div className="py-12 text-center text-muted-foreground font-mono text-sm border border-border/50 rounded-lg bg-card/50 backdrop-blur">Loading configuration...</div>
        ) : settings?.length === 0 ? (
           <div className="py-12 text-center text-muted-foreground font-mono text-sm border border-border/50 rounded-lg bg-card/50 backdrop-blur">No settings configured.</div>
        ) : (
          Object.entries(groupedSettings || {}).map(([category, items]) => (
            <Card key={category} className="border-border/50 bg-card/50 backdrop-blur">
              <CardHeader className="pb-4 border-b border-border/50">
                <CardTitle className="text-sm font-medium font-mono uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                  <Settings2 className="size-4" /> {category} Config
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border/50 hover:bg-transparent">
                      <TableHead className="w-[30%] font-mono text-xs uppercase text-muted-foreground pl-6">Key</TableHead>
                      <TableHead className="w-[50%] font-mono text-xs uppercase text-muted-foreground">Value</TableHead>
                      <TableHead className="w-[10%] font-mono text-xs uppercase text-muted-foreground text-center">Type</TableHead>
                      <TableHead className="w-[10%] font-mono text-xs uppercase text-muted-foreground text-right pr-6"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((setting) => (
                      <TableRow key={setting.id} className="border-border/50 group hover:bg-secondary/30">
                        <TableCell className="pl-6">
                          <div className="flex flex-col gap-1">
                            <span className="font-mono text-xs font-bold text-foreground">{setting.key}</span>
                            {setting.description && <span className="text-[10px] text-muted-foreground">{setting.description}</span>}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2 max-w-[400px]">
                            {setting.isSecret && !visibleSecrets[setting.key] ? (
                              <div className="font-mono text-xs text-muted-foreground tracking-widest bg-background/50 px-2 py-1 rounded border border-border/50 flex-1">
                                ••••••••••••••••
                              </div>
                            ) : (
                              <div className="font-mono text-xs text-foreground bg-background/50 px-2 py-1 rounded border border-border/50 flex-1 truncate">
                                {setting.value}
                              </div>
                            )}
                            {setting.isSecret && (
                              <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground" onClick={() => toggleSecret(setting.key)}>
                                {visibleSecrets[setting.key] ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
                              </Button>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="outline" className="font-mono text-[10px] uppercase border-border/50 text-muted-foreground bg-background/50">
                            {setting.valueType}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right pr-6">
                          <Button variant="ghost" size="icon" className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Edit2 className="size-3 text-muted-foreground hover:text-foreground" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}