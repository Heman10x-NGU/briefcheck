import { describe, it, expect, vi } from "vitest";
import { MODEL } from "../src/shared/schema.js";
import { QUESTIONS } from "../src/server/rubric.js";
import {
  TypeSafeProvider,
  validateResponse,
  type SemanticState,
} from "../src/server/providers.js";
const state: SemanticState = {
  section: "hero",
  current_excerpts: [],
  proposed_excerpts: [{ path: "hero.title", text: "Test" }],
  approved_facts: [{ id: "F1", text: "Test" }],
  approved_tone: "Plain",
};
function valid() {
  return {
    model: MODEL,
    answers: Object.fromEntries(
      Object.entries(QUESTIONS).map(([key, q]) => {
        const keys = Object.keys(q.criteria);
        return [
          key,
          {
            type: "choice",
            choice: keys[0],
            confidence: 1,
            probabilities: Object.fromEntries(
              keys.map((o, i) => [o, i === 0 ? 1 : 0]),
            ),
          },
        ];
      }),
    ),
    usage: { input_tokens: 100, output_tokens: 12 },
  };
}
describe("official TypeSafe contract without paid calls", () => {
  it("sends server-only Bearer credentials to the fixed endpoint and pins model", async () => {
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify(valid())));
    const result = await new TypeSafeProvider("test-only-key", f).evaluate(
      state,
    );
    expect(f.mock.calls[0][0]).toBe("https://api.typesafe.ai/v1/systemone");
    const request = f.mock.calls[0][1];
    expect(request.redirect).toBe("error");
    expect(request.headers.Authorization).toBe("Bearer test-only-key");
    expect(JSON.parse(request.body)).toEqual({
      model: MODEL,
      state,
      questions: QUESTIONS,
    });
    expect(result.model).toBe(MODEL);
  });
  it.each([401, 403, 429, 500, 529])(
    "fails explicitly for HTTP %s without leaking body",
    async (status) => {
      const f = vi
        .fn()
        .mockResolvedValue(new Response("secret provider body", { status }));
      await expect(
        new TypeSafeProvider("secret", f).evaluate(state),
      ).rejects.toThrow(/TypeSafe/);
      expect(f).toHaveBeenCalledTimes(1);
    },
  );
  it("rejects a missing key before any network", () => {
    expect(() => new TypeSafeProvider("")).toThrow(/missing/);
  });
  it("rejects non-JSON and oversized bodies", async () => {
    for (const body of ["not JSON", "a".repeat(64001)])
      await expect(
        new TypeSafeProvider(
          "test",
          vi.fn().mockResolvedValue(new Response(body)),
        ).evaluate(state),
      ).rejects.toThrow();
  });
  it("redacts network errors and timeout messages", async () => {
    await expect(
      new TypeSafeProvider(
        "secret",
        vi.fn().mockRejectedValue(new Error("secret token")),
      ).evaluate(state),
    ).rejects.toThrow("could not be reached");
    const f = vi.fn(
      (_url, init) =>
        new Promise((_resolve, reject) =>
          init.signal.addEventListener("abort", () =>
            reject(new Error("private")),
          ),
        ),
    );
    await expect(
      new TypeSafeProvider("secret", f as unknown as typeof fetch, 5).evaluate(
        state,
      ),
    ).rejects.toThrow("timed out");
  });
  it.each([
    "model",
    "missing",
    "extra",
    "type",
    "choice",
    "range",
    "sum",
    "nan",
    "confidence",
    "max",
  ])("rejects malformed %s response", (kind) => {
    const body = valid();
    const a = body.answers.support as {
      type: string;
      choice: string;
      confidence: number;
      probabilities: Record<string, number>;
    };
    if (kind === "model") body.model = "other";
    if (kind === "missing") delete body.answers.support;
    if (kind === "extra") body.answers.extra = a;
    if (kind === "type") a.type = "score";
    if (kind === "choice") a.choice = "unknown";
    if (kind === "range") a.confidence = 1.1;
    if (kind === "sum") a.probabilities.supported = 0.5;
    if (kind === "nan") a.confidence = NaN;
    if (kind === "confidence") {
      a.confidence = 1;
      Object.keys(a.probabilities).forEach((k) => (a.probabilities[k] = 0.25));
    }
    if (kind === "max") a.choice = "unsupported";
    expect(() => validateResponse(body)).toThrow();
  });
});
