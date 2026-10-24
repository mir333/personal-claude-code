#!/usr/bin/env bash
# Reset a web UI profile password by rewriting its scrypt hash in profiles.json.
#
# Usage:
#   scripts/reset-profile-password.sh [profile-name-or-@handle]
#
# Defaults to the "miro" profile. Prompts for the new password (not echoed,
# not saved to shell history). Override the container with CONTAINER=name.

set -euo pipefail

PROFILE="${1:-miro}"
PROFILE="${PROFILE#@}"
CONTAINER="${CONTAINER:-claude-code}"

read -rsp "New password for '$PROFILE': " NEW_PASSWORD; echo
read -rsp "Repeat password: " CONFIRM; echo
if [[ "$NEW_PASSWORD" != "$CONFIRM" ]]; then
  echo "Passwords do not match" >&2
  exit 1
fi
if (( ${#NEW_PASSWORD} < 4 )); then
  echo "Password must be at least 4 characters" >&2
  exit 1
fi

export NEW_PASSWORD PROFILE
docker exec -e NEW_PASSWORD -e PROFILE "$CONTAINER" node -e '
const fs = require("fs");
const crypto = require("crypto");
const f = "/home/node/.claude/profiles/profiles.json";
const target = process.env.PROFILE.toLowerCase();
const d = JSON.parse(fs.readFileSync(f, "utf8"));
const p = d.profiles.find((p) => p.name.toLowerCase() === target || p.slug === target);
if (!p) {
  console.error("Profile not found. Existing:", d.profiles.map((p) => `${p.name} (@${p.slug})`).join(", "));
  process.exit(1);
}
fs.copyFileSync(f, f + ".bak");
p.salt = crypto.randomBytes(16).toString("hex");
p.passwordHash = crypto.scryptSync(process.env.NEW_PASSWORD, p.salt, 64).toString("hex");
const tmp = f + "." + crypto.randomBytes(4).toString("hex") + ".tmp";
fs.writeFileSync(tmp, JSON.stringify(d, null, 2));
fs.renameSync(tmp, f);
console.log(`Password reset for ${p.name} (@${p.slug}). Backup: ${f}.bak`);
'
