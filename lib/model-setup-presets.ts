import type { DiscoveredModel } from "@/lib/model-discovery";

export interface ModelSetupPreset {
  id: string;
  name: string;
  baseUrl: string;
  api: "openai-completions" | "openai-responses" | "anthropic-messages" | "google-generative-ai";
  keyUrl: string;
  modelHints: string[];
}

/** Official provider endpoints used by the first-run model setup. */
export const MODEL_SETUP_PRESETS: readonly ModelSetupPreset[] = [
  {
    id: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    api: "openai-responses",
    keyUrl: "https://platform.openai.com/api-keys",
    modelHints: ["gpt-5", "gpt-4.1"],
  },
  {
    id: "anthropic",
    name: "Anthropic",
    baseUrl: "https://api.anthropic.com",
    api: "anthropic-messages",
    keyUrl: "https://platform.claude.com/settings/keys",
    modelHints: ["claude-sonnet", "claude-opus", "claude-haiku"],
  },
  {
    id: "google",
    name: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com",
    api: "google-generative-ai",
    keyUrl: "https://aistudio.google.com/apikey",
    modelHints: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini"],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    api: "openai-completions",
    keyUrl: "https://platform.deepseek.com/api_keys",
    modelHints: ["deepseek-chat", "deepseek-reasoner"],
  },
  {
    id: "moonshotai-cn",
    name: "Moonshot",
    baseUrl: "https://api.moonshot.cn/v1",
    api: "openai-completions",
    keyUrl: "https://platform.kimi.com/console/api-keys",
    modelHints: ["kimi-k2", "moonshot-v1"],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    api: "openai-completions",
    keyUrl: "https://openrouter.ai/settings/keys",
    modelHints: ["anthropic/claude-sonnet", "openai/gpt-5", "google/gemini"],
  },
] as const;

interface ModelsConfigLike {
  providers?: Record<string, { models?: Array<{ id?: string }> }>;
}

export function hasUsableModelSetup(config: ModelsConfigLike, managedProviderReady: boolean): boolean {
  if (managedProviderReady) return true;
  return Object.values(config.providers ?? {}).some((provider) =>
    provider.models?.some((model) => typeof model.id === "string" && model.id.trim().length > 0),
  );
}

export function pickSetupModel(models: readonly DiscoveredModel[], hints: readonly string[]): string {
  for (const hint of hints) {
    const normalizedHint = hint.toLocaleLowerCase();
    const exact = models.find((model) => model.id.toLocaleLowerCase() === normalizedHint);
    if (exact) return exact.id;
  }
  for (const hint of hints) {
    const normalizedHint = hint.toLocaleLowerCase();
    const partial = models.find((model) =>
      model.id.toLocaleLowerCase().includes(normalizedHint)
      || model.name?.toLocaleLowerCase().includes(normalizedHint),
    );
    if (partial) return partial.id;
  }
  return models[0]?.id ?? "";
}
