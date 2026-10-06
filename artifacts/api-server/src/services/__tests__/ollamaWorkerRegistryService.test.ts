
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  normalizeOllamaWorkerEndpoint,
} from "../ollamaWorkerRegistryService.js";

describe("Ollama worker endpoint policy", () => {
  it("accepts private and loopback OpenAI-compatible endpoints", () => {
    expect(
      normalizeOllamaWorkerEndpoint(
        "http://127.0.0.1:11434/v1",
      ),
    ).toBe("http://127.0.0.1:11434/v1");

    expect(
      normalizeOllamaWorkerEndpoint(
        "http://10.20.30.40:11434/v1",
      ),
    ).toBe("http://10.20.30.40:11434/v1");

    expect(
      normalizeOllamaWorkerEndpoint(
        "http://ollama-node.internal:11434/v1",
      ),
    ).toBe("http://ollama-node.internal:11434/v1");
  });

  it("rejects arbitrary public endpoints unless explicitly allowlisted", () => {
    expect(() =>
      normalizeOllamaWorkerEndpoint(
        "https://example.com/v1",
        {} as NodeJS.ProcessEnv,
      ),
    ).toThrow(/private\/loopback/);

    expect(
      normalizeOllamaWorkerEndpoint(
        "https://ollama.example.com/v1",
        {
          OLLAMA_WORKER_ALLOWED_HOSTS:
            "ollama.example.com",
        } as NodeJS.ProcessEnv,
      ),
    ).toBe("https://ollama.example.com/v1");
  });

  it("rejects credentials and non-v1 paths", () => {
    expect(() =>
      normalizeOllamaWorkerEndpoint(
        "http://user:pass@10.0.0.2:11434/v1",
      ),
    ).toThrow(/credentials/);

    expect(() =>
      normalizeOllamaWorkerEndpoint(
        "http://10.0.0.2:11434/api",
      ),
    ).toThrow(/\/v1/);
  });
});


describe("Ollama coding capacity registry", () => {
  it("counts healthy remote-pull workers as bounded model capacity", () => {
    const source = readFileSync(
      new URL("../ollamaWorkerRegistryService.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("REMOTE_OLLAMA_RUNTIME_KIND");
    expect(source).toContain("REMOTE_OLLAMA_CAPABILITY");
    expect(source).toContain("endpoint_url IS NULL");
    expect(source).toContain("SUM(GREATEST(${MAX_ACTIVE_JOBS_PER_WORKER} - running_jobs, 0))");
    expect(source).toContain("AND running_jobs < ${MAX_ACTIVE_JOBS_PER_WORKER}");
  });
});
