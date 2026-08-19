#!/usr/bin/env bash
# First-run path: dependencies, a login you can actually use, and a local
# database with the current schema. Safe to re-run.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd "${script_dir}/.." && pwd)"

echo "[1/3] Installing dependencies"
if [[ -x "${project_root}/node_modules/.bin/vinext" ]]; then
  echo "      already installed — skipping npm ci"
else
  bash "${script_dir}/install-ci.sh"
fi

echo
echo "[2/3] Dashboard login"
if [[ -f "${project_root}/.dev.vars" ]] && grep -q '^AGENCYSIGNAL_PASSWORD_HASH=' "${project_root}/.dev.vars"; then
  echo "      .dev.vars already has a login — run 'npm run auth:credentials' to change it"
else
  node "${script_dir}/setup-credentials.mjs" "$@"
fi

echo
echo "[3/3] Local database"
bash "${script_dir}/sites-env.sh" -- node "${script_dir}/db-migrate.mjs"

echo
echo "Setup complete. Start the app with: npm run dev"
