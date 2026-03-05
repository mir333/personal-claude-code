# Workspace Refresh & Chat Pagination Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a refresh button to reload workspaces/git branches, and paginate chat history to load only the last 50 messages with scroll-to-top loading.

**Architecture:** Two independent features. Feature 1 is a simple UI button + callback wiring. Feature 2 requires server-side pagination (query params on the history endpoint), client-side state shape change from array to `{ entries, total, hasMore }`, and a scroll-to-top handler with position preservation.

**Tech Stack:** React 19, Tailwind CSS 4, Express 5, lucide-react icons, custom ScrollArea component.

---

### Task 1: Workspace Refresh Button — Sidebar UI

**Files:**
- Modify: `app/client/src/components/Sidebar.jsx:2` (imports)
- Modify: `app/client/src/components/Sidebar.jsx:398-417` (props)
- Modify: `app/client/src/components/Sidebar.jsx:549-551` (Workspace header)

**Step 1: Add `RefreshCw` to Sidebar imports**

In `app/client/src/components/Sidebar.jsx` line 2, add `RefreshCw` to the lucide-react import:
```jsx
import { FolderOpen, Plus, Circle, BellRing, BellOff, GitBranch, Settings, Loader2, Download, ChevronDown, Search, LogOut, Clock, RefreshCw } from "lucide-react";
```

**Step 2: Add `onRefresh` prop to Sidebar**

In the destructured props at line 398-417, add `onRefresh` after `onBranchChange`:
```jsx
  onBranchChange,
  onRefresh,
  directories,
```

**Step 3: Add local refreshing state and handler**

Inside the Sidebar function body (after the existing `useState` declarations around line 421), add:
```jsx
const [refreshing, setRefreshing] = useState(false);

const handleRefresh = async () => {
  if (refreshing) return;
  setRefreshing(true);
  try {
    await onRefresh();
  } finally {
    setRefreshing(false);
  }
};
```

**Step 4: Replace the Workspace header with a flex row containing the refresh button**

Replace lines 549-551 (the `<p>Workspace</p>` element) with:
```jsx
<div className="flex items-center justify-between px-2 py-1.5">
  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
    Workspace
  </p>
  <button
    onClick={handleRefresh}
    disabled={refreshing}
    className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
    title="Refresh workspaces and git status"
  >
    <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
  </button>
</div>
```

**Step 5: Commit**
```bash
git add app/client/src/components/Sidebar.jsx
git commit -m "feat: add refresh button to Workspace header in sidebar"
```

---

### Task 2: Workspace Refresh Button — App.jsx Wiring

**Files:**
- Modify: `app/client/src/App.jsx:564-583` (Sidebar props)

**Step 1: Add `onRefresh` prop to the Sidebar component in App.jsx**

In `app/client/src/App.jsx`, in the `<Sidebar>` JSX around line 564-583, add the `onRefresh` prop after `onBranchChange`:
```jsx
onBranchChange={fetchGitStatus}
onRefresh={async () => {
  await Promise.all([
    fetchDirectories(),
    fetchAgents(),
    fetchAllGitStatuses(),
  ]);
}}
directories={directories}
```

**Step 2: Build and verify**

Run: `cd /workspace/miro/personal-claude-code/app && npm run build`
Expected: Build succeeds with no errors.

**Step 3: Commit**
```bash
git add app/client/src/App.jsx
git commit -m "feat: wire onRefresh callback to Sidebar for workspace reload"
```

---

### Task 3: Server-Side History Pagination

**Files:**
- Modify: `app/server/storage.js` (add `loadConversationSlice`)
- Modify: `app/server/agents.js:67-71` (update `getHistory` signature)
- Modify: `app/server/index.js:557-562` (update history endpoint)

**Step 1: Add `loadConversationSlice` to storage.js**

In `app/server/storage.js`, add after the existing `loadConversation` function (after line 37):
```js
export function loadConversationSlice(workDir, limit = 50, offset = 0) {
  const all = loadConversation(workDir);
  const total = all.length;
  if (limit <= 0) return { entries: all, total };
  const start = Math.max(0, total - offset - limit);
  const end = total - offset;
  const entries = all.slice(Math.max(start, 0), Math.max(end, 0));
  return { entries, total };
}
```

**Step 2: Update `getHistory` in agents.js**

Replace the `getHistory` function at lines 67-71 of `app/server/agents.js`:
```js
export function getHistory(id, limit, offset) {
  const agent = agents.get(id);
  if (!agent) return null;
  if (limit != null) {
    return loadConversationSlice(agent.workingDirectory, limit, offset);
  }
  return loadConversation(agent.workingDirectory);
}
```

Update the import at line 4 to include `loadConversationSlice`:
```js
import { loadConversation, appendEntry, loadConversationSlice } from "./storage.js";
```

**Step 3: Update the history endpoint in server/index.js**

Replace lines 557-562:
```js
app.get("/api/agents/:id/history", (req, res) => {
  const agent = getAgent(req.params.id);
  if (!agent) return res.status(404).json({ error: "Agent not found" });
  const limit = req.query.limit != null ? parseInt(req.query.limit, 10) : undefined;
  const offset = req.query.offset != null ? parseInt(req.query.offset, 10) : 0;
  const history = getHistory(req.params.id, limit, offset);
  res.json(history);
});
```

Note: When `limit` is undefined, `getHistory` returns a plain array (backward compatible). When `limit` is provided, returns `{ entries, total }`.

**Step 4: Build and verify**

Run: `cd /workspace/miro/personal-claude-code/app && npm run build`
Expected: Build succeeds.

**Step 5: Commit**
```bash
git add app/server/storage.js app/server/agents.js app/server/index.js
git commit -m "feat: add server-side pagination for chat history endpoint"
```

---

### Task 4: Client-Side Paginated History Loading

**Files:**
- Modify: `app/client/src/App.jsx:27-35` (state declarations)
- Modify: `app/client/src/App.jsx:194` (selectedConversation derivation)
- Modify: `app/client/src/App.jsx:321-335` (initial history fetch)

**Step 1: Change conversations state shape**

The conversations state currently stores `{ [agentId]: entry[] }`. Update the type to store `{ [agentId]: { entries: entry[], total: number, hasMore: boolean } }`.

No code change needed to the `useState` declaration since it starts as `{}`. But every place that reads or writes `conversations[agentId]` must be updated.

**Step 2: Update `selectedConversation` derivation (line 194)**

Replace:
```js
const selectedConversation = conversations[selectedAgentId] || [];
```
With:
```js
const selectedConversation = conversations[selectedAgentId]?.entries || [];
```

**Step 3: Update initial history fetch (lines 321-335)**

Replace the history fetch `useEffect`:
```js
useEffect(() => {
  if (!selectedAgentId) return;
  if (conversations[selectedAgentId]?.entries?.length) return;
  fetch(`/api/agents/${selectedAgentId}/history?limit=50&offset=0`)
    .then((r) => r.ok ? r.json() : { entries: [], total: 0 })
    .then(({ entries, total }) => {
      if (entries.length > 0 || total === 0) {
        setConversations((prev) => {
          if (prev[selectedAgentId]?.entries?.length) return prev;
          return {
            ...prev,
            [selectedAgentId]: { entries, total, hasMore: entries.length < total },
          };
        });
      }
    })
    .catch(() => {});
  // Recover pending question state from server
  fetch(`/api/agents/${selectedAgentId}`)
    .then((r) => r.ok ? r.json() : null)
    .then((data) => {
      if (data?.pendingQuestion) {
        setPendingQuestions((prev) => ({
          ...prev,
          [selectedAgentId]: { input: data.pendingQuestion.input, toolUseId: data.pendingQuestion.toolUseId },
        }));
      }
      if (data?.interactiveQuestions !== undefined) {
        setInteractiveQuestions((prev) => ({ ...prev, [selectedAgentId]: !!data.interactiveQuestions }));
      }
    })
    .catch(() => {});
}, [selectedAgentId]);
```

**Step 4: Update all WebSocket message handlers that write to conversations**

Every `setConversations` call in the `handleWsMessage` callback (lines 83-156) currently uses patterns like `prev[agentId] || []`. These must change to work with the new shape. The pattern is:

Old pattern:
```js
const conv = prev[agentId] || [];
return { ...prev, [agentId]: [...conv, newEntry] };
```

New pattern:
```js
const data = prev[agentId] || { entries: [], total: 0, hasMore: false };
return { ...prev, [agentId]: { ...data, entries: [...data.entries, newEntry], total: data.total + 1 } };
```

Apply this pattern to ALL `setConversations` calls in `handleWsMessage`:

1. **`message_dequeued` (line 83-89)**: Map over `.entries` instead of the array directly
2. **`agent_status` (line 95-103)**: When reloading from server, use the paginated endpoint
3. **`text_delta` (line 107-114)**: Append to `.entries`
4. **`tool_call` (line 117-120)**: Append to `.entries`
5. **`tool_result` (line 122-125)**: Append to `.entries`
6. **`done` (line 127-140)**: Append to `.entries`
7. **`error` (line 148-151)**: Append to `.entries`

Also update `handleServerRestart` (around line 162) which iterates `Object.entries(prev)`.

**Step 5: Update the `agent_status` handler's history reload**

The `agent_status` handler (lines 92-103) reloads the full conversation from disk. Change it to use paginated endpoint:
```js
if (type === "agent_status") {
  updateAgentStatus(agentId, rest.status);
  fetch(`/api/agents/${agentId}/history?limit=50&offset=0`)
    .then((r) => r.ok ? r.json() : { entries: [], total: 0 })
    .then(({ entries, total }) => {
      if (entries.length > 0) {
        setConversations((prev) => ({
          ...prev,
          [agentId]: { entries, total, hasMore: entries.length < total },
        }));
      }
    })
    .catch(() => {});
  return;
}
```

**Step 6: Build and verify**

Run: `cd /workspace/miro/personal-claude-code/app && npm run build`
Expected: Build succeeds with no errors.

**Step 7: Commit**
```bash
git add app/client/src/App.jsx
git commit -m "feat: load only last 50 messages initially with paginated state shape"
```

---

### Task 5: Scroll-to-Top Load More

**Files:**
- Modify: `app/client/src/App.jsx` (ScrollArea ref, scroll handler, loading spinner)

**Step 1: Add refs for scroll handling**

Near the existing `messagesEndRef` (line 41), add:
```js
const scrollAreaRef = useRef(null);
const isLoadingMoreRef = useRef(false);
```

**Step 2: Add the loadMore function**

After the initial history fetch `useEffect` (around line 351), add:
```js
const loadMoreMessages = useCallback(async () => {
  if (!selectedAgentId) return;
  const conv = conversations[selectedAgentId];
  if (!conv || !conv.hasMore || isLoadingMoreRef.current) return;
  isLoadingMoreRef.current = true;

  const scrollEl = scrollAreaRef.current?.querySelector("[data-scroll-viewport]");
  const prevScrollHeight = scrollEl?.scrollHeight || 0;

  try {
    const offset = conv.entries.length;
    const res = await fetch(`/api/agents/${selectedAgentId}/history?limit=50&offset=${offset}`);
    if (!res.ok) return;
    const { entries: older, total } = await res.json();
    if (older.length === 0) return;

    setConversations((prev) => {
      const existing = prev[selectedAgentId];
      if (!existing) return prev;
      const merged = [...older, ...existing.entries];
      return {
        ...prev,
        [selectedAgentId]: {
          entries: merged,
          total,
          hasMore: merged.length < total,
        },
      };
    });

    // Preserve scroll position after React renders
    requestAnimationFrame(() => {
      if (scrollEl) {
        const newScrollHeight = scrollEl.scrollHeight;
        scrollEl.scrollTop = newScrollHeight - prevScrollHeight;
      }
    });
  } catch {
    // ignore fetch errors
  } finally {
    isLoadingMoreRef.current = false;
  }
}, [selectedAgentId, conversations]);
```

**Step 3: Add scroll event listener**

After the `loadMoreMessages` function, add a `useEffect` for scroll detection:
```js
useEffect(() => {
  const scrollEl = scrollAreaRef.current?.querySelector("[data-scroll-viewport]");
  if (!scrollEl) return;

  const handleScroll = () => {
    if (scrollEl.scrollTop < 50) {
      loadMoreMessages();
    }
  };

  scrollEl.addEventListener("scroll", handleScroll, { passive: true });
  return () => scrollEl.removeEventListener("scroll", handleScroll);
}, [loadMoreMessages]);
```

**Step 4: Update ScrollArea to expose the scrollable viewport**

In `app/client/src/components/ui/scroll-area.jsx`, add `data-scroll-viewport` to the inner div so we can find it:
```jsx
const ScrollArea = React.forwardRef(({ className, children, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("relative overflow-hidden", className)}
    {...props}
  >
    <div data-scroll-viewport className="h-full w-full overflow-y-auto overflow-x-hidden scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent">
      {children}
    </div>
  </div>
));
```

**Step 5: Add `ref={scrollAreaRef}` to the chat ScrollArea in App.jsx**

In `App.jsx` around line 616, update the chat ScrollArea:
```jsx
<ScrollArea ref={scrollAreaRef} className="flex-1 p-4">
```

**Step 6: Add loading spinner at top of chat**

Inside the ScrollArea, before `{groupedConversation.map(...)}` (line 617), add:
```jsx
{conversations[selectedAgentId]?.hasMore && (
  <div className="flex justify-center py-2">
    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
  </div>
)}
```

Add `Loader2` to the lucide-react import in App.jsx if not already present (check line 4-ish).

**Step 7: Build and verify**

Run: `cd /workspace/miro/personal-claude-code/app && npm run build`
Expected: Build succeeds with no errors.

**Step 8: Commit**
```bash
git add app/client/src/App.jsx app/client/src/components/ui/scroll-area.jsx
git commit -m "feat: add scroll-to-top pagination for loading older chat messages"
```

---

### Task 6: Final Integration Verification

**Step 1: Full build**

Run: `cd /workspace/miro/personal-claude-code/app && npm run build`
Expected: Clean build, no errors.

**Step 2: Manual review checklist**
- [ ] Refresh button visible next to "Workspace" header
- [ ] Refresh button spins while loading
- [ ] Chat loads only last 50 messages initially
- [ ] Scrolling to top loads older messages
- [ ] Scroll position preserved when older messages load
- [ ] Loading spinner shows at top when there are more messages
- [ ] New real-time messages still append correctly
- [ ] Agent status changes still work

**Step 3: Final commit (if any fixups needed)**
```bash
git add -A
git commit -m "fix: integration fixes for workspace refresh and chat pagination"
```
