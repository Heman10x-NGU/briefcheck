/** Original adapter code. Contract verified against usenaive/agency-blueprint at UPSTREAM_COMMIT. */
import {
  canonical,
  CONFIDENCE_THRESHOLD,
  reviewSchema,
  RUBRIC_VERSION,
  type Evidence,
  type ProviderIdentity,
  type Report,
  type ReviewInput,
} from "../src/shared/schema.js";
export const UPSTREAM_COMMIT = "012751bba8c4b167c3d8e66acdc102b85e35ccfe";
export interface PendingRow {
  session: { id: string };
  action: {
    kind?: "tool" | "question";
    tool_call_id: string;
    name: string;
    args: Record<string, unknown>;
  };
}
export type Prepared =
  | { status: "ignored"; reason: string }
  | { status: "unavailable"; reason: string }
  | { status: "ready"; key: string; input: ReviewInput };
export function preparePendingReview(
  row: PendingRow,
  currentSite: Record<string, unknown>,
  evidence: Evidence,
  targetId: string,
): Prepared {
  if (
    !row ||
    typeof row !== "object" ||
    !row.session ||
    typeof row.session.id !== "string" ||
    !row.action ||
    typeof row.action.name !== "string" ||
    typeof row.action.tool_call_id !== "string" ||
    (row.action.kind !== undefined &&
      !["tool", "question"].includes(row.action.kind))
  ) {
    return {
      status: "unavailable",
      reason:
        "The pending action envelope is malformed. Review the original action manually.",
    };
  }
  if (
    row.action.kind === "question" ||
    row.action.name !== "dashboard.update_site"
  )
    return {
      status: "ignored",
      reason:
        "This adapter reviews only pending dashboard.update_site tool calls.",
    };
  if (
    !row.action.args ||
    typeof row.action.args !== "object" ||
    Array.isArray(row.action.args) ||
    Object.keys(row.action.args).length !== 1 ||
    !Object.hasOwn(row.action.args, "site")
  )
    return {
      status: "unavailable",
      reason:
        "Expected exactly args.site. Unsupported arguments require manual review.",
    };
  const parsed = reviewSchema.safeParse({
    identity: {
      sessionId: row.session.id,
      toolCallId: row.action.tool_call_id,
      targetId,
      actionName: row.action.name,
    },
    currentSite,
    proposedUpdate: row.action.args.site,
    evidence,
  });
  if (!parsed.success)
    return {
      status: "unavailable",
      reason:
        "The pending site update has an unsupported section, incomplete shape, missing evidence, or excessive size. Review the original arguments manually.",
    };
  return {
    status: "ready",
    key: JSON.stringify([row.session.id, row.action.tool_call_id]),
    input: parsed.data,
  };
}
/** Display-only freshness check, never an authorization check. Server reports are not signed. */
export function reportMatchesPending(
  report: Report,
  prepared: Prepared,
  provider: ProviderIdentity,
): boolean {
  return (
    prepared.status === "ready" &&
    canonical(report.input) === canonical(prepared.input) &&
    canonical({
      mode: report.provider.mode,
      requestedModel: report.provider.requestedModel,
      implementation: report.provider.implementation,
    }) === canonical(provider) &&
    report.rubricVersion === RUBRIC_VERSION &&
    report.threshold === CONFIDENCE_THRESHOLD
  );
}
// Deliberately no tool_confirmations or update_site calls. The original human buttons remain the only decision path.
