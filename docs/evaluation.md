# Evaluation protocol (not yet executed with a live model)

## Evidence available now

The deterministic and HTTP-contract test suites run locally. The simulator's four synthetic cases are demonstration and development cases. They do not establish semantic accuracy, calibration, production latency, user outcomes, or dollar savings.

On 2026-10-13, one live SubQ Snap request using the existing invented-result fixture succeeded. Its [recorded response](subq-smoke-2026-10-13.json) is a connection smoke check only. The response classified support as contradicted, scope as expanded, and tone as misaligned. No independent human label set or comparison with Jev was used. The 0.72 routing threshold has not been tuned for SubQ, and the preview model identifier may change behavior over time.

## Before tuning or shipping

1. Collect representative agency copy updates and their genuinely approved source packs, with permission for TypeSafe transmission. Include ordinary paraphrases, new results/testimonials, scope/price changes, vague and conflicting evidence, multilingual copy, and adversarial instructions.
2. Have two human reviewers label each section: support (`supported`, `unsupported`, `contradicted`, `unclear`), scope, tone, plus overall need for review. Resolve disagreements without consulting model output. Freeze source revisions and labels.
3. Split by agency/client and document family into development and untouched holdout sets, not random neighboring sentences. Keep at least 30% as holdout and enough samples to make error estimates useful. Store the split manifest before prompt/threshold changes. The current demo cases belong only in development.
4. Use development data to choose prompts and threshold. Freeze model ID, rubric, confidence rule and all deterministic checks. Run holdout once. Do not tune on it; a change requires a new holdout or explicit retest disclosure.
5. Compare three baselines on the identical holdout: deterministic-only checks, simulated rules, and deterministic + live Jev. Use recorded labels, not the simulator's expected answers, as ground truth.

## Calculations to report

- False-clear rate = human-review-required cases with no flags / all human-review-required cases. Treat unavailable responses separately, never as correct clear results.
- Review recall = flagged human-review-required cases / all human-review-required cases.
- Review precision = flagged human-review-required cases / all flagged cases with known human labels.
- Unavailable rate = unavailable cases / all attempted cases.
- Report the confusion matrix and raw numerator/denominator with every rate. Record median and p95 end-to-end latency and reported input tokens only from actual runs.
- Stratify results by claim type, language, missing/conflicting evidence and adversarial content. Inspect every false clear. Confidence is not a factuality probability; any calibration study must define its event precisely.

No holdout corpus or accuracy results have been produced for this prototype. `npm run eval:live -- --confirm-live-costs` is an opt-in four-case transport/workflow smoke check for the configured provider, not this evaluation protocol. Apply the same frozen-data procedure to SubQ before comparing it with Jev or making accuracy claims.
