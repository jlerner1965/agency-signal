import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const script = resolve(root, "scripts/setup-credentials.mjs");
const PASSWORD = "correct horse battery staple";

// Mirrors the verification in app/dashboard-auth.ts, which cannot be imported
// here because it depends on next/headers and cloudflare:workers.
function base64UrlToBytes(value) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  return Buffer.from(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="), "base64");
}

async function deriveHash(password, saltBytes, iterations = 100_000) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: saltBytes, iterations },
    material,
    256,
  );
  return Buffer.from(derived);
}

async function generate(args = []) {
  const { stdout } = await run(process.execPath, [
    script, "--print-only", "--email", "owner@example.com", "--password", PASSWORD, ...args,
  ], { cwd: root });
  return Object.fromEntries(
    stdout.split("\n")
      .filter((line) => /^AGENCYSIGNAL_[A-Z_]+=/.test(line))
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
}

test("generated credentials verify with the dashboard's PBKDF2 parameters", async () => {
  const values = await generate();
  assert.equal(values.AGENCYSIGNAL_LOGIN_EMAIL, "owner@example.com");
  const salt = base64UrlToBytes(values.AGENCYSIGNAL_PASSWORD_SALT);
  assert.equal(salt.length, 16);
  const derived = await deriveHash(PASSWORD, salt);
  assert.equal(derived.length, 32);
  assert.ok(derived.equals(base64UrlToBytes(values.AGENCYSIGNAL_PASSWORD_HASH)));
});

test("a wrong password does not derive the stored hash", async () => {
  const values = await generate();
  const derived = await deriveHash(`${PASSWORD}!`, base64UrlToBytes(values.AGENCYSIGNAL_PASSWORD_SALT));
  assert.ok(!derived.equals(base64UrlToBytes(values.AGENCYSIGNAL_PASSWORD_HASH)));
});

test("each run produces a fresh salt and session secret", async () => {
  const [first, second] = [await generate(), await generate()];
  assert.notEqual(first.AGENCYSIGNAL_PASSWORD_SALT, second.AGENCYSIGNAL_PASSWORD_SALT);
  assert.notEqual(first.AGENCYSIGNAL_PASSWORD_HASH, second.AGENCYSIGNAL_PASSWORD_HASH);
  assert.notEqual(first.AGENCYSIGNAL_SESSION_SECRET, second.AGENCYSIGNAL_SESSION_SECRET);
  assert.equal(base64UrlToBytes(first.AGENCYSIGNAL_SESSION_SECRET).length, 32);
});

// Credentials generated against different parameters would be rejected at
// login, so the two files have to agree on the derivation.
test("the dashboard verifier still uses the parameters this script generates for", async () => {
  const source = await readFile(resolve(root, "app/dashboard-auth.ts"), "utf8");
  assert.match(source, /iterations:\s*100_000/);
  assert.match(source, /hash:\s*"SHA-256"/);
  assert.match(source, /deriveBits\([\s\S]*?\}, material, 256\)/);
});

test("weak input is rejected instead of producing an unusable login", async () => {
  await assert.rejects(
    run(process.execPath, [script, "--print-only", "--email", "not-an-email", "--password", PASSWORD], { cwd: root }),
    (error) => error.code === 64,
  );
  await assert.rejects(
    run(process.execPath, [script, "--print-only", "--email", "owner@example.com", "--password", "short"], { cwd: root }),
    (error) => error.code === 64,
  );
});
