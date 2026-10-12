import { useEffect, useRef, useState } from "react";
import {
  canonical,
  configSchema,
  excerpts,
  REASONS,
  reviewSchema,
  updateSchema,
  type ProviderIdentity,
  type Report,
  type ReviewInput,
  type SectionName,
} from "../shared/schema.js";
import { fixtures } from "../shared/fixtures.js";
import { ReviewGeneration, validatedReport } from "./state.js";
type Config = {
  provider: ProviderIdentity;
  rubricVersion: string;
  threshold: number;
  externalTransmission: boolean;
};
const pretty = (value: unknown) => JSON.stringify(value, null, 2);
const titles: Record<string, string> = {
  hero: "Hero",
  pricing: "Pricing",
  contact: "Contact",
  proof: "Proof",
  services: "Services",
  tagline: "Tagline",
  company: "Company",
  tone: "Tone",
  footer: "Footer",
};
export function App() {
  const [input, setInput] = useState<ReviewInput>(
    structuredClone(fixtures[0].input),
  );
  const [proposalText, setProposalText] = useState(
    pretty(input.proposedUpdate),
  );
  const inFlight = useRef(false);
  const [fixture, setFixture] = useState(fixtures[0].id);
  const [tab, setTab] = useState("proposal");
  const [evidenceText, setEvidenceText] = useState(pretty(input.evidence));
  const [contextText, setContextText] = useState(
    pretty({ identity: input.identity, currentSite: input.currentSite }),
  );
  const [config, setConfig] = useState<Config | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState("");
  const [consent, setConsent] = useState(false);
  const generation = useRef(new ReviewGeneration());
  const changed = () => {
    setFixture("custom");
    generation.current.invalidate();
    setStale(Boolean(report) || busy || stale);
    setReport(null);
    setError("");
    setConsent(false);
  };
  useEffect(() => {
    fetch("/api/config")
      .then(async (r) => {
        if (!r.ok) throw new Error();
        return configSchema.parse(await r.json());
      })
      .then(setConfig)
      .catch(() =>
        setError(
          "Could not read server configuration. Reload before reviewing.",
        ),
      );
  }, []);
  const choose = (id: string) => {
    const f = fixtures.find((x) => x.id === id)!;
    changed();
    setFixture(id);
    setInput(structuredClone(f.input));
    setProposalText(pretty(f.input.proposedUpdate));
    setEvidenceText(pretty(f.input.evidence));
    setContextText(
      pretty({ identity: f.input.identity, currentSite: f.input.currentSite }),
    );
  };
  const updateCopy = (path: string, value: string) => {
    changed();
    const next = structuredClone(input);
    const parts = path.replace(/\[(\d+)\]/g, ".$1").split(".");
    let node: Record<string, unknown> = next.proposedUpdate as Record<
      string,
      unknown
    >;
    for (const key of parts.slice(0, -1))
      node = node[key] as Record<string, unknown>;
    node[parts.at(-1)!] = value;
    setInput(next);
    setProposalText(pretty(next.proposedUpdate));
  };
  const run = async () => {
    if (!config || inFlight.current) return;
    let evaluated: ReviewInput;
    try {
      const context = JSON.parse(contextText);
      evaluated = reviewSchema.parse({
        ...input,
        proposedUpdate: JSON.parse(proposalText),
        evidence: JSON.parse(evidenceText),
        identity: context.identity,
        currentSite: context.currentSite,
      });
    } catch {
      setError(
        "The input is invalid. Check the proposal/evidence/context JSON, required fields, supported section shapes, and size limits. No review ran.",
      );
      setReport(null);
      return;
    }
    if (config.externalTransmission && !consent) {
      setError(
        "Confirm the TypeSafe data transmission and possible API charge before running.",
      );
      return;
    }
    inFlight.current = true;
    const token = generation.current.begin();
    setBusy(true);
    setReport(null);
    setError("");
    setStale(false);
    try {
      const fresh = await fetch("/api/config").then(async (r) => {
        if (!r.ok) throw new Error("Configuration could not be read.");
        const result = configSchema.safeParse(await r.json());
        if (!result.success)
          throw new Error(
            "Server configuration is invalid. Reload before reviewing.",
          );
        return result.data;
      });
      if (canonical(fresh) !== canonical(config)) {
        if (generation.current.isCurrent(token)) {
          setConfig(fresh);
          setConsent(false);
          throw new Error(
            "Provider or rubric changed. Review the mode and run a fresh check.",
          );
        }
        return;
      }
      if (!generation.current.isCurrent(token)) return;
      const response = await fetch("/api/reviews", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(config.externalTransmission
            ? { "X-BriefCheck-Live-Consent": "1" }
            : {}),
        },
        body: JSON.stringify(evaluated),
      });
      const payload = await response.json();
      if (!generation.current.isCurrent(token)) return;
      if (payload.report)
        setReport(
          validatedReport(payload.report, evaluated, config, response.ok),
        );
      if (!response.ok)
        throw new Error(
          payload.error ?? "Review failed. No clear result is available.",
        );
      if (!payload.report)
        throw new Error(
          "The server returned no report. No clear result is available.",
        );
    } catch (e) {
      if (generation.current.isCurrent(token))
        setError(
          e instanceof Error
            ? e.message
            : "The server could not be reached. No review result is available.",
        );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const download = () => {
    if (!report) return;
    const blob = new Blob(
      [
        pretty({
          notice:
            "Advisory only. No approval taken. Simulation results do not measure Jev accuracy.",
          ...report,
        }),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `briefcheck-${report.id}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div className="app-shell">
      <header className="topbar">
        <a href="/" className="brand" aria-label="BriefCheck home">
          <span className="brand-icon">
            b<span>✓</span>
          </span>
          briefcheck<span className="wordmark-dot">.</span>
        </a>
        <div className="top-meta">
          <span className="local-dot" />
          Local review workbench<span className="version">v0.1</span>
        </div>
      </header>
      <main>
        <div className="intro">
          <div>
            <div className="eyebrow">BEFORE HUMAN APPROVAL</div>
            <h1>
              Good copy.
              <br />
              <span>Grounded claims.</span>
            </h1>
            <p>
              Compare a proposed website update with the facts you’ve approved.
              See the gaps. Keep the final judgment.
            </p>
          </div>
          <aside className="mode-card">
            <span className="mode-label">
              {config?.provider.mode === "typesafe"
                ? "LIVE TYPESAFE PROVIDER"
                : "SIMULATED DEMO"}
            </span>
            <strong>
              {config?.provider.mode === "typesafe"
                ? "Jev is configured server-side."
                : "Try the workflow. No key needed."}
            </strong>
            <p>
              {config?.provider.mode === "typesafe"
                ? "Copy and relevant evidence leave this computer when you run a review. API charges may apply."
                : "Illustrative rules power this demo. They don’t measure Jev’s accuracy or verify real-world facts."}
            </p>
          </aside>
        </div>
        <section className="scenario-bar" aria-label="Synthetic examples">
          <div>
            <span className="eyebrow">
              {fixture === "custom"
                ? "CUSTOM CASE FILE"
                : "SYNTHETIC CASE FILE"}
            </span>
            <label className="sr-only" htmlFor="scenario">
              Choose example
            </label>
            <select
              id="scenario"
              value={fixture}
              onChange={(e) => choose(e.target.value)}
            >
              {fixture === "custom" && (
                <option value="custom" disabled>
                  Custom input
                </option>
              )}
              {fixtures.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
          <p>
            {fixtures.find((f) => f.id === fixture)?.description ??
              "Your edited snapshot. Review the source pack before trusting any signal."}
          </p>
          <span className="synthetic-tag">
            {fixture === "custom"
              ? "Operator-edited input"
              : "Fictional agency · demo data"}
          </span>
        </section>
        <div className="workspace">
          <section className="editor-panel">
            <div className="panel-header">
              <div>
                <span className="eyebrow">01 / INSPECT THE INPUT</span>
                <h2>The proposed update</h2>
              </div>
              <span className="count-tag">
                {Object.keys(input.proposedUpdate).length} section
              </span>
            </div>
            <nav className="tabs" aria-label="Review inputs">
              {[
                ["proposal", "Copy comparison"],
                ["evidence", "Approved evidence"],
                ["context", "Action & current site"],
              ].map(([id, title]) => (
                <button
                  key={id}
                  aria-pressed={tab === id}
                  onClick={() => setTab(id)}
                  className={tab === id ? "active" : ""}
                >
                  {title}
                </button>
              ))}
            </nav>
            {tab === "proposal" ? (
              <div className="copy-editor">
                {(Object.keys(input.proposedUpdate) as SectionName[]).map(
                  (section) => (
                    <div key={section}>
                      <h3>{titles[section]}</h3>
                      <div className="comparison-labels">
                        <span>CURRENT COPY</span>
                        <span>
                          PROPOSED COPY <i>editable</i>
                        </span>
                      </div>
                      {excerpts(input.proposedUpdate[section], section).map(
                        (part) => {
                          const before = excerpts(
                            input.currentSite[section],
                            section,
                          ).find((p) => p.path === part.path);
                          return (
                            <div className="copy-row" key={part.path}>
                              <div className="original">
                                <span className="field-path">{part.path}</span>
                                <p>{before?.text || "Empty in current site"}</p>
                              </div>
                              <div>
                                <label
                                  className="field-path"
                                  htmlFor={part.path}
                                >
                                  {part.path}
                                </label>
                                <textarea
                                  id={part.path}
                                  value={part.text}
                                  onChange={(e) =>
                                    updateCopy(part.path, e.target.value)
                                  }
                                  rows={Math.min(
                                    6,
                                    Math.max(
                                      2,
                                      Math.ceil(part.text.length / 50),
                                    ),
                                  )}
                                />
                                <span className="char-count">
                                  {part.text.length} characters
                                </span>
                              </div>
                            </div>
                          );
                        },
                      )}
                    </div>
                  ),
                )}
                <details className="proposal-json">
                  <summary>Edit the complete proposed update as JSON</summary>
                  <label htmlFor="proposal-json">
                    Proposed whole-section replacements
                  </label>
                  <p>
                    Add or remove supported sections here. Invalid JSON stays
                    editable; it cannot be reviewed.
                  </p>
                  <textarea
                    id="proposal-json"
                    rows={16}
                    value={proposalText}
                    spellCheck={false}
                    onChange={(e) => {
                      changed();
                      setProposalText(e.target.value);
                      try {
                        const parsed = updateSchema.safeParse(
                          JSON.parse(e.target.value),
                        );
                        if (parsed.success)
                          setInput((old) => ({
                            ...old,
                            proposedUpdate: parsed.data,
                          }));
                      } catch {
                        /* Keep invalid source text for correction. */
                      }
                    }}
                  />
                </details>
                <p className="fine-print">
                  Sections replace the current section as a whole. This
                  workbench never changes or publishes your site.
                </p>
              </div>
            ) : tab === "evidence" ? (
              <div className="json-editor">
                <label htmlFor="evidence">
                  Approved facts, voice, and exact constraints
                </label>
                <p>
                  These are operator-supplied facts, not independently verified
                  truth. Evidence must be mapped to a section. Exact constraints
                  compare values in code.
                </p>
                <textarea
                  id="evidence"
                  value={evidenceText}
                  onChange={(e) => {
                    changed();
                    setEvidenceText(e.target.value);
                  }}
                  spellCheck={false}
                  rows={24}
                />
              </div>
            ) : (
              <div className="json-editor">
                <label htmlFor="context">
                  Pending action identity and complete current site
                </label>
                <p>
                  The report is bound to this session, tool call, target, and
                  current site. Editing any of them invalidates it.
                </p>
                <textarea
                  id="context"
                  value={contextText}
                  onChange={(e) => {
                    changed();
                    setContextText(e.target.value);
                    try {
                      const context = JSON.parse(e.target.value);
                      if (context.currentSite && context.identity)
                        setInput((old) => ({
                          ...old,
                          currentSite: context.currentSite,
                          identity: context.identity,
                        }));
                    } catch {
                      /* Keep invalid JSON visible until corrected. */
                    }
                  }}
                  spellCheck={false}
                  rows={24}
                />
              </div>
            )}
          </section>
          <aside className="review-panel" aria-label="Review report">
            <div className="panel-header">
              <div>
                <span className="eyebrow">02 / REVIEW THE SIGNALS</span>
                <h2>A second look</h2>
              </div>
              <span className="review-mark">↗</span>
            </div>
            <div className="review-body">
              <p className="review-intro">
                Exact checks in code. Bounded advisory judgments. Your approval
                stays yours.
              </p>
              {config?.externalTransmission && (
                <label className="consent">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                  />{" "}
                  I allow this review’s copy and relevant evidence to be sent to
                  TypeSafe. API charges may apply.
                </label>
              )}
              <button
                className="run-button"
                disabled={busy || !config}
                onClick={() => void run()}
              >
                {busy
                  ? "Review in progress…"
                  : config?.provider.mode === "typesafe"
                    ? "Run TypeSafe review"
                    : "Run simulated review"}
                <span aria-hidden="true">↗</span>
              </button>
              <div aria-live="polite" aria-atomic="true">
                {error && (
                  <div className="error-box" role="alert">
                    {error}
                  </div>
                )}
                {stale && (
                  <div className="stale-box">
                    Input changed. The previous report is invalid. Run a fresh
                    review.
                  </div>
                )}
                {busy && (
                  <p className="loading-note">
                    Checking this snapshot. You can keep editing; a late result
                    won’t attach to changed input.
                  </p>
                )}
              </div>
              {!report && !busy && (
                <div className="empty-report">
                  <span className="empty-icon">≋</span>
                  <h3>Evidence before confidence.</h3>
                  <p>
                    Your report will show exact input excerpts, fixed issue
                    labels, and the evidence supplied for each section.
                  </p>
                  <ol>
                    <li>Compare the current and proposed copy</li>
                    <li>Check the approved evidence</li>
                    <li>Run a review and inspect each concern</li>
                  </ol>
                </div>
              )}
              {report && (
                <div className="report">
                  <div className={`result-banner ${report.disposition}`}>
                    <span className="eyebrow">
                      {report.provider.mode === "simulated"
                        ? "SIMULATED RESULT"
                        : "TYPESAFE ADVISORY RESULT"}
                    </span>
                    <h3>
                      {report.disposition === "unavailable"
                        ? "Review unavailable"
                        : report.disposition === "review_required"
                          ? "Take a closer look"
                          : "No flags in this check"}
                    </h3>
                    <p>
                      {report.disposition === "no_flags"
                        ? "This is not approval or factual certification. A human still needs to review the copy and sources."
                        : `${report.issues.length} concern${report.issues.length === 1 ? "" : "s"} to inspect before a human decision.`}
                    </p>
                  </div>
                  {report.sections.map((section) => (
                    <section className="section-result" key={section.section}>
                      <div className="result-heading">
                        <h3>{titles[section.section]}</h3>
                        <span>{section.issues.length} flags</span>
                      </div>
                      {Object.keys(section.answers).length > 0 && (
                        <div className="signals">
                          {Object.entries(section.answers).map(([name, a]) => (
                            <div key={name}>
                              <span>{name}</span>
                              <strong>{a.choice.replaceAll("_", " ")}</strong>
                              <small>
                                {report.provider.mode === "simulated"
                                  ? "illustrative confidence"
                                  : "confidence"}{" "}
                                {a.confidence.toFixed(2)}
                              </small>
                            </div>
                          ))}
                        </div>
                      )}
                      {section.issues.map((issue, index) => (
                        <details
                          className="issue"
                          key={`${issue.code}-${index}`}
                          open={index === 0}
                        >
                          <summary>
                            <span className="issue-indicator" />
                            {issue.code.replaceAll("_", " ")}
                          </summary>
                          <p>{REASONS[issue.code]}</p>
                          <span className="field-path">
                            {issue.path} · {issue.source}
                          </span>
                          <div className="excerpt">
                            {issue.proposedExcerpt || "[empty string]"}
                          </div>
                          <span className="eyebrow">
                            SUPPLIED EVIDENCE · NOT A GENERATED RATIONALE
                          </span>
                          {issue.evidence.length ? (
                            issue.evidence.map((f) => (
                              <p className="evidence-quote" key={f.id}>
                                <b>{f.id}</b> {f.text}
                              </p>
                            ))
                          ) : (
                            <p>No approved evidence found.</p>
                          )}
                        </details>
                      ))}
                      <details className="evidence-details">
                        <summary>
                          All supplied evidence for this section
                        </summary>
                        {section.evidence.length ? (
                          section.evidence.map((f) => (
                            <p key={f.id}>
                              <b>{f.id}</b> {f.text}
                            </p>
                          ))
                        ) : (
                          <p>No approved evidence found.</p>
                        )}
                      </details>
                    </section>
                  ))}
                  <div className="report-footer">
                    <span>Human decision: not taken</span>
                    <button onClick={download}>Export snapshot ↓</button>
                    <p>
                      {report.rubricVersion} · {report.provider.requestedModel}
                      <br />
                      Snapshot {report.fingerprint.slice(0, 12)} ·{" "}
                      {new Date(report.createdAt).toLocaleTimeString()}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </aside>
        </div>
        <footer className="page-footer">
          <span>
            briefcheck.{" "}
            <span className="muted">
              A review aid, never an approval engine.
            </span>
          </span>
          <span>Local-first · No database · No automatic publishing</span>
        </footer>
      </main>
    </div>
  );
}
