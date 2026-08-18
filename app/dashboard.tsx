"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { parseLeadCsv } from "@/lib/csv-leads";
import { buildDailyQueue, filterLeadRows, nextLeadAction } from "@/lib/lead-search";
import { buildOpportunity } from "@/lib/opportunity";
import { qualificationBreakdown, qualificationLabel, salesStages } from "@/lib/sales";
import type { Activity, Finding, Lead, LeadStatus, Opportunity, Proposal } from "@/lib/types";
import ProspectDetail from "./prospect-detail";

const pipelineStatuses = salesStages as LeadStatus[];
const sectionMeta = {
  Today: { eyebrow: "Daily execution", title: "Today’s action queue", description: "Work the prospects most likely to move forward right now." },
  Pipeline: { eyebrow: "Sales workspace", title: "Business pipeline", description: "Turn website opportunities into relevant sales conversations." },
  Audits: { eyebrow: "Evidence desk", title: "Audit review", description: "Find credible, specific reasons to contact each business." },
  Engagement: { eyebrow: "Intent signals", title: "Report engagement", description: "Prioritize prospects who are reading their opportunity briefs." },
  Followups: { eyebrow: "Daily action", title: "Follow-ups", description: "Keep every promising conversation moving toward a meeting." },
} as const;
type Section = keyof typeof sectionMeta;

function initials(name: string) { return name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase(); }
function scoreTone(score: number) { return score === 0 ? "neutral" : score < 55 ? "critical" : score < 70 ? "watch" : "good"; }
function qualificationResultTone(score: number) { return score >= 70 ? "high-priority" : score >= 55 ? "strong-opportunity" : "develop"; }
function friendlyDate(value: string | null) {
  if (!value) return "Not scheduled";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}
function inputDate(value: string | null) {
  if (!value) return "";
  const date = new Date(value); const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
function NavIcon({ label }: { label: string }) { return <span className="nav-icon" aria-hidden="true">{label}</span>; }

export default function Dashboard({ ownerName }: { ownerName: string }) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selectedId, setSelectedId] = useState(-1);
  const [section, setSection] = useState<Section>("Today");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All stages");
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importRows, setImportRows] = useState<Record<string, string>[]>([]);
  const [importFile, setImportFile] = useState("");
  const [activities, setActivities] = useState<Activity[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [opportunity, setOpportunity] = useState<Opportunity | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [pagesAudited, setPagesAudited] = useState(0);
  const [selectedLeadIds, setSelectedLeadIds] = useState<number[]>([]);
  const [batchState, setBatchState] = useState({ complete: 0, total: 0, failed: 0, current: "" });
  const [notes, setNotes] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [contactDraft, setContactDraft] = useState({ contactName: "", email: "", phone: "", carrier: "" });
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [dataMode, setDataMode] = useState<"loading" | "live" | "error">("loading");
  const searchRef = useRef<HTMLInputElement>(null);

  async function loadLeads(preferredId?: number) {
    try {
      const response = await fetch("/api/leads");
      if (!response.ok) throw new Error("Data unavailable");
      const payload = await response.json();
      const rows = (payload.leads ?? []) as Lead[];
      setLeads(rows); setDataMode("live");
      const next = rows.find((lead) => lead.id === preferredId) ?? rows[0];
      setSelectedId(next?.id ?? -1); setNotes(next?.notes ?? ""); setFollowUp(inputDate(next?.nextFollowUpAt ?? null));
      setContactDraft({ contactName: next?.contactName ?? "", email: next?.email ?? "", phone: next?.phone ?? "", carrier: next?.carrier ?? "" });
    } catch { setDataMode("error"); }
  }

  useEffect(() => {
    fetch("/api/leads").then(async (response) => {
      if (!response.ok) throw new Error("Data unavailable");
      return response.json();
    }).then((payload) => {
      const rows = (payload.leads ?? []) as Lead[];
      const first = rows[0];
      setLeads(rows); setDataMode("live"); setSelectedId(first?.id ?? -1);
      setNotes(first?.notes ?? ""); setFollowUp(inputDate(first?.nextFollowUpAt ?? null));
      setContactDraft({ contactName: first?.contactName ?? "", email: first?.email ?? "", phone: first?.phone ?? "", carrier: first?.carrier ?? "" });
    }).catch(() => setDataMode("error"));
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 3200);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); searchRef.current?.focus(); }
      if (event.key === "Escape" && document.activeElement === searchRef.current) { setQuery(""); searchRef.current?.blur(); }
    }
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  const selected = selectedId === -1 ? undefined : leads.find((lead) => lead.id === selectedId);
  async function loadDetail(id: number) {
    try {
      const response = await fetch(`/api/leads/${id}`); const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to load prospect");
      setActivities(payload.activities ?? []); setFindings(payload.findings ?? []); setOpportunity(payload.opportunity ?? null); setPagesAudited(payload.audit?.pagesAudited ?? 0); setProposal(payload.proposal ?? null);
    } catch { setActivities([]); setFindings([]); setOpportunity(null); setPagesAudited(0); setProposal(null); }
  }
  useEffect(() => {
    if (!selectedId || selectedId < 0) return;
    fetch(`/api/leads/${selectedId}`).then(async (response) => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to load prospect");
      return payload;
    }).then((payload) => {
      setActivities(payload.activities ?? []); setFindings(payload.findings ?? []); setOpportunity(payload.opportunity ?? null); setPagesAudited(payload.audit?.pagesAudited ?? 0); setProposal(payload.proposal ?? null);
    }).catch(() => { setActivities([]); setFindings([]); setOpportunity(null); setPagesAudited(0); setProposal(null); });
  }, [selectedId]);

  const filtered = useMemo(() => filterLeadRows(leads, { section, statusFilter, query }), [leads, query, section, statusFilter]);
  const auditableVisible = useMemo(() => filtered.filter((lead) => !["Won", "Lost", "Disqualified"].includes(lead.status)).slice(0, 10), [filtered]);
  const stats = useMemo(() => ({
    total: leads.length,
    actions: buildDailyQueue(leads).length,
    ready: leads.filter((lead) => lead.status === "Audited").length,
    engaged: leads.filter((lead) => lead.reportViews > 0).length,
    due: leads.filter((lead) => lead.nextFollowUpAt && new Date(lead.nextFollowUpAt) <= new Date()).length,
  }), [leads]);

  function replaceLead(updated: Lead) { setLeads((current) => current.map((lead) => lead.id === updated.id ? updated : lead)); }
  function chooseLead(lead: Lead) { setSelectedId(lead.id); setNotes(lead.notes ?? ""); setFollowUp(inputDate(lead.nextFollowUpAt)); setContactDraft({ contactName: lead.contactName, email: lead.email, phone: lead.phone, carrier: lead.carrier }); setFindings([]); setOpportunity(buildOpportunity(lead, [])); setPagesAudited(0); setProposal(null); }
  function changeSection(nextSection: Section) { setSection(nextSection); setQuery(""); }
  function toggleLead(id: number) {
    setSelectedLeadIds((current) => {
      if (current.includes(id)) return current.filter((leadId) => leadId !== id);
      if (current.length >= 10) { setToast("Select up to 10 prospects per audit batch"); return current; }
      return [...current, id];
    });
  }
  function selectVisible() {
    const selectable = auditableVisible.map((lead) => lead.id);
    const allSelected = selectable.length > 0 && selectable.every((id) => selectedLeadIds.includes(id));
    setSelectedLeadIds(allSelected ? [] : selectable);
  }
  async function runBatchAudit() {
    const targets = leads.filter((lead) => selectedLeadIds.includes(lead.id) && !["Won", "Lost", "Disqualified"].includes(lead.status)).slice(0, 10);
    if (!targets.length || busy) return;
    setBusy(true); setBatchState({ complete: 0, total: targets.length, failed: 0, current: "Starting audits" });
    let complete = 0; let failed = 0;
    for (let index = 0; index < targets.length; index += 2) {
      const group = targets.slice(index, index + 2);
      await Promise.all(group.map(async (lead) => {
        setBatchState((current) => ({ ...current, current: lead.agencyName }));
        try {
          const response = await fetch("/api/audit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ leadId: lead.id, website: lead.website }) });
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.error || "Audit failed");
          replaceLead(payload.lead);
          if (lead.id === selectedId) { setFindings(payload.findings ?? []); setOpportunity(payload.opportunity ?? null); setPagesAudited(payload.pagesAudited ?? 1); }
        } catch { failed += 1; }
        complete += 1; setBatchState({ complete, total: targets.length, failed, current: lead.agencyName });
      }));
    }
    setSelectedLeadIds([]); setBusy(false); setBatchState({ complete, total: targets.length, failed, current: "Complete" });
    setToast(`${complete - failed} audits completed${failed ? ` · ${failed} could not be audited` : ""}`);
  }
  async function patchLead(values: Record<string, unknown>, success: string) {
    if (!selected) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/leads/${selected.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(values) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Update failed");
      replaceLead(payload.lead); setToast(success);
      await loadDetail(selected.id);
    } catch (error) { setToast(error instanceof Error ? error.message : "Update failed"); }
    finally { setBusy(false); }
  }
  async function updateStatus(status: LeadStatus) { await patchLead({ status }, `Moved to ${status}`); }
  async function runAudit() {
    if (!selected || busy) return;
    setBusy(true); setToast("Inspecting the live website…");
    try {
      const response = await fetch("/api/audit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ leadId: selected.id, website: selected.website }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Audit failed");
      replaceLead(payload.lead); setFindings(payload.findings ?? []); setOpportunity(payload.opportunity ?? null); setPagesAudited(payload.pagesAudited ?? 1); setToast(`${payload.pagesAudited}-page audit complete · ${payload.opportunity.primaryService}`);
    } catch (error) { setToast(error instanceof Error ? error.message : "Audit could not be completed"); }
    finally { setBusy(false); }
  }
  function outreach() {
    if (!selected) return { subject: "", body: "" };
    const insight = opportunity ?? buildOpportunity(selected, findings);
    const firstName = selected.contactName.split(" ")[0] || "there";
    return {
      subject: `${selected.agencyName}: ${insight.primaryFinding.toLowerCase()}`,
      body: `Hi ${firstName},\n\nI reviewed ${selected.agencyName}'s public website and noticed ${insight.primaryFinding.toLowerCase()}. It may be creating friction for prospective customers who are ready to take the next step.\n\nI put the exact evidence and recommended fix into a short, private brief:\n${window.location.origin}/report/${selected.reportToken}\n\nWould a 15-minute walkthrough be useful?\n\nBest,\nJames Lerner`,
    };
  }
  async function copyOutreach() {
    if (!selected?.score) { setToast("Run the website audit before sending outreach"); return; }
    const message = outreach(); await navigator.clipboard.writeText(`Subject: ${message.subject}\n\n${message.body}`); setToast("Personalized email copied");
  }
  async function openGmail() {
    if (!selected?.score) { setToast("Run the website audit before sending outreach"); return; }
    if (!selected.email) { setToast("Add an email address before opening Gmail"); return; }
    const message = outreach();
    window.open(`https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(selected.email)}&su=${encodeURIComponent(message.subject)}&body=${encodeURIComponent(message.body)}`, "_blank", "noopener,noreferrer");
    await patchLead({ outreachOpened: true }, "Email opened in Gmail and contact recorded");
  }
  async function addLead(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true);
    const body = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      const response = await fetch("/api/leads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to create lead");
      setLeads((current) => [payload.lead, ...current]); chooseLead(payload.lead); setShowAdd(false); setToast("Business added — run its audit next");
    } catch (error) { setToast(error instanceof Error ? error.message : "Lead could not be added"); }
    finally { setBusy(false); }
  }
  async function chooseCsv(file?: File) {
    if (!file) return;
    try { const rows = parseLeadCsv(await file.text()); setImportRows(rows); setImportFile(file.name); }
    catch { setImportRows([]); setToast("That CSV could not be read"); }
  }
  async function importCsv() {
    if (!importRows.length) return;
    setBusy(true);
    try {
      const response = await fetch("/api/leads/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ leads: importRows }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Import failed");
      setShowImport(false); setImportRows([]); setImportFile(""); await loadLeads();
      setToast(`${payload.imported} imported${payload.skipped ? ` · ${payload.skipped} skipped` : ""}`);
    } catch (error) { setToast(error instanceof Error ? error.message : "Import failed"); }
    finally { setBusy(false); }
  }
  async function signOut() { await fetch("/api/auth/logout", { method: "POST" }); window.location.assign("/login"); }

  const meta = sectionMeta[section];
  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup"><span className="brand-mark">A</span><span>AgencySignal</span></div>
        <div className="workspace-label"><span className="workspace-dot" /> Growth workspace</div>
        <nav className="primary-nav" aria-label="Primary navigation">
          <button className={section === "Today" ? "active" : ""} onClick={() => changeSection("Today")}><NavIcon label="✓" /> Today <span className="nav-count">{stats.actions}</span></button>
          <button className={section === "Pipeline" ? "active" : ""} onClick={() => changeSection("Pipeline")}><NavIcon label="P" /> Pipeline <span className="nav-count">{stats.total}</span></button>
          <button className={section === "Audits" ? "active" : ""} onClick={() => changeSection("Audits")}><NavIcon label="A" /> Audits <span className="nav-count">{stats.ready}</span></button>
          <button className={section === "Engagement" ? "active" : ""} onClick={() => changeSection("Engagement")}><NavIcon label="E" /> Engagement <span className="nav-count">{stats.engaged}</span></button>
          <button className={section === "Followups" ? "active" : ""} onClick={() => changeSection("Followups")}><NavIcon label="F" /> Follow-ups <span className="nav-count">{stats.due}</span></button>
        </nav>
        <div className="sidebar-bottom"><div className="user-row"><span className="avatar">JL</span><span><strong>{ownerName}</strong><small>Workspace owner</small></span><button aria-label="Sign out" title="Sign out" onClick={signOut}>↗</button></div></div>
      </aside>

      <section className="workspace">
        <header className="topbar"><div className="mobile-brand"><span className="brand-mark">A</span> AgencySignal</div><label className="global-search"><span aria-hidden="true">⌕</span><input ref={searchRef} aria-label="Search all leads" value={query} onChange={(event) => { setQuery(event.target.value); if (event.target.value.trim()) setSelectedId(-1); }} placeholder="Search all leads" />{query ? <button type="button" aria-label="Clear search" onClick={() => setQuery("")}>×</button> : <kbd>⌘ K</kbd>}</label><div className="top-actions"><span className={`sync-state ${dataMode}`}><i />{dataMode === "live" ? "Saved" : dataMode === "loading" ? "Connecting" : "Connection error"}</span><button className="primary-button" onClick={() => setShowAdd(true)}>+ Add business</button></div></header>
        <div className="workspace-content">
          <div className="page-heading"><div><p className="eyebrow">{meta.eyebrow}</p><h1>{meta.title}</h1><p>{meta.description}</p></div><div className="heading-actions"><button className="secondary-button" onClick={() => setShowImport(true)}>Import CSV</button><button className="primary-button" onClick={() => setShowAdd(true)}>Add business</button></div></div>
          <><section className="metrics-grid" aria-label="Pipeline summary">
            <article><div className="metric-label"><span>Today’s queue</span><b className="trend">Prioritized</b></div><strong>{stats.actions}</strong><p>Open prospects needing action</p></article>
            <article><div className="metric-label"><span>Audits ready</span><b className="trend">Act now</b></div><strong>{stats.ready}</strong><p>Evidence ready for outreach</p></article>
            <article><div className="metric-label"><span>Engaged reports</span><b className="trend positive">High intent</b></div><strong>{stats.engaged}</strong><p>Prospects viewing your brief</p></article>
            <article><div className="metric-label"><span>Follow-ups due</span><b className="trend">Today</b></div><strong>{stats.due}</strong><p>Conversations needing action</p></article>
          </section>
          <section className="pipeline-card">
            <div className="table-toolbar"><div><h2>{query.trim() ? "Search results" : section === "Today" ? "Prioritized worklist" : "Priority prospects"}</h2><p aria-live="polite">{filtered.length} {filtered.length === 1 ? "record" : "records"}{query.trim() ? ` matching “${query.trim()}” across the full pipeline` : section === "Today" ? " · due follow-ups and warm signals first" : " · sorted by recent activity"}</p></div><div className="table-controls batch-controls"><button className="secondary-button select-button" onClick={selectVisible}>{auditableVisible.length > 0 && auditableVisible.every((lead) => selectedLeadIds.includes(lead.id)) ? "Clear selection" : "Select visible"}</button><button className="primary-button batch-button" disabled={busy || !selectedLeadIds.length} onClick={runBatchAudit}>{busy && batchState.total ? `${batchState.complete}/${batchState.total} auditing…` : `Audit selected${selectedLeadIds.length ? ` (${selectedLeadIds.length})` : ""}`}</button><select aria-label="Filter by pipeline stage" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} disabled={Boolean(query.trim())}><option>All stages</option>{pipelineStatuses.map((status) => <option key={status}>{status}</option>)}</select></div></div>
            {batchState.total > 0 && <div className={`batch-progress ${batchState.complete === batchState.total ? "complete" : ""}`}><div><strong>{batchState.complete === batchState.total ? "Batch complete" : `Auditing ${batchState.current}`}</strong><span>{batchState.complete} of {batchState.total}{batchState.failed ? ` · ${batchState.failed} failed` : ""}</span></div><i><b style={{ width: `${(batchState.complete / batchState.total) * 100}%` }} /></i></div>}
            <div className="table-wrap"><table><thead><tr><th className="select-column"><input type="checkbox" aria-label="Select visible prospects" checked={auditableVisible.length > 0 && auditableVisible.every((lead) => selectedLeadIds.includes(lead.id))} onChange={selectVisible} /></th><th>Business</th><th>Industry</th><th>Audit score</th><th>Closing readiness</th><th>Stage</th><th>Signal</th><th>Next action</th><th><span className="sr-only">Open</span></th></tr></thead><tbody>{filtered.map((lead) => (
              <tr key={lead.id} className={lead.id === selectedId ? "selected" : ""} onClick={() => chooseLead(lead)}>
                <td className="select-column"><input type="checkbox" aria-label={`Select ${lead.agencyName}`} checked={selectedLeadIds.includes(lead.id)} disabled={["Won", "Lost", "Disqualified"].includes(lead.status)} onClick={(event) => event.stopPropagation()} onChange={() => toggleLead(lead.id)} /></td><td><div className="agency-cell"><span className="agency-avatar">{initials(lead.agencyName)}</span><span><strong>{lead.agencyName}</strong><small>{lead.contactName || "No contact"}{lead.city ? ` · ${lead.city}${lead.state ? `, ${lead.state}` : ""}` : ""}</small></span></div></td><td><span className="carrier-text">{lead.carrier}</span></td><td>{lead.score ? <span className={`score-badge ${scoreTone(lead.score)}`}><i style={{ "--score": `${lead.score * 3.6}deg` } as React.CSSProperties} />{lead.score}</span> : <span className="not-run">Not run</span>}</td><td><span className={`priority-pill priority-${qualificationResultTone(qualificationBreakdown(lead).total)}`}><strong>{qualificationBreakdown(lead).total}</strong>{qualificationLabel(lead)}</span></td><td><span className={`stage stage-${lead.status.toLowerCase().replaceAll(" ", "-")}`}>{lead.status}</span></td><td>{lead.reportViews ? <span className="signal"><i /> {lead.reportViews} view{lead.reportViews === 1 ? "" : "s"}</span> : <span className="muted">No activity</span>}</td><td><span className={lead.nextFollowUpAt && new Date(lead.nextFollowUpAt) <= new Date() ? "due" : "next-action"}>{nextLeadAction(lead)}</span></td><td><button className="row-open" aria-label={`Open ${lead.agencyName}`} onClick={(event) => { event.stopPropagation(); chooseLead(lead); }}>›</button></td>
              </tr>))}</tbody></table>{!filtered.length && <div className="empty-state"><strong>{leads.length ? "No businesses match this view." : "Build your first real prospect list."}</strong><span>{leads.length ? "Try a different search or pipeline stage." : "Import a CSV or add one business, then run a website audit."}</span>{leads.length ? <button className="secondary-button" onClick={() => { setQuery(""); setStatusFilter("All stages"); }}>Reset view</button> : <div className="empty-actions"><button className="secondary-button" onClick={() => setShowImport(true)}>Import CSV</button><button className="primary-button" onClick={() => setShowAdd(true)}>Add business</button></div>}</div>}</div>
          </section>{leads.length > 0 && leads.length < 3 && <section className="first-pipeline-card"><div><p className="eyebrow">Priority workflow</p><h2>Audit first. Personalize second.</h2><p>Those two actions create the reason to reach out and the message that starts the conversation.</p></div><ol><li className={leads.some((lead) => !lead.score) ? "current" : "done"}><span>1</span><div><strong>Audit the website</strong><small>Find specific conversion and visibility gaps.</small></div><button onClick={() => { const lead = leads.find((item) => !item.score) ?? leads[0]; chooseLead(lead); }}>Open lead</button></li><li className={leads.some((lead) => lead.score) ? "current" : "locked"}><span>2</span><div><strong>Create the email</strong><small>Use the strongest audit evidence to personalize outreach.</small></div>{leads.some((lead) => lead.score) && <button onClick={() => { const lead = leads.find((item) => item.score) ?? leads[0]; chooseLead(lead); }}>Write email</button>}</li><li className="locked"><span>3</span><div><strong>Advance the conversation</strong><small>Qualify, follow up, and propose after engagement.</small></div></li></ol></section>}</>
        </div>
      </section>

      {selected && <button className="detail-backdrop" aria-label="Close prospect workspace" onClick={() => setSelectedId(-1)} />}
      {selected && <ProspectDetail lead={selected} findings={findings} opportunity={opportunity} proposal={proposal} pagesAudited={pagesAudited} activities={activities} busy={busy} onClose={() => setSelectedId(-1)} onAudit={runAudit} onPatch={patchLead} onCopyOutreach={copyOutreach} onOpenGmail={openGmail} onProposal={(createdProposal, updatedLead) => { setProposal(createdProposal); replaceLead(updatedLead); setToast("Trackable proposal created"); }} onRefresh={async () => { await loadDetail(selected.id); setToast("Proposal status refreshed"); }} />}

      {selected && <aside className="detail-panel"><div className="detail-top"><p>Prospect detail</p><button aria-label="Close prospect detail" onClick={() => setSelectedId(-1)}>×</button></div><div className="detail-identity"><span className="detail-avatar">{initials(selected.agencyName)}</span><div><h2>{selected.agencyName}</h2><p>{selected.carrier}{selected.city ? ` · ${selected.city}${selected.state ? `, ${selected.state}` : ""}` : ""}</p></div></div><div className="detail-actions three"><button onClick={copyOutreach}>Copy email</button><button className="gmail-button" onClick={openGmail}>Open Gmail</button><a href={`/report/${selected.reportToken}`} target="_blank" rel="noreferrer">Open brief ↗</a></div><p className="workflow-hint">{!selected.score ? "1. Run the audit to create a credible reason to reach out." : !selected.email ? "2. Add an email address before opening Gmail." : "2. Review the email, send it, then schedule a follow-up."}</p>{opportunity && <div className="opportunity-card"><div className="opportunity-head"><span>Sales opportunity</span><strong>{opportunity.priorityScore}<small>/100</small></strong></div><h3>{opportunity.recommendedOffer}</h3><p>{opportunity.expectedOutcome}</p><div className="opportunity-meta"><span>{opportunity.priorityLabel}</span><span>{opportunity.scope}</span>{pagesAudited > 0 && <span>{pagesAudited} pages audited</span>}</div><div className="evidence-callout"><b>Lead with</b><span>{opportunity.primaryFinding}</span></div><div className="next-step"><b>Next action</b><span>{opportunity.nextAction}</span></div></div>}<div className="stage-control"><label htmlFor="lead-stage">Pipeline stage</label><select id="lead-stage" value={selected.status} onChange={(event) => updateStatus(event.target.value as LeadStatus)}>{pipelineStatuses.map((status) => <option key={status}>{status}</option>)}</select></div><div className="audit-summary"><div className="audit-score"><span className={`score-ring ${scoreTone(selected.score)}`}>{selected.score || "—"}</span><span><strong>Digital readiness</strong><small>{selected.lastAuditAt ? `Audited ${friendlyDate(selected.lastAuditAt)}` : "Audit not run"}</small></span></div><div className="score-lines">{[["Visibility", selected.visibilityScore], ["Conversion", selected.conversionScore], ["Technical", selected.technicalScore], ["Trust", selected.trustScore]].map(([label, value]) => <div key={label}><span>{label}</span><i><b style={{ width: `${value}%` }} /></i><strong>{value || "—"}</strong></div>)}</div><button className="audit-button" disabled={busy} onClick={runAudit}>{busy ? "Auditing up to 5 pages…" : selected.score ? "Run fresh multi-page audit" : "Run multi-page website audit"}</button><p className="audit-note">Reviews up to five public pages and records exact evidence. Check findings before outreach.</p></div>{findings.length > 0 && <div className="findings-preview"><h3>Best evidence</h3>{findings.slice(0, 3).map((finding) => <article key={`${finding.title}-${finding.sortOrder}`}><span className={`finding-dot ${finding.severity.toLowerCase()}`} /> <div><strong>{finding.title}</strong><p>{finding.evidence}</p></div></article>)}</div>}<div className="contact-block"><h3>Contact & industry</h3><div className="contact-edit"><input aria-label="Contact name" placeholder="Contact name" value={contactDraft.contactName} onChange={(event) => setContactDraft({ ...contactDraft, contactName: event.target.value })} /><input aria-label="Email" type="email" placeholder="Email" value={contactDraft.email} onChange={(event) => setContactDraft({ ...contactDraft, email: event.target.value })} /><input aria-label="Phone" placeholder="Phone" value={contactDraft.phone} onChange={(event) => setContactDraft({ ...contactDraft, phone: event.target.value })} /><input aria-label="Industry" placeholder="Industry" value={contactDraft.carrier} onChange={(event) => setContactDraft({ ...contactDraft, carrier: event.target.value })} /><button disabled={busy} onClick={() => patchLead(contactDraft, "Contact details saved")}>Save contact</button></div><a className="website-link" href={selected.website} target="_blank" rel="noreferrer">{selected.website.replace(/^https?:\/\//, "")} ↗</a></div><div className="workflow-block"><h3>Next follow-up</h3><div className="inline-save"><input type="datetime-local" value={followUp} onChange={(event) => setFollowUp(event.target.value)} /><button disabled={busy} onClick={() => patchLead({ nextFollowUpAt: followUp ? new Date(followUp).toISOString() : null }, "Follow-up saved")}>Save</button></div></div><div className="workflow-block"><h3>Sales notes</h3><textarea rows={4} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Decision maker, pain points, objections, next step…" /><button className="save-notes" disabled={busy || notes === selected.notes} onClick={() => patchLead({ notes }, "Notes saved")}>Save notes</button></div><div className="activity-block"><div className="section-title"><h3>Recent activity</h3></div>{activities.length ? <ol className="timeline">{activities.slice(0, 8).map((activity, index) => <li className={index === 0 ? "hot" : ""} key={activity.id}><i /><div><strong>{activity.description}</strong><span>{friendlyDate(activity.createdAt)}</span></div></li>)}</ol> : <p className="activity-empty">No activity yet. Run the audit to start.</p>}</div></aside>}

      {showAdd && <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowAdd(false)}><section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="add-title" onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><p className="eyebrow">New prospect</p><h2 id="add-title">Add a business</h2></div><button onClick={() => setShowAdd(false)} aria-label="Close">×</button></div><form onSubmit={addLead}><div className="form-grid"><label className="span-two">Business name<input name="agencyName" required placeholder="Acme Home Services" /></label><label>Contact name<input name="contactName" placeholder="Alex Rivera" /></label><label>Industry<input name="carrier" placeholder="HVAC, legal, retail…" /></label><label>City<input name="city" placeholder="Denver" /></label><label>State<input name="state" maxLength={3} placeholder="CO" /></label><label className="span-two">Website<input name="website" required inputMode="url" placeholder="https://business.com" /></label><label>Email<input name="email" type="email" placeholder="alex@business.com" /></label><label>Phone<input name="phone" type="tel" placeholder="+1 (303) 555-0100" /></label><label className="span-two">Notes<input name="notes" placeholder="Source, opportunity, or context" /></label></div><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setShowAdd(false)}>Cancel</button><button className="primary-button" disabled={busy}>{busy ? "Adding…" : "Add and audit"}</button></div></form></section></div>}
      {showImport && <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowImport(false)}><section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="import-title" onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><p className="eyebrow">Bulk prospecting</p><h2 id="import-title">Import lead CSV</h2></div><button onClick={() => setShowImport(false)} aria-label="Close">×</button></div><div className="import-body"><label className="file-drop">Choose a CSV file<input type="file" accept=".csv,text/csv" onChange={(event) => chooseCsv(event.target.files?.[0])} /><span>{importFile ? `${importFile} · ${importRows.length} rows ready` : "Drop-in exports from Apollo, HubSpot, spreadsheets, or other lead sources."}</span></label><p className="csv-help"><strong>Required:</strong> business/company/name and website/domain. Optional: contact name, first name, last name, industry, city, state, email, phone, notes. Duplicate websites or emails are skipped.</p><div className="modal-actions"><button className="secondary-button" onClick={() => setShowImport(false)}>Cancel</button><button className="primary-button" disabled={busy || !importRows.length} onClick={importCsv}>{busy ? "Importing…" : `Import ${importRows.length || ""} leads`}</button></div></div></section></div>}
      {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
    </main>
  );
}
