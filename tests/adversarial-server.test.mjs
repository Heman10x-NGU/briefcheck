// Independent adversarial regression checks.
// Synthetic fixtures and injected transports only; never uses live credentials or a paid API.
import assert from "node:assert/strict";
import { it } from "vitest";
import request from "supertest";
import { createApp } from "../src/server/app.js";
import { review, fingerprint, isReportCurrent } from "../src/server/review.js";
import {
  SimulatedProvider,
  TypeSafeProvider,
  ProviderError,
} from "../src/server/providers.js";
import { fixtures } from "../src/shared/fixtures.js";
const input = () => structuredClone(fixtures[0].input);
const provider = new SimulatedProvider();
let calls = 0;
const counted = {
  identity: provider.identity,
  evaluate: async (s) => {
    calls++;
    return provider.evaluate(s);
  },
};
const app = createApp(counted);
const post = (app, x) =>
  request(app).post("/api/reviews").set("Host", "localhost").send(x);
it("synthetic review no implicit human approval", async () => {
  const r = await post(app, input());
  assert.equal(r.status, 200);
  assert.equal(r.body.report.humanDecision, "not_taken");
  assert.equal(r.body.report.provider.mode, "simulated");
  assert.equal(r.headers["cache-control"], "no-store");
});
it("forged fact reference rejected before provider", async () => {
  const x = input();
  x.evidence.exact[0].factId = "FAKE";
  const before = calls;
  const r = await post(app, x);
  assert.equal(r.status, 400);
  assert.equal(calls, before);
});
it("unknown approval/URL fields rejected", async () => {
  for (const extra of [
    { approved: true },
    { provider: "typesafe" },
    { upstreamUrl: "http://127.0.0.1:80/" },
    { report: { disposition: "no_flags" } },
  ])
    assert.equal((await post(app, { ...input(), ...extra })).status, 400);
});
it("invalid host rejected", async () => {
  const r = await request(app)
    .post("/api/reviews")
    .set("Host", "attacker.example")
    .send(input());
  assert.equal(r.status, 403);
});
it("cross-origin request rejected", async () => {
  const r = await post(app, input()).set("Origin", "https://attacker.example");
  assert.equal(r.status, 403);
});
it("simple form request rejected", async () => {
  const r = await request(app)
    .post("/api/reviews")
    .set("Host", "localhost")
    .type("form")
    .send({ a: "b" });
  assert.equal(r.status, 415);
});
it("oversized request rejected before provider", async () => {
  const before = calls;
  const r = await request(app)
    .post("/api/reviews")
    .set("Host", "localhost")
    .send({ content: "x".repeat(66000) });
  assert.equal(r.status, 413);
  assert.equal(calls, before);
});
it("malformed JSON rejected without body echo", async () => {
  const r = await request(app)
    .post("/api/reviews")
    .set("Host", "localhost")
    .type("json")
    .send("{AUDIT_PRIVATE_BODY");
  assert.equal(r.status, 400);
  assert.ok(!r.text.includes("AUDIT_PRIVATE_BODY"));
});
it("deep JSON rejected without process failure", async () => {
  const raw = JSON.stringify(input()).replace(
    '"currentSite":{',
    '"currentSite":{"extra":' +
      "[".repeat(5000) +
      '"x"' +
      "]".repeat(5000) +
      ",",
  );
  const before = calls;
  const r = await request(app)
    .post("/api/reviews")
    .set("Host", "localhost")
    .type("json")
    .send(raw);
  assert.equal(r.status, 400);
  assert.equal(calls, before);
  assert.equal(
    (await request(app).get("/api/config").set("Host", "localhost")).status,
    200,
  );
});
it("real mode needs explicit per-request consent flag", async () => {
  let invoked = false;
  const p = {
    identity: {
      mode: "typesafe",
      requestedModel: "jev-1.13.0",
      implementation: "mock",
    },
    evaluate: async () => {
      invoked = true;
      throw Error("should not call");
    },
  };
  const r = await post(createApp(p), input());
  assert.equal(r.status, 403);
  assert.equal(invoked, false);
});
it("provider failure returns unavailable, never fallback", async () => {
  const p = {
    identity: provider.identity,
    evaluate: async () => {
      throw new ProviderError("Expected test failure");
    },
  };
  const r = await post(createApp(p), input());
  assert.equal(r.status, 502);
  assert.equal(r.body.report.disposition, "unavailable");
  assert.ok(
    r.body.report.issues.some((i) => i.code === "PROVIDER_UNAVAILABLE"),
  );
  assert.equal(r.body.report.humanDecision, "not_taken");
});
it("unexpected failure sanitized", async () => {
  const p = {
    identity: provider.identity,
    evaluate: async () => {
      throw Error("AUDIT_PRIVATE_ERROR");
    },
  };
  const r = await post(createApp(p), input());
  assert.equal(r.status, 502);
  assert.ok(!r.text.includes("AUDIT_PRIVATE_ERROR"));
});
it("concurrent reviews do not share results", async () => {
  let unblock, started;
  const gate = new Promise((r) => (unblock = r));
  const start = new Promise((r) => (started = r));
  const p = {
    identity: provider.identity,
    evaluate: async (s) => {
      started();
      await gate;
      return provider.evaluate(s);
    },
  };
  const a = createApp(p);
  const i1 = input(),
    i2 = input();
  i2.identity.sessionId = "unrelated-session";
  const pending = post(a, i1).then((r) => r);
  await start;
  const r2 = await post(a, i2);
  assert.equal(r2.status, 409);
  assert.ok(!JSON.stringify(r2.body).includes(i1.identity.sessionId));
  unblock();
  const r1 = await pending;
  assert.equal(r1.body.report.input.identity.sessionId, i1.identity.sessionId);
  const r3 = await post(a, i2);
  assert.equal(r3.status, 200);
  assert.equal(r3.body.report.input.identity.sessionId, i2.identity.sessionId);
});
it("no stored report lookup endpoint", async () => {
  const r = await request(app)
    .get("/api/reviews/anything")
    .set("Host", "localhost");
  assert.equal(r.status, 404);
});
it("fingerprint binds identities, content, evidence, provider", async () => {
  const base = input(),
    f = fingerprint(base, provider.identity);
  for (const mutator of [
    (x) => (x.identity.sessionId = "session2"),
    (x) => (x.identity.toolCallId = "call2"),
    (x) => (x.identity.targetId = "site2"),
    (x) => (x.currentSite.hero.title = "different"),
    (x) => (x.proposedUpdate.hero.title = "different"),
    (x) => (x.evidence.revision = "v2"),
    (x) => (x.evidence.facts[0].text = "different"),
    (x) => (x.evidence.exact[0].expected = "$1"),
  ]) {
    const x = input();
    mutator(x);
    assert.notEqual(fingerprint(x, provider.identity), f);
  }
  assert.notEqual(
    fingerprint(base, { ...provider.identity, requestedModel: "other" }),
    f,
  );
});
it("in-flight report snapshots input and rejects edited copy", async () => {
  const x = input();
  let unblock;
  const gate = new Promise((r) => (unblock = r));
  const p = {
    identity: provider.identity,
    evaluate: async (s) => {
      await gate;
      return provider.evaluate(s);
    },
  };
  const pending = review(x, p);
  x.proposedUpdate.hero.title = "Edited during review";
  unblock();
  const r = await pending;
  assert.notEqual(
    r.input.proposedUpdate.hero.title,
    x.proposedUpdate.hero.title,
  );
  assert.equal(isReportCurrent(r, x, p.identity), false);
});

// The response is display data, not an authorization token. Reject contradictions
// that could otherwise make malformed transport data look like a clean review.
import { validatedReport } from "../src/client/state.js";
for (const [name, mutate] of [
  [
    "forged section evidence ID",
    (r) => {
      r.sections[0].evidence = [{ id: "FORGED", text: "Invented support" }];
    },
  ],
  [
    "misquoted section evidence",
    (r) => {
      r.sections[0].evidence[0].text = "Invented support";
    },
  ],
  [
    "negative choice with no flags",
    (r) => {
      r.sections[0].answers.support.choice = "unsupported";
    },
  ],
  [
    "unknown choice with no flags",
    (r) => {
      r.sections[0].answers.support.choice = "automatically_approved";
    },
  ],
  [
    "low confidence with no flags",
    (r) => {
      r.sections[0].answers.support.confidence = 0.1;
    },
  ],
  [
    "forged issue evidence ID",
    (r) => {
      const issue = {
        code: "UNSUPPORTED_CLAIM",
        section: "hero",
        path: "hero",
        proposedExcerpt: r.sections[0].proposedExcerpts[0].text,
        evidence: [{ id: "FORGED", text: "Invented support" }],
        source: "advisory",
      };
      r.sections[0].issues.push(issue);
      r.issues.push(issue);
      r.disposition = "review_required";
    },
  ],
  [
    "misquoted issue evidence",
    (r) => {
      const issue = {
        code: "UNSUPPORTED_CLAIM",
        section: "hero",
        path: "hero",
        proposedExcerpt: r.sections[0].proposedExcerpts[0].text,
        evidence: [{ id: "F1", text: "Invented support" }],
        source: "advisory",
      };
      r.sections[0].issues.push(issue);
      r.issues.push(issue);
      r.disposition = "review_required";
    },
  ],
])
  it("client rejects " + name, async () => {
    const snapshot = input();
    const report = await review(snapshot, provider);
    const config = {
      provider: provider.identity,
      rubricVersion: report.rubricVersion,
      threshold: report.threshold,
    };
    mutate(report);
    assert.throws(() => validatedReport(report, snapshot, config, true));
  });
