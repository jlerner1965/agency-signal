"use client";

import { FormEvent, useEffect, useState } from "react";
import type { Finding, PublicOpportunity, PublicReportLead } from "@/lib/types";
import EngineReport, { type EngineReport as EngineReportData } from "./engine-report";

type ReportPayload = { lead: PublicReportLead; findings: Finding[]; opportunity: PublicOpportunity; audit: { pagesAudited: number; confidenceScore: number; checksPassed: number; checksFailed: number; checksUnverified: number; screenshotKey: string; createdAt: string } | null; auditComparison: { scoreDelta: number; resolved: string[]; regressed: string[] } | null; competitors: Array<{ id: number; name: string; website: string; score: number; visibilityScore: number; conversionScore: number; technicalScore: number; trustScore: number; confidenceScore: number; pagesAudited: number; screenshotKey: string }>; engine: EngineReportData | null };

export default function ReportView({ token, ownerName }: { token: string; ownerName: string }) {
  const ownerFirstName = ownerName.split(/\s+/)[0];
  const [payload, setPayload] = useState<ReportPayload | null>(null);
  const [error, setError] = useState("");
  const [requestState, setRequestState] = useState<"idle" | "sending" | "sent">("idle");
  const [requestError, setRequestError] = useState("");

  useEffect(() => {
    fetch(`/api/reports/${encodeURIComponent(token)}`)
      .then(async (response) => {
        const report = await response.json();
        if (!response.ok) throw new Error(report.error || "Report unavailable");
        return report as ReportPayload;
      })
      .then(setPayload)
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Report unavailable"));
  }, [token]);

  async function requestReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRequestState("sending");
    setRequestError("");
    const body = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      const response = await fetch(`/api/reports/${encodeURIComponent(token)}/inquiry`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Request could not be sent");
      setRequestState("sent");
    } catch (reason) {
      setRequestState("idle");
      setRequestError(reason instanceof Error ? reason.message : "Request could not be sent");
    }
  }

  if (error) {
    return (
      <main className="report-state">
        <div className="brand-lockup"><span className="brand-mark">A</span><span>AgencySignal</span></div>
        <section><p className="eyebrow">Secure report</p><h1>We couldn’t open this report.</h1><p>{error}. Check that the complete link was copied from the sender.</p></section>
      </main>
    );
  }

  if (!payload) {
    return (
      <main className="report-state loading-report">
        <div className="brand-lockup"><span className="brand-mark">A</span><span>AgencySignal</span></div>
        <section><span className="report-loader" /><p>Loading verified findings…</p></section>
      </main>
    );
  }

  const { lead, findings, opportunity, audit, auditComparison, competitors, engine } = payload;
  const scoreLabel = lead.score < 55 ? "Needs attention" : lead.score < 70 ? "Opportunity identified" : "Solid foundation";

  // A finished engine run is authoritative. The legacy sections below remain
  // only until that path retires.
  if (engine) {
    return (
      <main className="report-shell">
        <header className="report-nav"><div className="brand-lockup"><span className="brand-mark">A</span><span>AgencySignal</span></div><span className="confidential">Private digital opportunity brief</span></header>
        <section className="report-hero">
          <div className="report-container report-hero-grid">
            <div>
              <p className="eyebrow">Prepared for {lead.contactName || lead.agencyName}</p>
              <h1>{lead.agencyName}<br /><span>Digital Opportunity Brief</span></h1>
              <p className="report-intro">A review of what this business publicly sells, what its Google presence represents, and where the two do not match.</p>
            </div>
          </div>
        </section>
        <EngineReport report={engine} businessName={lead.agencyName} />
        <section className="report-cta"><div className="report-container report-cta-inner">
          <div>
            <p className="eyebrow">Recommended next step</p>
            <h2>Review the findings together in 15 minutes.</h2>
            <p>I&rsquo;ll explain which changes are worth prioritising, what can be fixed quickly, and where a larger rebuild would actually be justified.</p>
          </div>
          {requestState === "sent"
            ? <div className="request-success" role="status"><strong>Request received.</strong><span>{ownerFirstName} will follow up using the email you provided.</span></div>
            : <form className="review-form" onSubmit={requestReview}>
                <label>Your name<input name="name" autoComplete="name" required /></label>
                <label>Email<input name="email" type="email" autoComplete="email" required /></label>
                <label className="span-two">What would you like to discuss?<textarea name="message" rows={3} placeholder="Optional" /></label>
                {requestError && <p className="form-error">{requestError}</p>}
                <button className="report-primary span-two" disabled={requestState === "sending"}>{requestState === "sending" ? "Sending…" : "Request a review"}</button>
              </form>}
        </div></section>
        <footer className="report-footer"><div className="report-container"><div className="brand-lockup"><span className="brand-mark">A</span><span>AgencySignal</span></div><p>Evidence-led digital opportunity briefs for growing businesses.</p><span>Prepared by {ownerName}</span></div></footer>
      </main>
    );
  }
  return (
    <main className="report-shell">
      <header className="report-nav"><div className="brand-lockup"><span className="brand-mark">A</span><span>AgencySignal</span></div><span className="confidential">Private digital opportunity brief</span></header>
      <section className="report-hero">
        <div className="report-container report-hero-grid">
          <div><p className="eyebrow">Prepared for {lead.contactName || lead.agencyName}</p><h1>{lead.agencyName}<br /><span>Digital Opportunity Brief</span></h1><p className="report-intro">A focused review of the public website experience, designed to surface the changes most likely to improve visibility, trust and lead conversion.</p><div className="report-meta"><span>Website <strong>{lead.website.replace(/^https?:\/\//, "")}</strong></span><span>Market <strong>{lead.city}, {lead.state}</strong></span><span>Review status <strong>Evidence verified</strong></span></div></div>
          <div className="report-score-card"><span className="score-caption">Digital readiness</span><strong>{lead.score}<small>/100</small></strong><span className="score-assessment">{scoreLabel}</span><p>This score summarizes publicly observable website signals. It is not a search-ranking guarantee.</p></div>
        </div>
      </section>
      <section className="report-container report-summary">
        <div className="report-section-heading"><p className="eyebrow">Executive summary</p><h2>{findings.length ? `${Math.min(findings.length, 3)} improvements deserve attention first.` : "Your website review is ready."}</h2><p>The recommendations below are tied to observable page evidence. No internal account access was used.</p></div>
        {audit && <div className="report-audit-method"><article><span>Pages inspected</span><strong>{audit.pagesAudited}</strong></article><article><span>Evidence confidence</span><strong>{audit.confidenceScore}/100</strong></article><article><span>Checks passed</span><strong>{audit.checksPassed}</strong></article><article><span>Checks needing work</span><strong>{audit.checksFailed}</strong></article><p>Scores are earned from visible evidence. {audit.checksUnverified} check{audit.checksUnverified === 1 ? " was" : "s were"} not available and did not earn points.</p></div>}
        <div className="report-score-grid">
          {[["Visibility", lead.visibilityScore], ["Conversion", lead.conversionScore], ["Technical", lead.technicalScore], ["Trust", lead.trustScore]].map(([label, value]) => <article key={label}><div><span>{label}</span><strong>{value}</strong></div><i><b style={{ width: `${value}%` }} /></i></article>)}
        </div>
        {(audit?.screenshotKey || auditComparison) && <div className="report-proof-row">{audit?.screenshotKey && <figure><img src={`/api/audit-screenshots/${audit.screenshotKey}`} alt={`Rendered mobile page for ${lead.agencyName}`} /><figcaption><strong>Rendered mobile evidence</strong><span>Captured during the automated Lighthouse review.</span></figcaption></figure>}{auditComparison && <article><p className="eyebrow">Progress since prior audit</p><strong>{auditComparison.scoreDelta > 0 ? "+" : ""}{auditComparison.scoreDelta} points</strong>{auditComparison.resolved.length > 0 && <p><b>Resolved:</b> {auditComparison.resolved.join(" · ")}</p>}{auditComparison.regressed.length > 0 && <p><b>Needs renewed attention:</b> {auditComparison.regressed.join(" · ")}</p>}</article>}</div>}
      </section>
      {competitors.length > 0 && <section className="report-competitors"><div className="report-container"><div className="report-section-heading compact"><p className="eyebrow">Competitive benchmark</p><h2>How the website compares with alternatives.</h2><p>Each website was reviewed with the same evidence model. This comparison does not claim search position or business quality.</p></div><div className="report-competitor-grid"><article className="primary"><span>Your website</span><h3>{lead.agencyName}</h3><strong>{lead.score}</strong><div><small>Visibility {lead.visibilityScore}</small><small>Conversion {lead.conversionScore}</small><small>Technical {lead.technicalScore}</small><small>Trust {lead.trustScore}</small></div></article>{competitors.map((item) => <article key={item.id}>{item.screenshotKey && <img src={`/api/audit-screenshots/${item.screenshotKey}`} alt={`Rendered mobile page for ${item.name}`} />}<span>Competitor</span><h3>{item.name}</h3><strong>{item.score}</strong><div><small>Visibility {item.visibilityScore}</small><small>Conversion {item.conversionScore}</small><small>Technical {item.technicalScore}</small><small>Trust {item.trustScore}</small></div></article>)}</div></div></section>}
      <section className="report-opportunity"><div className="report-container report-opportunity-grid"><div><p className="eyebrow">Recommended implementation path</p><h2>{opportunity.recommendedOffer}</h2><p>{opportunity.expectedOutcome}</p></div><div className="report-offer-card"><span>Primary opportunity</span><strong>{opportunity.primaryService}</strong><p>{opportunity.primaryFinding}</p><small>{opportunity.scope}</small></div></div></section>
      <section className="findings-section"><div className="report-container"><div className="report-section-heading compact"><p className="eyebrow">Detailed findings</p><h2>What we found—and what to do next.</h2><p>{findings.length} evidence-backed improvement{findings.length === 1 ? "" : "s"}, ordered by severity.</p></div><div className="findings-list">{findings.map((finding, index) => <article className="finding-card" key={`${finding.title}-${index}`}><div className="finding-index">{String(index + 1).padStart(2, "0")}</div><div className="finding-main"><div className="finding-tags"><span>{finding.category}</span><span className={`severity ${finding.severity.toLowerCase()}`}>{finding.severity} priority</span></div><h3>{finding.title}</h3><div className="finding-columns"><div><h4>Evidence</h4><p>{finding.evidence}</p></div><div><h4>Recommended change</h4><p>{finding.recommendation}</p></div><div><h4>Why it matters</h4><p>{finding.impact}</p></div></div><a href={finding.affectedUrl} target="_blank" rel="noreferrer">Audited page ↗</a></div></article>)}</div></div></section>
      <section className="report-cta"><div className="report-container report-cta-inner"><div><p className="eyebrow">Recommended next step</p><h2>Review the findings together in 15 minutes.</h2><p>I’ll explain which changes are worth prioritizing, what can be fixed quickly and where a larger redesign would actually be justified.</p></div>{requestState === "sent" ? <div className="request-success" role="status"><strong>Request received.</strong><span>{ownerFirstName} will follow up using the email you provided.</span></div> : <form className="review-form" onSubmit={requestReview}><label>Your name<input name="name" autoComplete="name" required /></label><label>Email<input name="email" type="email" autoComplete="email" required /></label><label className="span-two">What would you like to discuss?<textarea name="message" rows={3} placeholder="Optional" /></label>{requestError && <p className="form-error">{requestError}</p>}<button className="report-primary span-two" disabled={requestState === "sending"}>{requestState === "sending" ? "Sending…" : "Request a review"}</button></form>}</div></section>
      <footer className="report-footer"><div className="report-container"><div className="brand-lockup"><span className="brand-mark">A</span><span>AgencySignal</span></div><p>Evidence-led digital opportunity briefs for growing businesses.</p><span>Prepared by {ownerName}</span></div></footer>
    </main>
  );
}
