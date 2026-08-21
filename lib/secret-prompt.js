/**
 * Asking for something that must not appear on screen.
 *
 * The trick is to replace the output stream's `write` while the answer is
 * typed, so keypresses are read but never echoed. The subtlety is that
 * `write` has three shapes — `write(chunk)`, `write(chunk, callback)` and
 * `write(chunk, encoding, callback)` — and readline uses all of them:
 * `cursorTo` writes with no callback at all.
 *
 * A replacement that assumes the third shape and calls `callback()` throws
 * `TypeError: callback is not a function` the moment readline moves the
 * cursor, which is what happened at the password prompt in
 * `npm run auth:credentials`. It also has to return a boolean, because that
 * is what a stream's `write` returns and callers act on it.
 */

/**
 * A `write` that swallows the output and still honours the contract.
 *
 * @param {unknown} _chunk
 * @param {unknown} [encoding] the encoding, or the callback in the two-argument form
 * @param {unknown} [callback]
 * @returns {boolean}
 */
export function muteWrite(_chunk, encoding, callback) {
  const done = typeof encoding === "function" ? encoding : callback;
  if (typeof done === "function") done();
  // A real write returns whether the buffer is under its high-water mark.
  // Nothing is buffered here, so there is never back-pressure to report.
  return true;
}

/**
 * Ask a question and read the answer without echoing it.
 *
 * Returns an empty string when no terminal is attached: a prompt nobody can
 * answer would hang a script run from cron or CI, so those pass the value
 * some other way and this declines rather than blocks.
 *
 * @param {string} question
 * @returns {Promise<string>}
 */
export async function promptSecret(question) {
  const { createInterface } = await import("node:readline/promises");
  const { stdin, stdout } = await import("node:process");
  if (!stdin.isTTY) return "";

  const rl = createInterface({ input: stdin, output: stdout, terminal: true });
  const original = stdout.write.bind(stdout);
  stdout.write(question);
  rl.output.write = muteWrite;
  try {
    return await rl.question("");
  } finally {
    rl.output.write = original;
    original("\n");
    rl.close();
  }
}
