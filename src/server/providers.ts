import { z } from "zod";
import {
  PROVIDER_MODELS,
  PROVIDER_LABELS,
  type ChoiceAnswer,
  type Excerpt,
  type ProviderIdentity,
} from "../shared/schema.js";
import { QUESTIONS } from "./rubric.js";
export interface SemanticState {
  section: string;
  current_excerpts: Excerpt[];
  proposed_excerpts: Excerpt[];
  approved_facts: { id: string; text: string }[];
  approved_tone: string;
}
export interface ProviderResult {
  model: string;
  answers: Record<string, ChoiceAnswer>;
  usage: { input_tokens: number; output_tokens: number };
}
export interface Provider {
  identity: ProviderIdentity;
  evaluate(state: SemanticState): Promise<ProviderResult>;
}
export class ProviderError extends Error {}
function answer(
  choice: string,
  options: string[],
  confidence = 0.84,
): ChoiceAnswer {
  const selected = 1 / options.length + confidence * (1 - 1 / options.length);
  return {
    type: "choice",
    choice,
    confidence,
    probabilities: Object.fromEntries(
      options.map((o) => [
        o,
        o === choice ? selected : (1 - selected) / (options.length - 1),
      ]),
    ),
  };
}
// Intentionally small illustrative rules, not a model, calibrated probabilities or accuracy benchmark.
export class SimulatedProvider implements Provider {
  identity: ProviderIdentity = {
    mode: "simulated",
    requestedModel: "simulated-rules-v1",
    implementation: "illustrative-rules-v1",
  };
  async evaluate(state: SemanticState): Promise<ProviderResult> {
    const copy = state.proposed_excerpts.map((x) => x.text).join("\n");
    const suspicious =
      /guarantee|\b\d+[×x]\b|trusted by \d|world[’']s|#1|award-winning|hundreds of clients/i.test(
        copy,
      );
    const injection =
      /ignore.{0,35}instructions|mark.{0,20}approved|system prompt/i.test(copy);
    const absent = state.approved_facts.length === 0;
    return {
      model: "simulated-rules-v1",
      answers: {
        support: answer(
          absent || injection
            ? "unclear"
            : suspicious
              ? "unsupported"
              : "supported",
          Object.keys(QUESTIONS.support.criteria),
          injection ? 0.4 : 0.84,
        ),
        scope: answer(
          absent
            ? "unclear"
            : /guarantee|within \d+ days|ecommerce|paid advertising/i.test(copy)
              ? "expanded"
              : "within_scope",
          Object.keys(QUESTIONS.scope.criteria),
        ),
        tone: answer(
          suspicious ? "misaligned" : "aligned",
          Object.keys(QUESTIONS.tone.criteria),
        ),
      },
      usage: { input_tokens: 0, output_tokens: 0 },
    };
  }
}
const responseSchema = z.object({
  model: z.string(),
  answers: z.record(
    z.string(),
    z.object({
      type: z.literal("choice"),
      choice: z.string(),
      confidence: z.number().finite().min(0).max(1),
      probabilities: z.record(z.string(), z.number().finite().min(0).max(1)),
    }),
  ),
  usage: z.object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
  }),
});
type LiveMode = "typesafe" | "subq";
export function validateResponse(
  raw: unknown,
  mode: LiveMode = "typesafe",
): ProviderResult {
  const label = PROVIDER_LABELS[mode];
  const parsed = responseSchema.safeParse(raw);
  if (!parsed.success || parsed.data.model !== PROVIDER_MODELS[mode])
    throw new ProviderError(
      `${label} returned a malformed response or an unexpected model.`,
    );
  const result = parsed.data;
  if (
    Object.keys(result.answers).sort().join(",") !==
    Object.keys(QUESTIONS).sort().join(",")
  )
    throw new ProviderError(
      `${label} did not return exactly the requested answers.`,
    );
  for (const [key, question] of Object.entries(QUESTIONS)) {
    const a = result.answers[key];
    const options = Object.keys(question.criteria);
    if (
      !options.includes(a.choice) ||
      Object.keys(a.probabilities).sort().join(",") !== options.sort().join(",")
    )
      throw new ProviderError(
        `${label} returned an unknown choice or incomplete distribution.`,
      );
    const sum = Object.values(a.probabilities).reduce((s, n) => s + n, 0);
    const derived =
      (Math.max(...Object.values(a.probabilities)) - 1 / options.length) /
      (1 - 1 / options.length);
    // Only TypeSafe documents this formula. SubQ's confidence is retained as
    // reported, range-checked above, and is not assumed to be comparable.
    if (mode === "typesafe" && Math.abs(a.confidence - derived) > 0.005)
      throw new ProviderError(
        `${label} returned confidence inconsistent with its distribution.`,
      );
    if (
      Math.abs(sum - 1) > 0.001 ||
      a.probabilities[a.choice] + 1e-9 <
        Math.max(...Object.values(a.probabilities))
    )
      throw new ProviderError(
        `${label} returned an inconsistent probability distribution.`,
      );
  }
  return result;
}
const LIVE_PROVIDERS = {
  typesafe: {
    endpoint: "https://api.typesafe.ai/v1/systemone",
    keyName: "TYPESAFE_API_KEY",
    timeoutMs: 12000,
  },
  subq: {
    endpoint: "https://api.subq.ai/v1/systemone",
    keyName: "SUBQ_API_KEY",
    timeoutMs: 60000,
  },
} as const;
class DecisionProvider implements Provider {
  readonly identity: ProviderIdentity;
  constructor(
    private readonly mode: LiveMode,
    private readonly key: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly timeoutMs: number = LIVE_PROVIDERS[mode].timeoutMs,
  ) {
    this.identity = {
      mode,
      requestedModel: PROVIDER_MODELS[mode],
      implementation: `${mode}-rest-v1`,
    };
    if (!key.trim())
      throw new ProviderError(
        `${LIVE_PROVIDERS[mode].keyName} is missing. Set it on the server before enabling ${PROVIDER_LABELS[mode]}.`,
      );
  }
  async evaluate(state: SemanticState): Promise<ProviderResult> {
    const label = PROVIDER_LABELS[this.mode];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(LIVE_PROVIDERS[this.mode].endpoint, {
        method: "POST",
        redirect: "error",
        headers: {
          Authorization: `Bearer ${this.key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.identity.requestedModel,
          state,
          questions: QUESTIONS,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const message =
          response.status === 401 || response.status === 403
            ? `${label} authentication or model access was rejected. Check the server key and account access.`
            : response.status === 402
              ? `${label} account has insufficient credits. Check your API console.`
              : response.status === 429
                ? `${label} rate limit reached. Retry manually later.`
                : `${label} is unavailable (HTTP ${response.status}). Retry manually later.`;
        throw new ProviderError(message);
      }
      // Bound provider responses and do not retain/log error bodies or headers.
      if (!response.body)
        throw new ProviderError(`${label} returned an empty response.`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let body = "";
      let size = 0;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 64000) {
          await reader.cancel();
          throw new ProviderError(`${label} response exceeded the size limit.`);
        }
        body += decoder.decode(part.value, { stream: true });
      }
      body += decoder.decode();
      let raw: unknown;
      try {
        raw = JSON.parse(body);
      } catch {
        throw new ProviderError(`${label} returned non-JSON content.`);
      }
      return validateResponse(raw, this.mode);
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError(
        controller.signal.aborted
          ? `${label} request timed out. Retry manually.`
          : `${label} could not be reached. Check connectivity and retry manually.`,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
export class TypeSafeProvider extends DecisionProvider {
  constructor(key: string, fetcher: typeof fetch = fetch, timeoutMs = 12000) {
    super("typesafe", key, fetcher, timeoutMs);
  }
}
export class SubQProvider extends DecisionProvider {
  constructor(key: string, fetcher: typeof fetch = fetch, timeoutMs = 60000) {
    super("subq", key, fetcher, timeoutMs);
  }
}
export function createProvider(env: NodeJS.ProcessEnv = process.env): Provider {
  switch (env.BRIEFCHECK_PROVIDER ?? "simulated") {
    case "simulated":
      return new SimulatedProvider();
    case "typesafe":
      return new TypeSafeProvider(env.TYPESAFE_API_KEY ?? "");
    case "subq":
      return new SubQProvider(env.SUBQ_API_KEY ?? "");
    default:
      throw new Error(
        "BRIEFCHECK_PROVIDER must be simulated, typesafe or subq.",
      );
  }
}
