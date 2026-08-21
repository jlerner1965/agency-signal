import { readMockup, recordMockupView } from "@/lib/audit/deliverables";

export const dynamic = "force-dynamic";

/**
 * The mockup is the deliverable, served whole at its own stable URL so it can
 * be sent as a live link. It is rendered as its own document rather than being
 * embedded, so the prospect's brand CSS cannot collide with the app's.
 *
 * `?embed=1` is the proposal showing the concept inline. It renders the same
 * page but does not count a view: a view count that ticks up every time the
 * proposal loads no longer tells anyone whether the concept was looked at.
 */
export default async function MockupPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await params;
  const embedded = (await searchParams)?.embed === "1";
  const valid = /^[a-f0-9]{32}$/i.test(token);
  const mockup = valid ? await (embedded ? readMockup(token) : recordMockupView(token)) : null;

  if (!mockup) {
    return <main style={{ font: "16px/1.6 system-ui, sans-serif", maxWidth: "42rem", margin: "12vh auto", padding: "0 1.5rem" }}>
      <h1 style={{ fontSize: "1.4rem" }}>This mockup link is not valid.</h1>
      <p>The link may have been replaced by a newer version. Ask for a current one.</p>
    </main>;
  }

  // Sandboxed to an opaque origin. The markup is built from a prospect's own
  // site, and srcDoc would otherwise run it on ours; the concept pages carry no
  // script of their own, so nothing here needs the privileges this withholds.
  //
  // A block filling the viewport rather than a fixed-position one. The two look
  // identical on screen, but this page is itself framed by the proposal, and a
  // fixed-position element inside a document being printed as part of its
  // parent is painted against the page box rather than in flow — which is how
  // the concepts came out of a saved PDF clipped or blank.
  return <iframe
    title={mockup.title}
    srcDoc={mockup.html}
    sandbox=""
    style={{ display: "block", width: "100%", height: "100vh", border: 0 }}
  />;
}
