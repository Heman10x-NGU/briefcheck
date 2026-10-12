// Independent production-start smoke tests. Local HTTP only; simulated provider only.
// Run after npm run build: node tests/qa.startup.mjs
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { fixtures } from "../dist/server/shared/fixtures.js";

const sentinel = "QA_ONLY_NOT_A_REAL_TYPESAFE_KEY_7ab3a1";
const reserve = createServer();
reserve.listen(0, "127.0.0.1");
await once(reserve, "listening");
const port = reserve.address().port;
await new Promise((resolve) => reserve.close(resolve));
// Override a developer's live .env so this test can never use real credentials.
const env = {
  ...process.env,
  PORT: String(port),
  BRIEFCHECK_PROVIDER: "simulated",
  TYPESAFE_API_KEY: sentinel,
  SUBQ_API_KEY: sentinel,
};
const child = spawn("npm", ["start"], {
  env,
  stdio: ["ignore", "pipe", "pipe"],
  detached: process.platform !== "win32",
});
let logs = "";
child.stdout.on("data", (b) => {
  logs += b.toString();
});
child.stderr.on("data", (b) => {
  logs += b.toString();
});
try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Startup timed out: ${logs}`)),
      10000,
    );
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Startup exited ${code}: ${logs}`));
    });
    const wait = setInterval(() => {
      if (logs.includes("BriefCheck listening")) {
        clearInterval(wait);
        clearTimeout(timeout);
        resolve();
      }
    }, 20);
    setTimeout(() => clearInterval(wait), 10100).unref();
  });
  const base = `http://127.0.0.1:${port}`;
  const configResponse = await fetch(`${base}/api/config`);
  assert.equal(configResponse.status, 200);
  const configText = await configResponse.text();
  const config = JSON.parse(configText);
  assert.equal(config.provider.mode, "simulated");
  assert.equal(config.externalTransmission, false);
  assert.ok(!configText.includes(sentinel));
  console.log(
    "PASS npm start uses explicit simulation with server-only fake keys present",
  );
  const home = await fetch(base);
  assert.equal(home.status, 200);
  assert.match(
    home.headers.get("content-security-policy") ?? "",
    /script-src 'self'/,
  );
  const html = await home.text();
  assert.ok(!html.includes(sentinel));
  const paths = [...html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)].map(
    (x) => x[1],
  );
  assert.ok(paths.length >= 2);
  for (const path of paths) {
    const res = await fetch(`${base}${path}`);
    assert.equal(res.status, 200);
    assert.ok(
      !(await res.text()).includes(sentinel),
      `Fake key leaked in ${path}`,
    );
  }
  console.log(
    "PASS production HTML, JS/CSS assets, config response have no sentinel key; CSP present",
  );
  const response = await fetch(`${base}/api/reviews`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(fixtures[0].input),
  });
  assert.equal(response.status, 200);
  const responseText = await response.text();
  const payload = JSON.parse(responseText);
  assert.equal(payload.report.provider.mode, "simulated");
  assert.equal(payload.report.humanDecision, "not_taken");
  assert.ok(!responseText.includes(sentinel));
  console.log(
    "PASS production HTTP simulated review; report has no sentinel key and takes no approval action",
  );
  const bad = await fetch(`${base}/api/reviews`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(bad.status, 400);
  const invalid = await bad.json();
  assert.ok(!invalid.report);
  console.log("PASS invalid production HTTP request fails without a report");
  assert.ok(!logs.includes(sentinel));
  console.log("PASS server startup logs do not expose fake key");
} finally {
  if (process.platform === "win32") child.kill("SIGTERM");
  else if (child.pid) process.kill(-child.pid, "SIGTERM");
}
