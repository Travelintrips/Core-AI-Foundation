// @vitest-environment node

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./coding-workspace.tsx", import.meta.url),
  "utf8",
);

describe("coding workspace bulk task selection", () => {
  it("renders per-task and select-all checkboxes", () => {
    expect(source).toContain('import { Checkbox } from "@/components/ui/checkbox"');
    expect(source).toContain('data-testid="checkbox-select-all-coding-tasks"');
    expect(source).toContain('data-testid={`checkbox-coding-task-${task.id}`}');
    expect(source).toContain('checked={selectedTaskIds.has(task.id)}');
    expect(source).toContain('const selectAllState: boolean | "indeterminate"');
  });

  it("only selects task states that the delete endpoint permits", () => {
    expect(source).toContain("const canDeleteCodingTask = (task: CodingTask) =>");
    expect(source).toContain("task.status === CodingTaskStatus.PENDING");
    expect(source).toContain("task.status === CodingTaskStatus.FAILED");
    expect(source).toContain("task.status === CodingTaskStatus.READY_REVIEW");
    expect(source).toContain("task.status === CodingTaskStatus.COMPLETED");
    expect(source).toContain("disabled={!taskDeletable || bulkDeletePending}");
  });

  it("bulk deletes the selected visible tasks behind one confirmation", () => {
    expect(source).toContain("const deleteSelectedTasks = async () =>");
    expect(source).toContain(
      "`Hapus ${tasksToDelete.length} tugas terpilih? Riwayat run dan perubahan terkait akan ikut dihapus.`",
    );
    expect(source).toContain("if (await deleteTask(task, true, true)) deletedCount += 1");
    expect(source).toContain('data-testid="button-delete-selected-coding-tasks"');
    expect(source).toContain("setSelectedTaskIds(new Set())");
  });

  it("keeps the legacy failed-task cleanup action", () => {
    expect(source).toContain("const deleteFailedTasks = async () =>");
    expect(source).toContain('data-testid="button-delete-failed-coding-tasks"');
  });
});
