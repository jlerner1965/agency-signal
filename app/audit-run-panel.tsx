"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type RunModule = {
  id: number; module: string; label: string; status: string; message: string;
  costCents: number; findingCount: number; attempts: number; maxAttempts: number;
  retryAfter: string | null; retryReason: string; checkSummary: string;
};

type RunFinding = {
  id: number; module: string; category: string; severity: string; title: string;
  evidence: string; recommendation: string; impactNote: string;
  impactScore: number; effortScore: number; priority: number; affectedUrl: string;
};

type Run = {
  id: number; status: string; website: string; overallScore: number | null;
  technicalScore: number | null; reachable: boolean | null; costCents: number;
  confidence: number; checksVerified: number; checksTotal: number;
  error: string; finishedAt: string | null;
};

type Diagnostics = {
  finalUrl: string; finalStatus: number; robotsFetchable: boolean; robotsStatus: number;
  robotsRules: number; crawlDelaySeconds: number | null; navigationServerRendered: boolean | null;
  pagesAttempted: number; pagesReached: number; pagesDisallowed: number; truncatedBy: string;
  blockedResponses: Array<{ url: string; status: number; server: string; cfRay: string }>;
};

type Summary = { run: Run; modules: RunModule[]; findings: RunFinding[]; diagnostics: Diagnostics | null; pending: boolean; waitingFor: string | null; waitingReason: string };

type Check = {
  id: string; category: string; label: string; status: string;
  weight: number; evidence: string; unverifiedReason?: string;
};

const UNMEASURED_REASON: Record<string, string> = {
  "retries-exhausted": "the source kept failing after repeated attempts",
  "source-unavailable": "the source was unavailable for this run",
  "host-unreachable": "the site could not be read",
  "not-applicable": "there was nothing on the page to measure",
};

/** Milliseconds until a deadline, clamped. Kept out of the component body so
 *  the clock read is never treated as part of a render. */
function msUntil(iso: string, capMs = 65_000) {
  return Math.min(Math.max(0, new Date(iso).getTime() - Date.now()), capMs);
}

const MODULE_TONE: Record<string, string> = {
  Complete: "good", Running: "watch", Queued: "neutral",
  Skipped: "neutral", Unreachable: "critical", Failed: "critical",
};

type Deliverables = {
  recommendations: Array<{ id: number; label: string; rationale: string; rationaleSource: string; findingIds: string }>;
  proposal: { id: number; token: string; title: string; price: number; timeline: string; version: number; status: string } | null;
  blockers: string[];
  mockups: Array<{ kind: string; title: string; url: string }>;
};

export default function AuditRunPanel({ leadId, reportToken }: { leadId: number; reportToken: string }) {
  const [deliverables, setDeliverables] = useState<Deliverables>({ recommendations: [], proposal: null, blockers: [], mockups: [] });
  const [packaging, setPackaging] = useState("");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [history, setHistory] = useState<Run[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [waitNotice, setWaitNotice] = useState("");
  const cancelled = useRef(false);

  useEffect(() => () => { cancelled.current = true; }, []);

  const loadHistory = useCallback(async () => {
    const response = await fetch(`/api/audit-runs?leadId=${leadId}`);
    const payload = await response.json();
    if (response.ok) setHistory(payload.runs ?? []);
  }, [leadId]);

  // State is set from the fetch callback rather than the effect body, so
  // switching prospects mid-request cannot land the previous one's history.
  useEffect(() => {
    let active = true;
    fetch(`/api/audit-runs?leadId=${leadId}`)
      .then((response) => (response.ok ? response.json() : { runs: [] }))
      .then((payload) => { if (active) setHistory(payload.runs ?? []); })
      .catch(() => { if (active) setHistory([]); });
    return () => { active = false; };
  }, [leadId]);

  /**
   * Ticks until the run reports nothing pending. Each tick runs one module.
   * A module deferred by backoff reports when it may be retried, so the loop
   * waits rather than spinning against a source that is already throttling us.
   */
  async function drain(runId: number) {
    for (let guard = 0; guard < 40; guard += 1) {
      if (cancelled.current) return;
      const response = await fetch(`/api/audit-runs/${runId}/tick`, { method: "POST" });
      const payload = (await response.json()) as Summary & { error?: string };
      if (!response.ok) throw new Error(payload.error || "The audit tick failed.");
      setSummary(payload);
      if (!payload.pending) return;

      if (payload.waitingFor) {
        const waitMs = msUntil(payload.waitingFor);
        if (waitMs > 0) {
          setWaitNotice(payload.waitingReason || "Waiting before the next attempt.");
          await new Promise((resolve) => setTimeout(resolve, waitMs + 500));
          if (cancelled.current) return;
        }
      }
      setWaitNotice("");
    }
    throw new Error("The run did not finish within the expected number of steps.");
  }

  async function startRun() {
    setBusy(true); setError(""); setSummary(null);
    try {
      const response = await fetch("/api/audit-runs", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ leadId }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to start the audit run.");
      setSummary(payload);
      await drain(payload.run.id);
      await loadHistory();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The audit run failed.");
    } finally {
      setBusy(false);
    }
  }

  async function openRun(runId: number) {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/audit-runs/${runId}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to load that run.");
      setSummary(payload);
      if (payload.pending) await drain(runId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load that run.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * The package is built in order: recommendations gate the proposal, the
   * mockups need the service lines the run already found, and the proposal
   * comes last because it links the mockups. Drafting it first left the
   * opening referring to concept pages that did not exist yet, and on a
   * re-run it referred to the previous pass's pages, which this rebuild
   * replaces with fresh tokens.
   */
  async function buildPackage(runId: number) {
    setPackaging("Building recommendations…");
    setError("");
    try {
      const recResponse = await fetch(`/api/audit-runs/${runId}/recommendations`, { method: "POST" });
      const recPayload = await recResponse.json();
      if (!recResponse.ok) throw new Error(recPayload.error || "Recommendations failed.");

      setPackaging("Generating mockups…");
      const mockupResponse = await fetch(`/api/audit-runs/${runId}/mockups`, { method: "POST" });
      const mockupPayload = await mockupResponse.json();
      if (!mockupResponse.ok) throw new Error(mockupPayload.error || "Mockups failed.");

      setPackaging("Drafting the proposal…");
      const proposalResponse = await fetch(`/api/audit-runs/${runId}/proposal`, {
        method: "POST", headers: { "content-type": "application/json" }, body: "{}",
      });
      const proposalPayload = await proposalResponse.json();
      if (!proposalResponse.ok) throw new Error(proposalPayload.error || "Proposal failed.");

      setDeliverables({
        recommendations: recPayload.recommendations ?? [],
        proposal: proposalPayload.proposal ?? null,
        blockers: proposalPayload.blockers ?? [],
        mockups: mockupPayload.mockups ?? [],
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The package could not be built.");
    } finally {
      setPackaging("");
    }
  }

  const run = summary?.run;
  const unscored = run ? run.overallScore === null : false;

  // Every check that did not run is shown explicitly; omission would read as a pass.
  const unmeasured = (summary?.modules ?? []).flatMap((module) => {
    try { return (JSON.parse(module.checkSummary || "[]") as Check[]).filter((check) => check.status === "unverified"); }
    catch { return [] as Check[]; }
  });

  return (
    <section className="engine-panel">
      <div className="audit-section-intro">
        <div>
          <p className="eyebrow">Audit engine</p>
          <h3>Run the module set</h3>
          <p>Each module runs as its own step and stores what it fetched. A run resumes where it stopped, and a site that could not be read is reported as unread rather than scored.</p>
        </div>
        <button className="primary-button" disabled={busy} onClick={startRun}>
          {busy ? "Running…" : "Start audit run"}
        </button>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}
      {waitNotice && <p className="engine-waiting" role="status">Backing off before the next attempt — {waitNotice}</p>}

      {run && (
        <section className="engine-run">
          <header>
            <div>
              <span className="eyebrow">Run #{run.id}</span>
              <strong>{run.status}</strong>
              <small>{run.website}</small>
            </div>
            <div className="engine-score">
              {unscored
                ? <><b className="critical">Not scored</b><small>{run.reachable === false ? "Site could not be read" : "Too little could be verified"}</small></>
                : <><b>{run.overallScore}</b><small>overall score</small></>}
            </div>
            <div className="engine-cost" title="Share of the rubric's total weight that was verified. Heavy checks count for more than light ones, and checks whose source was never in scope for this run are excluded from both figures.">
              <b>{run.confidence}%</b>
              <small>of rubric weight verified</small>
              <small className="engine-subdetail">{run.checksVerified} of {run.checksTotal} checks in scope</small>
            </div>
          </header>

          {unscored && run.reachable === false && (
            <p className="engine-warning" role="status">
              This prospect has no score because the site could not be fetched — not because the site scored badly. {run.error}
            </p>
          )}

          {unscored && run.reachable !== false && run.error && (
            <p className="engine-warning" role="status">
              No score is shown because too little of the audit could be verified. A score built on a handful of checks would read as confident when it is not. {run.error}
            </p>
          )}

          <ol className="engine-modules">
            {summary.modules.map((module) => (
              <li key={module.id} className={MODULE_TONE[module.status] ?? "neutral"}>
                <span className="engine-module-status">{module.status}</span>
                <div>
                  <strong>{module.label || module.module}</strong>
                  <small>{module.message || "Waiting to run."}</small>
                </div>
                <span className="engine-module-meta">
                  {module.attempts > 1 && `attempt ${module.attempts}/${module.maxAttempts} · `}
                  {module.findingCount} finding{module.findingCount === 1 ? "" : "s"}
                </span>
              </li>
            ))}
          </ol>

          {summary.diagnostics && (
            <div className="engine-diagnostics">
              <p className="eyebrow">Crawl diagnostics</p>
              <dl>
                <div><dt>Final response</dt><dd>HTTP {summary.diagnostics.finalStatus}</dd></div>
                <div><dt>robots.txt</dt><dd>{summary.diagnostics.robotsFetchable ? `read, ${summary.diagnostics.robotsRules} rules` : "not fetchable"}</dd></div>
                <div><dt>Crawl-delay</dt><dd>{summary.diagnostics.crawlDelaySeconds === null ? "none stated" : `${summary.diagnostics.crawlDelaySeconds}s`}</dd></div>
                <div><dt>Navigation</dt><dd>{summary.diagnostics.navigationServerRendered === null ? "unknown" : summary.diagnostics.navigationServerRendered ? "in served HTML" : "JS-rendered"}</dd></div>
                <div><dt>Pages</dt><dd>{summary.diagnostics.pagesReached} reached of {summary.diagnostics.pagesAttempted} attempted{summary.diagnostics.pagesDisallowed ? `, ${summary.diagnostics.pagesDisallowed} disallowed` : ""}</dd></div>
                {summary.diagnostics.truncatedBy && <div><dt>Truncated by</dt><dd>{summary.diagnostics.truncatedBy}</dd></div>}
              </dl>
              {summary.diagnostics.blockedResponses.length > 0 && (
                <ul className="engine-blocked">
                  {summary.diagnostics.blockedResponses.map((blocked) => (
                    <li key={blocked.url}>
                      HTTP {blocked.status} · {new URL(blocked.url).pathname}
                      {blocked.server && ` · server ${blocked.server}`}
                      {blocked.cfRay && " · Cloudflare"}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {unmeasured.length > 0 && (
            <div className="engine-unmeasured">
              <p className="eyebrow">{unmeasured.length} checks not measured</p>
              <p className="engine-unmeasured-note">
                These are shown rather than omitted. An omitted check reads as a pass, and none of these were measured either way.
              </p>
              <ul>
                {unmeasured.map((check) => (
                  <li key={check.id}>
                    <span className="engine-unmeasured-tag">Not measured</span>
                    <div>
                      <strong>{check.label}</strong>
                      <small>{check.evidence}{check.unverifiedReason ? ` — ${UNMEASURED_REASON[check.unverifiedReason] ?? check.unverifiedReason}` : ""}</small>
                    </div>
                    <span className="engine-module-meta">weight {check.weight}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {summary.findings.length > 0 && (
            <div className="engine-findings">
              <p className="eyebrow">{summary.findings.length} findings, fastest meaningful win first</p>
              {summary.findings.map((finding) => (
                <article key={finding.id}>
                  <div className="engine-finding-head">
                    <span className={`severity ${finding.severity.toLowerCase()}`}>{finding.severity}</span>
                    <h4>{finding.title}</h4>
                    <span className="engine-priority" title="Impact divided by effort">
                      impact {finding.impactScore} / effort {finding.effortScore}
                    </span>
                  </div>
                  <p>{finding.evidence}</p>
                  {finding.recommendation && <p><b>Fix:</b> {finding.recommendation}</p>}
                  {finding.impactNote && <p className="engine-impact">{finding.impactNote}</p>}
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {run && summary && !summary.pending && run.overallScore !== null && (
        <section className="engine-package">
          <div className="audit-section-intro">
            <div>
              <p className="eyebrow">Deliverables</p>
              <h3>Build the package</h3>
              <p>Recommendations map from the stored findings by rule; a recommendation that cannot cite one is refused rather than shipped. Nothing here is sent anywhere.</p>
            </div>
            <button className="primary-button" disabled={Boolean(packaging)} onClick={() => buildPackage(run.id)}>
              {packaging || "Build report, proposal and mockups"}
            </button>
          </div>

          {deliverables.blockers.length > 0 && (
            <div className="engine-blockers" role="status">
              <strong>Not exportable yet</strong>
              <ul>{deliverables.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>
            </div>
          )}

          {deliverables.recommendations.length > 0 && (
            <div className="engine-recs">
              <p className="eyebrow">{deliverables.recommendations.length} recommendations</p>
              {deliverables.recommendations.map((rec) => (
                <article key={rec.id}>
                  <div><strong>{rec.label}</strong><span className="engine-rec-source">{rec.rationaleSource === "model" ? "rationale written by model" : "rationale derived from findings"}</span></div>
                  <p>{rec.rationale}</p>
                  <small>Cites findings {JSON.parse(rec.findingIds || "[]").map((id: number) => `F${id}`).join(", ")}</small>
                </article>
              ))}
            </div>
          )}

          <div className="engine-links">
            <a href={`/report/${reportToken}`} target="_blank" rel="noreferrer">Open the client report ↗</a>
            {deliverables.proposal && (
              <a href={`/proposal/${deliverables.proposal.token}`} target="_blank" rel="noreferrer">
                Proposal v{deliverables.proposal.version} · {deliverables.proposal.title} ↗
              </a>
            )}
            {deliverables.mockups.map((mockup) => (
              <a key={mockup.url} href={mockup.url} target="_blank" rel="noreferrer">{mockup.title} ↗</a>
            ))}
          </div>
        </section>
      )}

      {history.length > 0 && (
        <div className="engine-history">
          <p className="eyebrow">Previous runs</p>
          <ul>
            {history.map((item) => (
              <li key={item.id}>
                <button onClick={() => openRun(item.id)} disabled={busy}>
                  Run #{item.id} · {item.status} · {item.overallScore === null ? "not scored" : `score ${item.overallScore}`}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
