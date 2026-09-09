# git-profile-env.sh — point git at the active profile by workspace slug.
#
# Sourcing this sets GIT_CONFIG_GLOBAL to the gitconfig of the profile that owns
# the current directory's /workspace/<slug>, so git uses that profile's identity
# and configuration. Per-profile isolation is preserved: a directory under
# /workspace/alice resolves to alice's profile, /workspace/bob to bob's — there
# is no shared or hardcoded profile.
#
# Push authentication in this app flows through the per-profile token embedded in
# each repo's `origin` URL (maintained by updateRemoteUrls on token save), so this
# helper fixes commit identity / profile context; it does not itself inject tokens.
#
# Authoritative resolver: app/server/profiles.js (getProfileIdForWorkspacePath).
# This is a dependency-free mirror of that slug-matching logic, for shells.
#
# Usage (POSIX sh, bash, or zsh):
#   . app/server/bin/git-profile-env.sh [dir]   # defaults to $PWD

__gpe_dir="${1:-$PWD}"
__gpe_cfg="$(
  GPE_DIR="$__gpe_dir" \
  CLAUDE_CONFIG_DIR="${CLAUDE_CONFIG_DIR:-/home/node/.claude}" \
  node --input-type=commonjs -e '
    const fs = require("fs"), path = require("path");
    const dir = process.env.GPE_DIR || process.cwd();
    const m = dir.match(/^\/workspace\/([^/]+)(?:\/|$)/);
    if (!m) process.exit(0);
    const base = process.env.CLAUDE_CONFIG_DIR;
    let profiles = [];
    try {
      profiles = JSON.parse(fs.readFileSync(path.join(base, "profiles", "profiles.json"), "utf8")).profiles || [];
    } catch (e) { process.exit(0); }
    const p = profiles.find((x) => x.slug === m[1]);
    if (!p) process.exit(0);
    const cfg = path.join(base, "profiles", p.id, "git", "gitconfig");
    if (fs.existsSync(cfg)) process.stdout.write(cfg);
  ' 2>/dev/null
)"

if [ -n "$__gpe_cfg" ]; then
  GIT_CONFIG_GLOBAL="$__gpe_cfg"
  export GIT_CONFIG_GLOBAL
  printf 'git: using profile config %s\n' "$GIT_CONFIG_GLOBAL" >&2
else
  printf 'git: no profile matched for %s (GIT_CONFIG_GLOBAL unchanged)\n' "$__gpe_dir" >&2
fi
unset __gpe_dir __gpe_cfg
