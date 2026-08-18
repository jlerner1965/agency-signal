"use client";

import { useEffect, useMemo, useState } from "react";
import { buildGooglePresenceAudit } from "@/lib/google-presence";
import { offerCatalog } from "@/lib/sales";
import type { Finding, Lead, Opportunity, Proposal } from "@/lib/types";

type Props = {
  lead: Lead;
  findings: Finding[];
  opportunity: Opportunity | null;
  proposal: Proposal | null;
  pagesAudited: number;
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

export default function ProspectDetail(props: Props) {
  const { lead, findings, opportunity, proposal, pagesAudited, busy } = props;
  const googleAudit = buildGooglePresenceAudit(lead);
  const [tab, setTab] = useState<"summary" | "website" | "google" | "proposal">("summary");
  const [googleDraft, setGoogleDraft] = useState({
    googleProfileUrl: lead.googleProfileUrl, googlePrimaryCategory: lead.googlePrimaryCategory, rating: lead.rating ?? 0,
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
  const [proposalScope, setProposalScope] = useState(opportunity?.primaryFinding || "Improve the highest-priority gaps identified in the digital presence audit.");
  const [proposalDeliverables, setProposalDeliverables] = useState(suggestedOffer.deliverables.join("\n"));

  useEffect(() => {
    setTab("summary");
    setGoogleDraft({ googleProfileUrl: lead.googleProfileUrl, googlePrimaryCategory: lead.googlePrimaryCategory, rating: lead.rating ?? 0, reviewCount: lead.reviewCount, googleReviewRecencyDays: lead.googleReviewRecencyDays, googleResponseRate: lead.googleResponseRate, googlePhotoCount: lead.googlePhotoCount, googlePostRecencyDays: lead.googlePostRecencyDays, googleProfileCompleteness: lead.googleProfileCompleteness, googleNapConsistent: lead.googleNapConsistent });
  }, [lead.id]);
  useEffect(() => {
    if (proposal) return;
    selectOffer(suggestedOffer.id);
    const googleFinding = googleAudit.findings[0]?.title;
    setProposalScope([opportunity?.primaryFinding, googleFinding && `Google presence: ${googleFinding}.`].filter(Boolean).join(" ") || "Improve the highest-priority gaps identified in the digital presence audit.");
  }, [lead.score, lead.googleReviewedAt, opportunity?.primaryFinding]);

  const draftGoogleAudit = useMemo(() => buildGooglePresenceAudit({ ...lead, ...googleDraft, googleReviewedAt: lead.googleReviewedAt || new Date().toISOString() }), [lead, googleDraft]);
  const combinedScore = lead.score && googleAudit.reviewed ? Math.round(lead.score * .6 + googleAudit.score * .4) : lead.score || googleAudit.score || 0;
  const combinedFindings = [
    ...findings.map((finding) => ({ ...finding, source: "Website" })),
    ...googleAudit.findings.map((finding) => ({ ...finding, source: "Google" })),
  ].sort((a, b) => ({ High: 0, Medium: 1, Low: 2 }[a.severity] - { High: 0, Medium: 1, Low: 2 }[b.severity]));
  const selectedOffer = proposalOffers.find((offer) => offer.id === offerId) ?? suggestedOffer;

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

  return <aside className="audit-detail-panel">
    <header className="audit-detail-head"><div className="detail-identity"><span className="detail-avatar">{initials(lead.agencyName)}</span><div><h2>{lead.agencyName}</h2><p>{lead.website.replace(/^https?:\/\//, "")}</p></div></div><button onClick={props.onClose} aria-label="Close audit">×</button></header>
    <nav className="audit-detail-tabs"><button className={tab === "summary" ? "active" : ""} onClick={() => setTab("summary")}>Summary</button><button className={tab === "website" ? "active" : ""} onClick={() => setTab("website")}>Website</button><button className={tab === "google" ? "active" : ""} onClick={() => setTab("google")}>Google</button><button className={tab === "proposal" ? "active" : ""} onClick={() => setTab("proposal")}>Proposal</button></nav>

    <div className="audit-detail-scroll">
      {tab === "summary" && <><section className="presence-overall"><div className={`large-score ${combinedScore ? tone(combinedScore) : "neutral"}`}><strong>{combinedScore || "—"}</strong><span>Digital presence</span></div><div><p className="eyebrow">Overall review</p><h3>{combinedScore ? combinedScore >= 75 ? "Strong foundation with specific opportunities" : combinedScore >= 55 ? "Visible gaps are limiting the customer journey" : "Major website and Google improvements are available" : "Complete both reviews for the full score"}</h3><p>The combined score weights the website at 60% and Google presence at 40%.</p></div></section>
        <section className="two-review-cards"><button onClick={() => setTab("website")}><span>Website experience</span><strong>{lead.score || "Not audited"}</strong><small>{lead.score ? `${pagesAudited || 1} pages · visibility, conversion, technical, trust` : "Run the live multi-page audit"}</small><b>{lead.score ? "View detailed findings →" : "Start website audit →"}</b></button><button onClick={() => setTab("google")}><span>Google presence</span><strong>{googleAudit.reviewed ? googleAudit.score : "Not reviewed"}</strong><small>{googleAudit.reviewed ? `${googleAudit.findings.length} improvement areas · reviews, profile, activity` : "Enter verified public profile information"}</small><b>{googleAudit.reviewed ? "View Google scorecard →" : "Start Google review →"}</b></button></section>
        <section className="top-opportunities"><div className="section-title-row"><div><p className="eyebrow">Highest priority</p><h3>What should be fixed first</h3></div>{combinedFindings.length > 0 && <span>{combinedFindings.length} total findings</span>}</div>{combinedFindings.length ? <div className="summary-findings">{combinedFindings.slice(0, 5).map((finding, index) => <article key={`${finding.source}-${finding.title}-${index}`}><span className={`severity-flag ${finding.severity.toLowerCase()}`}>{finding.severity}</span><div><small>{finding.source} · {finding.category}</small><strong>{finding.title}</strong><p>{finding.evidence}</p></div></article>)}</div> : <div className="audit-empty"><strong>No findings yet</strong><p>Run the website audit and complete the Google presence review.</p></div>}</section>
        <div className="summary-actions"><button className="primary-button" disabled={busy} onClick={() => lead.score ? setTab("proposal") : props.onAudit()}>{busy ? "Running audit…" : lead.score ? "Build proposal" : "Run website audit"}</button>{lead.score > 0 && <a className="secondary-button" href={`/report/${lead.reportToken}`} target="_blank" rel="noreferrer">Open detailed client report ↗</a>}</div></>}

      {tab === "website" && <><section className="audit-section-intro"><div><p className="eyebrow">Website audit</p><h3>Multi-page customer experience review</h3><p>Content checks across up to five pages, plus mobile Lighthouse performance, SEO, accessibility, and browser best practices when available.</p></div><button className="primary-button" disabled={busy} onClick={props.onAudit}>{busy ? "Auditing…" : lead.score ? "Run fresh audit" : "Run website audit"}</button></section>
        {lead.score ? <><section className="website-score-grid">{[["Overall", lead.score], ["Visibility", lead.visibilityScore], ["Conversion", lead.conversionScore], ["Technical", lead.technicalScore], ["Trust", lead.trustScore]].map(([label, value]) => <article key={label}><span>{label}</span><strong className={tone(Number(value))}>{value}</strong><i><b style={{ width: `${value}%` }} /></i></article>)}</section><section className="detailed-findings"><div className="section-title-row"><div><p className="eyebrow">Detailed findings</p><h3>{findings.length} website opportunities</h3></div><span>{pagesAudited || 1} pages reviewed</span></div>{findings.map((finding, index) => <article key={`${finding.title}-${index}`}><div className="finding-number">{String(index + 1).padStart(2, "0")}</div><div><div className="finding-labels"><span>{finding.category}</span><span className={`severity-flag ${finding.severity.toLowerCase()}`}>{finding.severity}</span></div><h4>{finding.title}</h4><dl><div><dt>Evidence</dt><dd>{finding.evidence}</dd></div><div><dt>Why it matters</dt><dd>{finding.impact}</dd></div><div><dt>Recommended fix</dt><dd>{finding.recommendation}</dd></div></dl></div></article>)}</section></> : <div className="audit-empty large"><strong>Website audit not run</strong><p>The review checks the homepage and high-value internal pages for discoverability, conversion, mobile experience, accessibility, and trust.</p><button className="primary-button" disabled={busy} onClick={props.onAudit}>{busy ? "Auditing…" : "Run website audit"}</button></div>}</>}

      {tab === "google" && <><section className="audit-section-intro google-intro"><div><p className="eyebrow">Google presence review</p><h3>Local visibility and reputation scorecard</h3><p>Enter information visible on the public Google Business Profile. Every score is transparent and can be verified before it reaches a proposal.</p></div><div className={`mini-score ${tone(draftGoogleAudit.score)}`}><strong>{draftGoogleAudit.score}</strong><span>/100</span></div></section>
        <section className="google-score-form"><label className="span-two">Google Business Profile URL<input value={googleDraft.googleProfileUrl} onChange={(event) => setGoogleDraft({ ...googleDraft, googleProfileUrl: event.target.value })} placeholder="https://g.page/..." /></label><label className="span-two">Primary business category<input value={googleDraft.googlePrimaryCategory} onChange={(event) => setGoogleDraft({ ...googleDraft, googlePrimaryCategory: event.target.value })} placeholder="Example: HVAC contractor" /></label><label>Star rating<input type="number" min="0" max="5" step="0.1" value={googleDraft.rating} onChange={(event) => setGoogleDraft({ ...googleDraft, rating: Number(event.target.value) })} /></label><label>Review count<input type="number" min="0" value={googleDraft.reviewCount} onChange={(event) => setGoogleDraft({ ...googleDraft, reviewCount: Number(event.target.value) })} /></label><label>Newest review<select value={googleDraft.googleReviewRecencyDays} onChange={(event) => setGoogleDraft({ ...googleDraft, googleReviewRecencyDays: Number(event.target.value) })}><option value="0">Not verified</option><option value="7">Within 7 days</option><option value="30">Within 30 days</option><option value="90">Within 90 days</option><option value="180">3–6 months ago</option><option value="365">More than 6 months</option></select></label><label>Owner response rate<input type="number" min="0" max="100" value={googleDraft.googleResponseRate} onChange={(event) => setGoogleDraft({ ...googleDraft, googleResponseRate: Number(event.target.value) })} /><small>Percent of reviews answered</small></label><label>Business photos<input type="number" min="0" value={googleDraft.googlePhotoCount} onChange={(event) => setGoogleDraft({ ...googleDraft, googlePhotoCount: Number(event.target.value) })} /></label><label>Newest Google post<select value={googleDraft.googlePostRecencyDays} onChange={(event) => setGoogleDraft({ ...googleDraft, googlePostRecencyDays: Number(event.target.value) })}><option value="0">No post / unknown</option><option value="7">Within 7 days</option><option value="30">Within 30 days</option><option value="90">Within 90 days</option><option value="180">3–6 months ago</option></select></label><label>Profile completeness<input type="number" min="0" max="100" value={googleDraft.googleProfileCompleteness} onChange={(event) => setGoogleDraft({ ...googleDraft, googleProfileCompleteness: Number(event.target.value) })} /><small>Estimated percent complete</small></label><label>Name, address, phone match<select value={googleDraft.googleNapConsistent ? "yes" : "no"} onChange={(event) => setGoogleDraft({ ...googleDraft, googleNapConsistent: event.target.value === "yes" })}><option value="no">No / not verified</option><option value="yes">Yes</option></select></label></section>
        <button className="save-google-review" disabled={busy} onClick={() => props.onPatch({ ...googleDraft, googlePresenceReviewed: true }, "Google presence scorecard saved")}>{busy ? "Saving…" : `Save Google review · ${draftGoogleAudit.score}/100`}</button>
        <section className="google-findings"><div className="section-title-row"><div><p className="eyebrow">Live score explanation</p><h3>{draftGoogleAudit.findings.length} improvement areas</h3></div></div>{draftGoogleAudit.findings.map((finding, index) => <article key={`${finding.title}-${index}`}><span className={`severity-flag ${finding.severity.toLowerCase()}`}>{finding.severity}</span><div><strong>{finding.title}</strong><p>{finding.evidence}</p><small>{finding.recommendation}</small></div></article>)}</section></>}

      {tab === "proposal" && <section className="simple-proposal-builder"><div className="audit-section-intro"><div><p className="eyebrow">Proposal development</p><h3>Turn the audit into a clear scope</h3><p>Edit every field before sharing. The client proposal includes the strongest website and Google findings.</p></div></div>{proposal ? <div className="existing-proposal"><span className="proposal-ready">{proposal.status}</span><h3>{proposal.title}</h3><p>${proposal.price.toLocaleString("en-US")} · {proposal.timeline} · {proposal.viewCount} view{proposal.viewCount === 1 ? "" : "s"}</p><div><button onClick={copyProposal}>Copy link</button><a href={`/proposal/${proposal.token}`} target="_blank" rel="noreferrer">Open / save PDF ↗</a></div><button className="refresh-proposal" onClick={props.onRefresh}>Refresh proposal status</button></div> : <><label>Proposal type<select value={offerId} onChange={(event) => selectOffer(event.target.value)}>{proposalOffers.map((offer) => <option key={offer.id} value={offer.id}>{offer.name}</option>)}</select></label><label>Proposal title<input value={proposalTitle} onChange={(event) => setProposalTitle(event.target.value)} /></label><label>Desired outcome<textarea rows={3} value={proposalOutcome} onChange={(event) => setProposalOutcome(event.target.value)} /></label><label>Audit-based scope<textarea rows={4} value={proposalScope} onChange={(event) => setProposalScope(event.target.value)} /></label><label>Deliverables <small>One per line</small><textarea rows={7} value={proposalDeliverables} onChange={(event) => setProposalDeliverables(event.target.value)} /></label><div className="proposal-money"><label>Investment<input type="number" min="500" step="100" value={proposalPrice} onChange={(event) => setProposalPrice(Number(event.target.value))} /></label><label>Timeline<input value={proposalTimeline} onChange={(event) => setProposalTimeline(event.target.value)} /></label></div><div className="proposal-proof"><strong>{selectedOffer.outcome}</strong><p>{selectedOffer.proof}</p></div><button className="generate-proposal" disabled={busy || (!lead.score && !googleAudit.reviewed) || !proposalTitle.trim() || !proposalDeliverables.trim()} onClick={() => generateProposal().catch((error) => alert(error.message))}>{lead.score || googleAudit.reviewed ? "Create trackable proposal" : "Complete an audit before proposing"}</button></>}</section>}
    </div>
  </aside>;
}
