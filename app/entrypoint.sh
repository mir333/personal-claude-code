#!/bin/bash
echo "Starting Claude Web UI on port 3001..."
cd /app && node server/index.js &
echo "Web UI started. Access at http://localhost:3001"
echo "Container ready. Use 'docker exec' for terminal access."
exec sleep infinity
