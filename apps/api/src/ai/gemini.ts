/**
 * Thin Gemini client. Gemini explains; it never decides. Callers must treat every failure as "no answer" and use a
 * deterministic fallback. Uses the REST API directly (no SDK) so the coordinator keeps a small dependency surface.
 */

export interface GeminiConfig {
  apiKey?: string;
  model: string;
  timeoutMs: number;
  enabled: boolean;
  maxConcurrent: number;
}

export interface JsonGenerator {
  readonly available: boolean;
  /** Returns the parsed JSON object, or null on any failure (timeout, bad JSON, safety block, missing key). */
  generateJson(request: {
    system: string;
    user: string;
    responseSchema: object;
  }): Promise<unknown | null>;
}

export function geminiConfigFromEnv(env: NodeJS.ProcessEnv = process.env): GeminiConfig {
  return {
    apiKey: env.GEMINI_API_KEY || undefined,
    model: env.GEMINI_MODEL || "gemini-flash-latest",
    timeoutMs: Number(env.GEMINI_TIMEOUT_MS ?? 8000),
    enabled: env.AI_FEATURES_ENABLED !== "false",
    maxConcurrent: 4,
  };
}

type FetchLike = typeof fetch;

export class GeminiClient implements JsonGenerator {
  private inFlight = 0;

  constructor(
    private readonly config: GeminiConfig,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  get available(): boolean {
    return this.config.enabled && Boolean(this.config.apiKey);
  }

  async generateJson(request: {
    system: string;
    user: string;
    responseSchema: object;
  }): Promise<unknown | null> {
    if (!this.available) return null;
    // Global concurrency cap: shed load instead of queueing behind a slow upstream.
    if (this.inFlight >= this.config.maxConcurrent) return null;
    this.inFlight++;
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const result = await this.once(request);
        if (result.kind === "ok") return result.value;
        if (result.kind === "fatal") return null;
        await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
      }
      return null;
    } finally {
      this.inFlight--;
    }
  }

  private async once(request: {
    system: string;
    user: string;
    responseSchema: object;
  }): Promise<{ kind: "ok"; value: unknown } | { kind: "retry" } | { kind: "fatal" }> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.config.model)}:generateContent`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": this.config.apiKey ?? "" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: request.system }] },
          contents: [{ role: "user", parts: [{ text: request.user }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 512,
            responseMimeType: "application/json",
            responseSchema: request.responseSchema,
          },
        }),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch {
      return { kind: "fatal" }; // timeout or network: don't retry, the caller falls back
    }
    if (res.status === 429 || res.status >= 500) return { kind: "retry" };
    if (!res.ok) return { kind: "fatal" };
    try {
      const body = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
      };
      const candidate = body.candidates?.[0];
      if (!candidate || (candidate.finishReason && candidate.finishReason !== "STOP"))
        return { kind: "fatal" };
      const text = candidate.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
      return { kind: "ok", value: JSON.parse(text) };
    } catch {
      return { kind: "fatal" };
    }
  }
}
