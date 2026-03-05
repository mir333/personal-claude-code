# Workspace Refresh Button & Chat History Pagination

## Feature 1: Workspace Refresh Button

### Problem
The workspace list and git branch names are only loaded on initial page load. If branches change externally (new branch created, pushed commits, etc.), the UI is stale until a full page reload.

### Design
Add a `RefreshCw` icon button next to the "Workspace" header text in the sidebar. Clicking it:

1. Re-fetches workspace directories (`fetchDirectories()`)
2. Re-fetches all agents (`fetchAgents()`)
3. Re-fetches git statuses for all agents (`fetchAllGitStatuses()`)
4. Shows a spinning animation on the icon while any fetch is in flight

**Props flow:** App.jsx passes an `onRefresh` callback to Sidebar, which calls all three fetch functions and resolves when all complete.

**UI:** Small `RefreshCw` icon (h-3.5 w-3.5) inline with the "Workspace" `<p>` tag, right-aligned. Uses `animate-spin` class while loading. Muted foreground color, brighter on hover.

### Files changed
- `Sidebar.jsx` — add refresh button next to "Workspace" header, accept `onRefresh` prop
- `App.jsx` — pass `onRefresh` callback that calls `fetchDirectories`, `fetchAgents`, `fetchAllGitStatuses`

---

## Feature 2: Chat History Pagination

### Problem
The entire conversation history is loaded from disk on agent selection. For long conversations (thousands of entries), this causes slow initial loads and high memory usage.

### Design
Server-side pagination: load only the last 50 entries initially, load more on scroll-to-top.

### Server changes
**`GET /api/agents/:id/history`** — add optional query params:
- `limit` (default: 50) — number of entries to return
- `offset` (default: 0) — offset from the end (0 = most recent)

Response changes from `[entries]` to `{ entries, total }`.

**`storage.js`** — add `loadConversationSlice(workDir, limit, offset)` that reads the full file but returns only the requested slice plus total count. (Full file read is unavoidable with JSON storage, but we limit what goes over the wire.)

### Client changes

**State shape change:** `conversations` values change from `entry[]` to:
```js
{ entries: entry[], total: number, hasMore: boolean }
```

**Initial load:** Fetch with default limit=50. Set `hasMore = total > entries.length`.

**Scroll-to-top loading:**
- Detect when ScrollArea scrollTop reaches 0 (or near 0, e.g. < 50px)
- Fetch next 50 older entries with `offset = currentEntries.length`
- Prepend to existing entries
- Preserve scroll position: measure scrollHeight before prepend, after React renders set `scrollTop += (newScrollHeight - oldScrollHeight)`
- Show a small `Loader2` spinner at the top while fetching
- Set `hasMore = false` when `entries.length >= total`

**Debounce:** Add a loading guard (`isLoadingMore` ref) to prevent duplicate fetches on rapid scroll.

**New messages:** Real-time WebSocket messages continue to append normally. They don't affect `total` (which is only used to know if older messages exist).

### Files changed
- `server/storage.js` — add `loadConversationSlice(workDir, limit, offset)`
- `server/index.js` — update history endpoint to accept `limit`/`offset`, return `{ entries, total }`
- `App.jsx` — update conversation state shape, initial fetch with limit, add scroll-to-top handler with position preservation, loading spinner
- `hooks/useAgents.js` or new `hooks/useConversation.js` — optional extraction of conversation logic

### Edge cases
- **Empty conversation:** `total=0`, `hasMore=false`, no load-more triggers
- **Conversation shorter than 50:** Single fetch gets everything, `hasMore=false`
- **New messages arrive while loading more:** Append new messages normally; offset-based loading from the end still works since we track count of already-loaded entries
- **Agent status reload:** When agent goes idle, server reloads conversation from disk — this should respect the current loaded window (re-fetch only the tail, not reset everything)
