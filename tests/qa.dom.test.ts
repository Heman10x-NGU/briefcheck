// @vitest-environment jsdom
// Independent component-flow QA. These tests use a DOM emulator, not a real browser.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { App } from "../src/client/App.js";
import { fixtures } from "../src/shared/fixtures.js";
import {
  CONFIDENCE_THRESHOLD,
  PROVIDER_MODELS,
  RUBRIC_VERSION,
  type Report,
} from "../src/shared/schema.js";
import { review } from "../src/server/review.js";
import { SimulatedProvider } from "../src/server/providers.js";

const provider = new SimulatedProvider();
const config = {
  provider: provider.identity,
  rubricVersion: RUBRIC_VERSION,
  threshold: CONFIDENCE_THRESHOLD,
  externalTransmission: false,
};
const response = (body: unknown, ok = true) =>
  ({ ok, status: ok ? 200 : 502, json: async () => body }) as Response;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
let root: Root;
let container: HTMLDivElement;
let report: Report;
let reviewReply: () => Promise<Response>;
let configReply: () => Promise<Response>;
let requests: { url: string; init?: RequestInit }[];
const text = () => container.textContent ?? "";
const buttons = () => Array.from(container.querySelectorAll("button"));
const button = (label: string) => {
  const node = buttons().find((b) => b.textContent?.includes(label));
  if (!node) throw new Error(`Missing button: ${label}`);
  return node;
};
const click = async (label: string) => {
  await act(async () => {
    button(label).click();
    await tick();
  });
};
const fill = async (id: string, value: string) => {
  await act(async () => {
    const node = container.querySelector(`[id="${id}"]`) as HTMLTextAreaElement;
    if (!node) throw new Error(`Missing field: ${id}`);
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
    await tick();
  });
};
const run = () => click("Run simulated review");
const mount = async () => {
  await act(async () => {
    root.render(createElement(App));
    await tick();
  });
};
const reviewRequests = () => requests.filter((r) => r.url === "/api/reviews");

beforeEach(async () => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  report = await review(structuredClone(fixtures[0].input), provider);
  requests = [];
  configReply = async () => response(config);
  reviewReply = async () => response({ report });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({ url, init });
      return url === "/api/config" ? configReply() : reviewReply();
    }),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("Independent DOM-emulated user flows", () => {
  it("starts keyless with explicit simulation and human-advisory limits", async () => {
    await mount();
    expect(text()).toContain("SIMULATED DEMO");
    expect(text()).toContain("No key needed");
    expect(text()).toContain("don’t measure real-model accuracy");
    expect(button("Run simulated review").disabled).toBe(false);
    await run();
    expect(text()).toContain("SIMULATED RESULT");
    expect(text()).toContain("This is not approval or factual certification");
    expect(text()).toContain("Human decision: not taken");
    expect(reviewRequests()).toHaveLength(1);
  });
  it("invalidates completed output when proposed copy changes", async () => {
    await mount();
    await run();
    expect(text()).toContain("SIMULATED RESULT");
    await fill("hero.title", "A newly edited title.");
    expect(text()).not.toContain("SIMULATED RESULT");
    expect(text()).toContain("previous report is invalid");
    expect(button("Run simulated review").disabled).toBe(false);
  });
  it("invalidates completed output when approved evidence changes", async () => {
    await mount();
    await run();
    await click("Approved evidence");
    await fill(
      "evidence",
      JSON.stringify({
        ...fixtures[0].input.evidence,
        revision: "new-revision",
      }),
    );
    expect(text()).not.toContain("SIMULATED RESULT");
    expect(text()).toContain("previous report is invalid");
  });
  it("invalidates completed output when session/action context changes", async () => {
    await mount();
    await run();
    await click("Action & current site");
    await fill(
      "context",
      JSON.stringify({
        identity: {
          ...fixtures[0].input.identity,
          sessionId: "different-session",
        },
        currentSite: fixtures[0].input.currentSite,
      }),
    );
    expect(text()).not.toContain("SIMULATED RESULT");
    expect(text()).toContain("previous report is invalid");
  });
  it("keeps a report on tab-only navigation without changing its input", async () => {
    await mount();
    await run();
    await click("Approved evidence");
    await click("Action & current site");
    await click("Copy comparison");
    expect(text()).toContain("SIMULATED RESULT");
    expect(text()).not.toContain("previous report is invalid");
    expect(reviewRequests()).toHaveLength(1);
  });
  it("discards a late result after an edit and permits a fresh retry", async () => {
    let finish!: (value: Response) => void;
    reviewReply = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    await mount();
    await run();
    expect(text()).toContain("Review in progress");
    await fill("hero.title", "Edited while pending");
    await act(async () => {
      finish(response({ report }));
      await tick();
    });
    expect(text()).not.toContain("SIMULATED RESULT");
    expect(text()).toContain("previous report is invalid");
    expect(button("Run simulated review").disabled).toBe(false);
  });
  it("allows only one in-flight review under repeated button clicks", async () => {
    let finish!: (value: Response) => void;
    reviewReply = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    await mount();
    await act(async () => {
      const b = button("Run simulated review");
      b.click();
      b.click();
      b.click();
      await tick();
    });
    expect(reviewRequests()).toHaveLength(1);
    expect(button("Review in progress").disabled).toBe(true);
    await act(async () => {
      finish(response({ report }));
      await tick();
    });
    expect(text()).toContain("SIMULATED RESULT");
  });
  it("rejects malformed evidence JSON and oversized copy before posting", async () => {
    await mount();
    await click("Approved evidence");
    await fill("evidence", "{ broken JSON");
    await run();
    expect(text()).toContain("The input is invalid");
    expect(reviewRequests()).toHaveLength(0);
    await fill("evidence", JSON.stringify(fixtures[0].input.evidence));
    await click("Copy comparison");
    await fill("hero.title", "x".repeat(2001));
    await run();
    expect(text()).toContain("The input is invalid");
    expect(reviewRequests()).toHaveLength(0);
  });
  it("shows a configuration failure and leaves review disabled", async () => {
    configReply = async () => {
      throw new TypeError("Failed to fetch");
    };
    await mount();
    expect(text()).toContain("Could not read server configuration");
    expect(button("Run simulated review").disabled).toBe(true);
    expect(reviewRequests()).toHaveLength(0);
  });
  it("recovers from an HTTP error and runs a subsequent successful retry", async () => {
    reviewReply = async () =>
      response({ error: "Upstream unavailable. Retry manually." }, false);
    await mount();
    await run();
    expect(text()).toContain("Upstream unavailable");
    expect(text()).not.toContain("No flags in this check");
    expect(button("Run simulated review").disabled).toBe(false);
    reviewReply = async () => response({ report });
    await run();
    expect(text()).toContain("SIMULATED RESULT");
    expect(reviewRequests()).toHaveLength(2);
  });
  it("recovers from malformed JSON and a network failure without a clear result", async () => {
    reviewReply = async () =>
      ({
        ok: true,
        json: async () => {
          throw new SyntaxError("Unexpected HTML response");
        },
      }) as unknown as Response;
    await mount();
    await run();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(text()).not.toContain("No flags in this check");
    reviewReply = async () => {
      throw new TypeError("Network unavailable");
    };
    await run();
    expect(text()).toContain("Network unavailable");
    expect(button("Run simulated review").disabled).toBe(false);
  });
  it.each([
    "empty",
    "bad confidence",
    "wrong input",
    "wrong provider",
    "failed clear response",
  ])(
    "rejects a %s report instead of showing a clear result or crashing",
    async (kind) => {
      const invalid = structuredClone(report);
      if (kind === "bad confidence") {
        const answer = Object.values(invalid.sections[0].answers)[0];
        (answer as unknown as { confidence: string }).confidence = "bogus";
      }
      if (kind === "wrong input")
        invalid.input.identity.sessionId = "another-session";
      if (kind === "wrong provider") invalid.provider.mode = "typesafe";
      reviewReply = async () =>
        response(
          { report: kind === "empty" ? {} : invalid },
          kind !== "failed clear response",
        );
      await mount();
      await run();
      expect(container.querySelector("h1")).not.toBeNull();
      expect(container.querySelector('[role="alert"]')).not.toBeNull();
      expect(text()).not.toContain("No flags in this check");
      expect(button("Run simulated review").disabled).toBe(false);
    },
  );
  it.each([
    ["typesafe", "jev-1.13.0", "TypeSafe"],
    ["subq", "subq-snap-preview", "SubQ"],
  ])("requires fresh consent for %s and does not silently send data", async (mode, model, label) => {
    const live = {
      ...config,
      provider: { mode: mode as keyof typeof PROVIDER_MODELS, requestedModel: model, implementation: `${mode}-rest-v1` },
      externalTransmission: true,
    };
    const liveReport = await review(fixtures[0].input, {
      identity: live.provider,
      evaluate: async state => ({ ...(await provider.evaluate(state)), model }),
    });
    reviewReply = async () => response({ report: liveReport });
    configReply = async () => response(live);
    await mount();
    expect(text()).toContain("LIVE DECISION MODELS");
    await click("Run Decision Model review");
    expect(reviewRequests()).toHaveLength(0);
    expect(text()).toContain(`Confirm the ${label} data transmission`);
    const consent = container.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
    await act(async () => {
      consent.click();
      await tick();
    });
    await click("Run Decision Model review");
    expect(reviewRequests()).toHaveLength(1);
    expect(reviewRequests()[0].init?.headers).toMatchObject({
      "X-BriefCheck-Live-Consent": "1",
    });
    expect(text()).toContain("DECISION MODEL ADVISORY RESULT");
    expect(text()).toContain("Human decision: not taken");
    await fill("hero.title", "New text");
    expect(
      (container.querySelector('input[type="checkbox"]') as HTMLInputElement)
        .checked,
    ).toBe(false);
  });
  it("halts when the server configuration changes between load and run", async () => {
    await mount();
    configReply = async () => response({ ...config, threshold: 0.9 });
    await run();
    expect(text()).toContain("Provider or rubric changed");
    expect(reviewRequests()).toHaveLength(0);
    expect(button("Run simulated review").disabled).toBe(false);
  });
  it.each([
    [],
    "not-an-object",
    { hero: [] },
    { hero: "invalid complete shape" },
  ])(
    "keeps malformed current-site context recoverable: %j",
    async (currentSite) => {
      await mount();
      await click("Action & current site");
      await fill(
        "context",
        JSON.stringify({ identity: fixtures[0].input.identity, currentSite }),
      );
      await click("Copy comparison");
      expect(container.querySelector("h1")).not.toBeNull();
      await run();
      expect(text()).toContain("The input is invalid");
      expect(reviewRequests()).toHaveLength(0);
      await click("Action & current site");
      await fill(
        "context",
        JSON.stringify({
          identity: fixtures[0].input.identity,
          currentSite: fixtures[0].input.currentSite,
        }),
      );
      await run();
      expect(text()).toContain("SIMULATED RESULT");
    },
  );
  it.each([
    ["missing provider", {}],
    [
      "unknown mode",
      { ...config, provider: { ...config.provider, mode: "unknown" } },
    ],
    [
      "live without transmission",
      {
        ...config,
        provider: { ...config.provider, mode: "typesafe" },
        externalTransmission: false,
      },
    ],
    ["invalid threshold", { ...config, threshold: "not-a-number" }],
  ])(
    "fails closed on malformed configuration: %s",
    async (_name, malformed) => {
      configReply = async () => response(malformed);
      await mount();
      expect(container.querySelector("h1")).not.toBeNull();
      expect(container.querySelector('[role="alert"]')).not.toBeNull();
      const runControl = buttons().find((b) =>
        b.classList.contains("run-button"),
      )!;
      expect(runControl.disabled).toBe(true);
      expect(reviewRequests()).toHaveLength(0);
    },
  );
  it("supports a custom raw proposal and keeps malformed JSON recoverable", async () => {
    await mount();
    const custom = structuredClone(fixtures[0].input);
    custom.proposedUpdate = structuredClone(fixtures[2].input.proposedUpdate);
    await fill("proposal-json", JSON.stringify(custom.proposedUpdate));
    expect(text()).toContain("Custom input");
    expect(container.querySelector('[id="pricing.tiers[0].price"]')).not.toBeNull();
    report = await review(custom, provider);
    await run();
    expect(text()).toContain("SIMULATED RESULT");
    expect(text()).toContain("EXACT MISMATCH");
    await fill("proposal-json", "{broken");
    expect(text()).not.toContain("SIMULATED RESULT");
    await run();
    expect(text()).toContain("The input is invalid");
    expect(reviewRequests()).toHaveLength(1);
    await fill("proposal-json", JSON.stringify(custom.proposedUpdate));
    await run();
    expect(text()).toContain("SIMULATED RESULT");
  });
  it("routes whitespace required copy to review instead of silently clearing it", async () => {
    await mount();
    await fill("hero.title", "   ");
    const empty = structuredClone(fixtures[0].input);
    empty.proposedUpdate.hero!.title = "   ";
    report = await review(empty, provider);
    await run();
    expect(text()).toContain("EMPTY COPY");
    expect(text()).toContain("Take a closer look");
    expect(text()).not.toContain("No flags in this check");
  });
  it("rejects malformed fresh configuration before posting a review", async () => {
    await mount();
    configReply = async () => response({});
    await run();
    expect(container.querySelector("h1")).not.toBeNull();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(reviewRequests()).toHaveLength(0);
  });
  it("renders adversarial HTML-like input/output as text, not executable markup", async () => {
    const payload = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
    await mount();
    await fill("hero.title", payload);
    const input = structuredClone(fixtures[0].input);
    input.proposedUpdate.hero!.title = payload;
    const xssReport = await review(input, provider);
    reviewReply = async () => response({ report: xssReport });
    await run();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(
      (container.querySelector('[id="hero.title"]') as HTMLTextAreaElement)
        .value,
    ).toBe(payload);
    expect(text()).toContain("SIMULATED RESULT");
  });
});
