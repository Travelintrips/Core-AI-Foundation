import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApprovedAiHandoffLease } from "../localCodingAiHandoffService.js";
import {
  CONSTRAINED_MODEL_CAPABILITIES,
  ProviderInvocationError,
  createConstrainedModelInvocationAdapter,
  type ConstrainedModelProvider,
} from "../localCodingAiModelAdapterService.js";
import { computeAiHandoffPackageHash } from "../localCodingAiProposalPolicyService.js";
import {
  boundedJsonObjectCandidates,
  buildAiPatchApplierProposal,
  buildAiProposalBinding,
  buildAiProposalPolicyEnvelope,
  createConstrainedCodingProviderAdapter,
  invokeConstrainedAiProposal,
  normalizeBoundedSchemaRepairOutput,
  validateAndApplyAiProposal,
} from "../localCodingAiExecutionGateService.js";

vi.mock("../aiSecretService.js", () => ({
  getProviderApiKey: () => "gemini-test-key",
}));

const execFileAsync = promisify(execFile);
const cleanup: string[] = [];

async function git(root: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: root,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      LANG: "C",
      LC_ALL: "C",
      GIT_TERMINAL_PROMPT: "0",
    },
  });
  return stdout.trim();
}

async function repositoryFixture(): Promise<{ root: string; head: string }> {
  const root = await mkdtemp(join(tmpdir(), "ai-execution-gate-"));
  cleanup.push(root);
  await git(root, ["init", "-b", "main"]);
  await git(root, ["config", "user.email", "test@example.com"]);
  await git(root, ["config", "user.name", "AI Gate Test"]);
  await writeFile(join(root, "example.ts"), "export const value = 1;\n", "utf8");
  await git(root, ["add", "example.ts"]);
  await git(root, ["commit", "-m", "fixture"]);
  return { root, head: await git(root, ["rev-parse", "HEAD"]) };
}

function leaseFixture(head: string): ApprovedAiHandoffLease {
  const patchSha = createHash("sha256").update("failing-local-patch", "utf8").digest("hex");
  const pkg: ApprovedAiHandoffLease["package"] = {
    version: 1,
    task: {
      id: "11111111-1111-4111-8111-111111111111",
      projectName: "AI execution gate test",
      instruction: "Change the exported value from one to two.",
    },
    repository: {
      repository: "Travelintrips/Core-AI-Foundation",
      branch: "main",
      baseHeadSha: head,
    },
    reason: "Deterministic recovery exhausted.",
    allowedFiles: ["example.ts"],
    diagnostics: [],
    snippets: [{
      file: "example.ts",
      startLine: 1,
      endLine: 1,
      content: "export const value = 1;",
      reason: "focus",
    }],
    symbols: [],
    dependencies: [],
    relatedTests: [],
    recentCommits: [],
    verificationCommands: ["pnpm typecheck"],
    currentPatch: {
      sha256: patchSha,
      excerpt: "diff --git a/example.ts b/example.ts",
      truncated: false,
    },
    policy: {
      readOnlyContext: true,
      repositoryAccess: false,
      networkAccess: false,
      shellAccess: false,
      secretAccess: false,
      sourceWrite: false,
      commitPushMerge: false,
      modelInvoked: false,
      requiresExplicitApprovalBeforeModel: true,
      allowedFilesOnly: true,
    },
  };

  return {
    package: pkg,
    packageHash: computeAiHandoffPackageHash(pkg),
    approvedAt: new Date(Date.now() - 1_000).toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
}

function proposalJson(lease: ApprovedAiHandoffLease): string {
  return JSON.stringify({
    version: 1,
    taskId: lease.package.task.id,
    packageHash: lease.packageHash,
    baseHeadSha: lease.package.repository.baseHeadSha,
    currentPatchSha256: lease.package.currentPatch.sha256,
    allowedFiles: lease.package.allowedFiles,
    capabilities: {
      shellCommand: false,
      networkRequest: false,
      commit: false,
      push: false,
      merge: false,
      secretAccess: false,
      envAccess: false,
    },
    proposal: {
      summary: "Update the bounded constant.",
      rationale: "The bounded snippet shows the exact deterministic edit.",
      operations: [{
        type: "replace_text",
        file: "example.ts",
        oldText: "export const value = 1;",
        newText: "export const value = 2;",
        expectedOccurrences: 1,
      }],
    },
  });
}

afterEach(async () => {
  vi.unstubAllGlobals();
  while (cleanup.length > 0) {
    const root = cleanup.pop();
    if (root) await rm(root, { recursive: true, force: true });
  }
});

describe("Local Coding AI Execution Gate integration", () => {
  it.each(["valid", "wrong binding", "forbidden capability"])(
    "validates native Gemini JSON through Contract V1: %s",
    async (format) => {
      const { root, head } = await repositoryFixture();
      const lease = leaseFixture(head);
      const proposal = JSON.parse(proposalJson(lease));
      if (format === "wrong binding") proposal.packageHash = "0".repeat(64);
      if (format === "forbidden capability") proposal.capabilities.shellCommand = true;
      const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify({
        candidates: [{ content: { parts: [
          { thought: true, text: 'The draft shape is {"proposal": "draft"}.' },
          { text: JSON.stringify(proposal) },
        ] } }],
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 80 },
      }), { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);
      const provider = createConstrainedCodingProviderAdapter({
        providerSlug: "google",
        modelId: "gemini-3.8-flash",
        jsonOutput: true,
      });

      const invocation = invokeConstrainedAiProposal({
        lease,
        adapter: createConstrainedModelInvocationAdapter(provider),
        target: { provider: "google", model: "gemini-3.8-flash" },
        requestId: `native-gemini-${format}`,
        timeoutMs: 5_000,
        maxOutputTokens: 512,
      });

      if (format === "valid") {
        const result = await invocation;
        const candidate = await validateAndApplyAiProposal({
          lease,
          proposal: result.proposal,
          repositoryRoot: root,
          currentRepositoryHeadSha: head,
        });
        expect(candidate.applyResult.status).toBe("APPLIED");
        expect(candidate.applyResult.scriptsExecuted).toBe(false);
        expect(await readFile(join(root, "example.ts"), "utf8")).toBe("export const value = 2;\n");
        expect(fetchMock).toHaveBeenCalledTimes(1);
      } else {
        await expect(invocation).rejects.toMatchObject({ kind: "INVALID_PROPOSAL" });
        expect(fetchMock).toHaveBeenCalledTimes(2);
      }
      for (const [, request] of fetchMock.mock.calls) {
        const body = JSON.parse(String(request?.body));
        expect(body.generationConfig.responseFormat.text.mimeType)
          .toBe("application/json");
        expect(body.generationConfig.responseFormat.text.schema)
          .toEqual(expect.objectContaining({ type: "object" }));
        expect(body.generationConfig).not.toHaveProperty("responseJsonSchema");
        expect(body.generationConfig).not.toHaveProperty("responseMimeType");
      }
    },
  );

  it.each([1, 2])("preserves Contract V1 after %s Gemini schema format rejection(s)", async (rejections) => {
    const { head } = await repositoryFixture();
    const lease = leaseFixture(head);
    const fetchMock = vi.fn<typeof fetch>();
    for (let attempt = 0; attempt < rejections; attempt++) {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: 400,
              message: "Request contains an invalid argument.",
              status: "INVALID_ARGUMENT",
            },
          }),
          { status: 400 },
        ),
      );
    }
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          candidates: [{
            content: { parts: [{ text: proposalJson(lease) }] },
          }],
          usageMetadata: { promptTokenCount: 80, candidatesTokenCount: 60 },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = createConstrainedCodingProviderAdapter({
      providerSlug: "google",
      modelId: "gemini-3.8-flash",
      jsonOutput: true,
    });
    const result = await invokeConstrainedAiProposal({
      lease,
      adapter: createConstrainedModelInvocationAdapter(provider),
      target: { provider: "google", model: "gemini-3.8-flash" },
      requestId: "native-gemini-schema-400-fallback",
      timeoutMs: 5_000,
      maxOutputTokens: 512,
    });

    expect(result.proposal.taskId).toBe(lease.package.task.id);
    expect(fetchMock).toHaveBeenCalledTimes(rejections + 1);

    const firstBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(firstBody.generationConfig.responseFormat.text.mimeType).toBe("application/json");
    expect(firstBody.generationConfig.responseFormat.text.schema)
      .toEqual(expect.objectContaining({ type: "object" }));

    const secondBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(secondBody.generationConfig.responseMimeType).toBe("application/json");
    expect(secondBody.generationConfig.responseJsonSchema)
      .toEqual(firstBody.generationConfig.responseFormat.text.schema);
    expect(secondBody.generationConfig).not.toHaveProperty("responseFormat");
    expect(secondBody.contents).toEqual(firstBody.contents);
    expect(secondBody.systemInstruction).toEqual(firstBody.systemInstruction);
    if (rejections === 2) {
      const thirdBody = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body));
      expect(thirdBody.generationConfig.responseMimeType).toBe("application/json");
      expect(thirdBody.generationConfig).not.toHaveProperty("responseJsonSchema");
      expect(thirdBody.generationConfig).not.toHaveProperty("responseFormat");
      expect(thirdBody.contents).toEqual(firstBody.contents);
      expect(thirdBody.systemInstruction).toEqual(firstBody.systemInstruction);
    }
  });

  it.each(["wrong binding", "HTTP 400"])("bounds and rejects JSON-only fallback failure: %s", async (failure) => {
    const { head } = await repositoryFixture();
    const lease = leaseFixture(head);
    const proposal = JSON.parse(proposalJson(lease));
    proposal.packageHash = "0".repeat(64);
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (_, request) => {
      const config = JSON.parse(String(request?.body)).generationConfig;
      if (config.responseFormat || config.responseJsonSchema || failure === "HTTP 400") {
        return new Response("INVALID_ARGUMENT", { status: 400 });
      }
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify(proposal) }] } }],
      }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = createConstrainedCodingProviderAdapter({
      providerSlug: "google",
      modelId: "gemini-3.8-flash",
      jsonOutput: true,
    });

    await expect(invokeConstrainedAiProposal({
      lease,
      adapter: createConstrainedModelInvocationAdapter(provider),
      target: { provider: "google", model: "gemini-3.8-flash" },
      requestId: "native-gemini-fallback-rejected",
      timeoutMs: 5_000,
      maxOutputTokens: 512,
    })).rejects.toMatchObject(
      failure === "wrong binding"
        ? { kind: "INVALID_PROPOSAL" }
        : { code: "PROVIDER_BAD_REQUEST" },
    );
    expect(fetchMock).toHaveBeenCalledTimes(failure === "wrong binding" ? 6 : 3);
  });

  it.each(["fenced", "json-string"])(
    "recovers bounded Gemini structured JSON transport wrapper: %s",
    async (format) => {
      const { head } = await repositoryFixture();
      const lease = leaseFixture(head);
      const fence = String.fromCharCode(96).repeat(3);
      const proposal = proposalJson(lease);
      const content =
        format === "fenced"
          ? fence + "json\n" + proposal + "\n" + fence
          : JSON.stringify(proposal);

      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: content }] } }],
            usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 20 },
          }),
          { status: 200 },
        ),
      );
      vi.stubGlobal("fetch", fetchMock);

      const provider = createConstrainedCodingProviderAdapter({
        providerSlug: "google",
        modelId: "gemini-3.8-flash",
        jsonOutput: true,
      });
      const result = await invokeConstrainedAiProposal({
        lease,
        adapter: createConstrainedModelInvocationAdapter(provider),
        target: { provider: "google", model: "gemini-3.8-flash" },
        requestId: "native-gemini-wrapper-" + format,
        timeoutMs: 5_000,
        maxOutputTokens: 512,
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result.proposal.taskId).toBe(lease.package.task.id);
    },
  );

  it("uses the bounded schema-repair attempt after malformed structured provider output", async () => {
    const { head } = await repositoryFixture();
    const lease = leaseFixture(head);
    const invoke = vi.fn()
      .mockRejectedValueOnce(
        new ProviderInvocationError(
          "Constrained provider returned malformed structured JSON",
          "BAD_REQUEST",
        ),
      )
      .mockResolvedValueOnce({
        output: {
          type: "structured" as const,
          value: JSON.parse(proposalJson(lease)),
        },
        usage: { inputTokens: 20, outputTokens: 20, totalTokens: 40 },
      });

    const result = await invokeConstrainedAiProposal({
      lease,
      adapter: createConstrainedModelInvocationAdapter({
        provider: "fake",
        model: "proposal-v1",
        capabilities: CONSTRAINED_MODEL_CAPABILITIES,
        invoke,
      }),
      target: { provider: "fake", model: "proposal-v1" },
      requestId: "execution-test-malformed-structured-repair",
      timeoutMs: 5_000,
      maxOutputTokens: 512,
    });

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls[1]?.[0].input).toContain("SCHEMA REPAIR REQUIRED");
    expect(result.proposal.taskId).toBe(lease.package.task.id);
  });

  it("fails as INVALID_PROPOSAL after two malformed structured responses", async () => {
    const { head } = await repositoryFixture();
    const lease = leaseFixture(head);
    const invoke = vi.fn(async () => {
      throw new ProviderInvocationError(
        "Constrained provider returned malformed structured JSON",
        "BAD_REQUEST",
      );
    });

    await expect(
      invokeConstrainedAiProposal({
        lease,
        adapter: createConstrainedModelInvocationAdapter({
          provider: "fake",
          model: "proposal-v1",
          capabilities: CONSTRAINED_MODEL_CAPABILITIES,
          invoke,
        }),
        target: { provider: "fake", model: "proposal-v1" },
        requestId: "execution-test-malformed-structured-terminal",
        timeoutMs: 5_000,
        maxOutputTokens: 512,
      }),
    ).rejects.toMatchObject({ kind: "INVALID_PROPOSAL" });

    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("runs prompt -> constrained adapter -> Contract V1 -> policy -> deterministic patch without scripts", async () => {
    const { root, head } = await repositoryFixture();
    const lease = leaseFixture(head);
    const invoke = vi.fn(async () => ({
      output: {
        type: "structured" as const,
        value: JSON.parse(proposalJson(lease)),
      },
      usage: { inputTokens: 100, outputTokens: 80, totalTokens: 180 },
    }));
    const provider: ConstrainedModelProvider = {
      provider: "fake",
      model: "proposal-v1",
      capabilities: CONSTRAINED_MODEL_CAPABILITIES,
      invoke,
    };
    const adapter = createConstrainedModelInvocationAdapter(provider);

    const modelResult = await invokeConstrainedAiProposal({
      lease,
      adapter,
      target: { provider: "fake", model: "proposal-v1" },
      requestId: "execution-test-1",
      timeoutMs: 5_000,
      maxOutputTokens: 512,
    });

    expect(invoke).toHaveBeenCalledTimes(1);
    const providerRequest = invoke.mock.calls[0]?.[0];
    expect(providerRequest?.capabilities).toEqual(CONSTRAINED_MODEL_CAPABILITIES);
    expect(providerRequest?.input).toContain(lease.packageHash);
    expect(modelResult.proposal.taskId).toBe(lease.package.task.id);

    const candidate = await validateAndApplyAiProposal({
      lease,
      proposal: modelResult.proposal,
      repositoryRoot: root,
      currentRepositoryHeadSha: head,
    });

    expect(candidate.applyResult.status).toBe("APPLIED");
    expect(candidate.applyResult.scriptsExecuted).toBe(false);
    expect(candidate.applyResult.networkUsed).toBe(false);
    expect(candidate.applyResult.commitCreated).toBe(false);
    expect(candidate.applyResult.pushed).toBe(false);
    expect(candidate.applyResult.patchSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await readFile(join(root, "example.ts"), "utf8")).toBe(
      "export const value = 2;\n",
    );
    expect(await git(root, ["rev-parse", "HEAD"])).toBe(head);
  });

  it("bridges Contract V1 operations into policy and patch applier formats deterministically", async () => {
    const { head } = await repositoryFixture();
    const lease = leaseFixture(head);
    const proposal = JSON.parse(proposalJson(lease));
    proposal.proposal.operations = [
      {
        type: "insert_before",
        file: "example.ts",
        anchor: "export const value = 1;",
        content: "// before\n",
        expectedOccurrences: 1,
      },
      {
        type: "insert_after",
        file: "example.ts",
        anchor: "export const value = 1;",
        content: "\n// after",
        expectedOccurrences: 1,
      },
    ];

    const binding = buildAiProposalBinding(lease);
    expect(binding.allowedFiles).toEqual(["example.ts"]);

    const policyEnvelope = buildAiProposalPolicyEnvelope(proposal, lease);
    expect(policyEnvelope).not.toHaveProperty("capabilities");
    expect(policyEnvelope.operations).toEqual([
      expect.objectContaining({ kind: "patch_file", path: "example.ts" }),
      expect.objectContaining({ kind: "patch_file", path: "example.ts" }),
    ]);

    expect(buildAiPatchApplierProposal(proposal)).toEqual({
      operations: [
        {
          kind: "replace_text",
          path: "example.ts",
          search: "export const value = 1;",
          replacement: "// before\nexport const value = 1;",
          expectedOccurrences: 1,
        },
        {
          kind: "replace_text",
          path: "example.ts",
          search: "export const value = 1;",
          replacement: "export const value = 1;\n// after",
          expectedOccurrences: 1,
        },
      ],
    });
  });

  it("repairs an empty operations proposal once before accepting a valid Contract V1 proposal", async () => {
    const { head } = await repositoryFixture();
    const lease = leaseFixture(head);
    const empty = JSON.parse(proposalJson(lease));
    empty.proposal.operations = [];
    const invoke = vi.fn()
      .mockResolvedValueOnce({
        output: { type: "structured" as const, value: empty },
        usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
      })
      .mockResolvedValueOnce({
        output: {
          type: "structured" as const,
          value: JSON.parse(proposalJson(lease)),
        },
        usage: { inputTokens: 20, outputTokens: 20, totalTokens: 40 },
      });
    const provider: ConstrainedModelProvider = {
      provider: "fake",
      model: "proposal-v1",
      capabilities: CONSTRAINED_MODEL_CAPABILITIES,
      invoke,
    };

    const result = await invokeConstrainedAiProposal({
      lease,
      adapter: createConstrainedModelInvocationAdapter(provider),
      target: { provider: "fake", model: "proposal-v1" },
      requestId: "execution-test-schema-repair",
      timeoutMs: 5_000,
      maxOutputTokens: 512,
    });

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls[1]?.[0].input).toContain("SCHEMA REPAIR REQUIRED");
    expect(result.proposal.proposal.operations).toHaveLength(1);
  });

  it("keeps compatibility normalization bounded for legacy text wrappers", async () => {
    const { head } = await repositoryFixture();
    const lease = leaseFixture(head);
    const fence = String.fromCharCode(96).repeat(3);
    const proposal = proposalJson(lease);

    expect(
      normalizeBoundedSchemaRepairOutput(
        fence + "json\n" + proposal + "\n" + fence,
      ),
    ).toBe(proposal);

    expect(
      normalizeBoundedSchemaRepairOutput(
        JSON.stringify(fence + "json\n" + proposal + "\n" + fence),
      ),
    ).toBe(proposal);

    const proseWrapped =
      "Here is the proposal:\n" +
      fence +
      "json\n" +
      proposal +
      "\n" +
      fence;
    expect(boundedJsonObjectCandidates(proseWrapped)).toEqual([proposal]);

    const mixed =
      'Provider diagnostic: {"status":"repairing","attempt":1}\n' +
      fence +
      "json\n" +
      proposal +
      "\n" +
      fence +
      "\nDone.";
    expect(boundedJsonObjectCandidates(mixed)).toEqual([
      '{"status":"repairing","attempt":1}',
      proposal,
    ]);
  });

  it("keeps multiple legacy JSON objects explicit instead of silently choosing one", async () => {
    const { head } = await repositoryFixture();
    const lease = leaseFixture(head);
    const proposal = proposalJson(lease);
    expect(
      boundedJsonObjectCandidates(proposal + "\n" + proposal),
    ).toEqual([proposal, proposal]);
  });

  it.each(["array", "wrong binding", "forbidden capability"])(
    "keeps strict validation for structured provider output: %s",
    async (format) => {
      const { head } = await repositoryFixture();
      const lease = leaseFixture(head);
      const proposal = JSON.parse(proposalJson(lease));
      if (format === "wrong binding") proposal.packageHash = "0".repeat(64);
      if (format === "forbidden capability") proposal.capabilities.shellCommand = true;
      const value = format === "array" ? [proposal] : proposal;
      const invoke = vi.fn(async () => ({
        output: { type: "structured" as const, value },
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      }));
      await expect(invokeConstrainedAiProposal({
        lease,
        adapter: createConstrainedModelInvocationAdapter({
          provider: "fake",
          model: "proposal-v1",
          capabilities: CONSTRAINED_MODEL_CAPABILITIES,
          invoke,
        }),
        target: { provider: "fake", model: "proposal-v1" },
        requestId: `invalid-${format}`,
        timeoutMs: 5_000,
        maxOutputTokens: 512,
      })).rejects.toMatchObject({ kind: "INVALID_PROPOSAL" });
      expect(invoke).toHaveBeenCalledTimes(2);
    },
  );
});
