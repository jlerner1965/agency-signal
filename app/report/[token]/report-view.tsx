"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { sampleFindings, sampleLeads } from "@/lib/sample-data";
import type { Finding, Lead } from "@/lib/types";

type ReportPayload = { lead: Lead; findings: Finding[] };

export default function ReportView({ token }: { token: string }) {
  const fallbackLead = sampleLeads.find((item) => item.reportToken === token) ?? sampleLeads[0];
  const [payload, setPayload] = useState<ReportPayload>({ lead: fallbackLead, findings: sampleFindings });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch(`/api/reports/${encodeURIComponent(token)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("Report unavailable");
        return response.json();
      })
      .then((report) => setPayload({ lead: report.lead, findings: report.findings?.length ? report.findings : sampleFindings }))
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, [token]);

  const { lead, findings } = payload;
  const scoreLabel = lead.score < 55 ? "Needs attention" : lead.score < 70 ? "Opportunity identified" : "Solid foundation";
  return (
    <main className="report-shell">
      <header className="report-nav"><Link href="/" className="brand-lockup"><span className="brand-mark">A</span><span>AgencySignal</span></Link><span className="confidential">Private digital opportunity brief</span></header>
      <section className="report-hero">
        <div className="report-container report-hero-grid">
          <div><p className="eyebrow">Prepared for {lead.contactName || lead.agencyName}</p><h1>{lead.agencyName}<br /><span>Digital Opportunity Brief</span></h1><p className="report-intro">A focused review of the public website experience, designed to surface the changes most likely to improve visibility, trust and lead conversion.</p><div className="report-meta"><span>Website <strong>{lead.website.replace(/^https?:\/\//, "")}</strong></span><span>Market <strong>{lead.city}, {lead.state}</strong></span><span>Review status <strong>{loaded ? "Evidence verified" : "Loading evidence"}</strong></span></div></div>
          <div className="report-score-card"><span className="score-caption">Digital readiness</span><strong>{lead.score || 58}<small>/100</small></strong><span className="score-assessment">{scoreLabel}</span><p>This score summarizes publicly observable website signals. It is not a search-ranking guarantee.</p></div>
        </div>
      </section>
      <section className="report-container report-summary">
        <div className="report-section-heading"><p className="eyebrow">Executive summary</p><h2>Three improvements deserve attention first.</h2><p>The recommendations below are tied to observable page evidence. No internal account access was used.</p></div>
        <div className="report-score-grid">
          {[ ["Visibility", lead.visibilityScore || 44], ["Conversion", lead.conversionScore || 52], ["Technical", lead.technicalScore || 72], ["Trust", lead.trustScore || 67] ].map(([label, value]) => <article key={label}><div><span>{label}</span><strong>{value}</strong></div><i><b style={{ width: `${value}%` }} /></i></article>)}
        </div>
      </section>
      <section className="findings-section"><div className="report-container"><div className="report-section-heading compact"><p className="eyebrow">Priority findings</p><h2>What we found—and what to do next.</h2></div><div className="findings-list">{findings.slice(0, 5).map((finding, index) => <article className="finding-card" key={`${finding.title}-${index}`}><div className="finding-index">0{index + 1}</div><div className="finding-main"><div className="finding-tags"><span>{finding.category}</span><span className={`severity ${finding.severity.toLowerCase()}`}>{finding.severity} priority</span></div><h3>{finding.title}</h3><div className="finding-columns"><div><h4>Evidence</h4><p>{finding.evidence}</p></div><div><h4>Recommended change</h4><p>{finding.recommendation}</p></div><div><h4>Why it matters</h4><p>{finding.impact}</p></div></div><a href={finding.affectedUrl} target="_blank" rel="noreferrer">Audited page ↗</a></div></article>)}</div></div></section>
      <section className="report-cta"><div className="report-container report-cta-inner"><div><p className="eyebrow">Recommended next step</p><h2>Review the findings together in 15 minutes.</h2><p>I’ll explain which changes are worth prioritizing, what can be fixed quickly and where a larger redesign would actually be justified.</p></div><div className="cta-actions"><a className="report-primary" href="mailto:james@example.com?subject=Digital%20opportunity%20brief">Request a review</a><a className="report-secondary" href={`mailto:james@example.com?subject=Implementation%20quote%20for%20${encodeURIComponent(lead.agencyName)}`}>Request implementation quote</a></div></div></section>
      <footer className="report-footer"><div className="report-container"><div className="brand-lockup"><span className="brand-mark">A</span><span>AgencySignal</span></div><p>Evidence-led digital audits for local insurance agencies.</p><span>Prepared by James Lerner</span></div></footer>
    </main>
  );
}
