import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => ({
  reserve: vi.fn(),
  release: vi.fn(),
  hasRemote: vi.fn(),
  enqueueRemote: vi.fn(),
  waitRemote: vi.fn(),
}));

vi.mock("../remoteOllamaWorkerService.js", () => ({
  hasRemoteOllamaWorker: mocks.hasRemote,
  enqueueRemoteOllamaInvocation: mocks.enqueueRemote,
  waitForRemoteOllamaInvocation: mocks.waitRemote,
}));

vi.mock("../ollamaWorkerRegistryService.js", () => ({
  reserveOllamaWorker: mocks.reserve,
  releaseOllamaWorkerReservation: mocks.release,
}));

import {
  createScheduledOllamaProviderAdapter,
} from "../localCodingOllamaWorkerProviderService.js";

describe("scheduled Ollama constrained provider", () => {
  beforeEach(() => {
    mocks.release.mockResolvedValue(undefined);
    mocks.hasRemote.mockResolvedValue(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("uses a healthy remote pull worker without exposing its Ollama endpoint", async () => {
    mocks.hasRemote.mockResolvedValue(true);
    mocks.enqueueRemote.mockResolvedValue({ id: 77 });
    mocks.waitRemote.mockResolvedValue({
      providerRequestId: "remote-1",
      output: { type: "text", text: "remote result" },
      usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
    });

    const provider = createScheduledOllamaProviderAdapter({
      modelId: "qwen2.5-coder:7b",
    });
    const signal = new AbortController().signal;
    const result = await provider.invoke(
      {
        requestId: "req-remote",
        input: JSON.stringify({ version: 1, system: "system", user: "user" }),
        responseFormat: { type: "text" },
        maxOutputTokens: 256,
        capabilities: provider.capabilities,
      },
      { signal },
    );

    expect(result.output).toEqual({ type: "text", text: "remote result" });
    expect(mocks.enqueueRemote).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "req-remote",
      modelId: "qwen2.5-coder:7b",
    }));
    expect(mocks.waitRemote).toHaveBeenCalledWith(77, signal);
    expect(mocks.reserve).not.toHaveBeenCalled();
  });

  it("reserves a worker, invokes it, and releases capacity", async () => {
    vi.stubEnv("OLLAMA_WORKER_API_KEY", "worker-secret");
    mocks.reserve.mockResolvedValue({
      id: 9,
      workerName: "ollama-gpu-01",
      modelId: "qwen2.5-coder:7b",
      endpointUrl: "http://10.10.0.21:11434/v1",
      availableSlots: 0,
      reservedAt: new Date().toISOString(),
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            id: "ollama-request-1",
            choices: [
              {
                message: {
                  content: "{\"version\":1}",
                },
              },
            ],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 4,
              total_tokens: 14,
            },
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          },
        ),
      ),
    );

    const provider =
      createScheduledOllamaProviderAdapter({
        modelId: "qwen2.5-coder:7b",
      });

    const result = await provider.invoke(
      {
        requestId: "req-1",
        input: JSON.stringify({
          version: 1,
          system: "system",
          user: "user",
        }),
        responseFormat: { type: "text" },
        maxOutputTokens: 256,
        capabilities: provider.capabilities,
      },
      {
        signal: new AbortController().signal,
      },
    );

    expect(mocks.reserve).toHaveBeenCalledWith(
      "qwen2.5-coder:7b",
    );

    expect(result.output).toEqual({
      type: "text",
      text: "{\"version\":1}",
    });

    const fetchInit = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as RequestInit | undefined;
    expect(fetchInit?.headers).toMatchObject({
      "x-api-key": "worker-secret",
    });

    expect(mocks.release).toHaveBeenCalledWith(
      9,
      "success",
      expect.any(Number),
    );
  });

  it("parses structured planner JSON returned by a scheduled Ollama worker", async () => {
    mocks.reserve.mockResolvedValue({
      id: 10,
      workerName: "ollama-gpu-02",
      modelId: "qwen2.5-coder:7b",
      endpointUrl: "http://10.10.0.22:11434/v1",
      availableSlots: 0,
      reservedAt: new Date().toISOString(),
    });

    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      new Response(
        JSON.stringify({
          id: "ollama-request-structured",
          choices: [
            {
              message: {
                content: JSON.stringify({
                  version: 1,
                  taskId: "task-1",
                  objective: "Create the requested file.",
                  workstreams: [],
                }),
              },
            },
          ],
          usage: {
            prompt_tokens: 20,
            completion_tokens: 8,
            total_tokens: 28,
          },
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = createScheduledOllamaProviderAdapter({
      modelId: "qwen2.5-coder:7b",
    });

    const result = await provider.invoke(
      {
        requestId: "req-structured",
        input: JSON.stringify({
          version: 1,
          system: "Return JSON.",
          user: "Plan the task.",
        }),
        responseFormat: {
          type: "structured",
          schemaName: "coding_multi_task_plan_v1",
          jsonSchema: { type: "object" },
        },
        maxOutputTokens: 256,
        capabilities: provider.capabilities,
      },
      { signal: new AbortController().signal },
    );

    expect(result.output).toEqual({
      type: "structured",
      value: {
        version: 1,
        taskId: "task-1",
        objective: "Create the requested file.",
        workstreams: [],
      },
    });

    const requestBody = JSON.parse(
      String((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body),
    ) as Record<string, unknown>;
    expect(requestBody.response_format).toEqual({
      type: "json_object",
    });
    expect(
      String(
        (
          requestBody.messages as Array<{ role: string; content: string }>
        )[0]?.content,
      ),
    ).toContain('{"type":"object"}');

    expect(mocks.release).toHaveBeenCalledWith(
      10,
      "success",
      expect.any(Number),
    );
  });

  it("accepts fenced JSON from Ollama structured responses", async () => {
    mocks.reserve.mockResolvedValue({
      id: 11,
      workerName: "ollama-gpu-03",
      modelId: "qwen2.5-coder:7b",
      endpointUrl: "http://10.10.0.23:11434/v1",
      availableSlots: 0,
      reservedAt: new Date().toISOString(),
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            id: "ollama-request-fenced",
            choices: [
              {
                message: {
                  content:
                    "```json\n{\"commands\":[\"git status --short\"],\"reason\":\"Check repo status\"}\n```",
                },
              },
            ],
            usage: {
              prompt_tokens: 15,
              completion_tokens: 10,
              total_tokens: 25,
            },
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          },
        ),
      ),
    );

    const provider = createScheduledOllamaProviderAdapter({
      modelId: "qwen2.5-coder:7b",
    });

    const result = await provider.invoke(
      {
        requestId: "req-fenced",
        input: JSON.stringify({
          version: 1,
          system: "Return JSON.",
          user: "Check status.",
        }),
        responseFormat: {
          type: "structured",
          schemaName: "trusted_powershell_plan",
          jsonSchema: { type: "object" },
        },
        maxOutputTokens: 256,
        capabilities: provider.capabilities,
      },
      { signal: new AbortController().signal },
    );

    expect(result.output).toEqual({
      type: "structured",
      value: {
        commands: ["git status --short"],
        reason: "Check repo status",
      },
    });
  });

  it("fails when no worker has capacity", async () => {
    mocks.reserve.mockResolvedValue(null);

    const provider =
      createScheduledOllamaProviderAdapter({
        modelId: "qwen2.5-coder:7b",
      });

    await expect(
      provider.invoke(
        {
          requestId: "req-2",
          input: JSON.stringify({
            version: 1,
            system: "system",
            user: "user",
          }),
          responseFormat: { type: "text" },
          maxOutputTokens: 256,
          capabilities: provider.capabilities,
        },
        {
          signal: new AbortController().signal,
        },
      ),
    ).rejects.toMatchObject({
      code: "UNAVAILABLE",
    });
  });
});
