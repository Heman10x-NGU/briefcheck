import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/server/app.js";
import { SimulatedProvider, ProviderError } from "../src/server/providers.js";
import { fixtures } from "../src/shared/fixtures.js";
describe("local HTTP integration", () => {
  it("returns visibly simulated configuration and full report", async () => {
    const app = createApp(new SimulatedProvider());
    const c = await request(app).get("/api/config");
    expect(c.body.provider.mode).toBe("simulated");
    const r = await request(app).post("/api/reviews").send(fixtures[0].input);
    expect(r.status).toBe(200);
    expect(r.body.report.provider.mode).toBe("simulated");
    expect(r.body.report.input).toEqual(fixtures[0].input);
    expect(r.body.report.humanDecision).toBe("not_taken");
  });
  it("rejects malformed JSON, excess input and schema failures before provider", async () => {
    const p = { identity: new SimulatedProvider().identity, evaluate: vi.fn() };
    const app = createApp(p);
    expect(
      (
        await request(app)
          .post("/api/reviews")
          .set("Content-Type", "application/json")
          .send("{")
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .post("/api/reviews")
          .send({ x: "a".repeat(65536) })
      ).status,
    ).toBe(413);
    expect((await request(app).post("/api/reviews").send({})).status).toBe(400);
    expect(p.evaluate).not.toHaveBeenCalled();
  });
  it("blocks cross-origin, rebinding and non-JSON requests", async () => {
    const app = createApp(new SimulatedProvider());
    expect(
      (
        await request(app)
          .post("/api/reviews")
          .set("Origin", "https://attacker.example")
          .send(fixtures[0].input)
      ).status,
    ).toBe(403);
    expect(
      (await request(app).get("/api/config").set("Host", "attacker.example"))
        .status,
    ).toBe(403);
    expect(
      (await request(app).post("/api/reviews").send("not json")).status,
    ).toBe(415);
  });
  it("requires explicit live transmission consent even for a valid input", async () => {
    const p = {
      identity: {
        mode: "typesafe" as const,
        requestedModel: "jev-1.13.0",
        implementation: "test",
      },
      evaluate: vi.fn(),
    };
    const r = await request(createApp(p))
      .post("/api/reviews")
      .send(fixtures[0].input);
    expect(r.status).toBe(403);
    expect(p.evaluate).not.toHaveBeenCalled();
  });
  it("returns 502 and unavailable report on provider errors", async () => {
    const p = {
      identity: new SimulatedProvider().identity,
      evaluate: vi.fn().mockRejectedValue(new ProviderError("Rate limited.")),
    };
    const r = await request(createApp(p))
      .post("/api/reviews")
      .send(fixtures[0].input);
    expect(r.status).toBe(502);
    expect(r.body.report.disposition).toBe("unavailable");
    expect(r.body.report.sections[0].answers).toEqual({});
  });
  it("serializes review work instead of creating duplicate paid calls", async () => {
    let release: () => void = () => {};
    const wait = new Promise<void>((r) => (release = r));
    const p = new SimulatedProvider();
    const app = createApp({
      identity: p.identity,
      evaluate: async (s) => {
        await wait;
        return p.evaluate(s);
      },
    });
    const first = request(app)
      .post("/api/reviews")
      .send(fixtures[0].input)
      .then((r) => r);
    await new Promise((r) => setTimeout(r, 20));
    const second = await request(app)
      .post("/api/reviews")
      .send(fixtures[0].input);
    expect(second.status).toBe(409);
    release();
    expect((await first).status).toBe(200);
  });
});
