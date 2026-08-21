import test from "node:test";
import assert from "node:assert/strict";
import { muteWrite, promptSecret } from "../lib/secret-prompt.js";

// The crash this file exists for: the muted `write` assumed it would always be
// handed three arguments and called `callback()`. Readline writes all three
// ways, and `cursorTo` writes with no callback at all — so moving the cursor
// threw `TypeError: callback is not a function` and took the whole prompt down.
test("the muted write honours every shape of write()", () => {
  // write(chunk) — no callback. This is the one that threw.
  assert.doesNotThrow(() => muteWrite("secret"));
  assert.equal(muteWrite("secret"), true);

  // write(chunk, callback) — the callback arrives as the second argument.
  let calledAsSecond = 0;
  assert.equal(muteWrite("secret", () => { calledAsSecond += 1; }), true);
  assert.equal(calledAsSecond, 1);

  // write(chunk, encoding, callback) — the shape it always handled.
  let calledAsThird = 0;
  assert.equal(muteWrite("secret", "utf8", () => { calledAsThird += 1; }), true);
  assert.equal(calledAsThird, 1);

  // An encoding with no callback is not a callback to invoke.
  assert.doesNotThrow(() => muteWrite("secret", "utf8"));
  assert.doesNotThrow(() => muteWrite("secret", "utf8", undefined));
});

test("nothing typed is ever echoed", () => {
  // The point of the replacement: the chunk goes nowhere.
  const written = [];
  const original = process.stdout.write;
  try {
    process.stdout.write = (chunk) => { written.push(chunk); return true; };
    muteWrite("hunter2");
    muteWrite("hunter2", () => {});
  } finally {
    process.stdout.write = original;
  }
  assert.deepEqual(written, []);
});

test("a prompt nobody can answer returns empty rather than hanging", async () => {
  const wasTTY = process.stdin.isTTY;
  try {
    // A run from cron, CI or a pipe has no terminal. Blocking there would hang
    // the job on a question no one will ever see.
    process.stdin.isTTY = false;
    assert.equal(await promptSecret("Password: "), "");
  } finally {
    process.stdin.isTTY = wasTTY;
  }
});
