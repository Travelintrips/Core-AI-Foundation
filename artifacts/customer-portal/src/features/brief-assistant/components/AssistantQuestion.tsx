/**
 * Phase 4A — Brief Assistant: Question Stage
 *
 * Renders the current question with the appropriate input type.
 * Routes to AssistantQuickReplies (single/multi) or AssistantTextInput (text).
 */

import { memo, useState, useCallback } from "react";
import { SkipForward } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PlannedBriefQuestion } from "../types";
import { AssistantMessage } from "./AssistantMessage";
import { AssistantQuickReplies } from "./AssistantQuickReplies";
import { AssistantTextInput } from "./AssistantTextInput";

interface AssistantQuestionProps {
  question: PlannedBriefQuestion;
  onAnswer: (selectedKeys: string[], customText: string) => void;
  onSkip: () => void;
}

export const AssistantQuestion = memo(function AssistantQuestion({
  question,
  onAnswer,
  onSkip,
}: AssistantQuestionProps) {
  const [selected, setSelected] = useState<string[]>([]);

  const handleConfirm = useCallback(
    (keys: string[], custom: string) => {
      if (keys.length === 0 && !custom) return;
      onAnswer(keys, custom);
    },
    [onAnswer],
  );

  const handleTextSubmit = useCallback(
    (text: string) => {
      onAnswer([], text);
    },
    [onAnswer],
  );

  return (
    <div className="space-y-4">
      {/* Question bubble */}
      <AssistantMessage>
        <p className="font-medium mb-1">{question.question}</p>
        {question.helperText && (
          <p className="text-xs text-muted-foreground mt-1">{question.helperText}</p>
        )}
        {question.reason && (
          <p className="text-[11px] text-muted-foreground/70 mt-2 italic">
            💡 {question.reason}
          </p>
        )}
      </AssistantMessage>

      {/* Input area */}
      <div className="pl-10">
        {(question.type === "single" || question.type === "multi") && question.options ? (
          <AssistantQuickReplies
            options={question.options}
            selected={selected}
            questionType={question.type}
            maxSelections={question.maxSelections}
            onSelectionChange={setSelected}
            onConfirm={handleConfirm}
          />
        ) : (
          <AssistantTextInput
            placeholder="Tuliskan jawaban Anda..."
            helperText={question.helperText}
            onSubmit={handleTextSubmit}
          />
        )}
      </div>

      {/* Skip */}
      <div className="pl-10">
        <button
          type="button"
          onClick={onSkip}
          aria-label={`Lewati pertanyaan: ${question.title}`}
          className={cn(
            "flex items-center gap-1.5 text-xs text-muted-foreground",
            "hover:text-foreground transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 rounded",
            "min-h-[36px] px-1",
          )}
        >
          <SkipForward className="w-3.5 h-3.5" />
          {question.required ? "Lewati sementara (bisa diisi manual)" : "Lewati"}
        </button>
      </div>
    </div>
  );
});

AssistantQuestion.displayName = "AssistantQuestion";
