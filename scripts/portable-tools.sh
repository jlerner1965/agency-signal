#!/usr/bin/env bash
# Resolves the GNU tools these scripts need on platforms that ship them under a
# different name, or not at all. Linux keeps exactly the behaviour it had; macOS
# gets a working fallback instead of a hard failure.
#
# Source this, do not execute it.
#
# Keep everything here compatible with bash 3.2, which is what macOS still
# ships. No mapfile, no associative arrays, no ${var,,}.

# sha256 of a file, printed bare. macOS has shasum rather than sha256sum.
sites_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    echo "Neither sha256sum nor shasum is available; cannot verify downloads." >&2
    return 69
  fi
}

# GNU timeout, which Homebrew's coreutils installs as gtimeout.
sites_timeout_bin() {
  if command -v timeout >/dev/null 2>&1; then
    echo "timeout"
  elif command -v gtimeout >/dev/null 2>&1; then
    echo "gtimeout"
  fi
}

# Runs a command under a time bound when one is available. The bound is a safety
# net against a hung install or build, not a correctness requirement, so its
# absence is a warning rather than a failure.
sites_run_bounded() {
  local duration="$1"
  local kill_after="$2"
  shift 2
  local bin
  bin="$(sites_timeout_bin)"
  if [ -n "${bin}" ]; then
    "${bin}" --signal=TERM --kill-after="${kill_after}" "${duration}" "$@"
  else
    echo "[sites] no GNU timeout found; running without a time bound." >&2
    echo "[sites] install it with: brew install coreutils" >&2
    "$@"
  fi
}

# Single-holder lock. flock does not exist on macOS, so fall back to mkdir,
# which is atomic on every POSIX filesystem. Returns non-zero when the lock is
# already held.
sites_acquire_lock() {
  local lock_file="$1"
  if command -v flock >/dev/null 2>&1; then
    exec 9>"${lock_file}"
    flock -n 9 || return 1
    return 0
  fi
  if mkdir "${lock_file}.d" 2>/dev/null; then
    # shellcheck disable=SC2064 — expand the path now, not at trap time.
    trap "rmdir '${lock_file}.d' 2>/dev/null || true" EXIT
    return 0
  fi
  return 1
}
