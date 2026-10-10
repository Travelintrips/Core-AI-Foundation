/** A narrowly scoped, read-only Repository Analyzer verification task. */
export function isRepositoryAnalyzerVerificationOnlyInstruction(instruction: string | null | undefined): boolean {
  const text = instruction ?? "";
  return (
    /\bTEST_ONLY\b|\btest only\b/i.test(text) &&
    /repository analyzer|repository analysis|analisis repository/i.test(text) &&
    /tanpa perubahan file|tanpa mengubah file|jangan mengubah file|no (?:code )?changes|no code modifications|do not (?:change|modify|edit) files?|read.only/i.test(text) &&
    /\bE2E\b|verifik|\bverif(?:y|ication)\b|\bsmoke\b/i.test(text)
  );
}

export function repositoryAnalyzerVerificationAck(instruction: string | null | undefined): string | null {
  if (!isRepositoryAnalyzerVerificationOnlyInstruction(instruction)) return null;
  return instruction?.match(/\bACK_[A-Z0-9_]{8,90}\b/)?.[0] ?? null;
}
