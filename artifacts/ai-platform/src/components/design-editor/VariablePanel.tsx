/**
 * VariablePanel — manage template variables (add, edit, delete, view sample data).
 */

import { useState } from "react";
import { Plus, Trash2, AlertTriangle, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useEditorState, useEditorDispatch } from "@/state/design-editor/context";
import type { TemplateVariable, TemplateVariableType } from "@/state/design-editor/types";

const VARIABLE_TYPES: { value: TemplateVariableType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "currency", label: "Currency" },
  { value: "image", label: "Image URL" },
  { value: "color", label: "Color" },
  { value: "url", label: "URL" },
  { value: "date", label: "Date" },
  { value: "boolean", label: "Boolean" },
];

function isKeyUsed(key: string, elements: any[]): boolean {
  return elements.some((el) => {
    const check = (val: any): boolean => {
      if (!val) return false;
      if (typeof val === "object" && val.binding?.variableKey === key) return true;
      if (typeof val === "object") return Object.values(val).some(check);
      return false;
    };
    return check(el);
  });
}

function isValidKey(key: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key);
}

interface AddVariableFormProps {
  onAdd: (v: TemplateVariable) => void;
  existingKeys: string[];
}

function AddVariableForm({ onAdd, existingKeys }: AddVariableFormProps) {
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [type, setType] = useState<TemplateVariableType>("text");
  const [required, setRequired] = useState(false);
  const [error, setError] = useState("");

  const submit = () => {
    if (!key.trim()) { setError("Key required"); return; }
    if (!isValidKey(key)) { setError("Key must be letters, numbers, underscore (start with letter/_)"); return; }
    if (existingKeys.includes(key)) { setError("Key already exists"); return; }
    onAdd({ key, label: label || key, type, required });
    setKey(""); setLabel(""); setType("text"); setRequired(false); setError("");
  };

  return (
    <div className="p-3 space-y-2" style={{ borderBottom: "1px solid #1E3057" }}>
      <p className="text-[10px] font-semibold uppercase tracking-widest text-[#4F6494]">Add Variable</p>
      <Input
        placeholder="variable_key"
        value={key}
        onChange={(e) => { setKey(e.target.value); setError(""); }}
        className="h-7 text-xs bg-[#060B18] border-[#1E3057] text-[#F0F4FF]"
      />
      <Input
        placeholder="Display Label"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        className="h-7 text-xs bg-[#060B18] border-[#1E3057] text-[#F0F4FF]"
      />
      <Select value={type} onValueChange={(v) => setType(v as TemplateVariableType)}>
        <SelectTrigger className="h-7 text-xs bg-[#060B18] border-[#1E3057] text-[#F0F4FF]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {VARIABLE_TYPES.map((t) => (
            <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="req"
          checked={required}
          onChange={(e) => setRequired(e.target.checked)}
          className="rounded"
        />
        <Label htmlFor="req" className="text-xs text-[#8899BB] cursor-pointer">Required</Label>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <Button
        size="sm" className="w-full h-7 text-xs gap-1" style={{ background: "#7C6EFA" }}
        onClick={submit}
      >
        <Plus className="size-3" /> Add Variable
      </Button>
    </div>
  );
}

export function VariablePanel() {
  const state = useEditorState();
  const dispatch = useEditorDispatch();
  const [deleteKey, setDeleteKey] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);

  const isUsed = (key: string) => isKeyUsed(key, state.elements);

  const handleAdd = (v: TemplateVariable) => dispatch({ type: "ADD_VARIABLE", variable: v });

  const handleDelete = (key: string) => {
    dispatch({ type: "DELETE_VARIABLE", key });
    setDeleteKey(null);
  };

  const variableInUse = deleteKey ? isUsed(deleteKey) : false;

  return (
    <div className="flex flex-col h-full">
      <AddVariableForm
        onAdd={handleAdd}
        existingKeys={state.variables.map((v) => v.key)}
      />

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {state.variables.length === 0 && (
            <p className="text-xs text-[#4F6494] text-center py-4">No variables defined</p>
          )}
          {state.variables.map((v) => (
            <Collapsible key={v.key}>
              <CollapsibleTrigger className="w-full">
                <div className="flex items-center gap-1.5 px-2 py-1.5 rounded text-xs text-[#8899BB] hover:bg-[#0D1528] group cursor-pointer">
                  <ChevronDown className="size-3 shrink-0" />
                  <span className="font-mono text-[#9D91FB] shrink-0">{v.key}</span>
                  <Badge variant="outline" className="text-[9px] h-3.5 px-1 border-[#1E3057]">
                    {v.type}
                  </Badge>
                  {v.required && (
                    <Badge className="text-[9px] h-3.5 px-1 bg-amber-900/40 text-amber-400 border-amber-700">
                      req
                    </Badge>
                  )}
                  {isUsed(v.key) && (
                    <Badge className="text-[9px] h-3.5 px-1 bg-green-900/40 text-green-400 border-green-700">
                      used
                    </Badge>
                  )}
                  <div className="flex-1" />
                  <Button
                    variant="ghost" size="sm"
                    className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300"
                    onClick={(e) => { e.stopPropagation(); setDeleteKey(v.key); }}
                  >
                    <Trash2 className="size-2.5" />
                  </Button>
                </div>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="px-3 pb-2 space-y-1.5">
                  <div className="flex gap-2 items-center">
                    <Label className="text-[10px] text-[#4F6494] w-12 shrink-0">Label</Label>
                    <Input
                      value={v.label}
                      onChange={(e) =>
                        dispatch({ type: "UPDATE_VARIABLE", key: v.key, patch: { label: e.target.value } })
                      }
                      className="h-6 text-xs bg-[#060B18] border-[#1E3057] text-[#F0F4FF] flex-1"
                    />
                  </div>
                  <div className="flex gap-2 items-center">
                    <Label className="text-[10px] text-[#4F6494] w-12 shrink-0">Default</Label>
                    <Input
                      value={String(v.defaultValue ?? "")}
                      onChange={(e) =>
                        dispatch({ type: "UPDATE_VARIABLE", key: v.key, patch: { defaultValue: e.target.value } })
                      }
                      placeholder="(optional)"
                      className="h-6 text-xs bg-[#060B18] border-[#1E3057] text-[#F0F4FF] flex-1"
                    />
                  </div>
                  {/* Sample data */}
                  <div className="flex gap-2 items-center">
                    <Label className="text-[10px] text-[#4F6494] w-12 shrink-0">Sample</Label>
                    <Input
                      value={String(state.sampleData[v.key] ?? "")}
                      onChange={(e) =>
                        dispatch({
                          type: "SET_SAMPLE_DATA",
                          data: { ...state.sampleData, [v.key]: e.target.value },
                        })
                      }
                      placeholder="preview value"
                      className="h-6 text-xs bg-[#060B18] border-[#1E3057] text-[#F0F4FF] flex-1"
                    />
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
          ))}
        </div>
      </ScrollArea>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteKey} onOpenChange={(o) => !o && setDeleteKey(null)}>
        <AlertDialogContent className="bg-[#0A1020] border-[#1E3057]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[#F0F4FF]">Delete Variable</AlertDialogTitle>
            <AlertDialogDescription className="text-[#8899BB]">
              {variableInUse && (
                <span className="flex items-center gap-2 text-amber-400 mb-2">
                  <AlertTriangle className="size-4" />
                  This variable is <strong>currently bound to elements</strong>. Deleting it will break those bindings.
                </span>
              )}
              Are you sure you want to delete <code className="text-[#9D91FB]">{deleteKey}</code>?
              This cannot be undone directly (use Undo to restore).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-[#1E3057] text-[#8899BB]">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-700 hover:bg-red-600 text-white"
              onClick={() => deleteKey && handleDelete(deleteKey)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
