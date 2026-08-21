import { getAuditScreenshot } from "@/lib/audit-screenshots";

export async function GET(_request: Request, context: { params: Promise<{ key: string }> }) {
  const { key } = await context.params;
  const object = await getAuditScreenshot(key);
  if (!object) return new Response("Not found", { status: 404 });
  // One realm at runtime, two declarations at compile time. `Headers`,
  // `Response` and `ReadableStream` here are the Worker's own — the same
  // objects R2 hands back — but this project keeps the DOM's versions global
  // so the browser components typecheck against what they actually run in, and
  // R2's types name the Workers ones. The casts cross that line and nothing
  // else: no shape is being claimed that the runtime does not already have.
  type WorkersHeaders = import("@cloudflare/workers-types").Headers;
  const headers = new Headers();
  object.writeHttpMetadata(headers as unknown as WorkersHeaders);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "public, max-age=31536000, immutable");
  return new Response(object.body as unknown as ReadableStream, { headers });
}
