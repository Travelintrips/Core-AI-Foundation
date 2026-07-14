/**
 * Phase 4A — Brief Assistant: Main Panel
 *
 * Desktop: right-side drawer (fixed, 420px)
 * Mobile:  full-screen overlay
 *
 * Orchestrates all stages through useAssistantSession.
 * Only onBriefChange (triggered by applyAnswer) mutates the brief.
 * Opening / mode-select / skip never touch the brief.
 *
 * Accessibility:
 *   - focus trap via autoFocus on panel
 *   - Escape closes
 *   - live region for answer results
 *   - heading hierarchy maintained
 */

import { memo, useCallback, useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BriefData } from "@/pages/brief";
import type { ServiceType, BriefSectionConfig } from "@/config/brief-service-config";
import { BriefRecommendationPanel } from "@/features/brief-intelligence";

import { useAssistantSession } from "../assistant-session";
import type { AssistantEventHandler, AssistantMode } from "../types";
import { AssistantHeader } from "./AssistantHeader";
import { AssistantMessage } from "./AssistantMessage";
import { AssistantQuestion } from "./AssistantQuestion";
import { AssistantChangePreview } from "./AssistantChangePreview";
import { AssistantReview } from "./AssistantReview";
import { AssistantCompletionSummary } from "./AssistantCompletionSummary";

// ── Props ──────────────────────────────────────────────────────────────────────

interface BriefAssistantPanelProps {
  requestId: string;
  brief: BriefData;
  serviceType: ServiceType;
  serviceConfig: BriefSectionConfig;
  onBriefChange: (newBrief: BriefData) => void;
  onClose: () => void;
  onEvent?: AssistantEventHandler;
}

// ── Mode start menu ────────────────────────────────────────────────────────────

const MODES: { mode: AssistantMode; label: string; description: string; icon: string }[] = [
  {
    mode: "start-from-beginning",
    label: "Bantu isi dari awal",
    description: "Ikuti pertanyaan singkat. Jawaban lama tidak akan ditimpa tanpa konfirmasi.",
    icon: "✏️",
  },
  {
    mode: "complete-missing",
    label: "Lengkapi bagian yang kosong",
    description: "Hanya menanyakan field yang belum diisi.",
    icon: "🔍",
  },
  {
    mode: "show-recommendations",
    label: "Tampilkan rekomendasi",
    description: "Lihat rekomendasi dari Brief Intelligence Engine.",
    icon: "✨",
  },
];

// ── Component ──────────────────────────────────────────────────────────────────

export const BriefAssistantPanel = memo(function BriefAssistantPanel({
  requestId,
  brief,
  serviceType,
  serviceConfig,
  onBriefChange,
  onClose,
  onEvent,
}: BriefAssistantPanelProps) {
  const session = useAssistantSession({
    requestId,
    brief,
    serviceType,
    serviceConfig,
    onBriefChange,
    onEvent,
  });

  const { state, currentQuestion, totalQuestions, currentQuestionIndex } = session;
  const panelRef = useRef<HTMLDivElement>(null);
  const appliedCountRef = useRef(0);

  // Track applied answers for completion summary
  const prevAnsweredLen = useRef(state.answeredQuestionIds.length);
  if (state.answeredQuestionIds.length > prevAnsweredLen.current) {
    appliedCountRef.current += state.answeredQuestionIds.length - prevAnsweredLen.current;
    prevAnsweredLen.current = state.answeredQuestionIds.length;
  }

  // Escape to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  // Focus panel on mount
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  const handleAnswer = useCallback(
    (selectedKeys: string[], customText: string) => {
      if (!state.currentQuestionId) return;
      session.draftAnswer({
        field: state.currentQuestionId as keyof BriefData,
        selectedKeys,
        customText,
      });
    },
    [session, state.currentQuestionId],
  );

  // ── Stage rendering ────────────────────────────────────────────────────────

  function renderBody() {
    const { stage, mode, pendingChange, skippedQuestionIds } = state;

    // ── Show recommendations mode ────────────────────────────────────────────
    if (mode === "show-recommendations") {
      return (
        <div className="space-y-4">
          <AssistantMessage>
            Berikut rekomendasi Brief Intelligence Engine berdasarkan brief Anda.
          </AssistantMessage>
          <BriefRecommendationPanel
            brief={brief}
            serviceName={serviceType}
            onApply={onBriefChange}
          />
          <div className="flex justify-end pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground border border-border/50 transition-colors"
            >
              Kembali ke brief
            </button>
          </div>
        </div>
      );
    }

    // ── Idle: mode selection ─────────────────────────────────────────────────
    if (stage === "idle" || mode === null) {
      return (
        <div className="space-y-4">
          <AssistantMessage>
            <p>
              Saya akan membantu melengkapi brief Anda melalui beberapa pertanyaan singkat.
            </p>
            <p className="mt-1.5 text-muted-foreground text-xs">
              Pilihan yang sudah Anda isi tidak akan diganti tanpa persetujuan.
            </p>
          </AssistantMessage>

          <div className="space-y-2 pl-10" role="group" aria-label="Pilih mode asisten">
            {MODES.map((m) => (
              <button
                key={m.mode}
                type="button"
                onClick={() => session.selectMode(m.mode)}
                className={cn(
                  "w-full text-left px-4 py-3.5 rounded-xl",
                  "border border-border/60 bg-card/40 hover:bg-card hover:border-primary/40",
                  "transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
                  "min-h-[44px]",
                )}
              >
                <div className="flex items-start gap-3">
                  <span className="text-lg shrink-0 mt-0.5" aria-hidden>{m.icon}</span>
                  <div>
                    <p className="text-sm font-medium text-foreground">{m.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{m.description}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      );
    }

    // ── Intro ────────────────────────────────────────────────────────────────
    if (stage === "intro") {
      const modeLabel = MODES.find((m) => m.mode === mode)?.label ?? "";
      return (
        <div className="space-y-4">
          <AssistantMessage>
            <p className="font-medium">Mode: {modeLabel}</p>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {mode === "complete-missing"
                ? "Saya hanya akan menanyakan field yang belum Anda isi."
                : "Saya akan menanyakan semua field penting. Jika sudah ada jawaban, Anda bisa memilih untuk mempertahankan atau mengganti."}
            </p>
            <p className="mt-1.5 text-xs text-muted-foreground/70">
              Setiap jawaban akan tampil sebagai pratinjau sebelum diterapkan.
            </p>
          </AssistantMessage>
          <div className="pl-10">
            <button
              type="button"
              onClick={() => session.state.currentQuestionId
                ? undefined
                : session.selectMode(mode)}
              className={cn(
                "px-5 py-2.5 rounded-xl text-sm font-medium",
                "bg-primary text-primary-foreground hover:bg-primary/90",
                "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
                "min-h-[44px]",
              )}
            >
              Mulai
            </button>
          </div>
        </div>
      );
    }

    // ── Preview (pending change) ──────────────────────────────────────────────
    if (stage === "preview" && pendingChange) {
      return (
        <AssistantChangePreview
          change={pendingChange}
          onApply={(mergeMode) => session.applyAnswer(mergeMode)}
          onEdit={session.editDraft}
          onSkip={session.skipQuestion}
        />
      );
    }

    // ── Question ─────────────────────────────────────────────────────────────
    if (stage === "question") {
      if (!currentQuestion) {
        // All questions answered — auto-advance to review happens in the hook
        return (
          <AssistantMessage>
            <p>Semua pertanyaan sudah dijawab. Menampilkan ringkasan...</p>
          </AssistantMessage>
        );
      }
      return (
        <AssistantQuestion
          question={currentQuestion}
          onAnswer={handleAnswer}
          onSkip={session.skipQuestion}
        />
      );
    }

    // ── Review ───────────────────────────────────────────────────────────────
    if (stage === "review") {
      return (
        <AssistantReview
          brief={brief}
          skippedQuestionIds={state.skippedQuestionIds}
          onComplete={session.complete}
          onClose={onClose}
        />
      );
    }

    // ── Complete ─────────────────────────────────────────────────────────────
    if (stage === "complete") {
      return (
        <AssistantCompletionSummary
          appliedCount={appliedCountRef.current}
          skippedCount={state.skippedQuestionIds.length}
          onClose={onClose}
          onReset={session.reset}
        />
      );
    }

    return null;
  }

  // ── Layout ─────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Backdrop (mobile / overlay) */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden"
        onClick={onClose}
        aria-hidden
      />

      {/* Panel */}
      <motion.div
        ref={panelRef}
        initial={{ x: "100%", opacity: 0.8 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: "100%", opacity: 0.8 }}
        transition={{ type: "spring", damping: 30, stiffness: 350 }}
        tabIndex={-1}
        role="dialog"
        aria-label="Asisten Brief"
        aria-modal="true"
        className={cn(
          // Desktop: right drawer
          "fixed inset-y-0 right-0 z-50",
          "w-full md:w-[440px]",
          "flex flex-col",
          "bg-background border-l border-border/60",
          "shadow-2xl",
          "focus:outline-none",
        )}
      >
        {/* Header */}
        <AssistantHeader
          stage={state.stage}
          mode={state.mode}
          currentIndex={currentQuestionIndex}
          total={totalQuestions}
          onClose={onClose}
          onReset={session.reset}
        />

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto overscroll-contain">
          <div className="p-4 space-y-4">
            <AnimatePresence mode="wait">
              <motion.div
                key={`${state.stage}-${state.currentQuestionId ?? "none"}`}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.18 }}
              >
                {renderBody()}
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Live region for SR announcements */}
          <div aria-live="polite" aria-atomic className="sr-only" id="assistant-live-region" />
        </div>

        {/* Bottom: review shortcut (when in question/preview stages) */}
        {(state.stage === "question" || state.stage === "preview") && (
          <div className="border-t border-border/40 px-4 py-3 bg-background/95 backdrop-blur-sm shrink-0">
            <button
              type="button"
              onClick={session.goToReview}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5"
            >
              <Sparkles className="w-3 h-3" />
              Lihat ringkasan sekarang
            </button>
          </div>
        )}
      </motion.div>
    </>
  );
});

BriefAssistantPanel.displayName = "BriefAssistantPanel";
