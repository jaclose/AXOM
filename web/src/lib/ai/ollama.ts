// ===========================================================================
// Local AI via Ollama (directive §7A) — the preferred free/no-key path.
// Detection is a cheap GET /api/tags; completion uses /api/chat with
// format:"json" so structured output is enforced at the model layer too.
// Everything degrades gracefully: an unreachable Ollama never blocks the app.
// ===========================================================================
import type { AIProvider, AiAvailability, AiJsonRequest } from "./types";

interface OllamaTagsResponse {
  models?: Array<{ name?: string }>;
}

interface OllamaChatResponse {
  message?: { content?: string };
}

export async function detectOllama(
  endpoint: string,
  fetchFn: typeof fetch = fetch,
): Promise<AiAvailability> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    const res = await fetchFn(`${endpoint}/api/tags`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return { ok: false, detail: `Ollama responded with HTTP ${res.status}.` };
    const data = await res.json() as OllamaTagsResponse;
    const models = (data.models ?? [])
      .map((m) => m.name)
      .filter((n): n is string => typeof n === "string" && n.length > 0);
    if (models.length === 0) {
      return { ok: false, detail: "Ollama is running but has no models. Pull one first (e.g. `ollama pull llama3.2`).", models: [] };
    }
    return { ok: true, detail: `Ollama reachable with ${models.length} model${models.length === 1 ? "" : "s"}.`, models };
  } catch {
    return { ok: false, detail: "Ollama not reachable. Install it from ollama.com and run `ollama serve`." };
  }
}

export function createOllamaProvider(
  endpoint: string,
  model: string,
  fetchFn: typeof fetch = fetch,
): AIProvider {
  return {
    info: { kind: "ollama", label: `Ollama · ${model} (local)`, local: true, requiresKey: false },
    available: () => detectOllama(endpoint, fetchFn),
    async completeJson(req: AiJsonRequest): Promise<unknown> {
      const res = await fetchFn(`${endpoint}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: req.signal,
        body: JSON.stringify({
          model,
          stream: false,
          // With a schema the reply is held to it, and nothing is left to chance in the wording.
          format: req.schema ?? "json",
          options: { num_predict: req.maxTokens ?? 1200, temperature: req.schema ? 0 : 0.4 },
          messages: [
            ...(req.system ? [{ role: "system", content: req.system }] : []),
            { role: "user", content: req.prompt },
          ],
        }),
      });
      if (!res.ok) throw new Error(`Local model request failed (HTTP ${res.status}).`);
      const data = await res.json() as OllamaChatResponse;
      const content = data.message?.content;
      if (typeof content !== "string" || !content.trim()) throw new Error("Local model returned an empty response.");
      try {
        return JSON.parse(content);
      } catch {
        throw new Error("Local model returned non-JSON output — try a larger or instruction-tuned model.");
      }
    },
  };
}
