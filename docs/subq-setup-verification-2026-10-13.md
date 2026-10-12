# SubQ setup verification

Verified locally on 2026-10-13, Node 22.21.0, npm 10.9.4. This extends the original prototype with a SubQ provider; the earlier QA and adversarial reports describe their original dated snapshots.

- `npm run check`: passed TypeScript, 193 tests in 8 files, and the client/server production build.
- `node tests/qa.startup.mjs`: passed the five local HTTP/startup groups, using explicit simulation and fake keys so a live `.env` cannot enable external requests.
- `npm run format:check`: passed.
- `git diff --check`: passed.
- Browser: reloaded the production app and confirmed `LIVE SUBQ PROVIDER`, the SubQ consent checkbox, and `Run SubQ review`. No additional browser-triggered model call was made.

One authorized live request used the existing fictional `unsupported` fixture through `POST /api/reviews`. It returned HTTP 200, requested and returned model `subq-snap-preview`, and disposition `review_required`. Support was `contradicted`, scope `expanded`, and tone `misaligned`. The provider reported 851 input tokens and 0 output tokens. The local client measured 822 ms end to end for this single request. This is not a latency benchmark or accuracy evaluation. Full synthetic input and validated output: [subq-smoke-2026-10-13.json](subq-smoke-2026-10-13.json).

The user's key was moved from the former TypeSafe field into `SUBQ_API_KEY` in ignored `.env`; no credential is included in the evidence or source. SubQ requests use its fixed HTTPS endpoint and a 60-second timeout, with no redirects, retries, or simulator fallback. TypeSafe's existing confidence-formula validation remains specific to TypeSafe; SubQ's documented response shape, answer coverage, selected maximum, probability sum/range, and confidence range are validated without assuming an undocumented confidence formula.

The shared 0.72 confidence threshold remains uncalibrated. No live Jev call, holdout evaluation, model-quality comparison, hosted deployment, or installed Naive integration was performed.
