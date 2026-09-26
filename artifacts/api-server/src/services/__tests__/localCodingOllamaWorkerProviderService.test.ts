
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
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("reserves a worker, invokes it, and releases capacity", async () => {
    mocks.reserve.mockResolvedValue({
      id: 9,
      workerName: "ollama-gpu-01",
      modelId: "qwen2.5-coder:7b",
      endpointUrl:
        "http://10.10.0.21:11434/v1",
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

    expect(mocks.release).toHaveBeenCalledWith(
      9,
      "success",
      expect.any(Number),
    );
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
          signal:
            new AbortController().signal,
        },
      ),
    ).rejects.toMatchObject({
      code: "UNAVAILABLE",
    });
  });
});
