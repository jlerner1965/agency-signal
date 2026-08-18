"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { sampleLeads } from "@/lib/sample-data";
import type { Lead, LeadStatus } from "@/lib/types";

const pipelineStatuses: LeadStatus[] = ["New", "Audit ready", "Contacted", "Report viewed", "Follow-up due", "Meeting booked", "Won", "Lost"];
const sectionMeta = {
  Pipeline: { eyebrow: "Sales workspace", title: "Agency pipeline", description: "Prioritize the agencies showing real buying signals." },
  Audits: { eyebrow: "Evidence desk", title: "Audit review", description: "Review evidence before a report reaches a prospect." },
  Engagement: { eyebrow: "Intent signals", title: "Report engagement", description: "See which prospects are returning to their reports." },
  Followups: { eyebrow: "Daily action", title: "Follow-ups", description: "Keep every promising conversation moving forward." },
} as const;
type Section = keyof typeof sectionMeta;

function initials(name: string) { return name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase(); }
function scoreTone(score: number) { return score === 0 ? "neutral" : score < 55 ? "critical" : score < 70 ? "watch" : "good"; }
function friendlyDate(value: string | null) {
  if (!value) return "Not scheduled";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}
function NavIcon({ label }: { label: string }) { return <span className="nav-icon" aria-hidden="true">{label}</span>; }

export default function Dashboard({ ownerName }: { ownerName: string }) {
  const [leads, setLeads] = useState<Lead[]>(sampleLeads);
  const [selectedId, setSelectedId] = useState(sampleLeads[0].id);
  const [section, setSection] = useState<Section>("Pipeline");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All stages");
  const [showAdd, setShowAdd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [dataMode, setDataMode] = useState<"loading" | "live" | "sample">("loading");

  useEffect(() => {
    fetch("/api/leads").then(async (response) => {
      if (!response.ok) throw new Error("Data unavailable");
      return response.json();
    }).then((payload) => {
      if (payload.leads?.length) { setLeads(payload.leads); setSelectedId(payload.leads[0].id); setDataMode("live"); }
    }).catch(() => setDataMode("sample"));
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 3200);
    return () => clearTimeout(timer);
  }, [toast]);

  const selected = selectedId === -1 ? undefined : leads.find((lead) => lead.id === selectedId) ?? leads[0];
  const filtered = useMemo(() => {
    let rows = leads;
    if (section === "Audits") rows = rows.filter((lead) => lead.status === "Audit ready" || lead.score === 0);
    if (section === "Engagement") rows = [...rows].filter((lead) => lead.reportViews > 0).sort((a, b) => b.reportViews - a.reportViews);
    if (section === "Followups") rows = rows.filter((lead) => lead.nextFollowUpAt || lead.status === "Follow-up due");
    if (statusFilter !== "All stages") rows = rows.filter((lead) => lead.status === statusFilter);
    const search = query.trim().toLowerCase();
    if (search) rows = rows.filter((lead) => `${lead.agencyName} ${lead.contactName} ${lead.city} ${lead.carrier}`.toLowerCase().includes(search));
    return rows;
  }, [leads, query, section, statusFilter]);
  const stats = useMemo(() => ({ total: leads.length, ready: leads.filter((lead) => lead.status === "Audit ready").length, engaged: leads.filter((lead) => lead.reportViews > 0).length, meetings: leads.filter((lead) => lead.status === "Meeting booked").length }), [leads]);

  function replaceLead(updated: Lead) { setLeads((current) => current.map((lead) => lead.id === updated.id ? updated : lead)); }
  async function updateStatus(status: LeadStatus) {
    if (!selected) return;
    replaceLead({ ...selected, status });
    try {
      const response = await fetch(`/api/leads/${selected.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) });
      if (response.ok) replaceLead((await response.json()).lead);
      setToast(`Moved to ${status}`);
    } catch { setToast("Stage updated for this session"); }
  }
  async function runAudit() {
    if (!selected || busy) return;
    setBusy(true); setToast("Inspecting the live website…");
    try {
      const response = await fetch("/api/audit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ leadId: selected.id, website: selected.website }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Audit failed");
      replaceLead(payload.lead); setToast(`Audit complete · score ${payload.lead.score}`);
    } catch (error) { setToast(error instanceof Error ? error.message : "Audit could not be completed"); }
    finally { setBusy(false); }
  }
  async function copyOutreach() {
    if (!selected) return;
    const biggestGap = selected.visibilityScore <= selected.conversionScore ? "local visibility" : "website conversion";
    const message = `Hi ${selected.contactName.split(" ")[0] || "there"},\n\nI reviewed ${selected.agencyName}’s website and found three specific opportunities, including a ${biggestGap} gap that may be making it harder for prospects to find or contact the agency.\n\nI put the findings into a short report: ${window.location.origin}/report/${selected.reportToken}\n\nBest,\nJames Lerner`;
    await navigator.clipboard.writeText(message); setToast("Personalized outreach copied");
  }
  async function addLead(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true);
    const body = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      const response = await fetch("/api/leads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to create lead");
      setLeads((current) => [payload.lead, ...current]); setSelectedId(payload.lead.id); setShowAdd(false); setToast("Lead added to the pipeline");
    } catch (error) { setToast(error instanceof Error ? error.message : "Lead could not be added"); }
    finally { setBusy(false); }
  }
  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.assign("/login");
  }

  const meta = sectionMeta[section];
  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup"><span className="brand-mark">A</span><span>AgencySignal</span></div>
        <div className="workspace-label"><span className="workspace-dot" /> Colorado insurance <span className="chevron">⌄</span></div>
        <nav className="primary-nav" aria-label="Primary navigation">
          <button className={section === "Pipeline" ? "active" : ""} onClick={() => setSection("Pipeline")}><NavIcon label="P" /> Pipeline <span className="nav-count">{stats.total}</span></button>
          <button className={section === "Audits" ? "active" : ""} onClick={() => setSection("Audits")}><NavIcon label="A" /> Audits <span className="nav-count">{stats.ready}</span></button>
          <button className={section === "Engagement" ? "active" : ""} onClick={() => setSection("Engagement")}><NavIcon label="E" /> Engagement <span className="nav-count">{stats.engaged}</span></button>
          <button className={section === "Followups" ? "active" : ""} onClick={() => setSection("Followups")}><NavIcon label="F" /> Follow-ups</button>
        </nav>
        <div className="sidebar-divider" /><div className="nav-kicker">Workspace</div>
        <nav className="secondary-nav" aria-label="Workspace navigation"><button><NavIcon label="T" /> Templates</button><button><NavIcon label="S" /> Scoring model</button><button><NavIcon label="⚙" /> Settings</button></nav>
        <div className="sidebar-bottom"><div className="coverage-card"><div className="coverage-head"><span>Weekly coverage</span><strong>68%</strong></div><div className="progress-track"><span style={{ width: "68%" }} /></div><p>17 of 25 target agencies audited</p></div><div className="user-row"><span className="avatar">JL</span><span><strong>{ownerName}</strong><small>Workspace owner</small></span><button aria-label="Sign out" title="Sign out" onClick={signOut}>↗</button></div></div>
      </aside>

      <section className="workspace">
        <header className="topbar"><div className="mobile-brand"><span className="brand-mark">A</span> AgencySignal</div><label className="global-search"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search agencies, contacts or cities" /><kbd>⌘ K</kbd></label><div className="top-actions"><span className={`sync-state ${dataMode}`}><i />{dataMode === "live" ? "Saved" : dataMode === "loading" ? "Connecting" : "Sample workspace"}</span><button className="quiet-button" aria-label="Notifications">○</button><button className="primary-button" onClick={() => setShowAdd(true)}>+ Add agency</button></div></header>
        <div className="workspace-content">
          <div className="page-heading"><div><p className="eyebrow">{meta.eyebrow}</p><h1>{meta.title}</h1><p>{meta.description}</p></div><div className="heading-actions"><button className="secondary-button" onClick={() => setToast("CSV import is ready for the next build")}>Import CSV</button><button className="primary-button" onClick={() => setShowAdd(true)}>Add agency</button></div></div>
          <section className="metrics-grid" aria-label="Pipeline summary">
            <article><div className="metric-label"><span>Total prospects</span><b className="trend positive">+12%</b></div><strong>{stats.total}</strong><p>Across the Colorado target list</p></article>
            <article><div className="metric-label"><span>Audits ready</span><b className="trend">Review</b></div><strong>{stats.ready}</strong><p>Waiting for your approval</p></article>
            <article><div className="metric-label"><span>Engaged reports</span><b className="trend positive">High intent</b></div><strong>{stats.engaged}</strong><p>Prospects who viewed findings</p></article>
            <article><div className="metric-label"><span>Meetings booked</span><b className="trend positive">This week</b></div><strong>{stats.meetings}</strong><p>Qualified sales conversations</p></article>
          </section>
          <section className="pipeline-card">
            <div className="table-toolbar"><div><h2>Priority agencies</h2><p>{filtered.length} records · sorted by recent activity</p></div><div className="table-controls"><select aria-label="Filter by pipeline stage" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option>All stages</option>{pipelineStatuses.map((status) => <option key={status}>{status}</option>)}</select><button className="icon-button" aria-label="More filters">≡</button></div></div>
            <div className="table-wrap"><table><thead><tr><th>Agency</th><th>Carrier</th><th>Audit score</th><th>Stage</th><th>Signal</th><th>Next action</th><th><span className="sr-only">Open</span></th></tr></thead><tbody>{filtered.map((lead) => (
              <tr key={lead.id} className={lead.id === selectedId ? "selected" : ""} onClick={() => setSelectedId(lead.id)}>
                <td><div className="agency-cell"><span className="agency-avatar">{initials(lead.agencyName)}</span><span><strong>{lead.agencyName}</strong><small>{lead.contactName} · {lead.city}, {lead.state}</small></span></div></td><td><span className="carrier-text">{lead.carrier}</span></td><td>{lead.score ? <span className={`score-badge ${scoreTone(lead.score)}`}><i style={{ "--score": `${lead.score * 3.6}deg` } as React.CSSProperties} />{lead.score}</span> : <span className="not-run">Not run</span>}</td><td><span className={`stage stage-${lead.status.toLowerCase().replaceAll(" ", "-")}`}>{lead.status}</span></td><td>{lead.reportViews ? <span className="signal"><i /> {lead.reportViews} view{lead.reportViews === 1 ? "" : "s"}</span> : <span className="muted">No activity</span>}</td><td><span className={lead.status === "Follow-up due" ? "due" : "next-action"}>{lead.nextFollowUpAt ? friendlyDate(lead.nextFollowUpAt) : lead.status === "Audit ready" ? "Review audit" : "Add follow-up"}</span></td><td><button className="row-open" aria-label={`Open ${lead.agencyName}`} onClick={(event) => { event.stopPropagation(); setSelectedId(lead.id); }}>›</button></td>
              </tr>))}</tbody></table>{!filtered.length && <div className="empty-state"><strong>No agencies match this view.</strong><span>Clear the search or choose another pipeline stage.</span></div>}</div>
          </section>
        </div>
      </section>

      {selected && <aside className="detail-panel"><div className="detail-top"><p>Prospect detail</p><button aria-label="Close prospect detail" onClick={() => setSelectedId(-1)}>×</button></div><div className="detail-identity"><span className="detail-avatar">{initials(selected.agencyName)}</span><div><h2>{selected.agencyName}</h2><p>{selected.carrier} · {selected.city}, {selected.state}</p></div></div><div className="detail-actions"><button onClick={copyOutreach}>Copy outreach</button><a href={`/report/${selected.reportToken}`} target="_blank" rel="noreferrer">Open report ↗</a></div><div className="stage-control"><label htmlFor="lead-stage">Pipeline stage</label><select id="lead-stage" value={selected.status} onChange={(event) => updateStatus(event.target.value as LeadStatus)}>{pipelineStatuses.map((status) => <option key={status}>{status}</option>)}</select></div><div className="audit-summary"><div className="audit-score"><span className={`score-ring ${scoreTone(selected.score)}`}>{selected.score || "—"}</span><span><strong>Digital readiness</strong><small>{selected.lastAuditAt ? `Audited ${friendlyDate(selected.lastAuditAt)}` : "Audit not run"}</small></span></div><div className="score-lines">{[["Visibility", selected.visibilityScore], ["Conversion", selected.conversionScore], ["Technical", selected.technicalScore], ["Trust", selected.trustScore]].map(([label, value]) => <div key={label}><span>{label}</span><i><b style={{ width: `${value}%` }} /></i><strong>{value || "—"}</strong></div>)}</div><button className="audit-button" disabled={busy} onClick={runAudit}>{busy ? "Inspecting website…" : selected.score ? "Run fresh website audit" : "Run website audit"}</button><p className="audit-note">Checks public homepage evidence only. Review findings before outreach.</p></div><div className="contact-block"><h3>Contact</h3><dl><div><dt>Contact</dt><dd>{selected.contactName || "Not added"}</dd></div><div><dt>Email</dt><dd>{selected.email || "Not added"}</dd></div><div><dt>Phone</dt><dd>{selected.phone || "Not added"}</dd></div><div><dt>Website</dt><dd><a href={selected.website} target="_blank" rel="noreferrer">{selected.website.replace(/^https?:\/\//, "")}</a></dd></div></dl></div><div className="activity-block"><div className="section-title"><h3>Recent activity</h3><button>View all</button></div><ol className="timeline"><li className="hot"><i /><div><strong>{selected.reportViews ? `Report viewed ${selected.reportViews} times` : "No report engagement yet"}</strong><span>{selected.reportViews ? "High-intent signal" : "Send the approved report to begin tracking"}</span></div></li><li><i /><div><strong>{selected.lastAuditAt ? "Website audit completed" : "Audit waiting to run"}</strong><span>{selected.lastAuditAt ? `Score ${selected.score} · evidence saved` : "Ready when you are"}</span></div></li><li><i /><div><strong>Lead added</strong><span>{selected.city}, Colorado target list</span></div></li></ol></div></aside>}

      {showAdd && <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowAdd(false)}><section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="add-title" onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><p className="eyebrow">New prospect</p><h2 id="add-title">Add an agency</h2></div><button onClick={() => setShowAdd(false)} aria-label="Close">×</button></div><form onSubmit={addLead}><div className="form-grid"><label className="span-two">Agency name<input name="agencyName" required placeholder="Front Range Insurance" /></label><label>Contact name<input name="contactName" placeholder="Sarah Mitchell" /></label><label>Carrier<select name="carrier"><option>State Farm</option><option>Allstate</option><option>Farmers</option><option>Independent</option></select></label><label>City<input name="city" required placeholder="Fort Collins" /></label><label>State<input name="state" defaultValue="CO" maxLength={2} /></label><label className="span-two">Website<input name="website" required inputMode="url" placeholder="https://agency.com" /></label><label>Email<input name="email" type="email" placeholder="agent@agency.com" /></label><label>Phone<input name="phone" type="tel" placeholder="+1 (303) 555-0100" /></label></div><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setShowAdd(false)}>Cancel</button><button className="primary-button" disabled={busy}>{busy ? "Adding…" : "Add to pipeline"}</button></div></form></section></div>}
      {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
    </main>
  );
}
