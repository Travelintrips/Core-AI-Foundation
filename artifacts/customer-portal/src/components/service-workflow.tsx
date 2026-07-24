import { CheckCircle2, FileText, Brain, Palette, Image, PenLine, ShieldCheck, MessageSquare, RotateCcw, Package, Sofa, Layout, Layers, BookOpen } from "lucide-react";

// ── Generic (brand/creative) pipeline steps ───────────────────────────────────

const GENERIC_WORKFLOW_STEPS = [
  {
    icon: FileText,
    label: "Creative Brief",
    description: "You submit your brand details, style preferences, and goals.",
    color: "text-blue-500",
    bg: "bg-blue-500/10",
  },
  {
    icon: Brain,
    label: "Brand Strategy",
    description: "AI Brand Strategist analyzes your market, competitors, and positioning.",
    color: "text-violet-500",
    bg: "bg-violet-500/10",
  },
  {
    icon: Palette,
    label: "Creative Direction",
    description: "Creative Director defines color palette, typography, and visual language.",
    color: "text-pink-500",
    bg: "bg-pink-500/10",
  },
  {
    icon: Image,
    label: "Image Generation",
    description: "AI Image Designer renders concepts at production resolution.",
    color: "text-orange-500",
    bg: "bg-orange-500/10",
  },
  {
    icon: PenLine,
    label: "Copywriting",
    description: "AI Copywriter crafts headlines, taglines, and supporting copy.",
    color: "text-yellow-600",
    bg: "bg-yellow-500/10",
  },
  {
    icon: ShieldCheck,
    label: "Quality Control",
    description: "Automated and human checks for consistency, accuracy, and brand fit.",
    color: "text-green-600",
    bg: "bg-green-500/10",
  },
  {
    icon: MessageSquare,
    label: "Client Review",
    description: "You review the deliverables and request revisions if needed.",
    color: "text-teal-500",
    bg: "bg-teal-500/10",
  },
  {
    icon: RotateCcw,
    label: "Revision",
    description: "Our team refines based on your feedback until you're satisfied.",
    color: "text-cyan-500",
    bg: "bg-cyan-500/10",
  },
  {
    icon: Package,
    label: "Final Delivery",
    description: "All production-ready files delivered in your required formats.",
    color: "text-primary",
    bg: "bg-primary/10",
  },
];

// ── Interior Design pipeline steps ───────────────────────────────────────────

const INTERIOR_WORKFLOW_STEPS = [
  {
    icon: FileText,
    label: "Interior Brief",
    description: "You submit space type, area, style preferences, and must-have features.",
    color: "text-blue-500",
    bg: "bg-blue-500/10",
  },
  {
    icon: Brain,
    label: "Design Concept",
    description: "Interior Concept Architect develops the overarching vision, theme, and mood board.",
    color: "text-violet-500",
    bg: "bg-violet-500/10",
  },
  {
    icon: Layout,
    label: "Space Planning",
    description: "Space Planner maps optimal layouts — circulation zones, functional areas, and proportions.",
    color: "text-pink-500",
    bg: "bg-pink-500/10",
  },
  {
    icon: Layers,
    label: "Material Specification",
    description: "Material Specialist curates finishes, textures, and furniture within your budget and style.",
    color: "text-orange-500",
    bg: "bg-orange-500/10",
  },
  {
    icon: PenLine,
    label: "Design Copy",
    description: "Interior Copywriter crafts space descriptions, concept narrative, and presentation documents.",
    color: "text-yellow-600",
    bg: "bg-yellow-500/10",
  },
  {
    icon: ShieldCheck,
    label: "Quality Control",
    description: "Design consistency, budget compliance, and document readiness checked before delivery.",
    color: "text-green-600",
    bg: "bg-green-500/10",
  },
  {
    icon: MessageSquare,
    label: "Client Review",
    description: "You review the interior concept document and request revisions if needed.",
    color: "text-teal-500",
    bg: "bg-teal-500/10",
  },
  {
    icon: RotateCcw,
    label: "Revision",
    description: "Our team refines the concept based on your feedback.",
    color: "text-cyan-500",
    bg: "bg-cyan-500/10",
  },
  {
    icon: Sofa,
    label: "Final Delivery",
    description: "Interior concept document, material palette, and spatial narrative delivered.",
    color: "text-primary",
    bg: "bg-primary/10",
  },
];

// ── Service code → steps mapping ──────────────────────────────────────────────

const INTERIOR_SERVICE_CODES = new Set(["interior-design", "interior-concept-design"]);

function getWorkflowSteps(serviceCode?: string) {
  if (serviceCode && INTERIOR_SERVICE_CODES.has(serviceCode)) {
    return INTERIOR_WORKFLOW_STEPS;
  }
  return GENERIC_WORKFLOW_STEPS;
}

// ── Component ─────────────────────────────────────────────────────────────────

interface ServiceWorkflowProps {
  /** Optional catalog serviceCode to show service-specific steps. */
  serviceCode?: string;
}

export function ServiceWorkflow({ serviceCode }: ServiceWorkflowProps = {}) {
  const steps = getWorkflowSteps(serviceCode);

  return (
    <section>
      <div className="flex items-center gap-2 mb-6">
        <CheckCircle2 className="w-5 h-5 text-primary" />
        <h2 className="font-serif text-lg font-medium">How It Works</h2>
        <span className="text-xs text-muted-foreground">AI-powered, human-reviewed</span>
      </div>

      <div className="relative">
        {/* Vertical connector line */}
        <div className="absolute left-5 top-6 bottom-6 w-0.5 bg-gradient-to-b from-blue-500/30 via-primary/20 to-primary/40 hidden sm:block" />

        <div className="space-y-4">
          {steps.map((step, i) => {
            const Icon = step.icon;
            const isLast = i === steps.length - 1;
            return (
              <div key={i} className="flex items-start gap-4 relative">
                {/* Icon node */}
                <div className={`relative z-10 shrink-0 w-10 h-10 rounded-full ${step.bg} flex items-center justify-center border border-border bg-background`}>
                  <Icon className={`w-4 h-4 ${step.color}`} />
                </div>
                {/* Content */}
                <div className={`flex-1 pb-2 ${isLast ? "" : "border-b border-border/40"}`}>
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-mono text-muted-foreground/60 w-5">{String(i + 1).padStart(2, "0")}</span>
                    <p className="font-medium text-sm">{step.label}</p>
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed pl-7">{step.description}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
