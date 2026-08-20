"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { buildGooglePresenceAudit } from "@/lib/google-presence";
import { buildDigitalBlueprint } from "@/lib/digital-blueprint";
import { offerCatalog } from "@/lib/sales";
import AuditRunPanel from "./audit-run-panel";
import type { AuditCheck, AuditComparison, AuditSummary, CompetitorAudit, Finding, Lead, Opportunity, Proposal } from "@/lib/types";

type Props = {
  lead: Lead;
  findings: Finding[];
  opportunity: Opportunity | null;
  proposal: Proposal | null;
  pagesAudited: number;
  auditSummary: AuditSummary | null;
  auditHistory: AuditSummary[];
  auditComparison: AuditComparison | null;
  competitors: CompetitorAudit[];
  busy: boolean;
  onClose: () => void;
  onAudit: () => Promise<void>;
  onPatch: (values: Record<string, unknown>, success: string) => Promise<void>;
  onProposal: (proposal: Proposal, lead: Lead) => void;
  onRefresh: () => Promise<void>;
};

const proposalOffers = offerCatalog.filter((offer) => ["digital-presence-plan", "google-presence", "website-redesign", "conversion-sprint"].includes(offer.id));
function initials(name: string) { return name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase(); }
function tone(score: number) { return score < 55 ? "critical" : score < 75 ? "watch" : "good"; }

/** The proposal scope suggested by what the audit found. */
function seededScope(primaryFinding: string | undefined, googleFinding: string | undefined) {
  return [primaryFinding, googleFinding && `Google presence: ${googleFinding}.`].filter(Boolean).join(" ")
    || "Improve the highest-priority gaps identified in the digital presence audit.";
}

export default function ProspectDetail(props: Props) {
  const { lead, findings, opportunity, proposal, pagesAudited, busy } = props;
  const googleAudit = useMemo(() => buildGooglePresenceAudit(lead), [lead]);
  // "engine" was missing from this union while the tab was rendered, selected
  // and compared against — it worked at runtime and failed the typecheck three
  // times over, which is how a real break would have hidden.
  const [tab, setTab] = useState<"summary" | "website" | "google" | "engine" | "compare" | "blueprint" | "proposal">("summary");
  const [competitorBusy, setCompetitorBusy] = useState(false);
  const [googleDraft, setGoogleDraft] = useState({
    googleProfileUrl: lead.googleProfileUrl, googlePrimaryCategory: lead.googlePrimaryCategory,
    googleServices: lead.googleServices ?? "", placeId: lead.placeId ?? "", rating: lead.rating ?? 0,
    reviewCount: lead.reviewCount, googleReviewRecencyDays: lead.googleReviewRecencyDays, googleResponseRate: lead.googleResponseRate,
    googlePhotoCount: lead.googlePhotoCount, googlePostRecencyDays: lead.googlePostRecencyDays,
    googleProfileCompleteness: lead.googleProfileCompleteness, googleNapConsistent: lead.googleNapConsistent,
  });
  const suggestedOffer = googleAudit.reviewed && googleAudit.score < 60 && lead.score < 65
    ? proposalOffers.find((offer) => offer.id === "digital-presence-plan")!
    : googleAudit.reviewed && googleAudit.score < 60
      ? proposalOffers.find((offer) => offer.id === "google-presence")!
      : lead.score && lead.score < 55 ? proposalOffers.find((offer) => offer.id === "website-redesign")! : proposalOffers[0];
  const [offerId, setOfferId] = useState(suggestedOffer.id);
  const [proposalPrice, setProposalPrice] = useState(suggestedOffer.price);
  const [proposalTimeline, setProposalTimeline] = useState(suggestedOffer.timeline);
  const [proposalTitle, setProposalTitle] = useState(suggestedOffer.name);
  const [proposalOutcome, setProposalOutcome] = useState(suggestedOffer.outcome);
  const [proposalScope, setProposalScope] = useState(seededScope(opportunity?.primaryFinding, googleAudit.findings[0]?.title));
  const [proposalDeliverables, setProposalDeliverables] = useState(suggestedOffer.deliverables.join("\n"));
  const blueprint = useMemo(() => buildDigitalBlueprint(lead, findings, googleAudit), [lead, findings, googleAudit]);
  const [selectedRecommendations, setSelectedRecommendations] = useState<string[]>([]);
  const checkSummary = props.auditSummary?.checkSummary;
  const auditChecks = useMemo<AuditCheck[]>(() => {
    try { return JSON.parse(checkSummary || "[]"); } catch { return []; }
  }, [checkSummary]);

  // The panel is keyed by lead id in the dashboard, so a different lead
  // remounts it and the initialisers above are the reset. What still changes in
  // place is the audit, which loads after this mounts, and the draft is
  // re-seeded when it arrives.
  // Only copy the operator has not touched is re-seeded. Replacing all of it
  // meant saving the Google review, or an audit finishing in the background,
  // silently discarded a half-written scope the operator was in the middle of.
  const seeded = useRef({
    offerId: suggestedOffer.id, price: suggestedOffer.price, timeline: suggestedOffer.timeline,
    title: suggestedOffer.name, outcome: suggestedOffer.outcome,
    deliverables: suggestedOffer.deliverables.join("\n"),
    scope: seededScope(opportunity?.primaryFinding, googleAudit.findings[0]?.title),
  });
  useEffect(() => {
    if (proposal) return;
    const offer = suggestedOffer;
    const next = {
      offerId: offer.id, price: offer.price, timeline: offer.timeline,
      title: offer.name, outcome: offer.outcome, deliverables: offer.deliverables.join("\n"),
      scope: seededScope(opportunity?.primaryFinding, googleAudit.findings[0]?.title),
    };
    const prior = seeded.current;
    // A field is only re-seeded while it still holds what we last seeded into
    // it. Returning the current value is a no-op for React, so an untouched
    // draft updates and an edited one is left exactly as the operator left it.
    setOfferId((current) => (current === prior.offerId ? next.offerId : current));
    setProposalPrice((current) => (current === prior.price ? next.price : current));
    setProposalTimeline((current) => (current === prior.timeline ? next.timeline : current));
    setProposalTitle((current) => (current === prior.title ? next.title : current));
    setProposalOutcome((current) => (current === prior.outcome ? next.outcome : current));
    setProposalDeliverables((current) => (current === prior.deliverables ? next.deliverables : current));
    setProposalScope((current) => (current === prior.scope || !current.trim() ? next.scope : current));
    seeded.current = next;
  }, [lead.score, lead.googleReviewedAt, opportunity?.primaryFinding]);


  const draftGoogleAudit = useMemo(() => buildGooglePresenceAudit({ ...lead, ...googleDraft, googleReviewedAt: lead.googleReviewedAt || new Date().toISOString() }), [lead, googleDraft]);
  const combinedScore = lead.score && googleAudit.reviewed ? Math.round(lead.score * .6 + googleAudit.score * .4) : lead.score || googleAudit.score || 0;
  const combinedFindings = [
    ...findings.map((finding) => ({ ...finding, source: "Website" })),
    ...googleAudit.findings.map((finding) => ({ ...finding, source: "Google" })),
  ].sort((a, b) => ({ High: 0, Medium: 1, Low: 2 }[a.severity] - { High: 0, Medium: 1, Low: 2 }[b.severity]));
  const selectedOffer = proposalOffers.find((offer) => offer.id === offerId) ?? suggestedOffer;

  function useBlueprintInProposal() {
    const chosen = blueprint.recommendations.filter((item) => selectedRecommendations.includes(item.id));
    const items = chosen.length ? chosen : blueprint.recommendations.slice(0, 6);
    const benchmark = [...props.competitors].sort((a, b) => b.score - a.score)[0];
    setProposalTitle(`${lead.agencyName} Digital Presence Improvement Plan`);
    setProposalOutcome(`Improve the customer journey from discovery to contact by resolving ${items.length} evidence-backed website and Google presence priorities${benchmark ? ` and strengthening the website against the ${benchmark.name} benchmark` : ""}.`);
    setProposalScope([benchmark && `${benchmark.name} provides a ${benchmark.score}/100 competitive benchmark compared with the current ${lead.score}/100 website score.`, ...items.map((item, index) => `${index + 1}. ${item.title}: ${item.action}`)].filter(Boolean).join("\n"));
    setProposalDeliverables(items.map((item) => item.action).join("\n"));
    setProposalPrice(Math.max(2500, Math.round(items.reduce((sum, item) => sum + (item.effort === "Major" ? 1600 : item.effort === "Moderate" ? 900 : 450), 0) / 100) * 100));
    setProposalTimeline(items.some((item) => item.effort === "Major") ? "5–7 weeks" : "3–4 weeks");
    setTab("proposal");
  }

  function selectOffer(id: string) {
    const offer = proposalOffers.find((item) => item.id === id) ?? suggestedOffer;
    setOfferId(offer.id); setProposalPrice(offer.price); setProposalTimeline(offer.timeline); setProposalTitle(offer.name); setProposalOutcome(offer.outcome); setProposalDeliverables(offer.deliverables.join("\n"));
  }
  async function generateProposal() {
    const response = await fetch(`/api/leads/${lead.id}/proposal`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ offerId, price: proposalPrice, timeline: proposalTimeline, title: proposalTitle, outcome: proposalOutcome, scope: proposalScope, deliverables: proposalDeliverables.split("\n").map((item) => item.trim()).filter(Boolean) }) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Unable to create proposal");
    props.onProposal(payload.proposal, payload.lead);
  }
  async function copyProposal() { if (proposal) await navigator.clipboard.writeText(`${window.location.origin}/proposal/${proposal.token}`); }

  async function addCompetitor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setCompetitorBusy(true);
    const form = event.currentTarget; const body = Object.fromEntries(new FormData(form).entries());
    try {
      const response = await fetch(`/api/leads/${lead.id}/competitors`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Unable to audit competitor");
      form.reset(); await props.onRefresh();
    } catch (error) { alert(error instanceof Error ? error.message : "Unable to audit competitor"); }
    finally { setCompetitorBusy(false); }
  }

  async function removeCompetitor(id: number) {
    setCompetitorBusy(true);
    try {
      const response = await fetch(`/api/leads/${lead.id}/competitors?competitorId=${id}`, { method: "DELETE" });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Unable to remove competitor"); await props.onRefresh();
    } catch (error) { alert(error instanceof Error ? error.message : "Unable to remove competitor"); }
    finally { setCompetitorBusy(false); }
  }

  const deltaLabel = (value: number) => value > 0 ? `+${value}` : String(value);

  return <aside className="audit-detail-panel">
    <header className="audit-detail-head"><div className="detail-identity"><span className="detail-avatar">{initials(lead.agencyName)}</span><div><h2>{lead.agencyName}</h2><p>{lead.website.replace(/^https?:\/\//, "")}</p></div></div><button onClick={props.onClose} aria-label="Close audit">×</button></header>
    <nav className="audit-detail-tabs"><button className={tab === "summary" ? "active" : ""} onClick={() => setTab("summary")}>Summary</button><button className={tab === "website" ? "active" : ""} onClick={() => setTab("website")}>Website</button><button className={tab === "google" ? "active" : ""} onClick={() => setTab("google")}>Google</button><button className={tab === "engine" ? "active" : ""} onClick={() => setTab("engine")}>Audit engine</button><button className={tab === "compare" ? "active" : ""} onClick={() => setTab("compare")}>Competitors</button><button className={tab === "blueprint" ? "active" : ""} onClick={() => setTab("blueprint")}>Blueprint</button><button className={tab === "proposal" ? "active" : ""} onClick={() => setTab("proposal")}>Proposal</button></nav>

    <div className="audit-detail-scroll">
      {tab === "summary" && <><section className="presence-overall"><div className={`large-score ${combinedScore ? tone(combinedScore) : "neutral"}`}><strong>{combinedScore || "—"}</strong><span>Digital presence</span></div><div><p className="eyebrow">Overall review</p><h3>{combinedScore ? combinedScore >= 75 ? "Strong foundation with specific opportunities" : combinedScore >= 55 ? "Visible gaps are limiting the customer journey" : "Major website and Google improvements are available" : "Complete both reviews for the full score"}</h3><p>The combined score weights the website at 60% and Google presence at 40%.</p></div></section>
        <section className="two-review-cards"><button onClick={() => setTab("website")}><span>Website experience</span><strong>{lead.score || "Not audited"}</strong><small>{lead.score ? `${pagesAudited || 1} pages · visibility, conversion, technical, trust` : "Run the live multi-page audit"}</small><b>{lead.score ? "View detailed findings →" : "Start website audit →"}</b></button><button onClick={() => setTab("google")}><span>Google presence</span><strong>{googleAudit.reviewed ? googleAudit.score : "Not reviewed"}</strong><small>{googleAudit.reviewed ? `${googleAudit.findings.length} improvement areas · reviews, profile, activity` : "Enter verified public profile information"}</small><b>{googleAudit.reviewed ? "View Google scorecard →" : "Start Google review →"}</b></button></section>
        <section className="top-opportunities"><div className="section-title-row"><div><p className="eyebrow">Highest priority</p><h3>What should be fixed first</h3></div>{combinedFindings.length > 0 && <span>{combinedFindings.length} total findings</span>}</div>{combinedFindings.length ? <div className="summary-findings">{combinedFindings.slice(0, 5).map((finding, index) => <article key={`${finding.source}-${finding.title}-${index}`}><span className={`severity-flag ${finding.severity.toLowerCase()}`}>{finding.severity}</span><div><small>{finding.source} · {finding.category}</small><strong>{finding.title}</strong><p>{finding.evidence}</p></div></article>)}</div> : <div className="audit-empty"><strong>No findings yet</strong><p>Run the website audit and complete the Google presence review.</p></div>}</section>
        <div className="summary-actions"><button className="primary-button" disabled={busy} onClick={() => lead.score ? setTab("blueprint") : props.onAudit()}>{busy ? "Running audit…" : lead.score ? "Build improvement blueprint" : "Run website audit"}</button>{lead.score > 0 && <a className="secondary-button" href={`/report/${lead.reportToken}`} target="_blank" rel="noreferrer">Open detailed client report ↗</a>}</div></>}

      {tab === "website" && <><section className="audit-section-intro"><div><p className="eyebrow">Website audit</p><h3>Multi-page customer experience review</h3><p>Content checks across up to five pages, plus mobile Lighthouse performance, SEO, accessibility, and browser best practices when available.</p></div><button className="primary-button" disabled={busy} onClick={props.onAudit}>{busy ? "Auditing…" : lead.score ? "Run fresh audit" : "Run website audit"}</button></section>
        {lead.score ? <><section className="website-score-grid">{[["Overall", lead.score], ["Visibility", lead.visibilityScore], ["Conversion", lead.conversionScore], ["Technical", lead.technicalScore], ["Trust", lead.trustScore]].map(([label, value]) => <article key={label}><span>{label}</span><strong className={tone(Number(value))}>{value}</strong><i><b style={{ width: `${value}%` }} /></i></article>)}</section>
        {(props.auditSummary?.screenshotKey || props.auditComparison) && <section className="audit-proof-grid">{props.auditSummary?.screenshotKey && <figure><img src={`/api/audit-screenshots/${props.auditSummary.screenshotKey}`} alt={`Rendered mobile view of ${lead.agencyName}`} /><figcaption><strong>Rendered mobile evidence</strong><span>Captured during the Lighthouse audit—not a stock image.</span></figcaption></figure>}{props.auditComparison && <div className="audit-change-card"><p className="eyebrow">Since the previous audit</p><strong className={props.auditComparison.scoreDelta >= 0 ? "improved" : "declined"}>{deltaLabel(props.auditComparison.scoreDelta)} points</strong><div>{[["Visibility", props.auditComparison.visibilityDelta], ["Conversion", props.auditComparison.conversionDelta], ["Technical", props.auditComparison.technicalDelta], ["Trust", props.auditComparison.trustDelta]].map(([label, value]) => <span key={String(label)}><b>{label}</b><em className={Number(value) >= 0 ? "up" : "down"}>{deltaLabel(Number(value))}</em></span>)}</div>{props.auditComparison.resolved.length > 0 && <p><b>Resolved:</b> {props.auditComparison.resolved.join(" · ")}</p>}{props.auditComparison.regressed.length > 0 && <p><b>Regressed:</b> {props.auditComparison.regressed.join(" · ")}</p>}</div>}</section>}
        {props.auditHistory.length > 1 && <details className="audit-history"><summary>View audit history ({props.auditHistory.length})</summary><div>{props.auditHistory.map((audit, index) => <article key={audit.id}><span>{new Date(audit.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span><strong>{audit.score}/100</strong><small>{audit.pagesAudited} pages · {audit.confidenceScore} confidence</small>{index === 0 && <b>Current</b>}</article>)}</div></details>}
        {props.auditSummary && <section className="audit-evidence-summary"><div><span>Audit confidence</span><strong>{props.auditSummary.confidenceScore}/100</strong><small>{props.auditSummary.confidenceScore >= 80 ? "High evidence coverage" : props.auditSummary.confidenceScore >= 60 ? "Moderate evidence coverage" : "Limited evidence coverage—review manually"}</small></div><div><span>Checks</span><strong>{props.auditSummary.checksPassed} passed · {props.auditSummary.checksFailed} failed</strong><small>{props.auditSummary.checksUnverified} unverified · {pagesAudited} pages inspected</small></div><p>Scores are earned from observable evidence. Unverified checks earn no points and lower confidence.</p></section>}
        {auditChecks.length > 0 && <details className="audit-methodology"><summary>View all {auditChecks.length} scored checks</summary><div>{auditChecks.map((item) => <article key={item.id}><span className={`check-status ${item.status}`}>{item.status === "passed" ? "✓" : item.status === "failed" ? "!" : "?"}</span><div><strong>{item.label}</strong><small>{item.category} · {item.weight} points · {item.evidence}</small></div></article>)}</div></details>}
        <section className="detailed-findings"><div className="section-title-row"><div><p className="eyebrow">Detailed findings</p><h3>{findings.length} evidence-backed opportunities</h3></div><span>{pagesAudited || 1} pages reviewed</span></div>{findings.map((finding, index) => <article key={`${finding.title}-${index}`}><div className="finding-number">{String(index + 1).padStart(2, "0")}</div><div><div className="finding-labels"><span>{finding.category}</span><span className={`severity-flag ${finding.severity.toLowerCase()}`}>{finding.severity}</span></div><h4>{finding.title}</h4><dl><div><dt>Evidence</dt><dd>{finding.evidence}</dd></div><div><dt>Why it matters</dt><dd>{finding.impact}</dd></div><div><dt>Recommended fix</dt><dd>{finding.recommendation}</dd></div></dl></div></article>)}</section></> : <div className="audit-empty large"><strong>Website audit not run</strong><p>The review checks the homepage and high-value internal pages for discoverability, conversion, mobile experience, accessibility, and trust.</p><button className="primary-button" disabled={busy} onClick={props.onAudit}>{busy ? "Auditing…" : "Run website audit"}</button></div>}</>}

      {tab === "google" && <><section className="audit-section-intro google-intro"><div><p className="eyebrow">Google presence review</p><h3>Local visibility and reputation scorecard</h3><p>Enter information visible on the public Google Business Profile. Every score is transparent and can be verified before it reaches a proposal.</p></div><div className={`mini-score ${tone(draftGoogleAudit.score)}`}><strong>{draftGoogleAudit.score}</strong><span>/100</span></div></section>
        <section className="google-score-form"><label className="span-two">Google Business Profile URL<input value={googleDraft.googleProfileUrl} onChange={(event) => setGoogleDraft({ ...googleDraft, googleProfileUrl: event.target.value })} placeholder="https://g.page/..." /></label><label className="span-two">Primary business category<input value={googleDraft.googlePrimaryCategory} onChange={(event) => setGoogleDraft({ ...googleDraft, googlePrimaryCategory: event.target.value })} placeholder="Example: HVAC contractor" /></label><label className="span-two">Services listed on the profile<textarea rows={3} value={googleDraft.googleServices} onChange={(event) => setGoogleDraft({ ...googleDraft, googleServices: event.target.value })} placeholder="One per line, or comma separated. Leave empty if the profile genuinely lists none." /><small>Google does not publish this for a profile you do not own. Until it is saved, the audit reports the service list as not measured rather than claiming it is empty.</small></label><label className="span-two">Place ID <small>Optional</small><input value={googleDraft.placeId} onChange={(event) => setGoogleDraft({ ...googleDraft, placeId: event.target.value })} placeholder="ChIJ..." /><small>Only used if you add a Places API key later; it skips the pricier lookup.</small></label><label>Star rating<input type="number" min="0" max="5" step="0.1" value={googleDraft.rating} onChange={(event) => setGoogleDraft({ ...googleDraft, rating: Number(event.target.value) })} /></label><label>Review count<input type="number" min="0" value={googleDraft.reviewCount} onChange={(event) => setGoogleDraft({ ...googleDraft, reviewCount: Number(event.target.value) })} /></label><label>Newest review<select value={googleDraft.googleReviewRecencyDays} onChange={(event) => setGoogleDraft({ ...googleDraft, googleReviewRecencyDays: Number(event.target.value) })}><option value="0">Not verified</option><option value="7">Within 7 days</option><option value="30">Within 30 days</option><option value="90">Within 90 days</option><option value="180">3–6 months ago</option><option value="365">More than 6 months</option></select></label><label>Owner response rate<input type="number" min="0" max="100" value={googleDraft.googleResponseRate} onChange={(event) => setGoogleDraft({ ...googleDraft, googleResponseRate: Number(event.target.value) })} /><small>Percent of reviews answered</small></label><label>Business photos<input type="number" min="0" value={googleDraft.googlePhotoCount} onChange={(event) => setGoogleDraft({ ...googleDraft, googlePhotoCount: Number(event.target.value) })} /></label><label>Newest Google post<select value={googleDraft.googlePostRecencyDays} onChange={(event) => setGoogleDraft({ ...googleDraft, googlePostRecencyDays: Number(event.target.value) })}><option value="0">No post / unknown</option><option value="7">Within 7 days</option><option value="30">Within 30 days</option><option value="90">Within 90 days</option><option value="180">3–6 months ago</option></select></label><label>Profile completeness<input type="number" min="0" max="100" value={googleDraft.googleProfileCompleteness} onChange={(event) => setGoogleDraft({ ...googleDraft, googleProfileCompleteness: Number(event.target.value) })} /><small>Estimated percent complete</small></label><label>Name, address, phone match<select value={googleDraft.googleNapConsistent ? "yes" : "no"} onChange={(event) => setGoogleDraft({ ...googleDraft, googleNapConsistent: event.target.value === "yes" })}><option value="no">No / not verified</option><option value="yes">Yes</option></select></label></section>
        <button className="save-google-review" disabled={busy} onClick={() => props.onPatch({ ...googleDraft, googlePresenceReviewed: true }, "Google presence scorecard saved")}>{busy ? "Saving…" : `Save Google review · ${draftGoogleAudit.score}/100`}</button>
        <section className="google-findings"><div className="section-title-row"><div><p className="eyebrow">Live score explanation</p><h3>{draftGoogleAudit.findings.length} improvement areas</h3></div></div>{draftGoogleAudit.findings.map((finding, index) => <article key={`${finding.title}-${index}`}><span className={`severity-flag ${finding.severity.toLowerCase()}`}>{finding.severity}</span><div><strong>{finding.title}</strong><p>{finding.evidence}</p><small>{finding.recommendation}</small></div></article>)}</section></>}

      {tab === "engine" && <AuditRunPanel leadId={lead.id} reportToken={lead.reportToken} />}

      {tab === "compare" && <section className="competitor-workspace"><div className="audit-section-intro"><div><p className="eyebrow">Competitive benchmark</p><h3>Compare against real alternatives</h3><p>Audit up to three competitor websites using the same scoring model. This is a website comparison—not a claim about search rank or business quality.</p></div></div>
        {lead.score > 0 && <section className="competitor-table"><div className="competitor-row heading"><span>Business</span><span>Overall</span><span>Visibility</span><span>Conversion</span><span>Technical</span><span>Trust</span><span /></div><div className="competitor-row primary"><span><strong>{lead.agencyName}</strong><small>Your audited site</small></span><b>{lead.score}</b><b>{lead.visibilityScore}</b><b>{lead.conversionScore}</b><b>{lead.technicalScore}</b><b>{lead.trustScore}</b><span>Baseline</span></div>{props.competitors.map((competitor) => <div className="competitor-row" key={competitor.id}><span><strong>{competitor.name}</strong><small>{competitor.website.replace(/^https?:\/\//, "")}</small></span><b className={competitor.score > lead.score ? "ahead" : "behind"}>{competitor.score}</b><b>{competitor.visibilityScore}</b><b>{competitor.conversionScore}</b><b>{competitor.technicalScore}</b><b>{competitor.trustScore}</b><button disabled={competitorBusy} onClick={() => removeCompetitor(competitor.id)}>Remove</button>{competitor.screenshotKey && <figure><img src={`/api/audit-screenshots/${competitor.screenshotKey}`} alt={`Rendered mobile view of ${competitor.name}`} /><figcaption>{competitor.pagesAudited} pages · {competitor.confidenceScore} confidence</figcaption></figure>}</div>)}</section>}
        {props.competitors.length < 3 && <form className="competitor-form" onSubmit={addCompetitor}><div><p className="eyebrow">Add competitor</p><h3>Run the same evidence audit</h3></div><label>Competitor name<input name="name" required placeholder="Competitor business" /></label><label>Website<input name="website" required inputMode="url" placeholder="https://competitor.com" /></label><button className="primary-button" disabled={competitorBusy}>{competitorBusy ? "Auditing competitor…" : "Audit and compare"}</button></form>}
        {!lead.score && <div className="audit-empty large"><strong>Audit the primary business first</strong><p>The comparison needs a baseline score before competitor sites can be evaluated.</p><button className="primary-button" disabled={busy} onClick={props.onAudit}>Run website audit</button></div>}
      </section>}

      {tab === "blueprint" && <section className="blueprint-builder"><div className="audit-section-intro"><div><p className="eyebrow">Digital Presence Blueprint</p><h3>Turn findings into an implementation plan</h3><p>Select the work worth proposing. Scope, deliverables, investment, and timing are generated from these choices and remain editable.</p></div></div>
        <section className="blueprint-score"><div><span>Current score</span><strong>{blueprint.currentScore || "—"}</strong></div><i>→</i><div><span>Estimated after selected priorities</span><strong>{blueprint.projectedScore}</strong><small>{blueprint.projectedLabel}</small></div></section>
        <section className="blueprint-recommendations"><div className="section-title-row"><div><p className="eyebrow">Recommended scope</p><h3>{blueprint.recommendations.length} evidence-backed actions</h3></div><button onClick={() => setSelectedRecommendations(selectedRecommendations.length === blueprint.recommendations.length ? [] : blueprint.recommendations.map((item) => item.id))}>{selectedRecommendations.length === blueprint.recommendations.length ? "Clear" : "Select all"}</button></div>{blueprint.recommendations.map((item) => <label key={item.id}><input type="checkbox" checked={selectedRecommendations.includes(item.id)} onChange={() => setSelectedRecommendations((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])} /><span className={`severity-flag ${item.severity.toLowerCase()}`}>{item.severity}</span><div><strong>{item.title}</strong><p>{item.action}</p><small>{item.source} · {item.category} · {item.effort}</small></div></label>)}</section>
        <section className="blueprint-structure"><div><p className="eyebrow">Recommended sitemap</p><ol>{blueprint.sitemap.map((item) => <li key={item}>{item}</li>)}</ol></div><div><p className="eyebrow">Homepage conversion structure</p><ol>{blueprint.homepage.sections.map((item) => <li key={item}>{item}</li>)}</ol></div></section>
        <section className="blueprint-roadmap"><p className="eyebrow">Implementation order</p>{blueprint.roadmap.map((phase) => <article key={phase.phase}><span>{phase.phase}</span><div><strong>{phase.label}</strong><p>{phase.items.length ? phase.items.map((item) => item.title).join(" · ") : "No additional items in this phase"}</p></div></article>)}</section>
        <button className="generate-proposal" disabled={!blueprint.recommendations.length} onClick={useBlueprintInProposal}>Use {selectedRecommendations.length || Math.min(6, blueprint.recommendations.length)} priorities in proposal →</button>
      </section>}

      {tab === "proposal" && <section className="simple-proposal-builder"><div className="audit-section-intro"><div><p className="eyebrow">Proposal development</p><h3>Turn the audit into a clear scope</h3><p>Edit every field before sharing. The client proposal includes the strongest website and Google findings.</p></div></div>{proposal ? <div className="existing-proposal"><span className="proposal-ready">{proposal.status}</span><h3>{proposal.title}</h3><p>${proposal.price.toLocaleString("en-US")} · {proposal.timeline} · {proposal.viewCount} view{proposal.viewCount === 1 ? "" : "s"}</p><div><button onClick={copyProposal}>Copy link</button><a href={`/proposal/${proposal.token}`} target="_blank" rel="noreferrer">Open / save PDF ↗</a></div><button className="refresh-proposal" onClick={props.onRefresh}>Refresh proposal status</button></div> : <><label>Proposal type<select value={offerId} onChange={(event) => selectOffer(event.target.value)}>{proposalOffers.map((offer) => <option key={offer.id} value={offer.id}>{offer.name}</option>)}</select></label><label>Proposal title<input value={proposalTitle} onChange={(event) => setProposalTitle(event.target.value)} /></label><label>Desired outcome<textarea rows={3} value={proposalOutcome} onChange={(event) => setProposalOutcome(event.target.value)} /></label><label>Audit-based scope<textarea rows={4} value={proposalScope} onChange={(event) => setProposalScope(event.target.value)} /></label><label>Deliverables <small>One per line</small><textarea rows={7} value={proposalDeliverables} onChange={(event) => setProposalDeliverables(event.target.value)} /></label><div className="proposal-money"><label>Investment<input type="number" min="500" step="100" value={proposalPrice} onChange={(event) => setProposalPrice(Number(event.target.value))} /></label><label>Timeline<input value={proposalTimeline} onChange={(event) => setProposalTimeline(event.target.value)} /></label></div><div className="proposal-proof"><strong>{selectedOffer.outcome}</strong><p>{selectedOffer.proof}</p></div><button className="generate-proposal" disabled={busy || (!lead.score && !googleAudit.reviewed) || !proposalTitle.trim() || !proposalDeliverables.trim()} onClick={() => generateProposal().catch((error) => alert(error.message))}>{lead.score || googleAudit.reviewed ? "Create trackable proposal" : "Complete an audit before proposing"}</button></>}</section>}
    </div>
  </aside>;
}
