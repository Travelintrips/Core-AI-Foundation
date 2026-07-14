import {
  MousePointer2, Type, Image, Square, Circle, Minus, Frame,
  Hand, Grid3x3, Ruler,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import type { ToolType, ElementType } from "./types";

interface Props {
  activeTool: ToolType;
  onToolChange: (tool: ToolType) => void;
  showGrid: boolean;
  onToggleGrid: () => void;
  showGuides: boolean;
  onToggleGuides: () => void;
  onAddElement: (type: ElementType) => void;
}

const TOOLS: { tool: ToolType; icon: React.ReactNode; label: string; shortcut: string }[] = [
  { tool: "select", icon: <MousePointer2 className="h-4 w-4" />, label: "Select", shortcut: "V" },
  { tool: "hand", icon: <Hand className="h-4 w-4" />, label: "Pan", shortcut: "H" },
];

const SHAPE_TOOLS: { tool: ToolType; icon: React.ReactNode; label: string; shortcut: string }[] = [
  { tool: "text", icon: <Type className="h-4 w-4" />, label: "Text", shortcut: "T" },
  { tool: "rect", icon: <Square className="h-4 w-4" />, label: "Rectangle", shortcut: "R" },
  { tool: "circle", icon: <Circle className="h-4 w-4" />, label: "Ellipse", shortcut: "E" },
  { tool: "frame", icon: <Frame className="h-4 w-4" />, label: "Frame", shortcut: "F" },
  { tool: "line", icon: <Minus className="h-4 w-4" />, label: "Line", shortcut: "L" },
  { tool: "image", icon: <Image className="h-4 w-4" />, label: "Image", shortcut: "I" },
];

export function Toolbar({
  activeTool, onToolChange, showGrid, onToggleGrid,
  showGuides, onToggleGuides,
}: Props) {
  return (
    <div className="flex flex-col items-center gap-1 p-2 bg-white border-r border-gray-200 w-12">
      {TOOLS.map(({ tool, icon, label, shortcut }) => (
        <Tooltip key={tool}>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "h-8 w-8",
                activeTool === tool && "bg-indigo-100 text-indigo-700"
              )}
              onClick={() => onToolChange(tool)}
            >
              {icon}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            {label} <span className="text-xs opacity-60 ml-1">{shortcut}</span>
          </TooltipContent>
        </Tooltip>
      ))}

      <Separator className="my-1" />

      {SHAPE_TOOLS.map(({ tool, icon, label, shortcut }) => (
        <Tooltip key={tool}>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "h-8 w-8",
                activeTool === tool && "bg-indigo-100 text-indigo-700"
              )}
              onClick={() => onToolChange(tool)}
            >
              {icon}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            {label} <span className="text-xs opacity-60 ml-1">{shortcut}</span>
          </TooltipContent>
        </Tooltip>
      ))}

      <Separator className="my-1" />

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn("h-8 w-8", showGrid && "bg-indigo-100 text-indigo-700")}
            onClick={onToggleGrid}
          >
            <Grid3x3 className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">Toggle Grid</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn("h-8 w-8", showGuides && "bg-indigo-100 text-indigo-700")}
            onClick={onToggleGuides}
          >
            <Ruler className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">Toggle Guides</TooltipContent>
      </Tooltip>
    </div>
  );
}
