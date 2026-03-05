# File Attachment Chips Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace inline file content injection with visual file chips (badges) above the textarea, with remove buttons, working on both desktop and mobile.

**Architecture:** Add `attachedFiles` state to `ChatInput`. On file select, store file metadata + content in state instead of injecting into textarea. Render removable badge chips above textarea. On send, prepend XML `<file>` tags transparently.

**Tech Stack:** React 19, lucide-react (FileText, X icons), existing Badge component, Tailwind CSS

---

### Task 1: Add attachedFiles state and update handleFileSelect

**Files:**
- Modify: `app/client/src/App.jsx:696` (add state)
- Modify: `app/client/src/App.jsx:731-764` (rewrite handleFileSelect)

**Step 1: Add new state after existing `text` state (line 696)**

Add this line after `const [text, setText] = useState("");`:

```javascript
const [attachedFiles, setAttachedFiles] = useState([]);
```

**Step 2: Rewrite handleFileSelect (lines 731-764)**

Replace the entire `handleFileSelect` function with:

```javascript
function handleFileSelect(e) {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;

  files.forEach((file) => {
    const reader = new FileReader();
    reader.onload = () => {
      setAttachedFiles((prev) => [...prev, { name: file.name, content: reader.result }]);
    };
    reader.onerror = () => {
      setAttachedFiles((prev) => [...prev, { name: file.name, content: "[Error: could not read file]" }]);
    };
    reader.readAsText(file);
  });

  e.target.value = "";
}
```

**Step 3: Add removeFile function right after handleFileSelect**

```javascript
function removeFile(index) {
  setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
}
```

**Step 4: Verify the app builds without errors**

Run: `cd /workspace/miro/personal-claude-code/app && npm run build 2>&1 | tail -5`
Expected: Build succeeds (no functional change yet in UI rendering or submission)

**Step 5: Commit**

```bash
git add app/client/src/App.jsx
git commit -m "refactor: store attached files in state instead of injecting into textarea"
```

---

### Task 2: Update handleSubmit to inject files at send time

**Files:**
- Modify: `app/client/src/App.jsx:713-722` (handleSubmit)

**Step 1: Rewrite handleSubmit to prepend file content on send**

Replace the `handleSubmit` function with:

```javascript
function handleSubmit(e) {
  e?.preventDefault();
  const hasFiles = attachedFiles.length > 0;
  const hasText = text.trim().length > 0;
  if (!hasFiles && !hasText) return;

  let message = "";
  if (hasFiles) {
    const fileParts = attachedFiles.map(
      (f) => `<file path="${f.name}">\n${f.content}\n</file>`
    );
    message = fileParts.join("\n") + "\n";
  }
  if (hasText) {
    message += text;
  }

  onSend(message);
  setText("");
  setAttachedFiles([]);
  if (textareaRef.current) {
    textareaRef.current.style.height = "auto";
  }
}
```

**Step 2: Update the send button disabled condition**

Find (line ~846):
```javascript
disabled={!text.trim()}
```

Replace with:
```javascript
disabled={!text.trim() && attachedFiles.length === 0}
```

This allows sending files even with an empty text message.

**Step 3: Verify the app builds**

Run: `cd /workspace/miro/personal-claude-code/app && npm run build 2>&1 | tail -5`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add app/client/src/App.jsx
git commit -m "feat: inject attached files at send time instead of on select"
```

---

### Task 3: Add imports for Badge, FileText, X icons

**Files:**
- Modify: `app/client/src/App.jsx:1-2` (imports)

**Step 1: Add FileText and X to the lucide-react import (line 2)**

Change:
```javascript
import { Send, Square, Trash2, Menu, TerminalSquare, MessageCircleQuestion, Paperclip, WifiOff, Copy, CopyCheck } from "lucide-react";
```

To:
```javascript
import { Send, Square, Trash2, Menu, TerminalSquare, MessageCircleQuestion, Paperclip, WifiOff, Copy, CopyCheck, FileText, X } from "lucide-react";
```

**Step 2: Add Badge import after the Button import (after line 10)**

Add:
```javascript
import { Badge } from "@/components/ui/badge";
```

**Step 3: Verify build**

Run: `cd /workspace/miro/personal-claude-code/app && npm run build 2>&1 | tail -5`

**Step 4: Commit**

```bash
git add app/client/src/App.jsx
git commit -m "chore: add imports for Badge, FileText, X icons"
```

---

### Task 4: Render file chips above the textarea

**Files:**
- Modify: `app/client/src/App.jsx` (inside ChatInput return JSX, before the textarea)

**Step 1: Add file chips row inside the form, between the `<div className="flex gap-2 items-end">` opening and the textarea**

Find the textarea element (line ~810):
```javascript
        <textarea
          ref={textareaRef}
```

Insert this block **immediately before** the `<textarea`:

```jsx
        {attachedFiles.length > 0 && (
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap gap-1.5 px-3 py-2 border border-input border-b-0 rounded-t-md bg-muted/30">
              {attachedFiles.map((file, idx) => (
                <Badge
                  key={idx}
                  variant="secondary"
                  className="gap-1 pl-1.5 pr-1 py-0.5 max-w-[200px] cursor-default"
                >
                  <FileText className="h-3 w-3 shrink-0" />
                  <span className="truncate text-xs">{file.name}</span>
                  <button
                    type="button"
                    onClick={() => removeFile(idx)}
                    className="ml-0.5 rounded-sm hover:bg-foreground/10 p-0.5 shrink-0"
                    title={`Remove ${file.name}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          </div>
        )}
```

**Step 2: Adjust textarea border radius when files are attached**

The textarea should lose its top border-radius when chips are shown above it, creating a seamless visual connection.

Find the textarea className:
```javascript
className="flex-1 resize-none overflow-y-auto rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
```

Replace with:
```javascript
className={cn(
  "flex-1 resize-none overflow-y-auto border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
  attachedFiles.length > 0 ? "rounded-b-md rounded-t-none border-t-0" : "rounded-md"
)}
```

**Note on layout:** The chips row and textarea need to be grouped together. We need to wrap them in a flex-col container so the chips sit directly above the textarea.

Find the current structure around the textarea:
```jsx
      <div className="flex gap-2 items-end">
        {/* desktop icon buttons... */}
        <textarea ... />
        {/* send/stop/reconnect buttons */}
      </div>
```

Wrap the chips + textarea in a `div` with `flex-1 flex flex-col min-w-0`:

Replace the section from `<input ref={fileInputRef}` through `</textarea>` closing with:

```jsx
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileSelect}
        />
        <div className="flex-1 flex flex-col min-w-0">
          {attachedFiles.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-3 py-2 border border-input border-b-0 rounded-t-md bg-muted/30">
              {attachedFiles.map((file, idx) => (
                <Badge
                  key={idx}
                  variant="secondary"
                  className="gap-1 pl-1.5 pr-1 py-0.5 max-w-[200px] cursor-default"
                >
                  <FileText className="h-3 w-3 shrink-0" />
                  <span className="truncate text-xs">{file.name}</span>
                  <button
                    type="button"
                    onClick={() => removeFile(idx)}
                    className="ml-0.5 rounded-sm hover:bg-foreground/10 p-0.5 shrink-0"
                    title={`Remove ${file.name}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={connected ? "Send a message..." : "Connecting..."}
            disabled={!connected}
            rows={1}
            className={cn(
              "w-full resize-none overflow-y-auto border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
              attachedFiles.length > 0 ? "rounded-b-md rounded-t-none border-t-0" : "rounded-md"
            )}
            style={{ maxHeight: "25vh" }}
          />
        </div>
```

**Step 3: Verify the app builds and renders correctly**

Run: `cd /workspace/miro/personal-claude-code/app && npm run build 2>&1 | tail -5`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add app/client/src/App.jsx
git commit -m "feat: render file attachment chips above textarea with remove buttons"
```

---

### Task 5: Manual smoke test

**Step 1: Start the dev server and test**

Run: `cd /workspace/miro/personal-claude-code/app && npm run dev`

Test the following scenarios:
1. Click paperclip → select a file → chip appears above textarea, textarea stays clean
2. Click X on a chip → chip is removed
3. Attach multiple files → all chips show, wrapping on narrow screens
4. Attach file + type message → send → both file content and message are sent, chips and text clear
5. Attach file with no message → send button is enabled → sends just the file
6. Resize to mobile width → chips wrap properly, paperclip in mobile row still works
7. Long filename → truncated with ellipsis at 200px max width

**Step 2: Final commit if any fixes were needed**

```bash
git add app/client/src/App.jsx
git commit -m "fix: polish file attachment chips UI"
```
