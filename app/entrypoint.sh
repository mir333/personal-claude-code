#!/bin/bash

# Persist git config inside the mounted volume (/home/node/.claude is on claude-code-config volume)
GIT_PERSIST_DIR="/home/node/.claude/git"
mkdir -p "$GIT_PERSIST_DIR"

# Point global gitconfig at the persisted copy
export GIT_CONFIG_GLOBAL="$GIT_PERSIST_DIR/gitconfig"

# Configure credential store to use a persisted file
git config --global credential.helper "store --file $GIT_PERSIST_DIR/git-credentials"

echo "Starting Claude Web UI on port 3001..."
cd /app && node server/index.js &
echo "Web UI started. Access at http://localhost:3001"
echo "Container ready. Use 'docker exec' for terminal access."
exec sleep infinity
