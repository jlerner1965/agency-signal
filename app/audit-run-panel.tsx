"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ProposalSectionPicker, { type SectionOption } from "./proposal-sections";
import { carries, sectionCatalog } from "@/lib/audit/proposal-sections";

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

/** What the chosen findings would cost, and what they could be shown as. Priced, not stored. */
type Preview = {
  scopeItems: Array<{ deliverable: string; label: string; criteria: string; rationale: string; quantity: number; display: string }>;
  priceDisplay: string;
  minimumApplied: boolean;
  retainer: { label: string; criteria: string; display: string } | null;
  chosenCount: number;
  totalCount: number;
  sections: SectionOption[];
  defaultSections: string[];
  message: string;
};

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

/** A part's name as the picker gives it, for saying back what was built. */
function labelForSection(id: string) {
  return sectionCatalog.find((section) => section.id === id)?.label ?? id;
}

const MODULE_TONE: Record<string, string> = {
  Complete: "good", Running: "watch", Queued: "neutral",
  Skipped: "neutral", Unreachable: "critical", Failed: "critical",
};

type Deliverables = {
  recommendations: Array<{ id: number; label: string; rationale: string; rationaleSource: string; findingIds: string }>;
  proposal: { id: number; token: string; title: string; price: number; timeline: string; version: number; status: string; openingProse: string } | null;
  blockers: string[];
  mockups: Array<{ kind: string; title: string; url: string }>;
  /** The parts the built document actually carries, as stored. */
  sections: string[] | null;
};

/** No package yet. What a run reads as before anything has been built for it. */
const NO_PACKAGE: Deliverables = { recommendations: [], proposal: null, blockers: [], mockups: [], sections: null };

export default function AuditRunPanel({ leadId, reportToken, onBuilt }: {
  leadId: number;
  reportToken: string;
  /** Told when this run's proposal is written, so the rest of the prospect stops
   *  offering to create a second, unrelated one. */
  onBuilt?: () => void | Promise<void>;
}) {
  const [deliverables, setDeliverables] = useState<Deliverables>(NO_PACKAGE);
  const [packaging, setPackaging] = useState("");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [history, setHistory] = useState<Run[]>([]);
  const [busy, setBusy] = useState(false);
  // Off by default: re-reading a source costs a paid Places call and another
  // crawl of the prospect's site, so it is asked for rather than assumed.
  const [fresh, setFresh] = useState(false);
  const [error, setError] = useState("");
  // Which findings go into the proposal. Held per run so opening a different
  // run does not inherit the last one's selection.
  const [selection, setSelection] = useState<{ runId: number; ids: number[] } | null>(null);
  // Which parts of the document to build. Held per run for the same reason the
  // findings are: opening a different run must not inherit the last one's
  // answer to a question about a different site.
  const [parts, setParts] = useState<{ runId: number; ids: string[] } | null>(null);
  // Stamped with the run it was priced for, for the same reason the findings and
  // the parts are. It was the one piece of per-run state that was not: opening a
  // second run left the first one's part list deciding what the build would
  // produce, and a run whose site could not be read offered concept pages
  // because a different run's preview said they could be built.
  const [preview, setPreview] = useState<{ runId: number; data: Preview } | null>(null);
  // The parts of a built proposal a person writes. Evidence is not among them.
  const [edits, setEdits] = useState<{ title: string; timeline: string; openingProse: string } | null>(null);
  const [saving, setSaving] = useState("");
  // A failed build is reported where the build was started, not at the top of
  // the panel above the whole findings list.
  const [packageError, setPackageError] = useState("");
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

  /**
   * What this run has already been packaged into.
   *
   * Read, never built. A run opened from the history used to come back as its
   * summary alone, so one that had already been packaged looked exactly like
   * one that never had — and pressing Build to "get the link back" wrote a new
   * version of a document that had already gone out.
   */
  async function loadPackage(runId: number) {
    try {
      const response = await fetch(`/api/audit-runs/${runId}/package`);
      const payload = await response.json();
      if (!response.ok) return;
      setDeliverables({
        recommendations: payload.recommendations ?? [],
        proposal: payload.proposal ?? null,
        blockers: payload.blockers ?? [],
        mockups: payload.mockups ?? [],
        sections: payload.sections ?? null,
      });
      const built = payload.proposal;
      setEdits(built ? { title: built.title ?? "", timeline: built.timeline ?? "", openingProse: built.openingProse ?? "" } : null);
    } catch {
      /* a package that will not load leaves the run readable; nothing is built here */
    }
  }

  async function startRun() {
    // A new run starts with nothing built for it. The package block is not
    // keyed to a run, so without this the previous run's proposal link, price
    // and concept links sit under the new run as though they were its own —
    // and saving an edit there rewrites the previous run's document.
    setBusy(true); setError(""); setSummary(null);
    setDeliverables(NO_PACKAGE); setEdits(null); setPreview(null); setPackaging(""); setPackageError("");
    try {
      const response = await fetch("/api/audit-runs", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ leadId, fresh }),
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

  async function saveEdits() {
    const proposal = deliverables.proposal;
    if (!proposal || !edits) return;
    setSaving("Saving…"); setError("");
    try {
      const response = await fetch(`/api/proposals/${encodeURIComponent(proposal.token)}`, {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(edits),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to save.");
      setDeliverables((current) => ({
        ...current,
        proposal: current.proposal ? { ...current.proposal, ...payload.proposal } : current.proposal,
      }));
      setSaving("Saved");
      window.setTimeout(() => setSaving(""), 1600);
    } catch (reason) {
      setSaving("");
      setError(reason instanceof Error ? reason.message : "Unable to save.");
    }
  }

  async function openRun(runId: number) {
    setBusy(true); setError("");
    setDeliverables(NO_PACKAGE); setEdits(null); setPreview(null); setPackaging(""); setPackageError("");
    try {
      const response = await fetch(`/api/audit-runs/${runId}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to load that run.");
      setSummary(payload);
      if (payload.pending) await drain(runId);
      else await loadPackage(runId);
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
   *
   * The concepts step runs only when the concepts were ticked. It is the
   * slowest part of the build and the one that reads the prospect's site
   * hardest, and a document that will not show them has no use for them.
   */
  async function buildPackage(runId: number) {
    setPackaging("Step 1 of 3 — mapping the recommendations…");
    setError(""); setPackageError("");
    const wantsConcepts = includedParts === null || includedParts.includes("concepts");
    try {
      const recResponse = await fetch(`/api/audit-runs/${runId}/recommendations`, { method: "POST" });
      const recPayload = await recResponse.json();
      if (!recResponse.ok) throw new Error(recPayload.error || "Recommendations failed.");

      let mockupPayload: { mockups?: Array<{ kind: string; title: string; url: string }>; error?: string } = {};
      if (wantsConcepts) {
        setPackaging("Step 2 of 3 — building the concept pages…");
        const mockupResponse = await fetch(`/api/audit-runs/${runId}/mockups`, { method: "POST" });
        mockupPayload = await mockupResponse.json();
        if (!mockupResponse.ok) throw new Error(mockupPayload.error || "The concept pages could not be built.");
      }

      setPackaging(wantsConcepts ? "Step 3 of 3 — writing the proposal…" : "Step 2 of 2 — writing the proposal…");
      const proposalResponse = await fetch(`/api/audit-runs/${runId}/proposal`, {
        method: "POST", headers: { "content-type": "application/json" },
        // The proposal is priced from the same selection the preview showed,
        // and carries the parts that were ticked beside it.
        body: JSON.stringify({ findingIds: chosenIds, sections: includedParts }),
      });
      const proposalPayload = await proposalResponse.json();
      if (!proposalResponse.ok) throw new Error(proposalPayload.error || "Proposal failed.");

      const built = proposalPayload.proposal ?? null;
      setDeliverables({
        recommendations: recPayload.recommendations ?? [],
        proposal: built,
        blockers: proposalPayload.blockers ?? [],
        mockups: mockupPayload.mockups ?? [],
        sections: proposalPayload.sections ?? null,
      });
      setEdits(built ? { title: built.title ?? "", timeline: built.timeline ?? "", openingProse: built.openingProse ?? "" } : null);
      // The rest of the prospect reads its proposal from the lead. Without
      // this, the Proposal tab still showed an empty create-form after the
      // engine had just written one, and the obvious next move there was to
      // generate a second, unrelated document that became the link everything
      // else handed out.
      if (built) await onBuilt?.();
    } catch (reason) {
      // Reported beside the button that started it. This used to render at the
      // top of the panel, a screenful above, so a failed build looked like
      // nothing had happened at all.
      setPackageError(reason instanceof Error ? reason.message : "The package could not be built.");
    } finally {
      setPackaging("");
    }
  }

  const run = summary?.run;
  const unscored = run ? run.overallScore === null : false;

  // Everything the run found, unless the operator has narrowed it. Derived
  // rather than initialised in an effect, so a newly opened run starts from its
  // own findings without a render where the selection belongs to the last one.
  const allFindingIds = summary?.findings.map((finding) => finding.id) ?? [];
  const chosenIds = selection && run && selection.runId === run.id ? selection.ids : allFindingIds;
  const chosenKey = chosenIds.join(",");
  const readyToPrice = Boolean(run && summary && !summary.pending && run.overallScore !== null);

  // Only a preview priced for the run on screen counts. One priced for a
  // different run is not a slightly stale figure, it is a different prospect's
  // answer, and it used to decide both the part list and whether the concept
  // pages were built at all.
  const livePreview = preview && run && preview.runId === run.id ? preview.data : null;

  // The parts on offer follow the finding selection, because a part is only
  // offered when this run holds what fills it. Until this run's preview lands
  // there is nothing to have chosen, and the build button waits for it rather
  // than committing to a document nobody has been shown.
  const sectionOptions = livePreview?.sections ?? [];
  const includedParts = livePreview
    ? (parts && run && parts.runId === run.id ? parts.ids : livePreview.defaultSections)
    : null;
  const buildsConcepts = includedParts === null || includedParts.includes("concepts");
  // The steps this build will actually run, named the same way everywhere they
  // appear. "Report" was in the button and in nothing else — the client report
  // is live from the moment the run finishes and no build produces it.
  const buildSteps = [
    "map the recommendations",
    buildsConcepts ? "build the concept pages" : "",
    "write the proposal",
  ].filter(Boolean);

  function toggleFinding(id: number) {
    if (!run) return;
    setSelection({
      runId: run.id,
      ids: chosenIds.includes(id) ? chosenIds.filter((entry) => entry !== id) : [...chosenIds, id],
    });
  }

  // The priced scope follows the selection. Nothing is written until the
  // package is built, so this can run on every change.
  const runId = run?.id;
  useEffect(() => {
    if (!readyToPrice || runId === undefined) return;
    let stale = false;
    fetch(`/api/audit-runs/${runId}/proposal/preview`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ findingIds: chosenKey ? chosenKey.split(",").map(Number) : [] }),
    })
      .then((response) => response.json())
      .then((payload: Preview & { error?: string }) => { if (!stale && !payload.error) setPreview({ runId, data: payload }); })
      .catch(() => { /* a failed preview leaves the last figure rather than blanking it */ });
    return () => { stale = true; };
  }, [runId, chosenKey, readyToPrice]);

  // Every check that did not run is shown explicitly; omission would read as a pass.
  const unmeasured = (summary?.modules ?? []).flatMap((module) => {
    try { return (JSON.parse(module.checkSummary || "[]") as Check[]).filter((check) => check.status === "unverified"); }
    catch { return [] as Check[]; }
  });

  return (
    <section className="engine-panel">
      <div className="audit-section-intro">
        <div>
          <p className="eyebrow">Step 1 · Audit engine</p>
          <h3>Run the module set</h3>
          <p>Each module runs as its own step and stores what it fetched. A run resumes where it stopped, and a site that could not be read is reported as unread rather than scored.</p>
        </div>
        <div className="engine-start">
          <button className="primary-button" disabled={busy} onClick={startRun}>
            {busy ? "Running…" : "Start audit run"}
          </button>
          <label className="engine-fresh">
            <input type="checkbox" checked={fresh} disabled={busy} onChange={(event) => setFresh(event.target.checked)} />
            <span>Fetch the sources again</span>
          </label>
          <small>Off, a run reuses what was already fetched today. On, it reads the site and the profile again — slower, and it spends the paid Places call.</small>
        </div>
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
              {readyToPrice && (
                <p className="engine-findings-note">
                  <b>Step 2 — choose the findings.</b> Tick the ones this proposal should make its case from.
                  The scope, the price, and which parts the document is able to carry all follow this selection,
                  and all three are shown under Deliverables below.
                </p>
              )}
              {summary.findings.map((finding) => (
                <article key={finding.id} className={readyToPrice && !chosenIds.includes(finding.id) ? "engine-finding-dropped" : ""}>
                  <div className="engine-finding-head">
                    {readyToPrice && (
                      <label className="engine-finding-pick">
                        <input
                          type="checkbox"
                          checked={chosenIds.includes(finding.id)}
                          onChange={() => toggleFinding(finding.id)}
                        />
                        <span className="visually-hidden">Include “{finding.title}” in the proposal</span>
                      </label>
                    )}
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

      {run && summary && !summary.pending && (
        <section className="engine-package">
          {/* The block reads in the order the work happens: what goes in, what
              it costs, then the button that commits to both. The button used to
              sit in this header, above a picker and a price that had not
              rendered yet, so the first thing on offer was to build a document
              the operator had not been shown. */}
          <div className="audit-section-intro">
            <div>
              <p className="eyebrow">Step 3 · Deliverables</p>
              <h3>Choose what goes in, then build it</h3>
              <p>Recommendations map from the stored findings by rule; a recommendation that cannot cite one is refused rather than shipped. Nothing here is sent anywhere.</p>
            </div>
          </div>

          {unscored ? (
            // Shown with its reason rather than dropped from the page. A step
            // that vanishes reads as a step this tool does not have.
            <p className="engine-scope-empty" role="status">
              Nothing can be built from a run with no score. A proposal priced off a handful of
              verified checks would read as confident when it is not, so the package waits for a
              run that scored{run.reachable === false ? " — this one could not read the site at all." : "."}
            </p>
          ) : (
            <>
              <ProposalSectionPicker
                options={sectionOptions}
                chosen={includedParts ?? []}
                disabled={Boolean(packaging)}
                onChange={(ids) => run && setParts({ runId: run.id, ids })}
              />

              {livePreview ? (
                <div className="engine-scope">
                  <div className="engine-scope-head">
                    <p className="eyebrow">Priced from {livePreview.chosenCount} of {livePreview.totalCount} findings</p>
                    <b>{livePreview.priceDisplay || "—"}</b>
                  </div>
                  {livePreview.scopeItems.length > 0 ? (
                    <ul>
                      {livePreview.scopeItems.map((item) => (
                        <li key={item.deliverable}>
                          <div>
                            <strong>{item.label}{item.quantity > 1 ? ` × ${item.quantity}` : ""}</strong>
                            <small>{item.rationale}</small>
                          </div>
                          <b>{item.display}</b>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="engine-scope-empty">{livePreview.message || "Nothing in this selection triggers a priced deliverable."}</p>
                  )}
                  {livePreview.minimumApplied && <p className="engine-scope-note">The minimum engagement applies.</p>}
                  {livePreview.retainer && (
                    <p className="engine-scope-note">Alongside the work: {livePreview.retainer.label} · {livePreview.retainer.display}</p>
                  )}
                </div>
              ) : (
                <p className="engine-scope-empty" role="status">Pricing this run&rsquo;s selection…</p>
              )}

              <div className="engine-build">
                <button
                  className="primary-button"
                  // Not clickable until this run's own price and part list are on
                  // screen. Pressing it before they arrived built whatever the
                  // server thought the run could fill — or, worse, whatever the
                  // previously opened run's preview still said.
                  disabled={Boolean(packaging) || chosenIds.length === 0 || !livePreview}
                  onClick={() => buildPackage(run.id)}
                >
                  {packaging || "Build the package"}
                </button>
                <small role="status">
                  {chosenIds.length === 0
                    ? "Tick at least one finding above. A proposal with nothing to cite is not built."
                    : !livePreview
                      ? "Waiting for this run's price before anything can be built from it."
                      : <>Runs {buildSteps.length} steps, in order: {buildSteps.join(", then ")}.
                        {buildsConcepts
                          ? " The concept pages are the slow step — they read the prospect's site hardest."
                          : " The concept pages are unticked, so they are not built at all."}</>}
                </small>
                {packageError && <p className="form-error" role="alert">{packageError}</p>}
              </div>

              {deliverables.blockers.length > 0 && (
                <div className="engine-blockers" role="status">
                  <strong>Not exportable yet</strong>
                  <ul>{deliverables.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>
                </div>
              )}

              {deliverables.proposal && deliverables.sections && (
                <p className="engine-built-parts" role="status">
                  {deliverables.sections.length
                    // Said back after the build, because a part that was ticked
                    // against evidence this run turned out not to have is dropped
                    // rather than refused, and the operator should not find that
                    // out by reading the document.
                    ? <>This proposal carries: {deliverables.sections.map(labelForSection).join(", ")}.</>
                    : "This proposal carries none of the optional parts — the opening argument and the deliverables list only, with no figures anywhere in it."}
                  {deliverables.sections.length > 0 && !deliverables.sections.includes("concepts") &&
                    " It carries no concept pages, so nothing in it shows what the site could look like."}
                </p>
              )}

              {/* The links come before the editor: what was built, and a way to
                  look at it, before being asked to write copy for it. */}
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

              {deliverables.proposal && edits && (
                <div className="engine-editor">
                  <div className="engine-editor-head">
                    <p className="eyebrow">Your words</p>
                    <p>Everything else in the document — the evidence, the sentences quoted from their site, and every figure — comes from the audit and the pricing file, and is not editable here.</p>
                  </div>
                  <label>
                    Title
                    <input value={edits.title} onChange={(event) => setEdits({ ...edits, title: event.target.value })} />
                  </label>
                  <label>
                    Timeline
                    <input
                      value={edits.timeline}
                      placeholder="Left out of the document while empty"
                      onChange={(event) => setEdits({ ...edits, timeline: event.target.value })}
                    />
                  </label>
                  {/* Offered only when the document has an opening to put it in.
                      A textarea for a part that was not built saved happily and
                      showed up nowhere. */}
                  {carries(deliverables.sections, "opening") ? (
                    <label>
                      Opening
                      <textarea rows={6} value={edits.openingProse} onChange={(event) => setEdits({ ...edits, openingProse: event.target.value })} />
                    </label>
                  ) : (
                    <p className="engine-editor-note">
                      No opening field: this document was built without one, so there is nowhere for it to appear.
                      Tick <b>Opening</b> above and build again to write one.
                    </p>
                  )}
                  <div className="engine-editor-actions">
                    <button className="primary-button" disabled={Boolean(saving)} onClick={saveEdits}>{saving || "Save"}</button>
                  </div>
                </div>
              )}
            </>
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
