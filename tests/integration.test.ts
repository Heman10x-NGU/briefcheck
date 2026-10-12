import { describe, it, expect } from "vitest";
import {
  preparePendingReview,
  reportMatchesPending,
  type PendingRow,
} from "../integration/naive-adapter.js";
import { fixtures } from "../src/shared/fixtures.js";
import { review } from "../src/server/review.js";
import { SimulatedProvider } from "../src/server/providers.js";
const f = fixtures[0].input;
const row = (): PendingRow => ({
  session: { id: f.identity.sessionId },
  action: {
    name: "dashboard.update_site",
    tool_call_id: f.identity.toolCallId,
    args: { site: structuredClone(f.proposedUpdate) },
  },
});
describe("pinned Naïve pre-confirmation adapter", () => {
  it("accepts args.site as whole-section replacement and preserves current data", () => {
    const r = preparePendingReview(
      row(),
      f.currentSite,
      f.evidence,
      f.identity.targetId,
    );
    expect(r.status).toBe("ready");
    if (r.status === "ready") {
      expect(r.input.proposedUpdate).toEqual(f.proposedUpdate);
      expect(r.input.currentSite).toEqual(f.currentSite);
    }
  });
  it("ignores questions and unrelated tools", () => {
    for (const action of [
      { ...row().action, kind: "question" as const },
      { ...row().action, name: "email.send" },
    ])
      expect(
        preparePendingReview(
          { ...row(), action },
          f.currentSite,
          f.evidence,
          "site",
        ).status,
      ).toBe("ignored");
  });
  it("explicitly refuses noncopy sections, partial sections and wrong argument envelopes", () => {
    for (const args of [
      { site: { analytics: { googleMeasurementId: "x" } } },
      { patch: f.proposedUpdate },
      { site: { hero: { title: "partial" } } },
      { site: f.proposedUpdate, extra: true },
    ])
      expect(
        preparePendingReview(
          { ...row(), action: { ...row().action, args } },
          f.currentSite,
          f.evidence,
          "site",
        ).status,
      ).toBe("unavailable");
  });
  it("isolates same tool call across sessions and invalidates edits", async () => {
    const provider = new SimulatedProvider();
    const r = await review(f, provider);
    const first = preparePendingReview(
      row(),
      f.currentSite,
      f.evidence,
      f.identity.targetId,
    );
    expect(reportMatchesPending(r, first, provider.identity)).toBe(true);
    const other = preparePendingReview(
      { ...row(), session: { id: "other-session" } },
      f.currentSite,
      f.evidence,
      f.identity.targetId,
    );
    expect(reportMatchesPending(r, other, provider.identity)).toBe(false);
    if (first.status === "ready" && other.status === "ready")
      expect(first.key).not.toBe(other.key);
  });
});

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NaiveReviewPanel } from "../integration/NaiveReviewPanel.js";
import { CONFIDENCE_THRESHOLD, RUBRIC_VERSION } from "../src/shared/schema.js";
it("renders an advisory panel without approval or execution controls", () => {
  const provider = new SimulatedProvider();
  const html = renderToStaticMarkup(
    React.createElement(NaiveReviewPanel, {
      prepared: preparePendingReview(
        row(),
        f.currentSite,
        f.evidence,
        f.identity.targetId,
      ),
      config: {
        provider: provider.identity,
        rubricVersion: RUBRIC_VERSION,
        threshold: CONFIDENCE_THRESHOLD,
      },
      load: async () => {
        throw new Error("Must not run during render");
      },
    }),
  );
  expect(html).toContain("Simulated demo");
  expect(html).toContain("Review this pending update");
  expect(html).not.toContain("tool_confirmations");
});

it.each([
  null,
  {},
  {
    session: { id: "s" },
    action: { name: "dashboard.update_site", tool_call_id: "x", args: null },
  },
  {
    session: { id: "s" },
    action: {
      kind: "unexpected",
      name: "dashboard.update_site",
      tool_call_id: "x",
      args: { site: f.proposedUpdate },
    },
  },
])("handles a malformed pending envelope without a clear report", (value) => {
  expect(
    preparePendingReview(
      value as PendingRow,
      f.currentSite,
      f.evidence,
      "target",
    ).status,
  ).toBe("unavailable");
});
