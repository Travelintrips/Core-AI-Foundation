import { useMemo, useState } from "react";
import { Gem, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { DesignScene, Embellishment } from "@/lib/ai-design-core";

interface Props {
  scene: DesignScene;
  onChange: (embellishments: Embellishment[]) => void;
}

export function FashionEmbellishmentEditor({ scene, onChange }: Props) {
  const parts = useMemo(() => scene.objects.filter(o => !o.locked), [scene.objects]);
  const [targetPartId, setTargetPartId] = useState(parts[0]?.id ?? "");
  const [type, setType] = useState<Embellishment["type"]>("bead");
  const [color, setColor] = useState("#ffffff");
  const [sizeMm, setSizeMm] = useState(4);
  const [density, setDensity] = useState(50);
  const [pattern, setPattern] = useState<Embellishment["pattern"]>("repeat");

  const add = () => {
    if (!targetPartId) return;
    const item: Embellishment = {
      id: crypto.randomUUID(),
      targetPartId, type, color,
      sizeMm: Math.max(0.5, sizeMm),
      density: Math.min(100, Math.max(0, density)),
      pattern,
    };
    onChange([...(scene.embellishments ?? []), item]);
  };

  return (
    <section className="rounded-xl border p-4 space-y-4">
      <div className="flex items-center gap-2 font-medium"><Gem className="h-4 w-4" /> Manik, Sequin & Bordir</div>
      <div className="grid md:grid-cols-5 gap-3">
        <div><Label>Bagian</Label><Select value={targetPartId} onValueChange={setTargetPartId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{parts.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select></div>
        <div><Label>Jenis</Label><Select value={type} onValueChange={v => setType(v as Embellishment["type"])}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["bead","sequin","embroidery","lace","button"].map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent></Select></div>
        <div><Label>Warna</Label><Input type="color" value={color} onChange={e => setColor(e.target.value)} /></div>
        <div><Label>Ukuran (mm)</Label><Input type="number" min={0.5} value={sizeMm} onChange={e => setSizeMm(Number(e.target.value))} /></div>
        <div><Label>Kepadatan %</Label><Input type="number" min={0} max={100} value={density} onChange={e => setDensity(Number(e.target.value))} /></div>
      </div>
      <div className="flex gap-3 items-end">
        <div className="w-52"><Label>Pola</Label><Select value={pattern} onValueChange={v => setPattern(v as Embellishment["pattern"])}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["free","repeat","mirror","radial","follow-edge"].map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent></Select></div>
        <Button onClick={add}><Plus className="h-4 w-4 mr-1" /> Tambah</Button>
      </div>
      <div className="space-y-2">
        {(scene.embellishments ?? []).map(e => (
          <div key={e.id} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
            <span>{e.type} · {parts.find(p => p.id === e.targetPartId)?.name ?? e.targetPartId} · {e.sizeMm}mm · {e.density}% · {e.pattern}</span>
            <Button size="icon" variant="ghost" onClick={() => onChange((scene.embellishments ?? []).filter(x => x.id !== e.id))}><Trash2 className="h-4 w-4" /></Button>
          </div>
        ))}
      </div>
    </section>
  );
}
