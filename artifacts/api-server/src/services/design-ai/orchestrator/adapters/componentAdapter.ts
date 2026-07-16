/**
 * Component Adapter (Team 3 → Orchestrator)
 *
 * STATUS: STUB — masih dipakai karena Team 3 belum tersedia.
 *
 * AUDIT (2026-07-16): Branch feature/design-ai-component-team tidak ditemukan
 * di repository (lokal maupun remote). Tidak ada folder agents/components/,
 * tidak ada fungsi runComponentPipeline() di seluruh codebase.
 * Git reflog, git fsck, dan git log --all tidak menemukan commit Team 3.
 *
 * TETAP DIPAKAI KARENA: pipeline asli belum ada. Stub ini memungkinkan
 * orchestrator berjalan end-to-end dengan output yang valid secara kontrak.
 *
 * KETIKA TEAM 3 SELESAI:
 *  1. Buat branch feature/design-ai-component-team dan implementasikan agent.
 *  2. Import runComponentPipeline() dari agents/components/index.js.
 *  3. Map outputnya ke ComponentTeamOutput.
 *  4. Hapus fungsi runComponentPipelineStub() di bawah ini.
 *
 * CONTRACT MISMATCH: Tidak ada saat ini — stub mengembalikan shape yang valid.
 */

import type { DiscoveryTeamOutput } from "../../types/discovery.types.js";
import type { DesignTeamOutput, ComponentTeamOutput } from "../../types/orchestrator.types.js";

/** STUB: mengembalikan ComponentTeamOutput minimal yang valid. Hapus ketika Team 3 selesai. */
export async function runComponentPipelineStub(
  discovery: DiscoveryTeamOutput,
  _design: DesignTeamOutput,
): Promise<ComponentTeamOutput> {
  const variableKeys = discovery.requirementAnalysis.requestedVariables.length > 0
    ? discovery.requirementAnalysis.requestedVariables
    : ["headline", "subheadline", "cta_label", "background_image"];

  return {
    componentPlan: discovery.requirementAnalysis.sections.map((s: { id: string; name: string; contentPurpose: string }) => ({
      id: s.id,
      type: "section",
      purpose: s.contentPurpose,
    })),
    variableKeys,
    assetBindings: variableKeys
      .filter((k: string) => k.toLowerCase().includes("image") || k.toLowerCase().includes("logo"))
      .map((k: string) => ({ variableKey: k, assetType: "image" })),
    _agentMetadata: [],
  };
}
