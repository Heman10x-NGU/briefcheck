/** Optional real-browser regression suite. NOT RUN in the build environment.
 * Prerequisites: build/start the app in SIMULATED mode, and install Playwright.
 * npm install --no-save --package-lock=false playwright@1.62.1
 * npx playwright install chromium
 * BRIEFCHECK_PROVIDER=simulated npm start
 * In another terminal: node tests/qa.browser.mjs
 * Optional: BRIEFCHECK_QA_URL=http://127.0.0.1:3000 BROWSER_EXECUTABLE=/path/to/chromium
 * Browser install/start is for a machine where those actions are permitted.
 */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
const base = process.env.BRIEFCHECK_QA_URL ?? "http://127.0.0.1:3000";
const origin = new URL(base).origin;
assert.ok(
  ["127.0.0.1", "localhost", "[::1]"].includes(new URL(base).hostname),
  "Use a loopback local test server.",
);
const configuration = await fetch(`${base}/api/config`).then((r) => r.json());
assert.equal(
  configuration.provider.mode,
  "simulated",
  "Refusing browser QA against a live provider.",
);
assert.equal(
  configuration.externalTransmission,
  false,
  "Refusing any upstream transmission.",
);
const out = process.env.BRIEFCHECK_QA_OUTPUT ?? "qa-browser-results";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_EXECUTABLE
    ? { executablePath: process.env.BROWSER_EXECUTABLE }
    : {}),
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 960 },
});
const page = await context.newPage();
const errors = [];
const results = [];
page.on("pageerror", (error) => errors.push(error.message));
await context.route("**/*", (route) =>
  new URL(route.request().url()).origin === origin
    ? route.continue()
    : route.abort(),
);
const run = () =>
  page.getByRole("button", { name: "Run simulated review" }).click();
const result = page.getByText("SIMULATED RESULT", { exact: true });
const record = (name) => {
  results.push({ name, status: "PASS" });
  console.log(`PASS ${name}`);
};
try {
  await page.goto(base);
  await page
    .getByRole("button", { name: "Run simulated review" })
    .waitFor({ state: "visible" });
  assert.ok(
    await page.getByText("SIMULATED DEMO", { exact: true }).isVisible(),
  );
  assert.ok(
    await page.getByText("Try the workflow. No key needed.").isVisible(),
  );
  record("Clear keyless simulation label");
  const firstResponse = page.waitForResponse(
    (r) => r.url().endsWith("/api/reviews") && r.request().method() === "POST",
  );
  await run();
  const good = (await (await firstResponse).json()).report;
  await result.waitFor();
  assert.ok(await page.getByText("Human decision: not taken").isVisible());
  record("Successful simulated review and human-decision limit");
  for (const [width, height] of [
    [1440, 960],
    [390, 844],
    [320, 780],
  ]) {
    await page.setViewportSize({ width, height });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      true,
      `Horizontal overflow at ${width}px`,
    );
    await page.screenshot({
      path: `${out}/report-${width}.png`,
      fullPage: true,
    });
    record(`No horizontal overflow at ${width}px`);
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.getByLabel("hero.title", { exact: true }).fill("An edited title.");
  assert.equal(await result.count(), 0);
  assert.ok(
    await page
      .getByText(
        "Input changed. The previous report is invalid. Run a fresh review.",
      )
      .isVisible(),
  );
  record("Proposed-copy edit invalidates report");
  await page.reload();
  await page.getByRole("button", { name: "Run simulated review" }).waitFor();
  await run();
  await result.waitFor();
  await page
    .getByRole("button", { name: "Approved evidence", exact: true })
    .click();
  const evidence = page.getByLabel(
    "Approved facts, voice, and exact constraints",
  );
  const priorEvidence = await evidence.inputValue();
  const changed = JSON.parse(priorEvidence);
  changed.revision = "browser-test-revision";
  await evidence.fill(JSON.stringify(changed));
  assert.equal(await result.count(), 0);
  record("Evidence edit invalidates report");
  await evidence.fill("{invalid");
  await run();
  assert.ok(await page.getByRole("alert").isVisible());
  record("Invalid JSON is recoverable");
  await page.reload();
  await page.getByRole("button", { name: "Run simulated review" }).waitFor();
  let complete;
  let pendingCount = 0;
  let received;
  const hasRequest = new Promise((r) => {
    received = r;
  });
  await page.route("**/api/reviews", async (route) => {
    pendingCount++;
    received();
    await new Promise((r) => {
      complete = r;
    });
    await route.fulfill({ status: 200, json: { report: good } });
  });
  await run();
  await hasRequest;
  assert.equal(
    await page.getByRole("button", { name: "Review in progress…" }).isEnabled(),
    false,
  );
  assert.equal(pendingCount, 1);
  await page
    .getByLabel("hero.title", { exact: true })
    .fill("Edited during request.");
  complete();
  await page.getByRole("button", { name: "Run simulated review" }).waitFor();
  assert.equal(await result.count(), 0);
  record("Pending review locks button; late report is discarded after edit");
  await page.unroute("**/api/reviews");
  for (const [name, status, body] of [
    ["HTTP error", 502, { error: "Synthetic QA failure" }],
    ["malformed report", 200, { report: {} }],
    ["failed clear response", 502, { report: good }],
    [
      "wrong session",
      200,
      {
        report: {
          ...good,
          input: {
            ...good.input,
            identity: { ...good.input.identity, sessionId: "wrong-session" },
          },
        },
      },
    ],
  ]) {
    await page.reload();
    await page.getByRole("button", { name: "Run simulated review" }).waitFor();
    await page.route("**/api/reviews", (route) =>
      route.fulfill({ status, json: body }),
    );
    await run();
    await page.getByRole("alert").waitFor();
    assert.equal(await result.count(), 0);
    assert.equal(
      await page
        .getByRole("button", { name: "Run simulated review" })
        .isEnabled(),
      true,
    );
    record(`${name} fails safely`);
    await page.unroute("**/api/reviews");
  }
  await page.reload();
  await page.getByRole("button", { name: "Run simulated review" }).waitFor();
  await page
    .getByLabel("hero.title", { exact: true })
    .fill('<img src=x onerror="alert(1)"><script>alert(2)</script>');
  await run();
  await result.waitFor();
  assert.equal(
    await page.locator("img[onerror], script:not([src])").count(),
    0,
  );
  record("HTML-like proposed input is inert");
  await page.goto("about:blank");
  await page.goBack();
  await page.getByRole("heading", { name: /Good copy/ }).waitFor();
  record("Browser back returns to usable application");
  assert.deepEqual(errors, []);
  record("No uncaught browser errors");
  await writeFile(
    `${out}/results.json`,
    JSON.stringify(
      { executedAt: new Date().toISOString(), base, results },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
