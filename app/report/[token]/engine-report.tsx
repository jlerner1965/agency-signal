"use client";

type Finding = {
  id: number; category: string; severity: string; title: string; evidence: string;
  recommendation: string; impactNote: string; impactScore: number; effortScore: number;
  priority: number; affectedUrl: string; sortOrder: number;
};

type ServiceLine = {
  name: string; siteUrl: string; quote: string; sources: string[];
  hasLandingPage: boolean; googleRepresented: boolean | null;
};

export type EngineReport = {
  run: {
    id: number; status: string; score: number | null; confidence: number;
    checksVerified: number; checksTotal: number; source: string;
    reachable: boolean | null; finishedAt: string | null; error: string;
  };
  subscores: Record<string, number | null>;
  modules: Array<{ module: string; label: string; status: string; message: string }>;
  findings: Finding[];
  serviceLines: ServiceLine[];
  unmeasured: Array<{ label: string; category: string; evidence: string; reason: string }>;
  recommendations: Array<{ label: string; rationale: string; findingIds: number[] }>;
  mockups: Array<{ kind: string; title: string; url: string }>;
};

const REASON: Record<string, string> = {
  "retries-exhausted": "the source kept failing after repeated attempts",
  "source-unavailable": "the data source was unavailable for this audit",
  "host-unreachable": "the site could not be read",
  "not-applicable": "there was nothing on the page to measure",
};

function tone(score: number) {
  return score < 55 ? "critical" : score < 75 ? "watch" : "good";
}

export default function EngineReport({ report, businessName }: { report: EngineReport; businessName: string }) {
  const { run } = report;
  const gaps = report.serviceLines.filter((line) => line.googleRepresented === false);

  return (
    <>
      <section className="er-score">
        <div className="report-container er-score-inner">
          <div>
            <p className="eyebrow">Audit result</p>
            {run.score === null ? (
              <>
                <strong className="er-unscored">Not scored</strong>
                <p>{run.reachable === false
                  ? "The website could not be read, so no score was produced. This is missing data, not a poor result."
                  : `Only ${run.confidence}% of the audit could be verified — below the threshold needed to report a score honestly.`}</p>
              </>
            ) : (
              <>
                <strong className={tone(run.score)}>{run.score}<small>/100</small></strong>
                <p>Measured across {run.checksVerified} of {run.checksTotal} checks, covering {run.confidence}% of the audit&rsquo;s total weight.</p>
              </>
            )}
          </div>
          <dl className="er-subscores">
            {Object.entries(report.subscores).filter(([, value]) => value !== null).map(([label, value]) => (
              <div key={label}><dt>{label}</dt><dd className={tone(value as number)}>{value}</dd></div>
            ))}
          </dl>
        </div>
      </section>

      {report.serviceLines.length > 0 && (
        <section className="er-services">
          <div className="report-container">
            <div className="report-section-heading compact">
              <p className="eyebrow">Service-line coverage</p>
              <h2>What {businessName} sells, and what Google shows.</h2>
              <p>Every line below was read from the website itself. The quoted text is where it was found.</p>
            </div>
            <div className="er-table-wrap">
              <table className="er-table">
                <thead><tr><th>Service line</th><th>Read from</th><th>Own page</th><th>On Google</th></tr></thead>
                <tbody>
                  {report.serviceLines.map((line) => (
                    <tr key={line.name} className={line.googleRepresented === false ? "gap" : ""}>
                      <td><strong>{line.name}</strong></td>
                      <td>
                        <a href={line.siteUrl} target="_blank" rel="noreferrer">{new URL(line.siteUrl).pathname}</a>
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
                {gaps.length} of {report.serviceLines.length} service lines are sold on the website but not represented on the Google Business Profile.
                Google shows one category per business; the lines it does not carry are not competing for local searches at all.
              </p>
            )}
          </div>
        </section>
      )}

      <section className="findings-section">
        <div className="report-container">
          <div className="report-section-heading compact">
            <p className="eyebrow">Findings</p>
            <h2>Ranked by impact against effort.</h2>
            <p>{report.findings.length} finding{report.findings.length === 1 ? "" : "s"}, highest return first.</p>
          </div>
          <div className="findings-list">
            {report.findings.map((finding) => (
              <article className="finding-card" key={finding.id}>
                <div className="finding-index">{String(finding.sortOrder).padStart(2, "0")}</div>
                <div className="finding-main">
                  <div className="finding-tags">
                    <span>{finding.category}</span>
                    <span className={`severity ${finding.severity.toLowerCase()}`}>{finding.severity} priority</span>
                    <span className="er-effort">impact {finding.impactScore} · effort {finding.effortScore}</span>
                  </div>
                  <h3>{finding.title}</h3>
                  <div className="finding-columns">
                    <div><h4>Evidence</h4><p>{finding.evidence}</p></div>
                    <div><h4>Recommended change</h4><p>{finding.recommendation}</p></div>
                    <div><h4>Why it matters</h4><p>{finding.impactNote}</p></div>
                  </div>
                  {finding.affectedUrl && <a href={finding.affectedUrl} target="_blank" rel="noreferrer">Audited page ↗</a>}
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {report.unmeasured.length > 0 && (
        <section className="er-unmeasured">
          <div className="report-container">
            <div className="report-section-heading compact">
              <p className="eyebrow">Not measured</p>
              <h2>What this audit could not check.</h2>
              <p>Listed rather than left out. An omitted check reads as a pass, and none of these were measured either way.</p>
            </div>
            <ul>
              {report.unmeasured.map((check) => (
                <li key={`${check.category}-${check.label}`}>
                  <strong>{check.label}</strong>
                  <small>{check.evidence}{check.reason ? ` — ${REASON[check.reason] ?? check.reason}` : ""}</small>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {report.mockups.length > 0 && (
        <section className="er-mockups">
          <div className="report-container">
            <div className="report-section-heading compact">
              <p className="eyebrow">Concept</p>
              <h2>What this could look like.</h2>
              <p>Built from {businessName}&rsquo;s own colours, type, and logo — a live page, not a picture of one.</p>
            </div>
            <div className="er-mockup-links">
              {report.mockups.map((mockup) => (
                <a key={mockup.url} href={mockup.url} target="_blank" rel="noreferrer">{mockup.title} ↗</a>
              ))}
            </div>
          </div>
        </section>
      )}
    </>
  );
}
