export async function saveAuditScreenshot(dataUrl: string, prefix: "audit" | "competitor") {
  if (!dataUrl) return "";
  const match = dataUrl.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) return "";
  const { env } = await import("cloudflare:workers");
  if (!env.BUCKET) return "";
  const extension = match[1].toLowerCase() === "jpeg" ? "jpg" : match[1].toLowerCase();
  const key = `${prefix}-${crypto.randomUUID()}.${extension}`;
  const binary = Uint8Array.from(atob(match[2]), (character) => character.charCodeAt(0));
  await env.BUCKET.put(key, binary, { httpMetadata: { contentType: `image/${match[1].toLowerCase()}`, cacheControl: "public, max-age=31536000, immutable" } });
  return key;
}

export async function getAuditScreenshot(key: string) {
  if (!/^(?:audit|competitor)-[a-f0-9-]+\.(?:jpg|png|webp)$/i.test(key)) return null;
  const { env } = await import("cloudflare:workers");
  return env.BUCKET ? env.BUCKET.get(key) : null;
}

export async function deleteAuditScreenshot(key: string) {
  if (!key) return;
  const { env } = await import("cloudflare:workers");
  if (env.BUCKET) await env.BUCKET.delete(key);
}
