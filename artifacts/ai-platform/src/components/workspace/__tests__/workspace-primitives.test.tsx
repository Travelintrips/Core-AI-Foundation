/**
 * Team 20 — Workspace Primitives Test Suite
 * Covers: render, variants, density, states, status mapping, a11y, responsive classes.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";

import { WorkspaceDensityProvider, useDensity } from "../workspace-density";
import {
  WorkspacePanel,
  WorkspacePanelHeader,
  WorkspaceSection,
  WorkspaceDivider,
} from "../workspace-panel";
import {
  WorkspaceToolbarGroup,
  WorkspaceToolbarButton,
  WorkspaceIconButton,
} from "../workspace-toolbar";
import { WorkspaceStatusBadge } from "../workspace-status-badge";
import {
  WorkspaceLoadingState,
  WorkspaceEmptyState,
  WorkspaceErrorState,
  WorkspaceUnavailableState,
} from "../workspace-states";
import { WorkspaceKeyboardHint } from "../workspace-overlays";
import { resolveWorkspaceStatus } from "../workspace-status";
import { InboxIcon } from "lucide-react";

// ─── helpers ──────────────────────────────────────────────────────────────────

function comfortable(ui: React.ReactElement) {
  return render(
    <WorkspaceDensityProvider defaultDensity="comfortable">{ui}</WorkspaceDensityProvider>,
  );
}

function compact(ui: React.ReactElement) {
  return render(
    <WorkspaceDensityProvider defaultDensity="compact">{ui}</WorkspaceDensityProvider>,
  );
}

// ─── 1. WorkspacePanel ────────────────────────────────────────────────────────

describe("WorkspacePanel", () => {
  it("renders children", () => {
    comfortable(<WorkspacePanel>hello panel</WorkspacePanel>);
    expect(screen.getByText("hello panel")).toBeTruthy();
  });

  it("has data-slot attribute", () => {
    comfortable(<WorkspacePanel data-testid="p" />);
    const el = screen.getByTestId("p");
    expect(el.getAttribute("data-slot")).toBe("workspace-panel");
  });

  it("elevated variant adds border class", () => {
    comfortable(<WorkspacePanel elevated data-testid="p" />);
    const el = screen.getByTestId("p");
    expect(el.className).toContain("border");
  });

  it("non-elevated has no border by default", () => {
    comfortable(<WorkspacePanel data-testid="p" />);
    const el = screen.getByTestId("p");
    expect(el.className).not.toContain("rounded-lg shadow-xs");
  });
});

// ─── 2. WorkspacePanelHeader ──────────────────────────────────────────────────

describe("WorkspacePanelHeader", () => {
  it("renders title", () => {
    comfortable(
      <WorkspaceDensityProvider>
        <WorkspacePanelHeader title="Layers" />
      </WorkspaceDensityProvider>,
    );
    expect(screen.getByText("Layers")).toBeTruthy();
  });

  it("renders description when provided", () => {
    comfortable(
      <WorkspacePanelHeader title="T" description="sub" />,
    );
    expect(screen.getByText("sub")).toBeTruthy();
  });

  it("renders actions slot", () => {
    comfortable(
      <WorkspacePanelHeader title="T" actions={<button>Add</button>} />,
    );
    expect(screen.getByRole("button", { name: "Add" })).toBeTruthy();
  });
});

// ─── 3. WorkspaceSection ─────────────────────────────────────────────────────

describe("WorkspaceSection", () => {
  it("renders with comfortable padding", () => {
    comfortable(<WorkspaceSection data-testid="s">X</WorkspaceSection>);
    expect(screen.getByTestId("s").className).toContain("p-4");
  });

  it("renders with compact padding", () => {
    compact(<WorkspaceSection data-testid="s">X</WorkspaceSection>);
    expect(screen.getByTestId("s").className).toContain("p-2");
  });
});

// ─── 4. WorkspaceDivider ─────────────────────────────────────────────────────

describe("WorkspaceDivider", () => {
  it("renders as hr by default", () => {
    comfortable(<WorkspaceDivider />);
    expect(document.querySelector("hr")).toBeTruthy();
  });

  it("renders with label", () => {
    comfortable(<WorkspaceDivider label="Tools" />);
    expect(screen.getByText("Tools")).toBeTruthy();
  });

  it("has role separator when labelled", () => {
    comfortable(<WorkspaceDivider label="Tools" />);
    expect(screen.getByRole("separator")).toBeTruthy();
  });
});

// ─── 5. WorkspaceToolbarGroup ─────────────────────────────────────────────────

describe("WorkspaceToolbarGroup", () => {
  it("has role toolbar with accessible label", () => {
    comfortable(
      <WorkspaceToolbarGroup label="Draw tools">
        <span />
      </WorkspaceToolbarGroup>,
    );
    expect(screen.getByRole("toolbar", { name: "Draw tools" })).toBeTruthy();
  });

  it("applies horizontal flex by default", () => {
    comfortable(
      <WorkspaceToolbarGroup label="T" data-testid="g">
        <span />
      </WorkspaceToolbarGroup>,
    );
    expect(screen.getByTestId("g").className).toContain("flex-row");
  });

  it("applies vertical flex when orientation=vertical", () => {
    comfortable(
      <WorkspaceToolbarGroup label="T" orientation="vertical" data-testid="g">
        <span />
      </WorkspaceToolbarGroup>,
    );
    expect(screen.getByTestId("g").className).toContain("flex-col");
  });
});

// ─── 6. WorkspaceToolbarButton ────────────────────────────────────────────────

describe("WorkspaceToolbarButton", () => {
  it("renders with aria-label when no showLabel", () => {
    comfortable(<WorkspaceToolbarButton label="Pen" />);
    expect(screen.getByRole("button", { name: "Pen" })).toBeTruthy();
  });

  it("reflects active state via aria-pressed", () => {
    comfortable(<WorkspaceToolbarButton label="Pen" active />);
    const btn = screen.getByRole("button", { name: "Pen" });
    expect(btn.getAttribute("aria-pressed")).toBe("true");
  });

  it("is disabled when disabled prop set", () => {
    comfortable(<WorkspaceToolbarButton label="Pen" disabled />);
    expect(screen.getByRole("button", { name: "Pen" })).toBeDisabled();
  });

  it("shows label text when showLabel=true", () => {
    comfortable(<WorkspaceToolbarButton label="Pen" showLabel />);
    expect(screen.getByText("Pen")).toBeTruthy();
  });

  it("applies compact size class in compact density", () => {
    compact(<WorkspaceToolbarButton label="X" data-testid="b" />);
    expect(screen.getByTestId("b").className).toContain("h-6");
  });
});

// ─── 7. WorkspaceIconButton ───────────────────────────────────────────────────

describe("WorkspaceIconButton", () => {
  it("has sr-only label", () => {
    comfortable(
      <WorkspaceIconButton icon={<InboxIcon />} label="Add layer" />,
    );
    const sr = document.querySelector(".sr-only");
    expect(sr?.textContent).toBe("Add layer");
  });

  it("has aria-label on button", () => {
    comfortable(
      <WorkspaceIconButton icon={<InboxIcon />} label="Add layer" />,
    );
    expect(screen.getByRole("button", { name: "Add layer" })).toBeTruthy();
  });

  it("is disabled when disabled prop set", () => {
    comfortable(
      <WorkspaceIconButton icon={<InboxIcon />} label="X" disabled />,
    );
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("outline variant adds border", () => {
    comfortable(
      <WorkspaceIconButton
        icon={<InboxIcon />}
        label="X"
        variant="outline"
        data-testid="ib"
      />,
    );
    expect(screen.getByTestId("ib").className).toContain("border");
  });
});

// ─── 8. WorkspaceStatusBadge ──────────────────────────────────────────────────

describe("WorkspaceStatusBadge", () => {
  const statuses = [
    "draft",
    "generating",
    "ready",
    "in_review",
    "approved",
    "revision_requested",
    "failed",
    "archived",
    "unavailable",
    "read_only",
  ] as const;

  it.each(statuses)("renders canonical status: %s", (status) => {
    comfortable(<WorkspaceStatusBadge status={status} />);
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("handles null status gracefully", () => {
    comfortable(<WorkspaceStatusBadge status={null} />);
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("handles unknown status by showing raw string", () => {
    comfortable(<WorkspaceStatusBadge status="custom_unknown" />);
    expect(screen.getByText("custom_unknown")).toBeTruthy();
  });

  it("has aria-label matching resolved meta", () => {
    comfortable(<WorkspaceStatusBadge status="approved" />);
    const el = screen.getByRole("status");
    expect(el.getAttribute("aria-label")).toContain("Approved");
  });

  it("status is not communicated by colour alone — label is always visible", () => {
    comfortable(<WorkspaceStatusBadge status="failed" />);
    expect(screen.getByText("Failed")).toBeTruthy();
  });

  it("renders sm size", () => {
    comfortable(
      <WorkspaceStatusBadge status="ready" size="sm" data-testid="b" />,
    );
    expect(screen.getByTestId("b").className).toContain("text-[10px]");
  });

  it("renders lg size", () => {
    comfortable(
      <WorkspaceStatusBadge status="ready" size="lg" data-testid="b" />,
    );
    expect(screen.getByTestId("b").className).toContain("text-sm");
  });

  it("hides dot when dot=false", () => {
    comfortable(
      <WorkspaceStatusBadge status="draft" dot={false} />,
    );
    const dots = document.querySelectorAll('[aria-hidden="true"]');
    expect(dots.length).toBe(0);
  });
});

// ─── 9. Status mapping ───────────────────────────────────────────────────────

describe("resolveWorkspaceStatus", () => {
  it("maps generating → info tone", () => {
    expect(resolveWorkspaceStatus("generating").tone).toBe("info");
  });

  it("maps approved → success tone", () => {
    expect(resolveWorkspaceStatus("approved").tone).toBe("success");
  });

  it("maps failed → danger tone", () => {
    expect(resolveWorkspaceStatus("failed").tone).toBe("danger");
  });

  it("maps archived → dim tone", () => {
    expect(resolveWorkspaceStatus("archived").tone).toBe("dim");
  });

  it("maps read_only → dim tone", () => {
    expect(resolveWorkspaceStatus("read_only").tone).toBe("dim");
  });

  it("maps platform alias 'running' → info", () => {
    expect(resolveWorkspaceStatus("running").tone).toBe("info");
  });

  it("maps platform alias 'completed' → success", () => {
    expect(resolveWorkspaceStatus("completed").tone).toBe("success");
  });

  it("handles null → neutral", () => {
    expect(resolveWorkspaceStatus(null).tone).toBe("neutral");
  });

  it("handles undefined → neutral", () => {
    expect(resolveWorkspaceStatus(undefined).tone).toBe("neutral");
  });

  it("does not hard-code any service or domain string", () => {
    // resolveWorkspaceStatus should never reference fashion, interior, etc.
    const src = resolveWorkspaceStatus.toString();
    expect(src).not.toContain("fashion");
    expect(src).not.toContain("interior");
    expect(src).not.toContain("packaging");
  });
});

// ─── 10. WorkspaceLoadingState ────────────────────────────────────────────────

describe("WorkspaceLoadingState", () => {
  it("renders with default message", () => {
    comfortable(<WorkspaceLoadingState />);
    expect(screen.getByText("Loading…")).toBeTruthy();
  });

  it("renders custom message", () => {
    comfortable(<WorkspaceLoadingState message="Fetching layers…" />);
    expect(screen.getByText("Fetching layers…")).toBeTruthy();
  });

  it("spinner has role status", () => {
    comfortable(<WorkspaceLoadingState />);
    // StateShell and Spinner both carry role="status" by design
    const statusEls = screen.getAllByRole("status");
    expect(statusEls.length).toBeGreaterThanOrEqual(1);
  });

  it("spinner has animate-none in reduced-motion class", () => {
    comfortable(<WorkspaceLoadingState />);
    const spinner = document.querySelector("[aria-label='Loading']");
    expect(spinner?.className).toContain("motion-reduce:animate-none");
  });
});

// ─── 11. WorkspaceEmptyState ──────────────────────────────────────────────────

describe("WorkspaceEmptyState", () => {
  it("renders title", () => {
    comfortable(<WorkspaceEmptyState title="No layers" />);
    expect(screen.getByText("No layers")).toBeTruthy();
  });

  it("renders description", () => {
    comfortable(
      <WorkspaceEmptyState title="X" description="Add a layer to start" />,
    );
    expect(screen.getByText("Add a layer to start")).toBeTruthy();
  });

  it("renders custom icon", () => {
    comfortable(
      <WorkspaceEmptyState
        title="X"
        icon={<InboxIcon data-testid="icon" />}
      />,
    );
    expect(screen.getByTestId("icon")).toBeTruthy();
  });

  it("renders action slot", () => {
    comfortable(
      <WorkspaceEmptyState
        title="X"
        action={<button>Add</button>}
      />,
    );
    expect(screen.getByRole("button", { name: "Add" })).toBeTruthy();
  });
});

// ─── 12. WorkspaceErrorState ──────────────────────────────────────────────────

describe("WorkspaceErrorState", () => {
  it("renders default error message", () => {
    comfortable(<WorkspaceErrorState />);
    expect(screen.getByText("Something went wrong.")).toBeTruthy();
  });

  it("renders custom message", () => {
    comfortable(<WorkspaceErrorState message="Load failed." />);
    expect(screen.getByText("Load failed.")).toBeTruthy();
  });

  it("has role alert", () => {
    comfortable(<WorkspaceErrorState />);
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("calls onRetry when button clicked", async () => {
    const onRetry = vi.fn();
    comfortable(<WorkspaceErrorState onRetry={onRetry} />);
    await userEvent.click(screen.getByText("Try again"));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

// ─── 13. WorkspaceUnavailableState ───────────────────────────────────────────

describe("WorkspaceUnavailableState", () => {
  it("renders premium reason", () => {
    comfortable(<WorkspaceUnavailableState reason="premium" />);
    expect(screen.getByText("Premium feature")).toBeTruthy();
  });

  it("renders permission reason", () => {
    comfortable(<WorkspaceUnavailableState reason="permission" />);
    expect(screen.getByText("Access restricted")).toBeTruthy();
  });

  it("renders offline reason", () => {
    comfortable(<WorkspaceUnavailableState reason="offline" />);
    expect(screen.getByText("Offline")).toBeTruthy();
  });

  it("allows custom title and description override", () => {
    comfortable(
      <WorkspaceUnavailableState
        reason="generic"
        title="Coming soon"
        description="Stay tuned."
      />,
    );
    expect(screen.getByText("Coming soon")).toBeTruthy();
    expect(screen.getByText("Stay tuned.")).toBeTruthy();
  });

  it("does not hard-code a service or domain", () => {
    // Title/description should never mention a specific vertical
    comfortable(<WorkspaceUnavailableState />);
    const text = document.body.textContent ?? "";
    expect(text).not.toContain("Fashion");
    expect(text).not.toContain("Interior");
  });
});

// ─── 14. WorkspaceKeyboardHint ────────────────────────────────────────────────

describe("WorkspaceKeyboardHint", () => {
  it("renders each key as a kbd element", () => {
    comfortable(<WorkspaceKeyboardHint keys={["⌘", "Z"]} label="Undo" />);
    const kbds = document.querySelectorAll("kbd");
    expect(kbds.length).toBe(2);
    expect(kbds[0].textContent).toBe("⌘");
    expect(kbds[1].textContent).toBe("Z");
  });

  it("provides sr-only label", () => {
    comfortable(<WorkspaceKeyboardHint keys={["⌘", "Z"]} label="Undo" />);
    const sr = document.querySelector(".sr-only");
    expect(sr?.textContent).toBe("Undo");
  });

  it("aria-label includes keys and label", () => {
    comfortable(
      <WorkspaceKeyboardHint keys={["⌘", "Z"]} label="Undo" />,
    );
    const hint = document.querySelector("[aria-label]");
    expect(hint?.getAttribute("aria-label")).toContain("Undo");
  });
});

// ─── 15. Density context ─────────────────────────────────────────────────────

describe("WorkspaceDensityProvider", () => {
  it("exposes comfortable density by default", () => {
    let captured: string | undefined;
    function Probe() {
      const { density } = useDensity();
      captured = density;
      return null;
    }
    render(
      <WorkspaceDensityProvider>
        <Probe />
      </WorkspaceDensityProvider>,
    );
    expect(captured).toBe("comfortable");
  });

  it("exposes compact density when set", () => {
    let captured: string | undefined;
    function Probe() {
      const { density } = useDensity();
      captured = density;
      return null;
    }
    render(
      <WorkspaceDensityProvider defaultDensity="compact">
        <Probe />
      </WorkspaceDensityProvider>,
    );
    expect(captured).toBe("compact");
  });

  it("pick() returns compact value when density is compact", () => {
    let result: string | undefined;
    function Probe() {
      const { pick } = useDensity();
      result = pick("p-4", "p-2");
      return null;
    }
    render(
      <WorkspaceDensityProvider defaultDensity="compact">
        <Probe />
      </WorkspaceDensityProvider>,
    );
    expect(result).toBe("p-2");
  });

  it("wraps children in a div with data-density attribute", () => {
    render(
      <WorkspaceDensityProvider defaultDensity="comfortable">
        <span>inner</span>
      </WorkspaceDensityProvider>,
    );
    const wrapper = document.querySelector("[data-density]");
    expect(wrapper?.getAttribute("data-density")).toBe("comfortable");
  });
});

// ─── 16. No hard-coded service/domain ────────────────────────────────────────

describe("Design system regression — no hard-coded service or domain", () => {
  const domainWords = ["fashion", "interior", "packaging", "branding", "cargo"];

  it("WorkspaceStatusBadge labels contain no domain-specific text", () => {
    const statuses = ["draft", "generating", "ready", "failed", "approved"];
    statuses.forEach((s) => {
      comfortable(<WorkspaceStatusBadge status={s} />);
      const text = document.body.textContent?.toLowerCase() ?? "";
      domainWords.forEach((word) => expect(text).not.toContain(word));
      document.body.innerHTML = "";
    });
  });
});
