# Task Webhooks Design

## Overview

Allow tasks to be triggered via HTTP webhook. Each task can have a unique webhook URL with an auto-generated secret token. Callers can send an arbitrary payload that gets appended to the task prompt as context.

## Data Model

Add `webhookToken` field to the task object:

```javascript
{
  // ... existing task fields
  webhookToken: string | null  // 32 random bytes, hex-encoded (64 chars)
}
```

Generated via `crypto.randomBytes(32).toString('hex')`. Null means webhooks are disabled for that task.

## API Endpoints

### Public (no session auth)

**`POST /api/webhooks/tasks/:taskId/:token`**

- Mounted before `requireAuth` middleware
- Validates token via `crypto.timingSafeEqual` against stored `webhookToken`
- Accepts any content type — reads raw body as string
- Triggers task execution with payload injected into prompt
- Returns 404 if task not found or token invalid (don't leak which)
- Returns 409 if task is already running
- Returns 200 with `{ ok: true, runId }` on success
- Body size limit: 100KB

### Authenticated

**`POST /api/tasks/:id/webhook-token`**

- Generates or regenerates webhook token for the task
- Returns `{ webhookToken, webhookUrl }` where URL is the full callable URL

**`DELETE /api/tasks/:id/webhook-token`**

- Revokes webhook token (sets to null)
- Returns 204

## Payload Injection

When the webhook is called with a non-empty body, the task prompt is augmented:

```
<original prompt>

---
The following payload was received via webhook:
<raw body content>
---
```

If the body is empty, the task runs with just its original prompt.

## Security

- Token validated with `crypto.timingSafeEqual` to prevent timing attacks
- Webhook endpoint returns generic 404 for both missing tasks and invalid tokens
- Reuses existing running-task guard (409 if already running)
- 100KB body size limit on webhook endpoint
- Token is 64 hex chars (256 bits of entropy)

## UI Changes

Add a "Webhook" section to the task detail/edit view:

- When no token exists: "Enable Webhook" button
- When token exists: display copyable webhook URL, "Regenerate" and "Revoke" buttons
- Show a note that regenerating invalidates the old URL

## Task Execution Changes

Modify `executeTask()` to accept an optional `payload` parameter. When present, append the payload context block to the prompt before sending to the agent.
