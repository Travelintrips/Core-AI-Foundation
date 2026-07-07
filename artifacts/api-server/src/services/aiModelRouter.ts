import { getAllActiveModels, type ModelWithProvider } from "./aiModelService.js";
import { getProviderApiKey } from "./aiSecretService.js";

type TaskType = "text" | "reasoning" | "image" | "multimodal" | "fast" | "document" | "code";

/** Infer task type from prompt content via keyword heuristics. */
function detectTaskType(prompt: string): TaskType {
  const lower = prompt.toLowerCase();
  if (/\b(image|generate image|draw|picture|photo|illustration|artwork|flux|sdxl|stable diffusion|dall-?e)\b/i.test(lower)) return "image";
  if (/\b(reason|step.?by.?step|think through|analyze carefully|complex problem|break down|chain of thought)\b/i.test(lower)) return "reasoning";
  if (/\b(long document|review this|summarize this|full paper|entire article|entire text|book)\b/i.test(lower)) return "document";
  if (/\b(quick|fast|brief answer|translate|classify|tag|label|one word|yes or no)\b/i.test(lower)) return "fast";
  if (/\b(code|function|script|debug|refactor|implement|algorithm|typescript|python|javascript)\b/i.test(lower)) return "code";
  if (/\b(image|screenshot|photo|picture|chart|diagram|graph|see|look at|visual)\b/i.test(lower)) return "multimodal";
  return "text";
}

/** Preferred capability keywords per task type. Higher position = higher weight. */
const TASK_CAPABILITY_MAP: Record<TaskType, string[]> = {
  text: ["text", "orchestrator", "copywriting", "brief", "analysis"],
  reasoning: ["reasoning", "analysis", "text"],
  image: ["image-generation", "image"],
  multimodal: ["multimodal", "vision", "text"],
  fast: ["fast", "text"],
  document: ["document", "review", "text"],
  code: ["code", "text"],
};

/**
 * Auto-routes to the best available model for the given prompt.
 * Filters to: active provider + active model + API key configured.
 * Scores by capability match and cost. Returns null if nothing available.
 */
export async function routeToModel(prompt: string): Promise<ModelWithProvider | null> {
  const allModels = await getAllActiveModels();

  // Filter to models whose provider has a configured API key
  const available = allModels.filter(({ provider }) => !!getProviderApiKey(provider.slug));

  if (available.length === 0) return null;

  const taskType = detectTaskType(prompt);
  const preferredCaps = TASK_CAPABILITY_MAP[taskType];

  // Score each model
  const scored = available.map((row) => {
    const caps: string[] = row.model.capabilities ?? [];
    const capScore = preferredCaps.reduce(
      (acc, cap, idx) => acc + (caps.includes(cap) ? preferredCaps.length - idx : 0),
      0,
    );
    // Lower cost = better; null cost treated as mid-tier
    const costScore = row.model.costPerOutputToken ? parseFloat(row.model.costPerOutputToken) : 0.00005;
    return { ...row, capScore, costScore };
  });

  // Sort: higher capScore first, then lower cost
  scored.sort((a, b) => {
    if (b.capScore !== a.capScore) return b.capScore - a.capScore;
    return a.costScore - b.costScore;
  });

  const best = scored[0];
  return best ? { model: best.model, provider: best.provider } : null;
}

/**
 * Returns all models that have a configured API key, for fallback chains.
 * Excludes the specified model ID.
 */
export async function getFallbackModels(excludeModelId: number): Promise<ModelWithProvider[]> {
  const allModels = await getAllActiveModels();
  return allModels.filter(
    ({ model, provider }) => model.id !== excludeModelId && !!getProviderApiKey(provider.slug),
  );
}
