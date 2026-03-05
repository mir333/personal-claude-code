# File Attachment Chips Design

## Problem

Currently, when files are attached via the paperclip button, their content is injected directly into the textarea as XML `<file>` tags. This clutters the input, is confusing to users, and makes it hard to manage attached files.

## Solution

Replace the direct textarea injection with a separate `attachedFiles` state. Show attached files as compact badge chips above the textarea with a file icon and remove button. On send, transparently prepend the XML `<file>` tags to the message.

## Approach: Separate state, inject at send time

### State

- New state: `attachedFiles` — array of `{ name: string, content: string }`
- `handleFileSelect` pushes to `attachedFiles` instead of injecting into textarea
- `removeFile(index)` removes a file from the array
- On submit, prepend XML `<file>` tags from `attachedFiles` to message text, then clear both

### UI

File chips row appears above the textarea, only when files are attached:

```
┌─────────────────────────────────────────────┐
│ [📄 report.txt ✕] [📄 data.csv ✕]          │  ← chips row
├─────────────────────────────────────────────┤
│ Type your message...                        │  ← clean textarea
├─────────────────────────────────────────────┤
│ [📎] [🔲]                          [Send]   │  ← actions
└─────────────────────────────────────────────┘
```

### Chip component

- Uses existing `Badge` component with `variant="secondary"`
- `FileText` icon (lucide-react) for file indicator
- `X` icon (lucide-react) for remove button
- `flex flex-wrap gap-2` layout with padding
- Subtle bottom border to separate from textarea
- Responsive: wraps naturally on mobile, badges shrink text with `truncate` and `max-w` to prevent overflow

### Mobile considerations

- Chips row uses `flex-wrap` so badges stack on narrow screens
- Each badge has `max-w-[200px] truncate` so long filenames don't blow out the layout
- The chips row sits inside the same card/container as the textarea, keeping the visual grouping tight
- Touch targets for the X button are at least 24x24px for easy tapping

### No backend changes required

The XML `<file>` tag format is preserved — the only change is when it gets injected (at send time instead of at file-select time).
