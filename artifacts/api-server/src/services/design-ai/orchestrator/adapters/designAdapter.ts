/**
 * Design Adapter (Team 2 → Orchestrator)
 *
 * STATUS: STUB — masih dipakai karena Team 2 belum tersedia.
 *
 * AUDIT (2026-07-16): Branch feature/design-ai-design-team tidak ditemukan
 * di repository (lokal maupun remote). Tidak ada folder agents/design/,
 * tidak ada fungsi runDesignPipeline() di seluruh codebase.
 * Git reflog, git fsck, dan git log --all tidak menemukan commit Team 2.
 *
 * TETAP DIPAKAI KARENA: pipeline asli belum ada. Stub ini memungkinkan
 * orchestrator berjalan end-to-end dengan output yang valid secara kontrak.
 *
 * KETIKA TEAM 2 SELESAI:
 *  1. Buat branch feature/design-ai-design-team dan implementasikan agent.
 *  2. Import runDesignPipeline() dari agents/design/index.js.
 *  3. Panggil fungsi tersebut dan map outputnya ke DesignTeamOutput.
 *  4. Hapus fungsi runDesignPipelineStub() di bawah ini.
 *  5. Tambahkan test untuk mapping.
 *
 * CONTRACT MISMATCH: Tidak ada saat ini — stub mengembalikan shape DesignTeamOutput yang valid.
 */

import type { DiscoveryTeamOutput } from "../../types/discovery.types.js";
import type { DesignTeamOutput } from "../../types/orchestrator.types.js";

/** STUB: mengembalikan DesignTeamOutput minimal yang valid. Hapus ketika Team 2 selesai. */
export async function runDesignPipelineStub(
  discovery: DiscoveryTeamOutput,
): Promise<DesignTeamOutput> {
  return {
    layoutDecisions: {
      gridSystem: "12-column",
      sectionOrder: discovery.requirementAnalysis.sections.map(s => s.id),
      densityRating: "medium",
    },
    compositionNotes: discovery.creativeBrief.visualDirection.slice(0, 3) as string[],
    typographyChoices: {
      primaryCategory: discovery.brandStrategy.typographyDirection.category[0] ?? "sans-serif",
      hierarchyLevels: 3,
    },
    colorSystemNotes: [
      `Primary mood: ${discovery.brandStrategy.colorDirection.primaryMood}`,
      ...discovery.brandStrategy.colorDirection.supportingMood,
    ],
    decorationNotes: discovery.brandStrategy.imageryDirection.slice(0, 2),
    _agentMetadata: [],
  };
}
