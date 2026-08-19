import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { minimumConfidence } from "../lib/audit/scoring-config.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFile(resolve(root, path), "utf8");

// Two rubrics can write leads.score while the legacy path is still shipping.
// They must not carry different guarantees, and a stored number must say where
// it came from. These assertions are the contract; both are retired together
// when the legacy path goes in Phase 3.

test("the legacy audit path gates its score on the shared threshold", async () => {
  const source = await read("app/api/audit/route.ts");
  assert.match(source, /import \{ minimumConfidence \} from "@\/lib\/audit\/scoring-config"/);
  assert.match(source, /const confident = result\.confidenceScore >= minimumConfidence/);
  // The score fields are written only inside the confident branch.
  assert.match(source, /\.\.\.\(confident \? \{[\s\S]*?score: result\.score/);
});

test("the legacy path still stores the audit when it cannot score it", async () => {
  const source = await read("app/api/audit/route.ts");
  // The audits insert is unconditional; only the leads update is gated.
  assert.match(source, /await db\.insert\(audits\)\.values\(/);
  assert.ok(!/confident \?[\s\S]{0,200}db\.insert\(audits\)/.test(source));
  assert.match(source, /unscoredReason/);
});

test("both paths record where a stored score came from", async () => {
  assert.match(await read("app/api/audit/route.ts"), /scoreSource: "legacy"/);
  assert.match(await read("lib/audit/runner.ts"), /scoreSource: "engine"/);
  const schema = await read("db/schema.ts");
  assert.match(schema, /scoreSource: text\("score_source"\)/);
  assert.match(schema, /scoreConfidence: integer\("score_confidence"\)/);
});

test("one threshold governs both paths", async () => {
  const config = await read("lib/audit/scoring-config.js");
  // Defined once, imported by both, so they cannot drift apart.
  assert.equal((config.match(/export const minimumConfidence/g) ?? []).length, 1);
  assert.equal(typeof minimumConfidence, "number");
  for (const path of ["app/api/audit/route.ts", "lib/audit/runner.ts"]) {
    assert.match(await read(path), /minimumConfidence/, `${path} must use the shared threshold`);
  }
});
