// Every edit or new run increments the generation. A late response cannot restore an old report.
export class ReviewGeneration {
  private generation = 0;
  invalidate() {
    return ++this.generation;
  }
  begin() {
    return ++this.generation;
  }
  isCurrent(token: number) {
    return token === this.generation;
  }
}

import {
  canonical,
  reportSchema,
  type ProviderIdentity,
  type ReviewInput,
  type Report,
} from "../shared/schema.js";
export function validatedReport(
  raw: unknown,
  input: ReviewInput,
  config: {
    provider: ProviderIdentity;
    rubricVersion: string;
    threshold: number;
  },
  httpOk: boolean,
): Report {
  const parsed = reportSchema.safeParse(raw);
  if (!parsed.success)
    throw new Error(
      "The server returned an invalid report. No clear result is available.",
    );
  const report = parsed.data;
  if (
    canonical(report.input) !== canonical(input) ||
    report.rubricVersion !== config.rubricVersion ||
    report.threshold !== config.threshold ||
    canonical({
      mode: report.provider.mode,
      requestedModel: report.provider.requestedModel,
      implementation: report.provider.implementation,
    }) !== canonical(config.provider)
  )
    throw new Error(
      "The report does not match the current input, provider, or rubric. Run a fresh review.",
    );
  if (!httpOk && report.disposition !== "unavailable")
    throw new Error(
      "The failed request returned an inconsistent report. No clear result is available.",
    );
  return report;
}
