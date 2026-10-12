import express from "express";
import {
  CONFIDENCE_THRESHOLD,
  PROVIDER_LABELS,
  RUBRIC_VERSION,
  reviewSchema,
} from "../shared/schema.js";
import { review } from "./review.js";
import { type Provider } from "./providers.js";
export function createApp(provider: Provider) {
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");
    if (
      !/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(
        req.headers.host ?? "",
      )
    ) {
      res
        .status(403)
        .json({ error: "This local workbench accepts loopback hosts only." });
      return;
    }
    if (req.path.startsWith("/api/") && req.method !== "GET") {
      const origin = req.headers.origin;
      if (origin && origin !== `http://${req.headers.host}`) {
        res
          .status(403)
          .json({ error: "Cross-origin requests are not allowed." });
        return;
      }
      if (!req.is("application/json")) {
        res.status(415).json({ error: "Send application/json." });
        return;
      }
    }
    next();
  });
  app.use(express.json({ limit: "64kb", strict: true }));
  app.get("/api/config", (_req, res) =>
    res.json({
      provider: provider.identity,
      rubricVersion: RUBRIC_VERSION,
      threshold: CONFIDENCE_THRESHOLD,
      externalTransmission: provider.identity.mode !== "simulated",
    }),
  );
  let active = false;
  app.post("/api/reviews", async (req, res) => {
    if (
      provider.identity.mode !== "simulated" &&
      req.headers["x-briefcheck-live-consent"] !== "1"
    ) {
      res.status(403).json({
        error: `Confirm this review may send copy and approved evidence to ${PROVIDER_LABELS[provider.identity.mode]} and incur API charges.`,
      });
      return;
    }
    const parsed = reviewSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error:
          "Review input is invalid. Fix the fields and retry; no semantic check ran.",
        details: parsed.error.issues.map((e) => ({
          path: e.path.join("."),
          message: e.message,
        })),
      });
      return;
    }
    if (active) {
      res.status(409).json({
        error:
          "A review is already running. Wait for it to finish before retrying.",
      });
      return;
    }
    active = true;
    try {
      const report = await review(parsed.data, provider);
      res
        .status(report.error ? 502 : 200)
        .json({ report, ...(report.error ? { error: report.error } : {}) });
    } catch {
      res
        .status(500)
        .json({ error: "Review failed. No clear result is available." });
    } finally {
      active = false;
    }
  });
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "Unknown API endpoint." }),
  );
  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      const status =
        (err as { type?: string })?.type === "entity.too.large" ? 413 : 400;
      res.status(status).json({
        error:
          status === 413
            ? "Input is too large. No review ran."
            : "Malformed JSON. No review ran.",
      });
    },
  );
  return app;
}
