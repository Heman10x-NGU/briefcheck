# BriefCheck independent QA

Verified 2026-10-11. Final automated result: **PASS**. Actual-browser visual and interaction coverage: **NOT RUN successfully**, for the infrastructure reasons below. No live Jev accuracy claim is supported by this work.

## Verified results

| Check | Result | Evidence |
| --- | --- | --- |
| Clean source copy, excluding dependencies/builds/secrets | PASS | Fresh temporary directory; no `node_modules`, `dist`, `.env`, `.git`, coverage, or browser outputs copied |
| `npm ci --cache /tmp/briefcheck-npm-cache` | PASS | 252 packages installed from the pinned lockfile |
| `npm run check` | PASS | TypeScript check, **168 tests in 7 files**, and production Vite/TypeScript build |
| Independent component QA | PASS | **30 tests** in `tests/qa.dom.test.ts`; included in the 168 total, not additional to it |
| `node tests/qa.startup.mjs` | PASS | Five production-start/local-HTTP check groups, described below |
| `npm audit --audit-level=low` | PASS | 0 known vulnerabilities reported at verification time |
| `npm run format:check` | PASS | App, integration, and script formatting |
| `node --check tests/qa.browser.mjs` | PASS | Syntax check only; does not execute browser tests |
| Final source versus tested clean copy | PASS | Application, integration, scripts, tests, package/lock, and root configuration match |

Environment: Node 24.19.0, npm 11.9.0, Vite 7.3.7, Vitest 4.1.11. The README's install/check/start workflow was reproduced. The production build emitted an approximately 302 kB JavaScript bundle (92 kB gzip) and 10.7 kB stylesheet.

One initial clean-verification tool call was interrupted after installation and the tests passed, during the build. The authorized workflow was then rerun from a new clean copy and completed with exit code 0. The first partial attempt is not counted as a completed build.

## Independent component coverage

`tests/qa.dom.test.ts` uses React with jsdom and mocked fetch responses. It is a DOM-emulated suite, **not a real browser**.

- Clearly labelled simulation, keyless workflow language, illustrative confidence, and human-decision/advisory limits
- Successful simulated result and no automatic approval
- Completed-report invalidation on proposal, evidence, or session/action/current-site edits
- Tab-only navigation retaining a still-current report
- A late result discarded after input changes
- Repeated same-batch clicks keeping exactly one request in flight and the button locked
- Invalid evidence JSON, oversized fields, malformed context, and correction/retry
- Configuration network failure, missing provider, unknown mode, mode/transmission mismatch, bad threshold, and malformed fresh configuration failing safely
- Provider/rubric changes detected before a review is sent
- HTTP failures, network failures, malformed JSON, malformed reports, bad answer types, wrong input, wrong provider, and contradictory failed/clear responses
- Live-mode consent required before a mocked transmission; correct consent header; any edit clears consent
- Raw whole-section JSON custom input, displayed section changes, invalid-source recovery, and exact-mismatch reporting
- Whitespace required copy routed to human review
- HTML-like proposed text rendered as inert text

All provider responses in these tests are synthetic. They verify application behavior, not Jev performance or factual correctness.

## Production startup and key isolation

`tests/qa.startup.mjs` starts the documented `npm start` command after a build, using a randomly allocated loopback port. The test sets a distinctive **fake, noncredential** TypeSafe key and leaves the provider unset, so it can confirm that merely setting a key never enables live requests.

The check groups pass:

1. Default configuration is simulated and external transmission is false.
2. The actual production HTML, JavaScript/CSS assets, and configuration response do not contain the fake key; the production Content Security Policy is present.
3. A real local HTTP review returns a simulated report with `humanDecision: not_taken`; the response does not contain the fake key.
4. Invalid HTTP input receives 400 with no report.
5. Startup logs do not expose the fake key.

The test launches and cleans up only its own local server process group. No real keys, external upstream calls, paid services, or hosted deployment were used. Browser network/UI key inspection remains outside the verified browser coverage; HTTP/bundle checks are the evidence available here.

## Findings and disposition

| Severity | Finding | Final disposition |
| --- | --- | --- |
| Medium | Multiple clicks before React's state update could let an older request clear the busy flag while the newest request was pending. | FIXED. Reproduced by the independent test, then passed with an immediate in-flight reference lock. |
| Medium | Initial configuration was trusted without runtime validation. A missing provider crashed rendering; unknown modes and inconsistent transmission flags remained enabled. | FIXED. Four failing regression cases now pass with strict, fail-closed configuration validation. |
| Medium | Report rendering originally trusted report shape and could accept a report before checking HTTP failure or current-input/provider binding. | FIXED. Identified in source review; malformed, wrong-input, wrong-provider, and failed-clear-response regression cases all pass. |
| Verification gap | Real-browser responsiveness, visual layout, browser history, screenshot review, and the optional browser suite could not be completed in this environment. | OPEN. Must be checked on a permitted browser/runtime before claiming full UI acceptance. |

No remaining failure was observed in the executed independent component/startup suite. This is not a comprehensive security audit; see the separate adversarial review.

## Browser limitation and reproducible remaining check

System Chromium was present, but its launch failed with `socket() failed: Operation not permitted`, including the one approved escalation attempt. No subsequent Chromium-launch workaround was attempted.

The supported cloud browser was available. It rejected `file://` by URL policy, and direct HTTP attempts to the running BriefCheck and journal previews returned `ERR_CONNECTION_REFUSED`. Local HTTP worked when server and client ran inside the same command, which enabled production-start checks, but the browser could not reach that listener. The blocked routes were not bypassed.

Consequently:

- Real-browser test suite: **NOT RUN**
- 1440/390/320-pixel responsive layout and overflow: **NOT VERIFIED**
- Browser Back/Forward and actual download behavior: **NOT VERIFIED**
- App or journal browser screenshots: **NONE CAPTURED**
- Live Jev, billing/access, and semantic accuracy: **NOT RUN** by design

An optional script is preserved as `tests/qa.browser.mjs`. It refuses non-loopback URLs and live-provider configuration, blocks external browser requests, tests the normal/edit/error/race/XSS/navigation flows, and captures responsive screenshots when actually run. Its output directory is `qa-browser-results` unless `BRIEFCHECK_QA_OUTPUT` is set.

On a machine where installing and running Chromium is permitted:

```sh
npm ci
npm run check
# Optional browser-only tooling; not needed by the application or normal test suite:
npm install --no-save --package-lock=false playwright@1.62.1
npx playwright install chromium
BRIEFCHECK_PROVIDER=simulated npm start
# In a second terminal:
node tests/qa.browser.mjs
```

Alternatively set `BROWSER_EXECUTABLE` to an already installed permitted Chromium path. Do not use the optional install/run instructions to bypass a machine's access controls. The script has only been syntax-checked here; its successful execution and screenshots still need review.
