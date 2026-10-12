import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import {
  SubQProvider,
  createProvider,
  type SemanticState,
} from "../src/server/providers.js";
import { QUESTIONS } from "../src/server/rubric.js";
import { createApp } from "../src/server/app.js";
import { fixtures } from "../src/shared/fixtures.js";
import { configSchema, reportSchema } from "../src/shared/schema.js";

const state: SemanticState = {
  section: "hero",
  current_excerpts: [],
  proposed_excerpts: [
    { path: "hero.title", text: "A website for small teams" },
  ],
  approved_facts: [{ id: "F1", text: "We build websites for small teams" }],
  approved_tone: "Plain",
};
function valid() {
  return {
    model: "subq-snap-preview",
    answers: Object.fromEntries(
      Object.entries(QUESTIONS).map(([key, q]) => {
        const options = Object.keys(q.criteria);
        return [
          key,
          {
            type: "choice",
            choice: options[0],
            confidence: 1,
            probabilities: Object.fromEntries(
              options.map((o, i) => [o, i === 0 ? 1 : 0]),
            ),
          },
        ];
      }),
    ),
    usage: { input_tokens: 100, output_tokens: 0 },
  };
}

describe("SubQ Decisions adapter, mocked requests only", () => {
  it("uses only the SubQ endpoint, model and server key", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(valid())));
    const provider = new SubQProvider("fake-subq-key", fetcher);
    const result = await provider.evaluate(state);
    expect(provider.identity.mode).toBe("subq");
    expect(result.model).toBe("subq-snap-preview");
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("https://api.subq.ai/v1/systemone");
    expect(init.redirect).toBe("error");
    expect(init.headers.Authorization).toBe("Bearer fake-subq-key");
    expect(JSON.parse(init.body)).toEqual({
      model: "subq-snap-preview",
      state,
      questions: QUESTIONS,
    });
  });
  it.each([401, 402, 403, 422, 429, 503])(
    "redacts HTTP %s errors without retrying",
    async (status) => {
      const fetcher = vi
        .fn()
        .mockResolvedValue(
          new Response("private upstream body fake-subq-key", { status }),
        );
      await expect(
        new SubQProvider("fake-subq-key", fetcher).evaluate(state),
      ).rejects.toThrow(/SubQ/);
      expect(fetcher).toHaveBeenCalledTimes(1);
      const error = await new SubQProvider(
        "fake-subq-key",
        vi
          .fn()
          .mockResolvedValue(new Response("private upstream body", { status })),
      )
        .evaluate(state)
        .catch((e) => e);
      expect(error.message).not.toMatch(/private|fake-subq-key/);
      if (status === 402) expect(error.message).toMatch(/credits/);
    },
  );
  it.each([
    "model",
    "missing",
    "extra",
    "type",
    "choice",
    "range",
    "sum",
    "max",
    "tokens",
    "distribution",
  ])("rejects malformed %s", async (kind) => {
    const body = valid();
    const a = body.answers.support;
    if (kind === "model") body.model = "jev-1.13.0";
    if (kind === "missing") delete body.answers.support;
    if (kind === "extra") body.answers.extra = a;
    if (kind === "type") a.type = "score";
    if (kind === "choice") a.choice = "unknown";
    if (kind === "range") a.confidence = 1.1;
    if (kind === "sum") a.probabilities.supported = 0.5;
    if (kind === "max") a.choice = "unsupported";
    if (kind === "tokens") body.usage.input_tokens = -1;
    if (kind === "distribution") delete a.probabilities.unclear;
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(body)));
    await expect(
      new SubQProvider("fake", fetcher).evaluate(state),
    ).rejects.toThrow();
  });
  it("keeps SubQ's reported confidence without assuming TypeSafe's formula", async () => {
    const body = valid();
    body.answers.support.probabilities = {
      supported: 0.8,
      unsupported: 0.1,
      contradicted: 0.05,
      unclear: 0.05,
    };
    body.answers.support.confidence = 0.8;
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(body)));
    expect(
      (await new SubQProvider("fake", fetcher).evaluate(state)).answers.support
        .confidence,
    ).toBe(0.8);
  });
  it.each(["not JSON", "a".repeat(64001), ""])(
    "rejects non-JSON, oversized or empty responses",
    async (body) => {
      await expect(
        new SubQProvider(
          "fake",
          vi.fn().mockResolvedValue(new Response(body)),
        ).evaluate(state),
      ).rejects.toThrow();
    },
  );
  it("redacts network errors and times out without retries", async () => {
    await expect(
      new SubQProvider(
        "fake",
        vi.fn().mockRejectedValue(new Error("private key")),
      ).evaluate(state),
    ).rejects.toThrow("SubQ could not be reached");
    const fetcher = vi.fn(
      (_url, init) =>
        new Promise((_resolve, reject) =>
          init.signal.addEventListener("abort", () =>
            reject(new Error("private")),
          ),
        ),
    );
    await expect(
      new SubQProvider("fake", fetcher as unknown as typeof fetch, 5).evaluate(
        state,
      ),
    ).rejects.toThrow("timed out");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("never borrows the other provider's key or enables live mode from a key alone", () => {
    expect(createProvider({ SUBQ_API_KEY: "fake" }).identity.mode).toBe(
      "simulated",
    );
    expect(() =>
      createProvider({ BRIEFCHECK_PROVIDER: "subq", TYPESAFE_API_KEY: "fake" }),
    ).toThrow(/SUBQ_API_KEY/);
    expect(
      createProvider({ BRIEFCHECK_PROVIDER: "subq", SUBQ_API_KEY: "fake" })
        .identity.mode,
    ).toBe("subq");
    expect(() => createProvider({ BRIEFCHECK_PROVIDER: "unknown" })).toThrow();
  });
  it("requires consent and produces a valid SubQ report through the HTTP API", async () => {
    const fetcher = vi
      .fn()
      .mockImplementation(async () => new Response(JSON.stringify(valid())));
    const app = createApp(new SubQProvider("fake-subq-key", fetcher));
    const config = (await request(app).get("/api/config")).body;
    expect(configSchema.parse(config).externalTransmission).toBe(true);
    expect(
      configSchema.safeParse({ ...config, externalTransmission: false })
        .success,
    ).toBe(false);
    expect(
      configSchema.safeParse({
        ...config,
        provider: { ...config.provider, requestedModel: "jev-1.13.0" },
      }).success,
    ).toBe(false);
    const denied = await request(app)
      .post("/api/reviews")
      .send(fixtures[0].input);
    expect(denied.status).toBe(403);
    expect(denied.body.error).toContain("SubQ");
    expect(fetcher).not.toHaveBeenCalled();
    const result = await request(app)
      .post("/api/reviews")
      .set("X-BriefCheck-Live-Consent", "1")
      .send(fixtures[0].input);
    expect(result.status).toBe(200);
    expect(
      reportSchema.parse(result.body.report).provider.returnedModels,
    ).toEqual(["subq-snap-preview"]);
    expect(result.body.report.humanDecision).toBe("not_taken");
    expect(JSON.stringify(result.body)).not.toContain("fake-subq-key");
  });
});
