"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { parseLeadCsv } from "@/lib/csv-leads";
import { buildGooglePresenceAudit } from "@/lib/google-presence";
import type { AuditComparison, AuditSummary, CompetitorAudit, Finding, Lead, Opportunity, Proposal } from "@/lib/types";
import ProspectDetail from "./prospect-detail";

function initials(name: string) { return name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase(); }
function scoreTone(score: number) { return score === 0 ? "neutral" : score < 55 ? "critical" : score < 75 ? "watch" : "good"; }
function formatDate(value: string | null) { return value ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value)) : "Not reviewed"; }

export default function Dashboard({ ownerName }: { ownerName: string }) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selectedId, setSelectedId] = useState(-1);
  const [query, setQuery] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importRows, setImportRows] = useState<Record<string, string>[]>([]);
  const [importFile, setImportFile] = useState("");
  const [findings, setFindings] = useState<Finding[]>([]);
  const [opportunity, setOpportunity] = useState<Opportunity | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [pagesAudited, setPagesAudited] = useState(0);
  const [auditSummary, setAuditSummary] = useState<AuditSummary | null>(null);
  const [auditHistory, setAuditHistory] = useState<AuditSummary[]>([]);
  const [auditComparison, setAuditComparison] = useState<AuditComparison | null>(null);
  const [competitors, setCompetitors] = useState<CompetitorAudit[]>([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [dataMode, setDataMode] = useState<"loading" | "live" | "error">("loading");
  const searchRef = useRef<HTMLInputElement>(null);

  async function loadLeads(preferredId?: number) {
    try {
      const response = await fetch("/api/leads");
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to load businesses");
      const rows = (payload.leads ?? []) as Lead[];
      setLeads(rows); setDataMode("live");
      if (preferredId) setSelectedId(preferredId);
    } catch (error) { setDataMode("error"); setToast(error instanceof Error ? error.message : "Unable to load businesses"); }
  }

  useEffect(() => { loadLeads(); }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 3200);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); searchRef.current?.focus(); }
      if (event.key === "Escape") { if (selectedId > 0) setSelectedId(-1); else { setQuery(""); searchRef.current?.blur(); } }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [selectedId]);

  const selected = leads.find((lead) => lead.id === selectedId);
  const filtered = useMemo(() => {
    const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (!terms.length) return leads;
    return leads.filter((lead) => {
      const haystack = [lead.agencyName, lead.website, lead.carrier, lead.city, lead.state, lead.contactName].join(" ").toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  }, [leads, query]);
  const googleReviewed = leads.filter((lead) => buildGooglePresenceAudit(lead).reviewed);
  const proposalCount = leads.filter((lead) => ["Proposal sent", "Decision pending", "Won"].includes(lead.status)).length;
  const stats = { businesses: leads.length, websiteAudits: leads.filter((lead) => lead.score > 0).length, googleReviews: googleReviewed.length, proposals: proposalCount };

  function replaceLead(updated: Lead) { setLeads((current) => current.map((lead) => lead.id === updated.id ? updated : lead)); }
  async function loadDetail(id: number) {
    const response = await fetch(`/api/leads/${id}`); const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Unable to load audit");
    setFindings(payload.findings ?? []); setOpportunity(payload.opportunity ?? null); setPagesAudited(payload.audit?.pagesAudited ?? 0); setAuditSummary(payload.audit ?? null); setAuditHistory(payload.auditHistory ?? []); setAuditComparison(payload.auditComparison ?? null); setCompetitors(payload.competitors ?? []); setProposal(payload.proposal ?? null);
  }
  function chooseLead(lead: Lead) { setSelectedId(lead.id); setFindings([]); setOpportunity(null); setPagesAudited(0); setAuditSummary(null); setAuditHistory([]); setAuditComparison(null); setCompetitors([]); setProposal(null); }
  useEffect(() => { if (selectedId > 0) loadDetail(selectedId).catch(() => { setFindings([]); setOpportunity(null); setProposal(null); }); }, [selectedId]);

  async function patchLead(values: Record<string, unknown>, success: string) {
    if (!selected) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/leads/${selected.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(values) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Update failed");
      replaceLead(payload.lead); setToast(success); await loadDetail(selected.id);
    } catch (error) { setToast(error instanceof Error ? error.message : "Update failed"); }
    finally { setBusy(false); }
  }

  /**
   * One scoring path: the module engine. The run is created and then advanced a
   * module at a time, waiting out any backoff the runner asks for.
   */
  async function runAudit() {
    if (!selected || busy) return;
    setBusy(true); setToast("Starting the audit run…");
    try {
      const created = await fetch("/api/audit-runs", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ leadId: selected.id }),
      });
      const start = await created.json();
      if (!created.ok) throw new Error(start.error || "The audit run could not be started.");

      let summary = start;
      for (let step = 0; step < 40 && summary.pending; step += 1) {
        const ticked = await fetch(`/api/audit-runs/${start.run.id}/tick`, { method: "POST" });
        summary = await ticked.json();
        if (!ticked.ok) throw new Error(summary.error || "The audit run failed.");
        const done = summary.modules.filter((module: { status: string }) => module.status !== "Queued" && module.status !== "Running").length;
        setToast(`Auditing — ${done} of ${summary.modules.length} modules complete…`);
        if (summary.pending && summary.waitingFor) {
          const waitMs = Math.min(Math.max(0, new Date(summary.waitingFor).getTime() - Date.now()), 65_000);
          if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs + 400));
        }
      }

      await loadLeads();
      await loadDetail(selected.id);
      setToast(summary.run.overallScore === null
        ? `Audit finished without a score — ${summary.run.error || "too little could be verified"}`
        : `Audit complete · score ${summary.run.overallScore} at ${summary.run.confidence}% verified`);
    } catch (error) { setToast(error instanceof Error ? error.message : "The audit could not be completed"); }
    finally { setBusy(false); }
  }

  async function addLead(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true);
    try {
      const body = Object.fromEntries(new FormData(event.currentTarget).entries());
      const response = await fetch("/api/leads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to add business");
      setLeads((current) => [payload.lead, ...current]); chooseLead(payload.lead); setShowAdd(false); setToast("Business added — start with the website audit");
    } catch (error) { setToast(error instanceof Error ? error.message : "Business could not be added"); }
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
      setShowImport(false); setImportRows([]); setImportFile(""); await loadLeads(); setToast(`${payload.imported} businesses imported`);
    } catch (error) { setToast(error instanceof Error ? error.message : "Import failed"); }
    finally { setBusy(false); }
  }
  async function signOut() { await fetch("/api/auth/logout", { method: "POST" }); window.location.assign("/login"); }

  return <main className="presence-app">
    <aside className="presence-sidebar"><div className="brand-lockup"><span className="brand-mark">A</span><span>AgencySignal</span></div><nav><button className="active"><span>◎</span> Audit workspace</button></nav><div className="presence-workflow"><span>Simple workflow</span><ol><li><b>1</b>Add a business</li><li><b>2</b>Audit website</li><li><b>3</b>Review Google presence</li><li><b>4</b>Create proposal</li></ol></div><div className="presence-user"><span className="avatar">{initials(ownerName)}</span><div><strong>{ownerName}</strong><small>Owner</small></div><button onClick={signOut} aria-label="Sign out">↗</button></div></aside>
    <section className="presence-main"><header className="presence-topbar"><label><span>⌕</span><input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search businesses" aria-label="Search businesses" />{query && <button onClick={() => setQuery("")} aria-label="Clear search">×</button>}</label><div><span className={`sync-state ${dataMode}`}><i />{dataMode === "live" ? "Saved" : dataMode === "loading" ? "Loading" : "Connection issue"}</span><button className="secondary-button" onClick={() => setShowImport(true)}>Import CSV</button><button className="primary-button" onClick={() => setShowAdd(true)}>+ Add business</button></div></header>
      <div className="presence-content"><section className="presence-intro"><div><p className="eyebrow">Digital presence intelligence</p><h1>Audit. Explain. Propose.</h1><p>Detailed website and Google-presence reviews that turn visible problems into a clear redesign or optimization proposal.</p></div><button className="primary-button" onClick={() => setShowAdd(true)}>Start a new audit</button></section>
        <section className="presence-metrics" aria-label="Audit summary"><article><span>Businesses</span><strong>{stats.businesses}</strong><small>saved for review</small></article><article><span>Website audits</span><strong>{stats.websiteAudits}</strong><small>multi-page + mobile</small></article><article><span>Google reviews</span><strong>{stats.googleReviews}</strong><small>presence scorecards</small></article><article><span>Proposals</span><strong>{stats.proposals}</strong><small>created and trackable</small></article></section>
        <section className="business-audit-list"><div className="business-list-head"><div><h2>Business audits</h2><p>{filtered.length} {filtered.length === 1 ? "business" : "businesses"} · select one to open the full audit</p></div></div><div className="business-table-wrap"><table><thead><tr><th>Business</th><th>Website</th><th>Google presence</th><th>Proposal</th><th></th></tr></thead><tbody>{filtered.map((lead) => { const google = buildGooglePresenceAudit(lead); return <tr key={lead.id} onClick={() => chooseLead(lead)}><td><div className="agency-cell"><span className="agency-avatar">{initials(lead.agencyName)}</span><span><strong>{lead.agencyName}</strong><small>{lead.carrier}{lead.city ? ` · ${lead.city}${lead.state ? `, ${lead.state}` : ""}` : ""}</small></span></div></td><td>{lead.score ? <div className="audit-table-score"><span className={scoreTone(lead.score)}>{lead.score}</span><div><strong>{scoreTone(lead.score) === "good" ? "Strong" : scoreTone(lead.score) === "watch" ? "Needs work" : "Priority gaps"}</strong><small>{formatDate(lead.lastAuditAt)}{lead.scoreConfidence ? ` · ${lead.scoreConfidence}% verified` : ""}</small></div></div> : <span className="audit-not-started">Not audited</span>}</td><td>{google.reviewed ? <div className="audit-table-score"><span className={scoreTone(google.score)}>{google.score}</span><div><strong>{scoreTone(google.score) === "good" ? "Strong" : scoreTone(google.score) === "watch" ? "Needs work" : "Priority gaps"}</strong><small>{formatDate(lead.googleReviewedAt)}</small></div></div> : <span className="audit-not-started">Not reviewed</span>}</td><td>{["Proposal sent", "Decision pending", "Won"].includes(lead.status) ? <span className="proposal-ready">Proposal ready</span> : <span className="audit-not-started">Not created</span>}</td><td><button className="review-business" onClick={(event) => { event.stopPropagation(); chooseLead(lead); }}>Review →</button></td></tr>; })}</tbody></table>{!filtered.length && <div className="simple-empty"><strong>{leads.length ? "No businesses match your search." : "Add your first business."}</strong><p>{leads.length ? "Clear the search and try again." : "You only need a business name and website to begin."}</p>{!leads.length && <button className="primary-button" onClick={() => setShowAdd(true)}>Add business</button>}</div>}</div></section>
      </div>
    </section>
    {selected && <button className="detail-backdrop" aria-label="Close business audit" onClick={() => setSelectedId(-1)} />}
    {selected && <ProspectDetail lead={selected} findings={findings} opportunity={opportunity} proposal={proposal} pagesAudited={pagesAudited} auditSummary={auditSummary} auditHistory={auditHistory} auditComparison={auditComparison} competitors={competitors} busy={busy} onClose={() => setSelectedId(-1)} onAudit={runAudit} onPatch={patchLead} onProposal={(created, updatedLead) => { setProposal(created); replaceLead(updatedLead); setToast("Proposal created"); }} onRefresh={async () => { await loadDetail(selected.id); }} />}
    {showAdd && <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowAdd(false)}><section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="add-title" onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><p className="eyebrow">New audit</p><h2 id="add-title">Add a business</h2></div><button onClick={() => setShowAdd(false)} aria-label="Close">×</button></div><form onSubmit={addLead}><div className="form-grid"><label className="span-two">Business name<input name="agencyName" required placeholder="Acme Home Services" /></label><label className="span-two">Website<input name="website" required inputMode="url" placeholder="https://business.com" /></label><label>Industry<input name="carrier" placeholder="HVAC, legal, retail…" /></label><label>City<input name="city" placeholder="Denver" /></label><label>State<input name="state" maxLength={3} placeholder="CO" /></label><label>Contact name <small>Optional</small><input name="contactName" placeholder="Alex Rivera" /></label><label className="span-two">Google Business Profile <small>Optional</small><input name="googleProfileUrl" inputMode="url" placeholder="https://g.page/..." /></label></div><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setShowAdd(false)}>Cancel</button><button className="primary-button" disabled={busy}>{busy ? "Adding…" : "Add business"}</button></div></form></section></div>}
    {showImport && <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowImport(false)}><section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="import-title" onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><p className="eyebrow">Bulk audits</p><h2 id="import-title">Import businesses</h2></div><button onClick={() => setShowImport(false)} aria-label="Close">×</button></div><div className="import-body"><label className="file-drop">Choose a CSV file<input type="file" accept=".csv,text/csv" onChange={(event) => chooseCsv(event.target.files?.[0])} /><span>{importFile ? `${importFile} · ${importRows.length} rows ready` : "Business name and website are required."}</span></label><div className="modal-actions"><button className="secondary-button" onClick={() => setShowImport(false)}>Cancel</button><button className="primary-button" disabled={busy || !importRows.length} onClick={importCsv}>{busy ? "Importing…" : `Import ${importRows.length || ""} businesses`}</button></div></div></section></div>}
    {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
  </main>;
}
