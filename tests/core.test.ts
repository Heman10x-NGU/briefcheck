import { describe, it, expect, vi } from "vitest";
import { fixtures } from "../src/shared/fixtures.js";
import { canonical, reviewSchema } from "../src/shared/schema.js";
import { fingerprint, isReportCurrent, review } from "../src/server/review.js";
import { SimulatedProvider, ProviderError } from "../src/server/providers.js";
import { ReviewGeneration } from "../src/client/state.js";
const make = () => structuredClone(fixtures[0].input);
describe("strict input boundaries", () => {
  it("accepts all synthetic demo fixtures", () => {
    for (const f of fixtures)
      expect(reviewSchema.safeParse(f.input).success).toBe(true);
  });
  it.each(["analytics", "palette", "madeUp", "whoWeServe"])(
    "rejects unsupported section %s",
    (key) => {
      const x = make();
      (x.proposedUpdate as Record<string, unknown>)[key] = { value: "test" };
      expect(reviewSchema.safeParse(x).success).toBe(false);
    },
  );
  it("rejects empty, partial and unknown-key sections", () => {
    for (const proposedUpdate of [
      {},
      { hero: { title: "Only title" } },
      { hero: { ...make().proposedUpdate.hero, magic: "x" } },
    ])
      expect(
        reviewSchema.safeParse({ ...make(), proposedUpdate }).success,
      ).toBe(false);
  });
  it("rejects wrong action, missing current data and duplicate evidence IDs", () => {
    let x = make();
    x.identity.actionName = "other" as never;
    expect(reviewSchema.safeParse(x).success).toBe(false);
    x = make();
    delete x.currentSite.hero;
    expect(reviewSchema.safeParse(x).success).toBe(false);
    x = make();
    x.evidence.facts.push(x.evidence.facts[0]);
    expect(reviewSchema.safeParse(x).success).toBe(false);
  });
  it("rejects oversized strings and excessive array lengths", () => {
    let x = make();
    x.proposedUpdate.hero!.title = "a".repeat(2001);
    expect(reviewSchema.safeParse(x).success).toBe(false);
    x = make();
    x.evidence.facts = Array.from({ length: 17 }, (_, i) => ({
      ...x.evidence.facts[0],
      id: String(i),
    }));
    expect(reviewSchema.safeParse(x).success).toBe(false);
  });
  it("rejects prototype paths and constraints without source IDs", () => {
    const x = make();
    x.evidence.exact[0].path = ["__proto__", "x"];
    expect(reviewSchema.safeParse(x).success).toBe(false);
    x.evidence.exact[0].path = ["pricing", "x"];
    x.evidence.exact[0].factId = "not-found";
    expect(reviewSchema.safeParse(x).success).toBe(false);
  });
});
describe("deterministic reviews and illustrative semantics", () => {
  const provider = new SimulatedProvider();
  it("has no flags for the supported example but takes no human decision", async () => {
    const r = await review(make(), provider);
    expect(r.disposition).toBe("no_flags");
    expect(r.humanDecision).toBe("not_taken");
    expect(r.provider.mode).toBe("simulated");
    expect(r.usage.inputTokens).toBe(0);
  });
  it("flags unsupported claims without claiming they are false", async () => {
    const r = await review(fixtures[1].input, provider);
    expect(r.issues.some((i) => i.code === "UNSUPPORTED_CLAIM")).toBe(true);
    expect(r.issues.some((i) => i.code === "CONTRADICTION")).toBe(false);
  });
  it("compares price and cadence in code with exact source excerpts", async () => {
    const r = await review(fixtures[2].input, provider);
    const exact = r.issues.filter((i) => i.code === "EXACT_MISMATCH");
    expect(exact).toHaveLength(2);
    expect(exact[0].proposedExcerpt).toBe("$2,400");
    expect(exact[0].evidence[0].text).toBe(
      fixtures[2].input.evidence.facts[1].text,
    );
  });
  it("flags instruction-like text as data", async () => {
    const r = await review(fixtures[3].input, provider);
    expect(r.issues.some((i) => i.code === "INSTRUCTION_LIKE_TEXT")).toBe(true);
    expect(r.humanDecision).toBe("not_taken");
  });
  it("does not use current website as factual evidence", async () => {
    const x = make();
    x.evidence.facts = x.evidence.facts.map((f) => ({
      ...f,
      sections: ["pricing"],
    }));
    const r = await review(x, provider);
    expect(r.issues.some((i) => i.code === "NO_EVIDENCE")).toBe(true);
    expect(r.sections[0].answers).toEqual({});
  });
  it("reports semantic errors unavailable, never falls back", async () => {
    const p = {
      identity: provider.identity,
      evaluate: vi.fn().mockRejectedValue(new ProviderError("Timeout.")),
    };
    const r = await review(make(), p);
    expect(r.disposition).toBe("unavailable");
    expect(r.sections[0].answers).toEqual({});
    expect(p.evaluate).toHaveBeenCalledTimes(1);
  });
  it("reports blank copy and deterministic character overflow", async () => {
    const x = make();
    x.proposedUpdate.hero!.title = "";
    x.proposedUpdate.hero!.subtitle = "a".repeat(1201);
    const r = await review(x, provider);
    expect(r.issues.map((i) => i.code)).toEqual(
      expect.arrayContaining(["EMPTY_COPY", "LENGTH_LIMIT"]),
    );
  });
  it("preserves original supplied excerpt text including HTML", async () => {
    const x = make();
    x.proposedUpdate.hero!.title = "<script>alert(1)</script>";
    const r = await review(x, provider);
    expect(
      r.sections[0].proposedExcerpts.find((x) => x.path === "hero.title")?.text,
    ).toBe("<script>alert(1)</script>");
  });
});
describe("snapshot binding and race protection", () => {
  const p = new SimulatedProvider();
  it("canonicalizes object-key order without altering array or string order", () => {
    expect(canonical({ b: 2, a: 1 })).toBe(canonical({ a: 1, b: 2 }));
    expect(canonical(["a", "b"])).not.toBe(canonical(["b", "a"]));
  });
  it.each([
    "session",
    "call",
    "target",
    "copy",
    "current",
    "facts",
    "revision",
    "constraint",
    "tone",
    "provider",
  ])("invalidates a changed %s", async (kind) => {
    const x = make();
    const r = await review(x, p);
    const provider = { ...p.identity };
    if (kind === "session") x.identity.sessionId += "2";
    if (kind === "call") x.identity.toolCallId += "2";
    if (kind === "target") x.identity.targetId += "2";
    if (kind === "copy") x.proposedUpdate.hero!.title += "!";
    if (kind === "current") x.currentSite.company = "Other";
    if (kind === "facts") x.evidence.facts[0].text += "Other";
    if (kind === "revision") x.evidence.revision += "2";
    if (kind === "constraint") x.evidence.exact[0].expected = "Other";
    if (kind === "tone") x.evidence.tone += "Formal";
    if (kind === "provider") provider.implementation += "2";
    expect(isReportCurrent(r, x, provider)).toBe(false);
  });
  it("holds a deep snapshot during async work", async () => {
    let release: () => void = () => {};
    const wait = new Promise<void>((r) => (release = r));
    const x = make();
    const original = x.proposedUpdate.hero!.title;
    const pending = review(x, {
      identity: p.identity,
      evaluate: async (s) => {
        await wait;
        return p.evaluate(s);
      },
    });
    x.proposedUpdate.hero!.title = "mutated";
    release();
    const r = await pending;
    expect(r.input.proposedUpdate.hero!.title).toBe(original);
    expect(r.fingerprint).not.toBe(fingerprint(x, p.identity));
  });
  it("rejects late results and older repeated runs", () => {
    const g = new ReviewGeneration();
    const first = g.begin();
    g.invalidate();
    expect(g.isCurrent(first)).toBe(false);
    const second = g.begin();
    const third = g.begin();
    expect(g.isCurrent(second)).toBe(false);
    expect(g.isCurrent(third)).toBe(true);
  });
});

it("routes an empty textual-section replacement to manual removal review without inference", async () => {
  const x = make();
  x.currentSite.proof = { facts: ["An existing fact"] };
  x.proposedUpdate = { proof: { facts: [] } };
  const provider = {
    identity: new SimulatedProvider().identity,
    evaluate: vi.fn(),
  };
  const r = await review(reviewSchema.parse(x), provider);
  expect(r.disposition).toBe("review_required");
  expect(r.issues.some((i) => i.code === "EMPTY_SECTION")).toBe(true);
  expect(provider.evaluate).not.toHaveBeenCalled();
});
