# Claude Code Web UI — Design Document

## Overview

A React + Node.js web application running inside the existing Claude Code container that provides a browser-based interface for managing and interacting with multiple Claude Code agents simultaneously.

## Architecture

```
┌─────────────────────────────────────────────┐
│  Docker Container                           │
│                                             │
│  ┌───────────────┐    ┌──────────────────┐  │
│  │  React App    │    │  Node.js Backend │  │
│  │  (static)     │◄──►│  (port 3001)     │  │
│  │               │    │                  │  │
│  │  - Sidebar    │    │  - REST API      │  │
│  │  - Chat panel │    │  - WebSocket     │  │
│  │               │    │  - Claude SDK    │  │
│  └───────────────┘    └──────┬───────────┘  │
│                              │              │
│                     ┌────────▼───────────┐  │
│                     │  Claude Code SDK   │  │
│                     │  (multiple agents) │  │
│                     └────────┬───────────┘  │
│                              │              │
│                     ┌────────▼───────────┐  │
│                     │  /workspace        │  │
│                     │  (mounted volume)  │  │
│                     └────────────────────┘  │
└─────────────────────────────────────────────┘
```

- Node backend on port 3001 serves both the REST API, WebSocket, and the built React static files.
- Each agent is an independent Claude Code SDK instance with its own working directory.
- Auth via OAuth (Pro/Max plan) — tokens stored in `/home/node/.claude/` (persisted via docker volume).

## Authentication

- No API key. Uses Claude Code Pro/Max OAuth authentication.
- First-time setup: exec into container, run `claude` to authenticate.
- Auth tokens persist in `claude-code-config` volume at `/home/node/.claude/`.
- SDK picks up auth automatically. All agents share the same session.
- If auth expires, UI shows a banner directing user to re-authenticate via terminal.

## Backend (Node.js + Express)

### REST Endpoints

- `POST /api/agents` — Create agent (name, workingDirectory)
- `GET /api/agents` — List all agents with status
- `DELETE /api/agents/:id` — Stop and remove an agent
- `GET /api/agents/:id/history` — Get conversation history

### WebSocket (ws://localhost:3001/ws)

- Send: `{ type: "message", agentId: "abc", text: "..." }`
- Receive: `{ type: "chunk", agentId: "abc", content: "..." }` (streamed)
- Receive: `{ type: "tool_call", agentId: "abc", tool: "...", input: "...", output: "..." }`
- Receive: `{ type: "done", agentId: "abc" }`
- Receive: `{ type: "error", agentId: "abc", message: "..." }`

### Agent Management

- Agents stored in `Map<id, AgentSession>` in memory.
- Each AgentSession: id, name, workingDirectory, conversationHistory, status (idle/busy/error).
- Each agent runs Claude SDK `claude()` in its own async context.

## Frontend (React 19 + Tailwind CSS + Vite)

### Sidebar (~280px, left)

- "New Agent" button — opens form with name + working directory inputs.
- Agent list: name, working directory, status dot (green=idle, yellow=busy, red=error).
- Click to select, delete button with confirmation.

### Chat Panel (main area)

- Message list: user messages right, agent responses left.
- Tool calls rendered as collapsible cards (tool name + summary header, expandable detail).
- Real-time streaming text display.
- Input bar at bottom: text field + send button.

### Tech

- React 19, Tailwind CSS, Vite.
- Single WebSocket connection multiplexed by agentId.

## Project Structure

```
/app/
  server/
    index.js          # Express + WebSocket + static serving
    agents.js         # Claude SDK agent session management
  client/
    src/
      App.jsx
      components/
        Sidebar.jsx
        ChatPanel.jsx
        MessageList.jsx
        ToolCallCard.jsx
        NewAgentForm.jsx
    index.html
    vite.config.js
    tailwind.config.js
  package.json
```

## Container Changes

### Dockerfile additions

- Copy `/app` source into container.
- `npm install && npm run build` to build frontend at image build time.

### docker-compose changes

- Expose port 3001.
- Entrypoint script starts Node backend + keeps container alive.

### Startup flow

1. Container starts, entrypoint runs.
2. Node backend starts on port 3001, serves React build + WebSocket.
3. Container stays alive for `docker exec` terminal access.
4. User opens `http://localhost:3001` in browser.

## Error Handling

- Agent SDK errors sent to client via WebSocket, agent status set to "error".
- Auth errors show banner in UI directing user to re-auth via terminal.
- WebSocket auto-reconnects, re-fetches agent list and history on reconnect.
- Conversation history in memory only (ephemeral, lost on restart).
- Deleting an agent aborts any in-flight SDK call.
