import { createHash, randomUUID } from "node:crypto";
import {
  atPath,
  canonical,
  CONFIDENCE_THRESHOLD,
  excerpts,
  RUBRIC_VERSION,
  type Issue,
  type ProviderIdentity,
  type Report,
  type ReviewInput,
  type SectionName,
  type SectionResult,
} from "../shared/schema.js";
import { QUESTIONS } from "./rubric.js";
import { ProviderError, type Provider } from "./providers.js";
export const hash = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");
export function fingerprint(
  input: ReviewInput,
  provider: ProviderIdentity,
): string {
  return hash({
    input,
    provider,
    rubric: {
      version: RUBRIC_VERSION,
      questions: QUESTIONS,
      threshold: CONFIDENCE_THRESHOLD,
    },
  });
}
export function isReportCurrent(
  report: Report,
  input: ReviewInput,
  provider: ProviderIdentity,
): boolean {
  return report.fingerprint === fingerprint(input, provider);
}
export async function review(
  input: ReviewInput,
  provider: Provider,
): Promise<Report> {
  // Immutable snapshot: callers can edit their own state while the provider is in flight.
  input = structuredClone(input);
  const sections: SectionResult[] = [];
  for (const section of Object.keys(input.proposedUpdate) as SectionName[]) {
    const evidence = input.evidence.facts
      .filter((f) => f.sections.includes(section))
      .map(({ id, text }) => ({ id, text }));
    const proposedExcerpts = excerpts(input.proposedUpdate[section], section);
    const result: SectionResult = {
      section,
      currentExcerpts: excerpts(input.currentSite[section], section),
      proposedExcerpts,
      evidence,
      answers: {},
      issues: [],
    };
    const add = (code: Issue["code"], path: string, proposedExcerpt: string) =>
      result.issues.push({
        code,
        section,
        path,
        proposedExcerpt,
        evidence,
        source: "deterministic",
      });
    if (proposedExcerpts.length === 0)
      add("EMPTY_SECTION", section, "[no textual copy in this replacement]");
    if (evidence.length === 0)
      add(
        "NO_EVIDENCE",
        section,
        proposedExcerpts.map((p) => p.text).join("\n"),
      );
    for (const part of proposedExcerpts) {
      if (part.text.length > 1200) add("LENGTH_LIMIT", part.path, part.text);
      if (
        !part.text.trim() &&
        !/secondaryCta|offlineNote|cadence$/.test(part.path)
      )
        add("EMPTY_COPY", part.path, part.text);
      if (
        /ignore.{0,35}instructions|mark.{0,20}approved|system prompt|override.{0,20}(?:check|rules)/i.test(
          part.text,
        )
      )
        add("INSTRUCTION_LIKE_TEXT", part.path, part.text);
    }
    // Scan evidence too: marking supplied facts "approved" does not make hostile text trustworthy.
    for (const fact of evidence)
      if (
        /ignore.{0,35}instructions|mark.{0,20}approved|system prompt|override.{0,20}(?:check|rules)/i.test(
          fact.text,
        )
      )
        add(
          "INSTRUCTION_LIKE_TEXT",
          `evidence.${fact.id}`,
          proposedExcerpts.map((p) => p.text).join("\n"),
        );
    for (const constraint of input.evidence.exact.filter(
      (c) => c.path[0] === section,
    )) {
      const actual = atPath(input.proposedUpdate, constraint.path);
      if (actual !== constraint.expected) {
        const fact = input.evidence.facts.find(
          (f) => f.id === constraint.factId,
        )!;
        result.issues.push({
          code: "EXACT_MISMATCH",
          section,
          path: constraint.path.map(String).join("."),
          proposedExcerpt:
            actual === undefined ? "[field absent]" : String(actual),
          evidence: [{ id: fact.id, text: fact.text }],
          source: "deterministic",
        });
      }
    }
    sections.push(result);
  }
  const report: Report = {
    id: randomUUID(),
    fingerprint: fingerprint(input, provider.identity),
    evidenceHash: hash(input.evidence),
    createdAt: new Date().toISOString(),
    input,
    rubricVersion: RUBRIC_VERSION,
    threshold: CONFIDENCE_THRESHOLD,
    provider: { ...provider.identity, returnedModels: [] },
    disposition: "review_required",
    humanDecision: "not_taken",
    sections,
    issues: [],
    usage: { inputTokens: 0, outputTokens: 0 },
  };
  for (const section of sections) {
    if (section.evidence.length === 0 || section.proposedExcerpts.length === 0)
      continue;
    try {
      const response = await provider.evaluate({
        section: section.section,
        current_excerpts: section.currentExcerpts,
        proposed_excerpts: section.proposedExcerpts,
        approved_facts: section.evidence,
        approved_tone: input.evidence.tone,
      });
      section.answers = response.answers;
      report.provider.returnedModels.push(response.model);
      report.usage.inputTokens += response.usage.input_tokens;
      report.usage.outputTokens += response.usage.output_tokens;
      const add = (code: Issue["code"]) =>
        section.issues.push({
          code,
          section: section.section,
          path: section.section,
          proposedExcerpt: section.proposedExcerpts
            .map((p) => p.text)
            .join("\n"),
          evidence: section.evidence,
          source: "advisory",
        });
      for (const [name, answer] of Object.entries(response.answers)) {
        if (
          answer.choice === "unclear" ||
          answer.confidence < CONFIDENCE_THRESHOLD
        )
          add("UNCERTAIN");
        if (name === "support" && answer.choice === "unsupported")
          add("UNSUPPORTED_CLAIM");
        if (name === "support" && answer.choice === "contradicted")
          add("CONTRADICTION");
        if (name === "scope" && answer.choice === "expanded")
          add("UNSUPPORTED_CLAIM");
        if (name === "tone" && answer.choice === "misaligned")
          add("TONE_MISMATCH");
      }
      section.issues = section.issues.filter(
        (issue, index, all) =>
          all.findIndex(
            (x) => x.code === issue.code && x.path === issue.path,
          ) === index,
      );
    } catch (error) {
      report.error =
        error instanceof ProviderError
          ? error.message
          : "The semantic provider failed. Retry manually.";
      for (const unfinished of sections.filter(
        (s) => Object.keys(s.answers).length === 0,
      ))
        unfinished.issues.push({
          code: "PROVIDER_UNAVAILABLE",
          section: unfinished.section,
          path: unfinished.section,
          proposedExcerpt: unfinished.proposedExcerpts
            .map((p) => p.text)
            .join("\n"),
          evidence: unfinished.evidence,
          source: "advisory",
        });
      break; // No retries and no fallback to the simulator.
    }
  }
  report.issues = sections.flatMap((s) => s.issues);
  report.disposition = report.error
    ? "unavailable"
    : report.issues.length
      ? "review_required"
      : "no_flags";
  report.provider.returnedModels = [...new Set(report.provider.returnedModels)];
  return report;
}
