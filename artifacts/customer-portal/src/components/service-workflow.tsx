import { CheckCircle2, FileText, Brain, Palette, Image, PenLine, ShieldCheck, MessageSquare, RotateCcw, Package } from "lucide-react";
import { useTranslation } from "@/lib/i18n";

const WORKFLOW_STEPS = [
  {
    icon: FileText,
    label: "creativeBrief",
    description: "creativeBriefDesc",
    color: "text-blue-500",
    bg: "bg-blue-500/10",
  },
  {
    icon: Brain,
    label: "brandStrategy",
    description: "brandStrategyDesc",
    color: "text-violet-500",
    bg: "bg-violet-500/10",
  },
  {
    icon: Palette,
    label: "creativeDirection",
    description: "creativeDirectionDesc",
    color: "text-pink-500",
    bg: "bg-pink-500/10",
  },
  {
    icon: Image,
    label: "imageGeneration",
    description: "imageGenerationDesc",
    color: "text-orange-500",
    bg: "bg-orange-500/10",
  },
  {
    icon: PenLine,
    label: "copywriting",
    description: "copywritingDesc",
    color: "text-yellow-600",
    bg: "bg-yellow-500/10",
  },
  {
    icon: ShieldCheck,
    label: "qualityControl",
    description: "qualityControlDesc",
    color: "text-green-600",
    bg: "bg-green-500/10",
  },
  {
    icon: MessageSquare,
    label: "clientReview",
    description: "clientReviewDesc",
    color: "text-teal-500",
    bg: "bg-teal-500/10",
  },
  {
    icon: RotateCcw,
    label: "revision",
    description: "revisionDesc",
    color: "text-cyan-500",
    bg: "bg-cyan-500/10",
  },
  {
    icon: Package,
    label: "finalDelivery",
    description: "finalDeliveryDesc",
    color: "text-primary",
    bg: "bg-primary/10",
  },
];

export function ServiceWorkflow() {
  const { t } = useTranslation();
  return (
    <section>
      <div className="flex items-center gap-2 mb-6">
        <CheckCircle2 className="w-5 h-5 text-primary" />
        <h2 className="font-serif text-lg font-medium">{t("serviceDetail.workflow.title")}</h2>
        <span className="text-xs text-muted-foreground">{t("serviceDetail.workflow.subtitle")}</span>
      </div>

      <div className="relative">
        {/* Vertical connector line */}
        <div className="absolute left-5 top-6 bottom-6 w-0.5 bg-gradient-to-b from-blue-500/30 via-primary/20 to-primary/40 hidden sm:block" />

        <div className="space-y-4">
          {WORKFLOW_STEPS.map((step, i) => {
            const Icon = step.icon;
            const isLast = i === WORKFLOW_STEPS.length - 1;
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
                    <p className="font-medium text-sm">{t(`serviceDetail.workflow.${step.label}`)}</p>
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed pl-7">{t(`serviceDetail.workflow.${step.description}`)}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
