#!/bin/bash

# Persist git config inside the mounted volume (/home/node/.claude is on claude-code-config volume)
GIT_PERSIST_DIR="/home/node/.claude/git"
mkdir -p "$GIT_PERSIST_DIR"

# Point global gitconfig at the persisted copy
export GIT_CONFIG_GLOBAL="$GIT_PERSIST_DIR/gitconfig"

# Configure credential store to use a persisted file
git config --global credential.helper "store --file $GIT_PERSIST_DIR/git-credentials"

# Check for Claude credentials on first start
CLAUDE_CREDS="${CLAUDE_CONFIG_DIR:=/home/node/.claude}/.credentials.json"
if [ ! -f "$CLAUDE_CREDS" ] && [ -z "$ANTHROPIC_API_KEY" ]; then
  echo ""
  echo "=============================================="
  echo "  Claude API Key / Authentication Not Found"
  echo "=============================================="
  echo ""
  echo "  No Claude credentials detected. You need to"
  echo "  authenticate before using the Web UI."
  echo ""
  echo "  Option 1: OAuth (Claude Pro/Max subscription)"
  echo "    1. docker compose exec claude-code zsh"
  echo "    2. Run: claude"
  echo "    3. Follow the browser-based login flow"
  echo "    4. Tokens are saved automatically"
  echo ""
  echo "  Option 2: API Key"
  echo "    Add to docker-compose.yml environment:"
  echo "      ANTHROPIC_API_KEY: \"sk-ant-...\""
  echo "    Then restart: docker compose up -d"
  echo ""
  echo "  The Web UI will show setup instructions"
  echo "  until credentials are configured."
  echo ""
  echo "=============================================="
  echo ""
fi

echo "Starting Claude Web UI on port 3001..."
cd /app && node server/index.js &
echo "Web UI started. Access at http://localhost:3001"
echo "Container ready. Use 'docker exec' for terminal access."
exec sleep infinity
