"use client";

import { FormEvent, useEffect, useState } from "react";

/** One priced line, traced back to the findings that justify it. */
type ScopeItem = {
  deliverable: string; label: string; criteria: string; rationale: string;
  quantity: number; display: string;
};

type Retainer = { label: string; criteria: string; display: string };

type MockupLink = { kind: string; title: string; url: string };

/** What the site sells, and whether Google carries it. The core argument. */
/**
 * The path, for a link the reader can recognise. A stored URL that will not
 * parse is not worth taking the whole document down for, so it prints as it
 * was stored.
 */
function pathOf(url: string) {
  try { return new URL(url).pathname; } catch { return url; }
}

type ServiceLine = {
  name: string; siteUrl: string; quote: string;
  hasLandingPage: boolean; googleRepresented: boolean | null;
};

/**
 * Everything the proposal API returns. Two builders write this row — the
 * lead-based one and the audit-run one — and the run-based fields are simply
 * absent on older proposals. They are typed as possibly-empty here rather than
 * cast in at each point of use, which is what the casts were hiding.
 */
type ProposalRecord = {
  title: string; service: string; outcome: string; scope: string;
  deliverables: string[]; price: number; timeline: string; status: string;
  expiresAt: string; acceptedAt: string | null;
  scopeItems: ScopeItem[];
  mockupLinks: MockupLink[];
  retainer: Retainer | null;
  priceDisplay: string;
  openingProse: string;
  openingBlocked: string;
  minimumApplied: boolean;
  pricingPlaceholder: boolean;
  voicePlaceholder: boolean;
};

type Payload = {
  proposal: ProposalRecord;
  serviceLines: ServiceLine[];
  lead: { agencyName: string; contactName: string; city: string; state: string };
  audit: { score: number; pagesAudited: number; confidenceScore: number; checksPassed: number; checksFailed: number; createdAt: string } | null;
  googleAudit: { score: number; reviewedAt: string | null } | null;
  competitors: Array<{ id: number; name: string; score: number }>;
  findings: { title: string; evidence: string; recommendation: string; category: string; severity: string }[];
};

export default function ProposalView({ token, ownerName }: { token: string; ownerName: string }) {
  const ownerFirstName = ownerName.split(/\s+/)[0];
  const [payload, setPayload] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "accepted">("idle");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch(`/api/proposals/${encodeURIComponent(token)}`)
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error || "Proposal unavailable"); return body; })
      .then((body) => { setPayload(body); if (body.proposal.status === "Accepted") setState("accepted"); })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Proposal unavailable"));
  }, [token]);

  async function accept(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setState("sending"); setError("");
    const body = Object.fromEntries(new FormData(event.currentTarget).entries());
    const response = await fetch(`/api/proposals/${encodeURIComponent(token)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) { setState("idle"); setError(result.error || "Unable to accept proposal"); return; }
    setState("accepted");
  }

  async function copyLink() {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true); window.setTimeout(() => setCopied(false), 1800);
  }

  if (error && !payload) return <main className="proposal-state"><div className="brand-lockup"><span className="brand-mark">A</span><span>AgencySignal</span></div><section><p className="eyebrow">Proposal</p><h1>This proposal is unavailable.</h1><p>{error}</p></section></main>;
  if (!payload) return <main className="proposal-state"><div className="brand-lockup"><span className="brand-mark">A</span><span>AgencySignal</span></div><section><span className="report-loader" /><p>Loading proposal…</p></section></main>;

  const { proposal, lead, audit, googleAudit, findings, competitors, serviceLines } = payload;
  const gaps = serviceLines.filter((line) => line.googleRepresented === false);

  // One document, read in order. A section only appears in the nav when it has
  // something in it, so the contents never promise a section that is not there.
  const sections = [
    serviceLines.length ? { id: "coverage", label: "What you sell" } : null,
    findings.length ? { id: "evidence", label: "What we found" } : null,
    proposal.scopeItems.length ? { id: "scope", label: "Scope and price" } : null,
    proposal.mockupLinks.length ? { id: "concepts", label: "What it looks like" } : null,
    { id: "approve", label: "Approve" },
  ].filter(Boolean) as Array<{ id: string; label: string }>;

  // The config decides how a figure is framed — "starts at $4,500" is not the
  // same claim as "$4,500". Printing the raw band minimum in the hero stated a
  // firm price the pricing file had deliberately called a starting one.
  const investment = proposal.priceDisplay || `$${proposal.price.toLocaleString("en-US")}`;

  const blocked = [
    proposal.pricingPlaceholder ? "The amounts below come from placeholder pricing." : "",
    proposal.voicePlaceholder ? "No opening has been written — config/voice.md is still a placeholder." : "",
    proposal.openingBlocked || "",
  ].filter(Boolean);

  return <main className="proposal-shell">
    <header className="proposal-nav"><div className="brand-lockup"><span className="brand-mark">A</span><span>AgencySignal</span></div><div className="proposal-nav-actions"><span>Prepared for {lead.agencyName}</span><button onClick={copyLink}>{copied ? "Copied" : "Copy link"}</button><button className="primary" onClick={() => window.print()}>Print / Save PDF</button></div></header>
    <nav className="proposal-contents" aria-label="Sections">
      <div className="proposal-container">
        {sections.map((section) => <a key={section.id} href={`#${section.id}`}>{section.label}</a>)}
      </div>
    </nav>
    <section className="proposal-hero"><div className="proposal-container"><p className="eyebrow">Digital growth proposal</p><h1>{proposal.title}</h1><p>{proposal.outcome}</p><div className="proposal-summary"><span>Investment<strong>{investment}</strong></span>{proposal.timeline ? <span>Timeline<strong>{proposal.timeline}</strong></span> : null}<span>Valid until<strong>{new Date(proposal.expiresAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</strong></span></div></div></section>
{blocked.length > 0 && (
      <div className="proposal-stub" role="status">
        <strong>Draft — not ready to send.</strong>
        {blocked.map((reason) => <span key={reason}>{reason}</span>)}
      </div>
    )}
    {proposal.scopeItems.length > 0 && (
      <section className="proposal-container proposal-pricing" id="scope">
        <p className="eyebrow">Scope and investment</p>
        <ul>
          {proposal.scopeItems.map((item) => (
            <li key={item.deliverable}>
              <div>
                <strong>{item.label}{item.quantity > 1 ? ` × ${item.quantity}` : ""}</strong>
                <small>{item.criteria}</small>
                <em>{item.rationale}</em>
              </div>
              <b>{item.display}</b>
            </li>
          ))}
        </ul>
        <div className="proposal-total">
          <span>Total</span>
          <b>{investment}</b>
          {proposal.minimumApplied && <small>The minimum engagement applies.</small>}
        </div>
        {proposal.retainer && (
          <div className="proposal-retainer">
            <div><strong>{proposal.retainer.label}</strong><small>{proposal.retainer.criteria}</small></div>
            <b>{proposal.retainer.display}</b>
          </div>
        )}
      </section>
    )}
    {proposal.openingProse ? (
      <section className="proposal-container proposal-opening">
        {proposal.openingProse.split(/\n{2,}/).map((paragraph, index) => (
          <p key={index}>{paragraph.split("\n").map((line, lineIndex) => (
            <span key={lineIndex}>{line}<br /></span>
          ))}</p>
        ))}
      </section>
    ) : null}
    {serviceLines.length > 0 && (
      <section className="proposal-container proposal-coverage" id="coverage">
        <p className="eyebrow">Service-line coverage</p>
        <h2>What {lead.agencyName} sells, and what Google shows.</h2>
        <p className="proposal-locked">Every line below was read from the website itself. The quoted text is where it was found.</p>
        <div className="er-table-wrap">
          <table className="er-table">
            <thead><tr><th>Service line</th><th>Read from</th><th>Own page</th><th>On Google</th></tr></thead>
            <tbody>
              {serviceLines.map((line) => (
                <tr key={line.name} className={line.googleRepresented === false ? "gap" : ""}>
                  <td><strong>{line.name}</strong></td>
                  <td>
                    <a href={line.siteUrl} target="_blank" rel="noreferrer">{pathOf(line.siteUrl)}</a>
                    <small>&ldquo;{line.quote}&rdquo;</small>
                  </td>
                  <td>{line.hasLandingPage ? <span className="yes">Yes</span> : <span className="no">No page</span>}</td>
                  <td>{line.googleRepresented === null
                    ? <span className="unknown">Not checked</span>
                    : line.googleRepresented ? <span className="yes">Represented</span> : <span className="no">Missing</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {gaps.length > 0 && (
          <p className="er-gap-note">
            {gaps.length} of {serviceLines.length} service line{serviceLines.length === 1 ? " is" : "s are"} sold on the website but not represented on the Google Business Profile.
            Google shows one category per business; the lines it does not carry are not competing for local searches at all.
          </p>
        )}
      </section>
    )}

    <section className="proposal-container proposal-body"><div><p className="eyebrow">Why this work</p><h2>A focused response to an identified opportunity.</h2><p>{proposal.scope}</p><p>This scope is designed to improve a measurable customer-acquisition outcome without adding work that is not tied to the stated objective.</p></div><aside><span>Recommended service</span><strong>{proposal.service}</strong><small>Prepared by {ownerName}</small></aside></section>
    {findings.length > 0 && <section className="proposal-evidence" id="evidence"><div className="proposal-container"><div className="proposal-evidence-head"><div><p className="eyebrow">Audit evidence</p><h2>What the digital presence review found</h2><p className="proposal-locked">Every line below is quoted from the audit of this site. None of it is editable — a figure or a sentence that cannot be traced back to something we read is refused rather than written.</p>{audit && <p>{audit.checksPassed} checks passed · {audit.checksFailed} need work · {audit.confidenceScore}/100 evidence confidence</p>}</div><div className="proposal-score-pair">{audit && <div className="proposal-audit-score"><strong>{audit.score}</strong><span>website score<br />{audit.pagesAudited} page{audit.pagesAudited === 1 ? "" : "s"} reviewed</span></div>}{googleAudit && <div className="proposal-audit-score"><strong>{googleAudit.score}</strong><span>Google presence<br />profile scorecard</span></div>}</div></div>{competitors.length > 0 && <div className="proposal-benchmarks"><span>Competitive website benchmark</span>{competitors.map((item) => <article key={item.id}><strong>{item.name}</strong><b>{item.score}/100</b></article>)}</div>}<div className="proposal-evidence-grid">{findings.map((finding, index) => <article key={`${finding.title}-${index}`}><span>{finding.category} · {finding.severity}</span><h3>{finding.title}</h3><p>{finding.evidence}</p><strong>Recommended</strong><p>{finding.recommendation}</p></article>)}</div></div></section>}
    <section className="proposal-deliverables"><div className="proposal-container"><p className="eyebrow">Included</p><h2>Deliverables and implementation</h2><ol>{proposal.deliverables.map((item, index) => <li key={item}><span>0{index + 1}</span><strong>{item}</strong></li>)}</ol></div></section>
    {proposal.mockupLinks.length > 0 && (
      <section className="proposal-concepts" id="concepts">
        <div className="proposal-container">
          <p className="eyebrow">Concept</p>
          <h2>What this could look like.</h2>
          <p className="proposal-locked">Built from {lead.agencyName}&rsquo;s own colours, type and logo, and filled with sentences read from the current site. A live page, not a picture of one.</p>
          <div className="proposal-concept-grid">
            {proposal.mockupLinks.map((link) => (
              <figure key={link.url}>
                <iframe src={`${link.url}?embed=1`} title={link.title} loading="lazy" />
                <figcaption>
                  <span>{link.title}</span>
                  <a href={link.url} target="_blank" rel="noreferrer">Open full size ↗</a>
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>
    )}

    <section className="proposal-accept" id="approve"><div className="proposal-container"><div><p className="eyebrow">Decision</p><h2>Approve the project.</h2><p>Submitting acceptance records your approval and contact information. {ownerFirstName} will follow up with the kickoff details and formal service agreement.</p></div>{state === "accepted" ? <div className="proposal-accepted" role="status"><span>✓</span><strong>Proposal accepted</strong><p>Thank you. The next step is project kickoff and scheduling.</p></div> : <form onSubmit={accept}><label>Authorized name<input name="signerName" required autoComplete="name" defaultValue={lead.contactName} /></label><label>Email<input name="signerEmail" type="email" required autoComplete="email" /></label>{error && <p className="form-error">{error}</p>}<button disabled={state === "sending"}>{state === "sending" ? "Recording acceptance…" : `Accept proposal · $${proposal.price.toLocaleString("en-US")}`}</button><small>Acceptance is recorded with the date, name, and email provided.</small></form>}</div></section>
    <footer className="proposal-footer"><div className="proposal-container"><div className="brand-lockup"><span className="brand-mark">A</span><span>AgencySignal</span></div><span>Evidence-led digital growth proposals</span></div></footer>
  </main>;
}
