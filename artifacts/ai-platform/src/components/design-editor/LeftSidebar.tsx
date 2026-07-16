/**
 * LeftSidebar — tab-based panel for adding elements, managing variables, layers, canvas.
 */

import { useState } from "react";
import {
  Type, Image as ImageIcon, Square, Minus, QrCode,
  List, Layers, Settings2, Variable,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useEditorState, useEditorDispatch } from "@/state/design-editor/context";
import { LayerList } from "./LayerList";
import { VariablePanel } from "./VariablePanel";
import { CanvasSettingsPanel } from "./CanvasSettingsPanel";
import {
  createTextElement, createImageElement, createShapeElement,
  createQrElement, createLineElement, nextZIndexFromList,
} from "@/utils/design-editor/elementFactory";

function ElementButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex flex-col items-center gap-1.5 p-3 rounded-lg border text-xs transition-colors cursor-pointer",
        "border-[#1E3057] text-[#8899BB] hover:border-[#7C6EFA] hover:text-[#9D91FB] hover:bg-[#0D1528]",
      )}
    >
      <Icon className="size-5" />
      {label}
    </button>
  );
}

export function LeftSidebar() {
  const state = useEditorState();
  const dispatch = useEditorDispatch();

  const nextZ = () => nextZIndexFromList(state.elements);

  const addText = () =>
    dispatch({
      type: "ADD_ELEMENT",
      element: createTextElement(state.canvas.width, state.canvas.height, nextZ()),
    });

  const addImage = () =>
    dispatch({
      type: "ADD_ELEMENT",
      element: createImageElement(state.canvas.width, state.canvas.height, nextZ()),
    });

  const addRect = () =>
    dispatch({
      type: "ADD_ELEMENT",
      element: createShapeElement(state.canvas.width, state.canvas.height, nextZ(), "rectangle"),
    });

  const addCircle = () =>
    dispatch({
      type: "ADD_ELEMENT",
      element: createShapeElement(state.canvas.width, state.canvas.height, nextZ(), "circle"),
    });

  const addRoundedRect = () =>
    dispatch({
      type: "ADD_ELEMENT",
      element: createShapeElement(state.canvas.width, state.canvas.height, nextZ(), "rounded-rectangle"),
    });

  const addQr = () =>
    dispatch({
      type: "ADD_ELEMENT",
      element: createQrElement(state.canvas.width, state.canvas.height, nextZ()),
    });

  const addLine = () =>
    dispatch({
      type: "ADD_ELEMENT",
      element: createLineElement(state.canvas.width, state.canvas.height, nextZ()),
    });

  return (
    <aside
      className="w-56 flex flex-col flex-shrink-0"
      style={{ background: "#0A1020", borderRight: "1px solid #1E3057" }}
    >
      <Tabs defaultValue="elements" className="flex flex-col h-full">
        <TabsList
          className="grid grid-cols-4 h-9 rounded-none mx-0 px-1 gap-0.5 shrink-0"
          style={{ background: "#0A1020", borderBottom: "1px solid #1E3057" }}
        >
          <TabsTrigger value="elements" className="text-[10px] px-0 data-[state=active]:bg-[#1E3057]">
            <Square className="size-3" />
          </TabsTrigger>
          <TabsTrigger value="layers" className="text-[10px] px-0 data-[state=active]:bg-[#1E3057]">
            <Layers className="size-3" />
          </TabsTrigger>
          <TabsTrigger value="variables" className="text-[10px] px-0 data-[state=active]:bg-[#1E3057]">
            <Variable className="size-3" />
          </TabsTrigger>
          <TabsTrigger value="canvas" className="text-[10px] px-0 data-[state=active]:bg-[#1E3057]">
            <Settings2 className="size-3" />
          </TabsTrigger>
        </TabsList>

        {/* Elements tab */}
        <TabsContent value="elements" className="flex-1 overflow-hidden mt-0">
          <ScrollArea className="h-full">
            <div className="p-3 space-y-3">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-[#4F6494]">Text</p>
              <div className="grid grid-cols-2 gap-2">
                <ElementButton icon={Type} label="Text" onClick={addText} />
              </div>

              <p className="text-[10px] font-semibold uppercase tracking-widest text-[#4F6494]">Media</p>
              <div className="grid grid-cols-2 gap-2">
                <ElementButton icon={ImageIcon} label="Image" onClick={addImage} />
                <ElementButton icon={QrCode} label="QR Code" onClick={addQr} />
              </div>

              <p className="text-[10px] font-semibold uppercase tracking-widest text-[#4F6494]">Shapes</p>
              <div className="grid grid-cols-2 gap-2">
                <ElementButton icon={Square} label="Rectangle" onClick={addRect} />
                <ElementButton icon={Square} label="Rounded" onClick={addRoundedRect} />
                <ElementButton icon={Square} label="Circle" onClick={addCircle} />
                <ElementButton icon={Minus} label="Line" onClick={addLine} />
              </div>
            </div>
          </ScrollArea>
        </TabsContent>

        {/* Layers tab */}
        <TabsContent value="layers" className="flex-1 overflow-hidden mt-0">
          <LayerList />
        </TabsContent>

        {/* Variables tab */}
        <TabsContent value="variables" className="flex-1 overflow-hidden mt-0">
          <VariablePanel />
        </TabsContent>

        {/* Canvas settings tab */}
        <TabsContent value="canvas" className="flex-1 overflow-hidden mt-0">
          <CanvasSettingsPanel />
        </TabsContent>
      </Tabs>
    </aside>
  );
}
