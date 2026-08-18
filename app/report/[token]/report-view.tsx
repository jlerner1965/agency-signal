"use client";

import { FormEvent, useEffect, useState } from "react";
import type { Finding, Opportunity, PublicReportLead } from "@/lib/types";

type ReportPayload = { lead: PublicReportLead; findings: Finding[]; opportunity: Opportunity };

export default function ReportView({ token }: { token: string }) {
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

  const { lead, findings, opportunity } = payload;
  const scoreLabel = lead.score < 55 ? "Needs attention" : lead.score < 70 ? "Opportunity identified" : "Solid foundation";
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
        <div className="report-score-grid">
          {[["Visibility", lead.visibilityScore], ["Conversion", lead.conversionScore], ["Technical", lead.technicalScore], ["Trust", lead.trustScore]].map(([label, value]) => <article key={label}><div><span>{label}</span><strong>{value}</strong></div><i><b style={{ width: `${value}%` }} /></i></article>)}
        </div>
      </section>
      <section className="report-opportunity"><div className="report-container report-opportunity-grid"><div><p className="eyebrow">Recommended implementation path</p><h2>{opportunity.recommendedOffer}</h2><p>{opportunity.expectedOutcome}</p></div><div className="report-offer-card"><span>Primary opportunity</span><strong>{opportunity.primaryService}</strong><p>{opportunity.primaryFinding}</p><small>{opportunity.scope}</small></div></div></section>
      <section className="findings-section"><div className="report-container"><div className="report-section-heading compact"><p className="eyebrow">Priority findings</p><h2>What we found—and what to do next.</h2></div><div className="findings-list">{findings.slice(0, 5).map((finding, index) => <article className="finding-card" key={`${finding.title}-${index}`}><div className="finding-index">0{index + 1}</div><div className="finding-main"><div className="finding-tags"><span>{finding.category}</span><span className={`severity ${finding.severity.toLowerCase()}`}>{finding.severity} priority</span></div><h3>{finding.title}</h3><div className="finding-columns"><div><h4>Evidence</h4><p>{finding.evidence}</p></div><div><h4>Recommended change</h4><p>{finding.recommendation}</p></div><div><h4>Why it matters</h4><p>{finding.impact}</p></div></div><a href={finding.affectedUrl} target="_blank" rel="noreferrer">Audited page ↗</a></div></article>)}</div></div></section>
      <section className="report-cta"><div className="report-container report-cta-inner"><div><p className="eyebrow">Recommended next step</p><h2>Review the findings together in 15 minutes.</h2><p>I’ll explain which changes are worth prioritizing, what can be fixed quickly and where a larger redesign would actually be justified.</p></div>{requestState === "sent" ? <div className="request-success" role="status"><strong>Request received.</strong><span>James will follow up using the email you provided.</span></div> : <form className="review-form" onSubmit={requestReview}><label>Your name<input name="name" autoComplete="name" required /></label><label>Email<input name="email" type="email" autoComplete="email" required /></label><label className="span-two">What would you like to discuss?<textarea name="message" rows={3} placeholder="Optional" /></label>{requestError && <p className="form-error">{requestError}</p>}<button className="report-primary span-two" disabled={requestState === "sending"}>{requestState === "sending" ? "Sending…" : "Request a review"}</button></form>}</div></section>
      <footer className="report-footer"><div className="report-container"><div className="brand-lockup"><span className="brand-mark">A</span><span>AgencySignal</span></div><p>Evidence-led digital opportunity briefs for growing businesses.</p><span>Prepared by James Lerner</span></div></footer>
    </main>
  );
}
