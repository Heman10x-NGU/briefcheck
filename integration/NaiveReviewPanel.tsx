import { useEffect, useRef, useState } from "react";
import {
  canonical,
  REASONS,
  PROVIDER_LABELS,
  type ProviderIdentity,
  type Report,
  type ReviewInput,
} from "../src/shared/schema.js";
import { validatedReport } from "../src/client/state.js";
import type { Prepared } from "./naive-adapter.js";
export interface PanelConfig {
  provider: ProviderIdentity;
  rubricVersion: string;
  threshold: number;
}
export interface PanelProps {
  prepared: Prepared;
  config: PanelConfig;
  load: (
    input: ReviewInput,
    liveConsent: boolean,
  ) => Promise<{ ok: boolean; report?: unknown; error?: string }>;
}
/** Advisory-only slot placed above the existing Approve/Reject controls. Never sends a decision. */
export function NaiveReviewPanel({ prepared, config, load }: PanelProps) {
  const providerLabel = PROVIDER_LABELS[config.provider.mode];
  const identity = canonical({ prepared, config });
  const generation = useRef(0);
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{
    identity: string;
    report: Report;
  } | null>(null);
  useEffect(() => {
    generation.current++;
    setResult(null);
    setError("");
    setConsent(false);
    return () => {
      generation.current++;
    };
  }, [identity]);
  if (prepared.status === "ignored") return null;
  if (prepared.status === "unavailable")
    return (
      <aside role="note">
        <strong>BriefCheck unavailable</strong>
        <p>{prepared.reason}</p>
        <p>No approval or clear result is implied.</p>
      </aside>
    );
  const report = result?.identity === identity ? result.report : null;
  const run = async () => {
    if (inFlight.current) return;
    if (config.provider.mode !== "simulated" && !consent) {
      setError(
        `Confirm the ${providerLabel} transmission and possible API charges first.`,
      );
      return;
    }
    inFlight.current = true;
    const token = ++generation.current;
    setBusy(true);
    setResult(null);
    setError("");
    try {
      const response = await load(prepared.input, consent);
      if (token !== generation.current) return;
      if (response.report)
        setResult({
          identity,
          report: validatedReport(
            response.report,
            prepared.input,
            config,
            response.ok,
          ),
        });
      if (!response.ok)
        throw new Error(response.error ?? "Review unavailable.");
      if (!response.report) throw new Error("No report was returned.");
    } catch (e) {
      if (token === generation.current)
        setError(e instanceof Error ? e.message : "Review unavailable.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  return (
    <aside aria-label="BriefCheck advisory review">
      <h3>
        BriefCheck ·{" "}
        {config.provider.mode === "simulated"
          ? "Simulated demo"
          : `${providerLabel} advisory`}
      </h3>
      <p>
        Review copy against operator-supplied facts before you use the existing
        human decision controls.
      </p>
      {config.provider.mode !== "simulated" && (
        <label>
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
          />
          Send this copy and relevant evidence to {providerLabel}. API charges
          may apply.
        </label>
      )}
      <button type="button" disabled={busy} onClick={() => void run()}>
        {busy ? "Reviewing…" : "Review this pending update"}
      </button>
      {error && <p role="alert">{error}</p>}
      {report && (
        <div aria-live="polite">
          <strong>
            {report.disposition === "no_flags"
              ? "No flags in this advisory check"
              : report.disposition === "unavailable"
                ? "Review unavailable"
                : "Human review needed"}
          </strong>
          <p>
            {report.provider.mode === "simulated"
              ? "Illustrative rules, not measured real-model accuracy. "
              : ""}
            No approval has been taken.
          </p>
          {report.sections.map((s) => (
            <section key={s.section}>
              <h4>{s.section}</h4>
              {s.issues.map((issue, i) => (
                <details key={i}>
                  <summary>{REASONS[issue.code]}</summary>
                  <p>{issue.path}</p>
                  <pre style={{ whiteSpace: "pre-wrap" }}>
                    {issue.proposedExcerpt}
                  </pre>
                  {issue.evidence.map((f) => (
                    <p key={f.id}>
                      {f.id}: {f.text}
                    </p>
                  ))}
                </details>
              ))}
              <details>
                <summary>All supplied evidence</summary>
                {s.evidence.length ? (
                  s.evidence.map((f) => (
                    <p key={f.id}>
                      {f.id}: {f.text}
                    </p>
                  ))
                ) : (
                  <p>No approved evidence found.</p>
                )}
              </details>
            </section>
          ))}
        </div>
      )}
    </aside>
  );
}
