import { resolve } from "node:path";
import express from "express";
import { createApp } from "./app.js";
import { SimulatedProvider, TypeSafeProvider } from "./providers.js";
const mode = process.env.BRIEFCHECK_PROVIDER ?? "simulated";
if (!["simulated", "typesafe"].includes(mode))
  throw new Error("BRIEFCHECK_PROVIDER must be simulated or typesafe.");
const provider =
  mode === "typesafe"
    ? new TypeSafeProvider(process.env.TYPESAFE_API_KEY ?? "")
    : new SimulatedProvider();
const app = createApp(provider);
if (process.argv.includes("--dev")) {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
} else {
  app.use((_req, res, next) => {
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    next();
  });
  app.use(express.static(resolve("dist/client")));
  app.get("/{*path}", (_req, res) =>
    res.sendFile(resolve("dist/client/index.html")),
  );
}
const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("PORT must be an integer from 1 to 65535.");
app.listen(port, "127.0.0.1", () =>
  console.log(
    `BriefCheck listening on http://127.0.0.1:${port} (${provider.identity.mode})`,
  ),
);
