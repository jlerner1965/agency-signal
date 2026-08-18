"use client";

import { useMemo, useState } from "react";
import type { Activity, Finding, Lead, LeadStatus, Opportunity, Proposal } from "@/lib/types";
import { discoveryPlaybook, objections, offerCatalog, offerForOpportunity, outreachSequence, qualificationBreakdown, qualificationLabel, salesStages } from "@/lib/sales";

type Props = {
  lead: Lead;
  findings: Finding[];
  opportunity: Opportunity | null;
  proposal: Proposal | null;
  pagesAudited: number;
  activities: Activity[];
  busy: boolean;
  onClose: () => void;
  onAudit: () => Promise<void>;
  onPatch: (values: Record<string, unknown>, success: string) => Promise<void>;
  onCopyOutreach: () => Promise<void>;
  onOpenGmail: () => Promise<void>;
  onProposal: (proposal: Proposal, lead: Lead) => void;
  onRefresh: () => Promise<void>;
};

function initials(name: string) { return name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase(); }
function scoreTone(score: number) { return score === 0 ? "neutral" : score < 55 ? "critical" : score < 70 ? "watch" : "good"; }
function friendlyDate(value: string | null) { return value ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value)) : "Not scheduled"; }
function inputDate(value: string | null) { if (!value) return ""; const date = new Date(value); const offset = date.getTimezoneOffset() * 60_000; return new Date(date.getTime() - offset).toISOString().slice(0, 16); }

export default function ProspectDetail(props: Props) {
  const { lead, findings, opportunity, proposal, pagesAudited, activities, busy } = props;
  const [tab, setTab] = useState<"close" | "audit" | "activity">("close");
  const [draftLeadId, setDraftLeadId] = useState(lead.id);
  const [qualification, setQualification] = useState({ fitScore: lead.fitScore, needScore: lead.needScore, intentScore: lead.intentScore, urgencyScore: lead.urgencyScore, reachabilityScore: lead.reachabilityScore });
  const [discovery, setDiscovery] = useState({ businessObjective: lead.businessObjective, painPoint: lead.painPoint, currentProvider: lead.currentProvider, decisionMaker: lead.decisionMaker, budgetRange: lead.budgetRange, desiredTimeline: lead.desiredTimeline, nextCommittedStep: lead.nextCommittedStep, objection: lead.objection, lossReason: lead.lossReason });
  const [contact, setContact] = useState({ contactName: lead.contactName, email: lead.email, phone: lead.phone, carrier: lead.carrier });
  const [notes, setNotes] = useState(lead.notes);
  const [followUp, setFollowUp] = useState(inputDate(lead.nextFollowUpAt));
  const recommendedOffer = useMemo(() => offerForOpportunity(opportunity), [opportunity]);
  const [offerId, setOfferId] = useState(recommendedOffer.id);
  const [proposalPrice, setProposalPrice] = useState(recommendedOffer.price);
  const [proposalTimeline, setProposalTimeline] = useState(recommendedOffer.timeline);

  if (draftLeadId !== lead.id) {
    setDraftLeadId(lead.id);
    setQualification({ fitScore: lead.fitScore, needScore: lead.needScore, intentScore: lead.intentScore, urgencyScore: lead.urgencyScore, reachabilityScore: lead.reachabilityScore });
    setDiscovery({ businessObjective: lead.businessObjective, painPoint: lead.painPoint, currentProvider: lead.currentProvider, decisionMaker: lead.decisionMaker, budgetRange: lead.budgetRange, desiredTimeline: lead.desiredTimeline, nextCommittedStep: lead.nextCommittedStep, objection: lead.objection, lossReason: lead.lossReason });
    setContact({ contactName: lead.contactName, email: lead.email, phone: lead.phone, carrier: lead.carrier });
    setNotes(lead.notes); setFollowUp(inputDate(lead.nextFollowUpAt)); setTab("close");
    setOfferId(recommendedOffer.id); setProposalPrice(recommendedOffer.price); setProposalTimeline(recommendedOffer.timeline);
  }

  const scoredLead = { ...lead, ...qualification };
  const qualificationResult = qualificationBreakdown(scoredLead);
  const playbook = discoveryPlaybook(lead, opportunity);
  const selectedOffer = offerCatalog.find((offer) => offer.id === offerId) ?? recommendedOffer;
  const sequenceStep = outreachSequence.find((item) => item.step === Math.max(1, lead.sequenceStep)) ?? outreachSequence[0];
  const objectionResponse = objections[discovery.objection as keyof typeof objections];

  async function generateProposal() {
    const response = await fetch(`/api/leads/${lead.id}/proposal`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ offerId, price: proposalPrice, timeline: proposalTimeline }) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Unable to create proposal");
    props.onProposal(payload.proposal, payload.lead);
  }

  async function copyProposal() {
    if (!proposal) return;
    await navigator.clipboard.writeText(`${window.location.origin}/proposal/${proposal.token}`);
  }

  async function copyObjectionResponse() { if (objectionResponse) await navigator.clipboard.writeText(objectionResponse); }

  return <aside className="detail-panel conversion-panel">
    <div className="detail-top"><p>Prospect workspace</p><button aria-label="Close prospect detail" onClick={props.onClose}>×</button></div>
    <div className="detail-identity"><span className="detail-avatar">{initials(lead.agencyName)}</span><div><h2>{lead.agencyName}</h2><p>{lead.carrier}{lead.city ? ` · ${lead.city}${lead.state ? `, ${lead.state}` : ""}` : ""}</p></div></div>
    <div className="detail-tabs" role="tablist"><button className={tab === "close" ? "active" : ""} onClick={() => setTab("close")}>Outreach</button><button className={tab === "audit" ? "active" : ""} onClick={() => setTab("audit")}>Audit</button><button className={tab === "activity" ? "active" : ""} onClick={() => setTab("activity")}>Notes</button></div>

    {tab === "close" && <>
      {!lead.score ? <section className="guided-next-step">
        <span className="step-badge">Recommended next step</span>
        <h3>Audit the website first</h3>
        <p>AgencySignal needs real website evidence before it can recommend outreach, qualification, or a proposal.</p>
        <ul><li>Reviews up to five public pages</li><li>Scores visibility, conversion, trust, and technical readiness</li><li>Creates specific reasons to contact this business</li></ul>
        <button disabled={busy} onClick={props.onAudit}>{busy ? "Auditing up to 5 pages…" : "Run website audit"}</button>
        <small>You can review every finding before using it in outreach.</small>
      </section> : <>
      <section className="guided-next-step outreach-next-step">
        <span className="step-badge">Step 2 · Highest priority</span>
        <h3>Create the personalized email</h3>
        <p>The audit is ready. Turn its strongest finding into a specific, credible reason to contact {lead.agencyName}.</p>
        <div className="guided-actions"><button onClick={props.onCopyOutreach}>Copy personalized email</button><button className="secondary" onClick={props.onOpenGmail}>Open in Gmail</button></div>
        <small>The email uses the strongest verified audit finding. Nothing is sent automatically.</small>
      </section>
      <details className="advanced-closing"><summary><span>Optional closing tools</span><small>Qualification, follow-up, discovery, and proposal</small></summary><div className="advanced-closing-body">
      <div className="close-score-card"><div><span>Closing readiness</span><strong>{qualificationResult.total}<small>/100</small></strong></div><div className="readiness-bar"><i style={{ width: `${qualificationResult.total}%` }} /></div><p>{qualificationLabel(scoredLead)} · Need and audit quality are separate from buyer intent.</p></div>
      <div className="stage-control"><label htmlFor="lead-stage">Sales stage</label><select id="lead-stage" value={lead.status} onChange={(event) => props.onPatch({ status: event.target.value as LeadStatus }, `Moved to ${event.target.value}`)}>{salesStages.map((status) => <option key={status}>{status}</option>)}</select></div>
      <section className="conversion-section"><div className="conversion-title"><div><span>01</span><h3>Qualification</h3></div><small>Fit · need · intent · urgency · reachability</small></div><div className="qualification-grid">{([['fitScore','Fit'],['needScore','Need'],['intentScore','Intent'],['urgencyScore','Urgency'],['reachabilityScore','Reachability']] as const).map(([field, label]) => <label key={field}>{label}<select value={qualification[field]} onChange={(event) => setQualification({ ...qualification, [field]: Number(event.target.value) })}>{[0,25,50,75,100].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>)}</div><button className="section-save" disabled={busy} onClick={() => props.onPatch(qualification, `Qualification saved · ${qualificationLabel(scoredLead)}`)}>Save qualification</button></section>
      <section className="conversion-section"><div className="conversion-title"><div><span>02</span><h3>Discovery record</h3></div><small>Required before a proposal</small></div><div className="discovery-grid"><label>Business objective<textarea rows={2} value={discovery.businessObjective} onChange={(event) => setDiscovery({ ...discovery, businessObjective: event.target.value })} /></label><label>Main pain point<textarea rows={2} value={discovery.painPoint} onChange={(event) => setDiscovery({ ...discovery, painPoint: event.target.value })} /></label><label>Current provider<input value={discovery.currentProvider} onChange={(event) => setDiscovery({ ...discovery, currentProvider: event.target.value })} /></label><label>Decision-maker<input value={discovery.decisionMaker} onChange={(event) => setDiscovery({ ...discovery, decisionMaker: event.target.value })} /></label><label>Budget range<select value={discovery.budgetRange} onChange={(event) => setDiscovery({ ...discovery, budgetRange: event.target.value })}><option value="">Unknown</option><option>$1k–$3k</option><option>$3k–$7.5k</option><option>$7.5k–$15k</option><option>$15k+</option></select></label><label>Desired timeline<select value={discovery.desiredTimeline} onChange={(event) => setDiscovery({ ...discovery, desiredTimeline: event.target.value })}><option value="">Unknown</option><option>Within 30 days</option><option>1–3 months</option><option>3–6 months</option><option>Later / nurture</option></select></label><label className="span-two">Next committed step<input value={discovery.nextCommittedStep} placeholder="Specific action, owner, and date" onChange={(event) => setDiscovery({ ...discovery, nextCommittedStep: event.target.value })} /></label></div><button className="section-save" disabled={busy} onClick={() => props.onPatch(discovery, "Discovery record saved")}>Save discovery</button></section>
      <section className="conversion-section playbook"><div className="conversion-title"><div><span>03</span><h3>Discovery call playbook</h3></div><small>Use, don’t read word-for-word</small></div><div className="call-opening"><b>Opening</b><p>{playbook.opening}</p></div><ol>{playbook.questions.map((question) => <li key={question}>{question}</li>)}</ol></section>
      <section className="conversion-section"><div className="conversion-title"><div><span>04</span><h3>Follow-up sequence</h3></div><small>{lead.sequenceStatus}</small></div><div className="sequence-step"><span>Step {sequenceStep.step} of 5</span><strong>{sequenceStep.label}</strong><p>{sequenceStep.purpose}</p></div><div className="dual-actions">{lead.sequenceStatus === "Not started" ? <button disabled={busy} onClick={() => props.onPatch({ sequenceAction: "start" }, "Outreach sequence started")}>Start sequence</button> : <button disabled={busy || lead.sequenceStatus === "Completed"} onClick={() => props.onPatch({ sequenceAction: "advance" }, "Sequence advanced")}>Complete step and schedule next</button>}<button className="secondary" onClick={props.onCopyOutreach}>Copy evidence email</button></div></section>
      <section className="conversion-section"><div className="conversion-title"><div><span>05</span><h3>Objection coach</h3></div><small>Record what is actually blocking the deal</small></div><select className="full-select" value={discovery.objection} onChange={(event) => setDiscovery({ ...discovery, objection: event.target.value })}><option value="">Select objection</option>{Object.keys(objections).map((item) => <option key={item}>{item}</option>)}</select>{objectionResponse && <div className="objection-response"><p>{objectionResponse}</p><button onClick={copyObjectionResponse}>Copy response</button></div>}<button className="section-save" disabled={busy} onClick={() => props.onPatch({ objection: discovery.objection }, "Objection recorded")}>Save objection</button></section>
      <section className="conversion-section proposal-builder"><div className="conversion-title"><div><span>06</span><h3>Proposal</h3></div><small>Evidence → scope → decision</small></div>{proposal ? <div className="proposal-status"><div><span className={`proposal-state-pill ${proposal.status.toLowerCase()}`}>{proposal.status}</span><strong>{proposal.title}</strong><p>${proposal.price.toLocaleString("en-US")} · {proposal.timeline} · {proposal.viewCount} view{proposal.viewCount === 1 ? "" : "s"}</p></div><div className="dual-actions"><button onClick={copyProposal}>Copy proposal link</button><a href={`/proposal/${proposal.token}`} target="_blank" rel="noreferrer">Open proposal ↗</a></div><button className="refresh-proposal" onClick={props.onRefresh}>Refresh views and acceptance</button></div> : <><label>Offer<select value={offerId} onChange={(event) => { const next = offerCatalog.find((item) => item.id === event.target.value)!; setOfferId(next.id); setProposalPrice(next.price); setProposalTimeline(next.timeline); }}>{offerCatalog.map((offer) => <option key={offer.id} value={offer.id}>{offer.name}</option>)}</select></label><div className="proposal-inputs"><label>Investment<input type="number" min="500" step="100" value={proposalPrice} onChange={(event) => setProposalPrice(Number(event.target.value))} /></label><label>Timeline<input value={proposalTimeline} onChange={(event) => setProposalTimeline(event.target.value)} /></label></div><div className="offer-preview"><strong>{selectedOffer.outcome}</strong><ul>{selectedOffer.deliverables.map((item) => <li key={item}>{item}</li>)}</ul><p>{selectedOffer.proof}</p></div><button className="generate-proposal" disabled={busy || !lead.score} onClick={() => generateProposal().catch((error) => alert(error.message))}>{lead.score ? "Generate trackable proposal" : "Run audit before proposal"}</button></>}</section>
      </div></details>
      </>}
    </>}

    {tab === "audit" && <><div className="detail-actions three"><button onClick={props.onCopyOutreach}>Copy email</button><button className="gmail-button" onClick={props.onOpenGmail}>Open Gmail</button><a href={`/report/${lead.reportToken}`} target="_blank" rel="noreferrer">Open brief ↗</a></div>{opportunity && <div className="opportunity-card"><div className="opportunity-head"><span>Sales opportunity</span><strong>{opportunity.priorityScore}<small>/100</small></strong></div><h3>{opportunity.recommendedOffer}</h3><p>{opportunity.expectedOutcome}</p><div className="opportunity-meta"><span>{opportunity.priorityLabel}</span><span>{opportunity.scope}</span>{pagesAudited > 0 && <span>{pagesAudited} pages audited</span>}</div><div className="evidence-callout"><b>Lead with</b><span>{opportunity.primaryFinding}</span></div></div>}<div className="audit-summary"><div className="audit-score"><span className={`score-ring ${scoreTone(lead.score)}`}>{lead.score || "—"}</span><span><strong>Digital readiness</strong><small>{lead.lastAuditAt ? `Audited ${friendlyDate(lead.lastAuditAt)}` : "Audit not run"}</small></span></div><div className="score-lines">{[["Visibility", lead.visibilityScore], ["Conversion", lead.conversionScore], ["Technical", lead.technicalScore], ["Trust", lead.trustScore]].map(([label, value]) => <div key={label}><span>{label}</span><i><b style={{ width: `${value}%` }} /></i><strong>{value || "—"}</strong></div>)}</div><button className="audit-button" disabled={busy} onClick={props.onAudit}>{busy ? "Auditing up to 5 pages…" : lead.score ? "Run fresh multi-page audit" : "Run multi-page website audit"}</button></div>{findings.length > 0 && <div className="findings-preview"><h3>Best evidence</h3>{findings.slice(0, 3).map((finding) => <article key={`${finding.title}-${finding.sortOrder}`}><span className={`finding-dot ${finding.severity.toLowerCase()}`} /><div><strong>{finding.title}</strong><p>{finding.evidence}</p></div></article>)}</div>}<div className="contact-block"><h3>Contact & industry</h3><div className="contact-edit"><input aria-label="Contact name" placeholder="Contact name" value={contact.contactName} onChange={(event) => setContact({ ...contact, contactName: event.target.value })} /><input aria-label="Email" type="email" placeholder="Email" value={contact.email} onChange={(event) => setContact({ ...contact, email: event.target.value })} /><input aria-label="Phone" placeholder="Phone" value={contact.phone} onChange={(event) => setContact({ ...contact, phone: event.target.value })} /><input aria-label="Industry" placeholder="Industry" value={contact.carrier} onChange={(event) => setContact({ ...contact, carrier: event.target.value })} /><button disabled={busy} onClick={() => props.onPatch(contact, "Contact details saved")}>Save contact</button></div><a className="website-link" href={lead.website} target="_blank" rel="noreferrer">{lead.website.replace(/^https?:\/\//, "")} ↗</a></div></>}

    {tab === "activity" && <><div className="workflow-block"><h3>Next follow-up</h3><div className="inline-save"><input type="datetime-local" value={followUp} onChange={(event) => setFollowUp(event.target.value)} /><button disabled={busy} onClick={() => props.onPatch({ nextFollowUpAt: followUp ? new Date(followUp).toISOString() : null }, "Follow-up saved")}>Save</button></div></div><div className="workflow-block"><h3>Sales notes</h3><textarea rows={5} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Decision maker, pain points, objections, next step…" /><button className="save-notes" disabled={busy || notes === lead.notes} onClick={() => props.onPatch({ notes }, "Notes saved")}>Save notes</button></div>{lead.status === "Lost" && <div className="workflow-block"><h3>Loss reason</h3><select className="full-select" value={discovery.lossReason} onChange={(event) => setDiscovery({ ...discovery, lossReason: event.target.value })}><option value="">Select reason</option><option>Price</option><option>Existing provider</option><option>No urgency</option><option>No decision access</option><option>Timing</option><option>Service mismatch</option><option>No response</option></select><button className="section-save" onClick={() => props.onPatch({ lossReason: discovery.lossReason }, "Loss reason saved")}>Save reason</button></div>}<div className="activity-block"><div className="section-title"><h3>Recent activity</h3></div>{activities.length ? <ol className="timeline">{activities.slice(0, 14).map((activity, index) => <li className={index === 0 ? "hot" : ""} key={activity.id}><i /><div><strong>{activity.description}</strong><span>{friendlyDate(activity.createdAt)}</span></div></li>)}</ol> : <p className="activity-empty">No activity yet.</p>}</div></>}
  </aside>;
}
