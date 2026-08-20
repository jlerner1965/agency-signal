import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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


// --------------------------------------------------------------- .dev.vars

async function withDevVars(contents, args) {
  const dir = await mkdtemp(resolve(tmpdir(), "agencysignal-"));
  const file = resolve(dir, ".dev.vars");
  if (contents !== null) await writeFile(file, contents);
  const { stdout } = await run(process.execPath, [script, ...args], {
    cwd: root,
    env: { ...process.env, AGENCYSIGNAL_DEV_VARS: file },
  });
  return { stdout, written: await readFile(file, "utf8") };
}

const LOGIN = [
  "AGENCYSIGNAL_LOGIN_EMAIL=owner@example.com",
  "AGENCYSIGNAL_PASSWORD_SALT=salt-value",
  "AGENCYSIGNAL_PASSWORD_HASH=hash-value",
  "AGENCYSIGNAL_SESSION_SECRET=session-value",
].join("\n");

test("adding an API key leaves the login exactly as it was", async () => {
  // The README gives this command for adding a key later. Regenerating the
  // session secret here would sign out every existing session.
  const { written } = await withDevVars(`${LOGIN}\n`, ["--pagespeed-key", "PSI-KEY"]);
  for (const line of LOGIN.split("\n")) assert.ok(written.includes(line), `lost ${line}`);
  assert.match(written, /^PAGESPEED_API_KEY=PSI-KEY$/m);
});

test("adding one API key does not discard the other", async () => {
  const { written } = await withDevVars(
    `${LOGIN}\nGOOGLE_PLACES_API_KEY=PLACES-KEY\n`,
    ["--pagespeed-key", "PSI-KEY"],
  );
  assert.match(written, /^GOOGLE_PLACES_API_KEY=PLACES-KEY$/m);
  assert.match(written, /^PAGESPEED_API_KEY=PSI-KEY$/m);
});

test("rotating the login keeps the API keys already stored", async () => {
  // These are not passed again, and were being dropped on every rotation.
  const { written } = await withDevVars(
    `${LOGIN}\nPAGESPEED_API_KEY=PSI-KEY\nGOOGLE_PLACES_API_KEY=PLACES-KEY\n`,
    ["--email", "owner@example.com", "--password", PASSWORD],
  );
  assert.match(written, /^PAGESPEED_API_KEY=PSI-KEY$/m);
  assert.match(written, /^GOOGLE_PLACES_API_KEY=PLACES-KEY$/m);
  // The login itself did rotate, which is what was asked for.
  assert.ok(!written.includes("AGENCYSIGNAL_SESSION_SECRET=session-value"));
});

test("unrelated local variables survive either path", async () => {
  const { written } = await withDevVars(
    `${LOGIN}\nSOMETHING_ELSE=keep-me\n`,
    ["--pagespeed-key", "PSI-KEY"],
  );
  assert.match(written, /^SOMETHING_ELSE=keep-me$/m);
});

test("a key flag with no login yet still generates one", async () => {
  // Nothing to preserve, so this must not silently skip the login setup.
  const { written } = await withDevVars(null, [
    "--email", "owner@example.com", "--password", PASSWORD, "--pagespeed-key", "PSI-KEY",
  ]);
  assert.match(written, /^AGENCYSIGNAL_PASSWORD_HASH=.+$/m);
  assert.match(written, /^PAGESPEED_API_KEY=PSI-KEY$/m);
});
