import { z } from "zod";

export const MODEL = "jev-1.13.0";
export const RUBRIC_VERSION = "briefcheck-1.0";
export const CONFIDENCE_THRESHOLD = 0.72; // Product routing choice, not a validated accuracy threshold.
export const SECTION_NAMES = [
  "company",
  "tagline",
  "tone",
  "hero",
  "proof",
  "services",
  "pricing",
  "contact",
  "footer",
] as const;
export type SectionName = (typeof SECTION_NAMES)[number];
const text = z.string().max(2000);
const nonempty = z.string().min(1).max(200);
const list = <T extends z.ZodType>(item: T) => z.array(item).max(24);
export const sectionSchemas = {
  company: text,
  tagline: text,
  tone: text,
  hero: z
    .object({
      eyebrow: text,
      title: text,
      subtitle: text,
      cta: text,
      secondaryCta: text,
    })
    .strict(),
  proof: z.object({ facts: list(text) }).strict(),
  services: list(
    z
      .object({
        name: text,
        headline: text,
        description: text,
        deliverables: list(text),
      })
      .strict(),
  ),
  pricing: z
    .object({
      title: text,
      subtitle: text,
      tiers: list(
        z
          .object({
            name: text,
            price: text,
            cadence: text,
            blurb: text,
            includes: list(text),
            featured: z.boolean().optional(),
          })
          .strict(),
      ),
    })
    .strict(),
  contact: z
    .object({ title: text, subtitle: text, email: text, offlineNote: text })
    .strict(),
  footer: z.object({ note: text }).strict(),
};
export const updateSchema = z
  .object(sectionSchemas)
  .partial()
  .strict()
  .refine(
    (v) => Object.keys(v).length > 0 && Object.keys(v).length <= 6,
    "Supply one to six supported whole sections.",
  );
export const factSchema = z
  .object({
    id: nonempty,
    text: z.string().min(1).max(1000),
    sections: z.array(z.enum(SECTION_NAMES)).min(1).max(9),
  })
  .strict();
export const evidenceSchema = z
  .object({
    revision: nonempty,
    tone: z.string().min(1).max(500),
    facts: z.array(factSchema).min(1).max(16),
    exact: z
      .array(
        z
          .object({
            path: z
              .array(
                z.union([
                  z.string().min(1).max(80),
                  z.number().int().min(0).max(23),
                ]),
              )
              .min(1)
              .max(6),
            expected: z.union([text, z.number().finite(), z.boolean()]),
            factId: nonempty,
          })
          .strict(),
      )
      .max(16),
  })
  .strict()
  .superRefine((v, ctx) => {
    const ids = v.facts.map((f) => f.id);
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({ code: "custom", message: "Evidence IDs must be unique." });
    for (const constraint of v.exact) {
      if (!ids.includes(constraint.factId))
        ctx.addIssue({
          code: "custom",
          message: "Every exact constraint must reference a supplied fact ID.",
        });
      if (
        !SECTION_NAMES.includes(constraint.path[0] as SectionName) ||
        constraint.path.some((p) =>
          ["__proto__", "prototype", "constructor"].includes(String(p)),
        )
      )
        ctx.addIssue({
          code: "custom",
          message: "Invalid exact-constraint path.",
        });
    }
  });
export const reviewSchema = z
  .object({
    identity: z
      .object({
        sessionId: nonempty,
        toolCallId: nonempty,
        targetId: nonempty,
        actionName: z.literal("dashboard.update_site"),
      })
      .strict(),
    currentSite: z.record(z.string(), z.json()),
    proposedUpdate: updateSchema,
    evidence: evidenceSchema,
  })
  .strict()
  .superRefine((v, ctx) => {
    if (JSON.stringify(v).length > 30000)
      ctx.addIssue({
        code: "custom",
        message: "Review context exceeds 30,000 characters.",
      });
    const check = (x: unknown, depth = 0): boolean => {
      if (depth > 10) return false;
      if (typeof x === "string") return x.length <= 2000;
      if (Array.isArray(x))
        return x.length <= 24 && x.every((y) => check(y, depth + 1));
      if (x && typeof x === "object")
        return (
          Object.keys(x).length <= 40 &&
          Object.entries(x).every(
            ([k, y]) =>
              !["__proto__", "prototype", "constructor"].includes(k) &&
              check(y, depth + 1),
          )
        );
      return true;
    };
    if (!check(v.currentSite))
      ctx.addIssue({
        code: "custom",
        message:
          "Current site exceeds structural bounds or contains unsafe keys.",
      });
    for (const key of Object.keys(v.proposedUpdate) as SectionName[]) {
      if (!sectionSchemas[key].safeParse(v.currentSite[key]).success)
        ctx.addIssue({
          code: "custom",
          message: `Current section ${key} must have the supported complete shape.`,
        });
    }
  });
export type ReviewInput = z.infer<typeof reviewSchema>;
export type Evidence = z.infer<typeof evidenceSchema>;
export type IssueCode =
  | "EXACT_MISMATCH"
  | "EMPTY_SECTION"
  | "EMPTY_COPY"
  | "LENGTH_LIMIT"
  | "INSTRUCTION_LIKE_TEXT"
  | "NO_EVIDENCE"
  | "UNSUPPORTED_CLAIM"
  | "CONTRADICTION"
  | "UNCERTAIN"
  | "TONE_MISMATCH"
  | "PROVIDER_UNAVAILABLE";
export const REASONS: Record<IssueCode, string> = {
  EMPTY_SECTION:
    "This whole-section replacement contains no copy. Review the removal manually.",
  EXACT_MISMATCH: "A structured value differs from its approved constraint.",
  EMPTY_COPY: "A required copy field is empty.",
  LENGTH_LIMIT: "Copy exceeds the review length limit.",
  INSTRUCTION_LIKE_TEXT: "Instruction-like text needs a human review.",
  NO_EVIDENCE: "No approved evidence supplied for this section.",
  UNSUPPORTED_CLAIM: "The advisory signal indicates a claim needs evidence.",
  CONTRADICTION:
    "The advisory signal indicates a conflict with supplied facts.",
  UNCERTAIN: "The advisory result is uncertain; inspect the evidence yourself.",
  TONE_MISMATCH:
    "The advisory signal indicates a mismatch with the approved voice.",
  PROVIDER_UNAVAILABLE:
    "The semantic check did not complete. No clear result is available.",
};
export interface Excerpt {
  path: string;
  text: string;
}
export interface Issue {
  code: IssueCode;
  section: string;
  path: string;
  proposedExcerpt: string;
  evidence: { id: string; text: string }[];
  source: "deterministic" | "advisory";
}
export interface ChoiceAnswer {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}
export interface SectionResult {
  section: SectionName;
  currentExcerpts: Excerpt[];
  proposedExcerpts: Excerpt[];
  evidence: { id: string; text: string }[];
  answers: Record<string, ChoiceAnswer>;
  issues: Issue[];
}
export interface ProviderIdentity {
  mode: "simulated" | "typesafe";
  requestedModel: string;
  implementation: string;
}
export interface Report {
  id: string;
  fingerprint: string;
  evidenceHash: string;
  createdAt: string;
  input: ReviewInput;
  rubricVersion: string;
  threshold: number;
  provider: ProviderIdentity & { returnedModels: string[] };
  disposition: "review_required" | "no_flags" | "unavailable";
  humanDecision: "not_taken";
  sections: SectionResult[];
  issues: Issue[];
  error?: string;
  usage: { inputTokens: number; outputTokens: number };
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export function excerpts(value: unknown, path: string): Excerpt[] {
  if (typeof value === "string") return [{ path, text: value }];
  if (Array.isArray(value))
    return value.flatMap((v, i) => excerpts(v, `${path}[${i}]`));
  if (value && typeof value === "object")
    return Object.entries(value).flatMap(([k, v]) =>
      excerpts(v, `${path}.${k}`),
    );
  return [];
}
export function atPath(value: unknown, path: (string | number)[]): unknown {
  let current: unknown = value;
  for (const key of path) {
    if (!current || typeof current !== "object" || !Object.hasOwn(current, key))
      return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

const issueSchema = z
  .object({
    code: z.enum(Object.keys(REASONS) as [IssueCode, ...IssueCode[]]),
    section: z.string(),
    path: z.string(),
    proposedExcerpt: z.string(),
    evidence: z.array(z.object({ id: z.string(), text: z.string() }).strict()),
    source: z.enum(["deterministic", "advisory"]),
  })
  .strict();
const excerptSchema = z.object({ path: z.string(), text: z.string() }).strict();
const choiceAnswerSchema = z
  .object({
    type: z.literal("choice"),
    choice: z.string(),
    confidence: z.number().finite().min(0).max(1),
    probabilities: z.record(z.string(), z.number().finite().min(0).max(1)),
  })
  .strict();
export const configSchema = z
  .object({
    provider: z
      .object({
        mode: z.enum(["simulated", "typesafe"]),
        requestedModel: z.string().min(1),
        implementation: z.string().min(1),
      })
      .strict(),
    rubricVersion: z.literal(RUBRIC_VERSION),
    threshold: z.number().finite().min(0).max(1),
    externalTransmission: z.boolean(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      v.externalTransmission !== (v.provider.mode === "typesafe") ||
      v.provider.requestedModel !==
        (v.provider.mode === "typesafe" ? MODEL : "simulated-rules-v1")
    )
      ctx.addIssue({
        code: "custom",
        message: "Inconsistent provider configuration.",
      });
  });
export const reportSchema = z
  .object({
    id: z.string().uuid(),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    evidenceHash: z.string().regex(/^[a-f0-9]{64}$/),
    createdAt: z.iso.datetime(),
    input: reviewSchema,
    rubricVersion: z.string(),
    threshold: z.number().finite().min(0).max(1),
    provider: z
      .object({
        mode: z.enum(["simulated", "typesafe"]),
        requestedModel: z.string(),
        implementation: z.string(),
        returnedModels: z.array(z.string()),
      })
      .strict(),
    disposition: z.enum(["review_required", "no_flags", "unavailable"]),
    humanDecision: z.literal("not_taken"),
    sections: z
      .array(
        z
          .object({
            section: z.enum(SECTION_NAMES),
            currentExcerpts: z.array(excerptSchema),
            proposedExcerpts: z.array(excerptSchema),
            evidence: z.array(
              z.object({ id: z.string(), text: z.string() }).strict(),
            ),
            answers: z.record(z.string(), choiceAnswerSchema),
            issues: z.array(issueSchema),
          })
          .strict(),
      )
      .min(1)
      .max(6),
    issues: z.array(issueSchema),
    error: z.string().optional(),
    usage: z
      .object({
        inputTokens: z.number().int().nonnegative(),
        outputTokens: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      v.disposition !==
      (v.error
        ? "unavailable"
        : v.issues.length
          ? "review_required"
          : "no_flags")
    )
      ctx.addIssue({
        code: "custom",
        message: "Inconsistent report disposition.",
      });
    if (canonical(v.issues) !== canonical(v.sections.flatMap((s) => s.issues)))
      ctx.addIssue({ code: "custom", message: "Inconsistent report issues." });
    if (
      v.sections
        .map((s) => s.section)
        .sort()
        .join(",") !== Object.keys(v.input.proposedUpdate).sort().join(",")
    )
      ctx.addIssue({
        code: "custom",
        message: "Report section coverage mismatch.",
      });
    for (const section of v.sections) {
      const supplied = v.input.evidence.facts
        .filter((f) => f.sections.includes(section.section))
        .map(({ id, text }) => ({ id, text }));
      if (canonical(section.evidence) !== canonical(supplied))
        ctx.addIssue({ code: "custom", message: "Report evidence mismatch." });
      for (const issue of section.issues)
        if (
          issue.evidence.some(
            (f) =>
              !v.input.evidence.facts.some(
                (real) => real.id === f.id && real.text === f.text,
              ),
          )
        )
          ctx.addIssue({ code: "custom", message: "Unknown issue evidence." });
      if (
        canonical(section.proposedExcerpts) !==
          canonical(
            excerpts(v.input.proposedUpdate[section.section], section.section),
          ) ||
        canonical(section.currentExcerpts) !==
          canonical(
            excerpts(v.input.currentSite[section.section], section.section),
          )
      )
        ctx.addIssue({ code: "custom", message: "Report excerpt mismatch." });
      if (
        v.disposition === "no_flags" &&
        (["support", "scope", "tone"].some(
          (key) =>
            !section.answers[key] ||
            section.answers[key].confidence < v.threshold,
        ) ||
          section.answers.support?.choice !== "supported" ||
          section.answers.scope?.choice !== "within_scope" ||
          section.answers.tone?.choice !== "aligned")
      )
        ctx.addIssue({
          code: "custom",
          message:
            "A no-flags report contains concerning or uncertain answers.",
        });
      if (
        v.disposition === "no_flags" &&
        (Object.keys(section.answers).sort().join(",") !==
          "scope,support,tone" ||
          section.evidence.length === 0)
      )
        ctx.addIssue({
          code: "custom",
          message: "A no-flags report lacks complete semantic checks.",
        });
    }
  });
