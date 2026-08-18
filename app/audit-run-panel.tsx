"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatCents } from "@/lib/audit/cost-config";

type RunModule = {
  id: number; module: string; label: string; status: string; message: string;
  costCents: number; findingCount: number; attempts: number;
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

type Summary = { run: Run; modules: RunModule[]; findings: RunFinding[]; pending: boolean };

const MODULE_TONE: Record<string, string> = {
  Complete: "good", Running: "watch", Queued: "neutral",
  Skipped: "neutral", Unreachable: "critical", Failed: "critical",
};

export default function AuditRunPanel({ leadId }: { leadId: number }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [history, setHistory] = useState<Run[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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

  /** Ticks until the run reports nothing pending. Each tick runs one module. */
  async function drain(runId: number) {
    for (let guard = 0; guard < 20; guard += 1) {
      if (cancelled.current) return;
      const response = await fetch(`/api/audit-runs/${runId}/tick`, { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "The audit tick failed.");
      setSummary(payload);
      if (!payload.pending) return;
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

  const run = summary?.run;
  const unscored = run ? run.overallScore === null : false;

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
            <div className="engine-cost">
              <b>{run.confidence}%</b>
              <small>{run.checksVerified} of {run.checksTotal} checks verified</small>
            </div>
            <div className="engine-cost">
              <b>{formatCents(run.costCents)}</b>
              <small>estimated API cost</small>
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
                  {module.findingCount} finding{module.findingCount === 1 ? "" : "s"}
                  {module.costCents > 0 && ` · ${formatCents(module.costCents)}`}
                </span>
              </li>
            ))}
          </ol>

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
