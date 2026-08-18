"use client";

import type { Lead } from "@/lib/types";
import { revenueMetrics } from "@/lib/sales";

function money(value: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value); }

export default function RevenueDashboard({ leads, onOpen }: { leads: Lead[]; onOpen: (lead: Lead) => void }) {
  const metrics = revenueMetrics(leads);
  const stages = ["Identified", "Audited", "Contacted", "Replied", "Discovery scheduled", "Qualified", "Proposal sent", "Decision pending", "Won"];
  const stageCounts = stages.map((stage) => ({ stage, count: leads.filter((lead) => lead.status === stage).length }));
  const max = Math.max(1, ...stageCounts.map((item) => item.count));
  const dealRows = leads.filter((lead) => lead.dealValue > 0 || ["Qualified", "Proposal sent", "Decision pending", "Won"].includes(lead.status)).sort((a, b) => (b.dealValue || 0) - (a.dealValue || 0));
  const losses = Object.entries(leads.filter((lead) => lead.status === "Lost").reduce<Record<string, number>>((totals, lead) => { const key = lead.lossReason || "Not recorded"; totals[key] = (totals[key] || 0) + 1; return totals; }, {})).sort((a, b) => b[1] - a[1]);

  return <div className="revenue-dashboard">
    <section className="revenue-metrics"><article><span>Open pipeline</span><strong>{money(metrics.pipelineValue)}</strong><small>{metrics.active} active opportunities</small></article><article><span>Qualified</span><strong>{metrics.qualified}</strong><small>Discovery completed</small></article><article><span>Proposals</span><strong>{metrics.proposals}</strong><small>{metrics.closeRate}% proposal close rate</small></article><article className="won"><span>Revenue won</span><strong>{money(metrics.revenue)}</strong><small>{metrics.won} signed customer{metrics.won === 1 ? "" : "s"}</small></article></section>
    <div className="revenue-grid"><section className="funnel-card"><div className="card-heading"><div><p className="eyebrow">Conversion funnel</p><h2>Where opportunities are moving—or stalling</h2></div></div><div className="funnel-list">{stageCounts.map((item) => <div key={item.stage}><span>{item.stage}</span><i><b style={{ width: `${Math.max(3, (item.count / max) * 100)}%` }} /></i><strong>{item.count}</strong></div>)}</div></section><section className="loss-card"><div className="card-heading"><p className="eyebrow">Loss intelligence</p><h2>Why deals are lost</h2></div>{losses.length ? <ol>{losses.map(([reason, count]) => <li key={reason}><span>{reason}</span><strong>{count}</strong></li>)}</ol> : <p className="no-losses">No losses recorded yet. When a deal is marked Lost, AgencySignal requires the reason so the process can improve.</p>}</section></div>
    <section className="deal-table"><div className="card-heading"><div><p className="eyebrow">Deal desk</p><h2>Qualified and proposed work</h2></div><span>{dealRows.length} opportunities</span></div>{dealRows.length ? <table><thead><tr><th>Business</th><th>Stage</th><th>Qualification</th><th>Deal value</th><th>Next commitment</th></tr></thead><tbody>{dealRows.map((lead) => <tr key={lead.id} onClick={() => onOpen(lead)}><td><strong>{lead.agencyName}</strong><small>{lead.decisionMaker || lead.contactName || "Decision-maker needed"}</small></td><td><span className={`stage stage-${lead.status.toLowerCase().replaceAll(" ", "-")}`}>{lead.status}</span></td><td>{lead.qualificationStatus}</td><td>{money(lead.dealValue)}</td><td>{lead.nextCommittedStep || "Define next step"}</td></tr>)}</tbody></table> : <div className="empty-state"><strong>No qualified deals yet.</strong><span>Complete discovery and assign an offer to create a measurable pipeline.</span></div>}</section>
  </div>;
}
