# BriefCheck

A small, local-first review workbench for proposed agency website-copy updates. Compare the current copy, a pending whole-section replacement, and operator-approved facts. Get deterministic constraint checks plus bounded, per-section advisory signals before a human makes the real decision.

**Default: an explicitly labelled simulator. No API key, network inference, paid service, signup, database, or hosting is needed.** This is a working prototype, not a factuality guarantee, approval engine, prompt-injection defense, or installed Vetta/Naïve integration.

## Run locally

Node **22.12+** (tested with 24.19.0) and npm. From this directory:

```sh
npm ci
npm run check
npm start
```

Open **http://127.0.0.1:3000**. `npm start` serves the built React UI and Node API from one loopback-only process. Build first. `npm run dev` uses Vite middleware and Node watch mode with the `tsx` import hook, also on port 3000. Both development and production start optionally load `.env` using Node; exported environment variables take precedence. No environment file is required for simulation.

If the environment cannot write npm's default cache, use `npm ci --cache /tmp/briefcheck-npm-cache`. If port 3000 is taken, use `PORT=3001 npm start`. No scripts create repositories, start Codex Cloud tasks, merge branches, or publish websites.

## Try the workflow

1. Choose one of four fictional Northstar Studio cases: careful rewrite, invented result, changed pricing, or instructions embedded in copy.
2. Edit proposed copy, approved evidence, or the action/current-site context. Evidence includes a revision, per-section facts, voice guidance, and optional exact path/value constraints.
3. Run the clearly labelled simulated review. Inspect fixed reason labels, actual input excerpts, and the actual facts supplied for each section. Evidence is contextual, not a generated explanation or proof of causation.
4. Export the evaluated JSON snapshot if useful. Every edit invalidates the visible report; an earlier request cannot attach its result to a newer input. No approval or publishing action exists.

The simulator uses a few transparent illustrative pattern rules. It will miss unsupported claims outside those patterns. Its displayed distributions/confidences are synthetic and **do not measure Jev accuracy**. A no-flags result remains an invitation to inspect the evidence, never certification.

## What is checked

- Strict JSON shape, unknown keys, required current section shape, action identity, 30,000-character aggregate context cap, 64 KiB HTTP body cap, up to six proposed sections, 2,000 characters per string, and up to 24 items per list. Invalid/unsupported input yields an explicit error before inference.
- Deterministic equality for operator-specified exact constraints, blank required copy, a 1,200-character per-copy-field advisory limit, and a small instruction-like-text warning. Arithmetic/exact comparison stays in code. The warning regex is not a comprehensive injection detector.
- Three atomic Choice questions per reviewed section: factual support, added commitments/scope, and voice alignment. They receive that section's current/proposed excerpts, explicitly mapped approved facts, and voice guidance. Current copy is context, not authority.
- Missing evidence, uncertain choices, low confidence, contradictions, unsupported claims, tone conflicts, and errors remain review concerns. Confidence threshold **0.72** is an uncalibrated product routing choice, not a validated safety threshold. Facts can be incomplete, contradictory, or false; humans must validate the source pack.
- Supported section replacements: `company`, `tagline`, `tone`, `hero`, `proof`, `services`, `pricing`, `contact`, `footer`. The first version deliberately refuses `analytics`, `palette`, `whoWeServe`, `process`, `faq`, unknown sections, and partial nested replacements. Review these manually. No silently ignored noncopy changes.

## Real TypeSafe provider: optional, server-only, unrun

The real REST adapter is implemented and tested with mocked HTTP responses. **No live Jev requests were run during this build.** Access availability and actual model quality are not verified here.

After separately authorizing transmission of your content and any API charges, copy `.env.example` to your own untracked `.env` and set:

```dotenv
BRIEFCHECK_PROVIDER=typesafe
TYPESAFE_API_KEY=your-own-server-key
```

Restart the server. The UI changes to live-provider mode and requires explicit transmission/cost acknowledgment for each snapshot. Setting a key alone does not enable real calls. Do not put a key in any `VITE_*` variable, UI form, source file, shared screenshot, or report. `.env` is ignored.

Calls go only to `POST https://api.typesafe.ai/v1/systemone`, with model pinned to `jev-1.13.0`. One request per eligible section, sequentially, at most six per review. Three questions per request. Timeout: 12 seconds per request. No automatic retries, no redirects, no fallback from a failed live call to the simulator. 401/403, rate limits, network/timeouts, non-JSON, missing or invalid answers, unexpected models, oversized responses, malformed probability distributions, and inconsistent confidence fail unavailable. Error bodies and keys are never logged or returned.

Only that section's text, mapped facts, and tone are sent to TypeSafe; identity and other site sections stay local. Read TypeSafe's current terms/data handling before using private or client material. Do not use sensitive or regulated data without an appropriate approved workflow.

## Tests and evaluation

```sh
npm run typecheck
npm test
npm run build
# Intentionally external and potentially billable; NOT part of check/test/build:
npm run eval:live -- --confirm-live-costs
```

The live smoke-evaluation script requires both the explicit flag and `BRIEFCHECK_PROVIDER=typesafe` plus the key. It sends only the four synthetic cases, at most four requests, stops after a provider error, and prints complete reports. It is **not an accuracy benchmark**; those four cases also inform the simulator and are not a holdout set. See [evaluation plan](docs/evaluation.md) for the frozen train/holdout procedure to use before making accuracy claims.

Tests cover strict schemas, exact comparisons, true excerpts, synthetic scenarios, injection-like input handling, stale results, session isolation, server-only provider requests, response-contract failures, HTTP errors/concurrency, and the pinned pre-confirmation adapter. Independent review files, when present, describe their own test scope and infrastructure limits. See [QA report](docs/qa-report.md) and [adversarial review](docs/adversarial-review.md). Browser, mock-contract, and real-provider validation are different levels of evidence.

## Architecture

- `src/shared`: bounded data schema, report schema, reason vocabulary, canonicalization, and fictional fixtures.
- `src/server`: Express API; deterministic review and SHA-256 snapshot binding; simulator and TypeSafe REST provider; atomic question definitions.
- `src/client`: React comparison workbench, safe text rendering, request-generation invalidation, input-bound report validation, and snapshot export.
- `integration`: original, minimal Naïve pending-action adapter and React advisory panel. [Wiring guide](docs/naive-integration.md).
- `tests`: Vitest unit, HTTP contract/integration, and independent QA/security regression tests.

`GET /api/config` reveals only public provider configuration. `POST /api/reviews` accepts the strict `ReviewInput` object and returns `{report}` or an explicit error. For TypeSafe, `X-BriefCheck-Live-Consent: 1` is also required. An unavailable provider returns HTTP 502 with an unavailable report; malformed inputs return 400/413. Only one review can run at a time (409 for concurrent work). There is no report database, authentication, approval, execution, crawling, arbitrary-URL fetching, or deployment endpoint.

Each immutable report includes the full evaluated input, session/tool-call/target identity, evidence content hash, question/rubric/config-bound fingerprint, provider mode/requested and returned model, timestamp, raw typed answers, exact excerpts, deterministic disposition, and `humanDecision: not_taken`. Hashes bind snapshots; they are not signatures or authorization tokens. Exports contain supplied copy and facts, so share them only with appropriate recipients. Reports and keys are not persisted by the app; a browser download is user-controlled.

The service is intentionally single-user and loopback-only. It is **not safe to expose directly to the internet**. Production integration requires host authentication/authorization, trusted server-resolved evidence/action context, tenant isolation, request budgets, concurrency/rate limits, and a fresh review of data handling. Copy can contain malicious instructions. Jev's own docs warn that adversarial state can steer decisions, so this report can never be a security boundary.

## Sources and attribution

Official documentation checked 2026-10-11: [HTTP API](https://docs.typesafe.ai/api), [models](https://docs.typesafe.ai/models), [confidence](https://docs.typesafe.ai/confidence), [Jev limitations](https://docs.typesafe.ai/model-jaggedness/jev-1.13).

Naïve contract reference: `usenaive/agency-blueprint` at [`012751bba8c4b167c3d8e66acdc102b85e35ccfe`](https://github.com/usenaive/agency-blueprint/tree/012751bba8c4b167c3d8e66acdc102b85e35ccfe). The adapter/panel are original implementation code based on the public action/schema interface; no upstream codebase or templates are copied. No affiliation or installed integration is claimed.
