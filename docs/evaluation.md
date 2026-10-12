# Evaluation protocol (not yet executed with Jev)

## Evidence available now

The deterministic and HTTP-contract test suites run locally. The simulator's four synthetic cases are demonstration and development cases. They do not establish semantic accuracy, calibration, production latency, user outcomes, or dollar savings.

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

No holdout corpus, live-provider results, or performance numbers have been fabricated for this prototype. `npm run eval:live -- --confirm-live-costs` is an opt-in four-case transport/workflow smoke check, not this evaluation protocol.
