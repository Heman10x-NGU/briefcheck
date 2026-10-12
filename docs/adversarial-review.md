# BriefCheck adversarial review

Review date: 2026-10-11. Status: completed against the frozen source snapshot below. The two verified findings were fixed and independently re-tested. No unresolved blocking defect was identified within this review’s tested scope.

## Scope

The review covers the local advisory prototype, its server-side TypeSafe adapter, input/report validation, and display-only integration adapter. All request fixtures and keys are synthetic. External TypeSafe requests are injected test doubles; no paid calls or production credentials were used.

This is a bounded correctness/security review, not a security certification, accuracy benchmark, or validation of the model's resistance to prompt injection. BriefCheck is not an authorization boundary and cannot publish a site or approve a pending action.

## Reproduce the independent checks

From a clean checkout with the documented Node version:

```sh
npm ci
npx vitest run tests/adversarial-provider.test.mjs tests/adversarial-server.test.mjs
npm run check
```

Independent run: **73/73 passed** across two files: 50 provider/input cases and 23 HTTP/state/report-integrity cases. After the final dependency refresh, `npm run check` independently passed TypeScript, **168/168 tests across seven files**, and the client/server production build (Vite 7.3.7, Vitest 4.1.11, Node 24.19.0). Some independent cases overlap the developer-authored suite intentionally; these are test-case counts, not distinct security guarantees. The 73 independent cases are included in the aggregate 168, not additional to it. The frozen source hashes are recorded below.

## Verified findings and remediation

### Medium: contradictory provider confidence could suppress review flags

The initial provider validator accepted an evenly split Choice distribution with `confidence: 1`, despite the official confidence formula requiring zero. With positive choices, the review engine returned `no_flags` and no uncertainty issue.

Reproduction: provide all three expected answers and the pinned model; use probability 0.25 for each support option, 1/3 for each scope/tone option, `confidence: 1`, and select `supported`, `within_scope`, and `aligned`.

Fix location: `src/server/providers.ts:130–136`. The provider now derives Choice confidence from the highest option probability and rejects disagreement over 0.005. The independent contradictory-confidence regression passes. This prevents that malformed-response path; it does not calibrate the product's 0.72 routing threshold or establish real-model accuracy.

Sources: [TypeSafe confidence definition](https://docs.typesafe.ai/confidence), [HTTP response contract](https://docs.typesafe.ai/api).

### Medium: inconsistent report contents could appear clean

The first client report schema accepted a `no_flags` report with an unsupported/unknown choice or confidence below the configured threshold. It also accepted invented section evidence and issue evidence whose ID or text did not match the report's supplied input facts. The input/config binding alone did not detect these mutations.

This concerns malformed-response display correctness. It is not an authorization exploit: reports are unsigned, and no approval or publication operation consumes them.

Fix locations: `src/shared/schema.ts:404–456` and `src/client/state.ts:22–55`. The report validator now requires section evidence to match mapped input facts, issue evidence IDs/text to match supplied facts, and no-flags signals to use known positive choices at or above the configured threshold. All seven independent regressions pass. The integration example also preserves the actual HTTP status when combining it with response JSON, so a body field cannot override the failure indicator.

## Verified controls

- The live transport uses one fixed HTTPS TypeSafe endpoint, a pinned model, a server-side Bearer header, and `redirect: 'error'`. Submitted copy cannot select an upstream URL or alter the fixed questions.
- Missing keys, missing/extra answers, invalid model/choice/type/range/distribution, empty/non-JSON/oversized responses, network failures, HTTP errors, and timeouts fail closed. Error bodies and synthetic credential values are not echoed.
- The simulator is explicit and is never a fallback after a live-provider failure. Every report records that no human decision was taken.
- Review input rejects unknown approval/provider/URL/report fields, forged exact-constraint source IDs, duplicate evidence IDs, unsupported sections, partial replacements, unsafe paths, oversized text, and excessive nesting.
- Local HTTP handling restricts Host and browser Origin, requires JSON, bounds request bodies, rejects malformed/deep input before a provider call, and returns no-store responses.
- A live review requires a distinct consent header. The local UI is responsible for collecting that consent; this is not authentication against other programs already able to reach the local process.
- Concurrent reviews do not return another client's report. There is no stored-report lookup endpoint or persistent report cache.
- Input is snapshotted before asynchronous work. Fingerprints include action/session/target IDs, current and proposed content, evidence/constraints, provider identity, rubric content/version, and threshold. Changed inputs invalidate the prior fingerprint.
- The integration adapter has no confirmation or publishing calls and explicitly labels its freshness check as display-only.

## Limits

- The explicit live-evaluation no-cost guard was executed after the final Node/tsx script change: omitting `--confirm-live-costs` exited with status 1 before provider construction. No external request ran.
- The live provider's real availability, billing, model quality, and behavior on hostile content were not exercised.
- Evidence is operator-supplied. Exact values are mechanically compared; source truth and provenance are not independently verified.
- Instruction-like-text heuristics are illustrative detection aids. They do not guarantee prompt-injection prevention.
- Editing during an in-flight review discards a stale result; it does not promise cancellation of already-started remote work.
- The prototype is a loopback, single-operator workbench. It has not been reviewed as an internet-facing authenticated service.
- Browser interaction and visual checks are documented separately in the QA report; this report does not claim those tests ran.

## Frozen source snapshot

SHA-256 values recorded after re-running the final aggregate check following the Node/tsx startup-script update. Documentation-only edits do not change this source snapshot.

```text
dd07cce612a25d98ce6013140dc0ed188a08f0dd6ce7ddcbddeb263a6944e7bd  integration/NaiveReviewPanel.tsx
4e27174974721718030262b07c8e9c4af929956d0bd418b40acffe3fe3285e31  integration/naive-adapter.ts
2e2fc5c5cf3c23299ccae402b4f2f6d93b1a24e8a3bf0e8ee5e916a554c237cf  scripts/live-eval.ts
d0948a21bf1673cf0db2c6236243a3c0021118f83d011c03dd871892369cbe22  src/client/App.tsx
eb8598318973458ea5f1f088c948e826a853c60c971880c1cfdfa8462b20a80c  src/client/main.tsx
bfb062bbd9272d80084f041af9c56b3aef37febe8d3333af408e2edfdb537cb2  src/client/state.ts
83e938168e0453915dfc7e8cf6ecf86c4c714c075892eb780ecb4014f37b202f  src/client/style.css
063f2f70cb86863b753b9609624953d58c439b80adbf5dfdc58c9729d3de5fcb  src/server/app.ts
d8cde30cef95cb19860700cb8a9fe99a751466cc8ad48271997d2aba4f3c422f  src/server/index.ts
2a7a4db8e00c568fa7615a4d0ddffcf8f56dfe5b97a65f58739c356cbefff799  src/server/providers.ts
57a2b5d1228ef300d24f8f61850cb1b60d37a35838abdc59d05936c0c0eb3719  src/server/review.ts
a4db76f550c919feab07adbf49b616cc19544389a2836c80dec19b7eddde70e0  src/server/rubric.ts
d8d3430d16beab9e8955e4107f7440a8485203d27f7920ed1ef03f113d6645f5  src/shared/fixtures.ts
d9d518c072bd1b0031d590551fe3569fba30a6d45db25a196b813bc5ff8b7169  src/shared/schema.ts
1b82626bd310e30ab01766e0c161f6d84b94df3dc08cd63e47216ae4ebd54a48  package.json
f1a8a039b99d4e2369f8bbca31483e46f20bf3ce60ca37d4f401e601812ea4b8  package-lock.json
c4cabaa431aa9765995535af7245f68c93063ec3bd4c6c54bd3728ad45785b1b  vite.config.ts
```
