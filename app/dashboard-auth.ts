import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const COOKIE_NAME = "__Host-agencysignal_session";
const SESSION_SECONDS = 60 * 60 * 8;
const encoder = new TextEncoder();

type SessionPayload = { email: string; exp: number };

async function runtimeValue(key: string) {
  const { env } = await import("cloudflare:workers");
  const workerValue = (env as unknown as Record<string, unknown>)[key];
  return typeof workerValue === "string" ? workerValue : process.env[key] ?? "";
}

async function configuredEmail() {
  return (await runtimeValue("AGENCYSIGNAL_LOGIN_EMAIL")).trim().toLowerCase();
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function sessionKey() {
  const secret = await runtimeValue("AGENCYSIGNAL_SESSION_SECRET");
  if (!secret) throw new Error("Dashboard session secret is not configured");
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function sign(value: string) {
  const signature = await crypto.subtle.sign("HMAC", await sessionKey(), encoder.encode(value));
  return bytesToBase64Url(new Uint8Array(signature));
}

async function readSessionToken(token: string | undefined) {
  if (!token) return null;
  const [payloadPart, signaturePart, extra] = token.split(".");
  if (!payloadPart || !signaturePart || extra) return null;
  try {
    const valid = await crypto.subtle.verify(
      "HMAC",
      await sessionKey(),
      base64UrlToBytes(signaturePart),
      encoder.encode(payloadPart),
    );
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payloadPart))) as SessionPayload;
    if (payload.exp <= Date.now() || payload.email !== await configuredEmail()) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function getDashboardSession() {
  const cookieStore = await cookies();
  return readSessionToken(cookieStore.get(COOKIE_NAME)?.value);
}

export async function requireDashboardUser(returnTo: string) {
  const session = await getDashboardSession();
  if (!session) redirect(`/login?return_to=${encodeURIComponent(safeReturnTo(returnTo))}`);
  return session;
}

export async function requireDashboardApi() {
  if (await getDashboardSession()) return null;
  return Response.json({ error: "Dashboard login required" }, { status: 401 });
}

export async function verifyDashboardCredentials(email: string, password: string) {
  const [salt, expectedHash, loginEmail] = await Promise.all([
    runtimeValue("AGENCYSIGNAL_PASSWORD_SALT"),
    runtimeValue("AGENCYSIGNAL_PASSWORD_HASH"),
    configuredEmail(),
  ]);
  if (!salt || !expectedHash || !loginEmail) return false;
  try {
    const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
    const derived = new Uint8Array(await crypto.subtle.deriveBits({
      name: "PBKDF2",
      hash: "SHA-256",
      salt: base64UrlToBytes(salt),
      iterations: 100_000,
    }, material, 256));
    const expected = base64UrlToBytes(expectedHash);
    let difference = derived.length ^ expected.length;
    for (let index = 0; index < Math.max(derived.length, expected.length); index += 1) {
      difference |= (derived[index] ?? 0) ^ (expected[index] ?? 0);
    }
    return difference === 0 && email.trim().toLowerCase() === loginEmail;
  } catch {
    return false;
  }
}

export async function createDashboardSession(email: string) {
  const payload: SessionPayload = { email: email.trim().toLowerCase(), exp: Date.now() + SESSION_SECONDS * 1000 };
  const payloadPart = bytesToBase64Url(encoder.encode(JSON.stringify(payload)));
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, `${payloadPart}.${await sign(payloadPart)}`, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
}

export async function clearDashboardSession() {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
}

export function safeReturnTo(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}
