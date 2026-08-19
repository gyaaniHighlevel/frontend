# Genesis - low-level design

AI-powered HighLevel app builder. Vue 3 + TypeScript + shadcn-vue frontend, Firebase backend (Auth, Firestore, Cloud Functions gen 2), Anthropic Messages API for generation, HighLevel REST APIs for CRM data.

| | |
|---|---|
| Status | Draft for implementation |
| Depends on | HLD (three-tier architecture, proxy pattern, fixed three-file contract) |
| Out of scope | CI/CD pipeline details, load testing, multi-location support |

---

## 1. Design decisions and system invariants

Decisions locked during HLD, restated here because every section below assumes them:

1. Proxy pattern for all HighLevel access. HighLevel OAuth tokens live server-side only. Generated apps call `window.hl.*`, which forwards to a Cloud Function proxy. Tokens never appear in generated code, Firestore client-readable docs, snapshots, or the browser.
2. Fixed three-file contract. The LLM emits at most `index.html` (body markup), `app.js` (ESM module), `styles.css`. The platform owns the document shell, import map, Tailwind, and the `hl-sdk.js` shim. This turns path validation into set membership and makes the preview builder deterministic.
3. REST, not MCP, for the runtime data path. HighLevel's official MCP server authenticates with a Private Integration Token, which sidesteps the graded OAuth requirement and still needs a server-side credential holder. MCP stays a possible generation-time grounding tool, recorded as a future improvement.
4. Content-addressed snapshots. File contents live in immutable `blobs/{sha256}` docs; snapshots are manifests of `path → sha256`. Cheap snapshots, dedupe across generations, diff view falls out for free.
5. Single call per generation turn. No planner/coder/reviewer chain. Reliability comes from a constrained contract, a streaming validator, one bounded repair pass, and a user-triggered runtime-error loop.
6. Full iframe reload per generation and per restore. The preview always equals the head snapshot exactly. No incremental patching, no drift.

System invariants - violating any of these is a bug, not a tradeoff:

- INV-1 `headSnapshotId` only ever moves to a snapshot built from a fully validated generation, a manual save commit, or a restore. Partial LLM output never becomes a snapshot.
- INV-2 A client can never read `hlConnections/{uid}` or any field containing token material. Enforced by security rules, verified by an emulator test.
- INV-3 At most one generation per project is in `streaming` state (single-flight), enforced by a Firestore transaction, with an orphan-takeover rule for crashed instances (§7.1).
- INV-4 Blobs are immutable and content-addressed. Writing the same sha twice is a no-op; orphan blobs are harmless garbage, never dangling references.
- INV-5 The preview iframe runs with an opaque origin (`sandbox="allow-scripts"`, never `allow-same-origin`) and a CSP whose `connect-src` lists only the proxy URL.
- INV-6 Every SSE stream terminates with exactly one `done` or one `error` event, even on upstream failure, so the client state machine always resolves.

---

## 2. Component inventory and repository layout

```
/functions                  Firebase Cloud Functions (Node 20, TypeScript)
  src/
    oauth/start.ts          GET  /oauth/hl/start        (redirect w/ state)
    oauth/callback.ts       GET  /oauth/hl/callback     (code exchange)
    proxy/index.ts          ALL  /hl/*                  (10 whitelisted routes)
    generate/index.ts       POST /generate              (SSE orchestrator)
    generate/parser.ts      streaming tag parser (pure, unit-testable)
    generate/context.ts     context assembly + grounding fetch
    generate/commit.ts      validation gates + snapshot commit
    projects/index.ts       callable: create/rename/softDelete/restore project
    snapshots/index.ts      callable: listSnapshots, restoreSnapshot
    lib/hlClient.ts         HL REST client, token refresh transaction
    lib/crypto.ts           AES-256-GCM envelope encrypt/decrypt
    lib/sse.ts              SSE framing + heartbeat helper
    lib/errors.ts           error taxonomy (§12.2)
/frontend                   Vue 3 + Vite + TS + shadcn-vue
  src/
    stores/                 auth.ts, projects.ts, workspace.ts (files/generation/preview)
    lib/sseClient.ts        fetch-based SSE reader
    lib/previewBuilder.ts   buildSrcdoc()
    assets/hl-sdk.js        shim source, inlined at build time
    components/             ChatPanel, EditorPanel, PreviewPanel, SnapshotSheet, ConnectHL
    views/                  Auth, Dashboard, Workspace
firebase.json  .firebaserc  firestore.rules  firestore.indexes.json  .env.example
```

Runtime dependencies pinned in `/functions`: `firebase-admin`, `firebase-functions` (v2 API), `@anthropic-ai/sdk`, `acorn`, `zod` (request schemas). Frontend: `vue`, `pinia`, `vue-router`, `@guolao/vue-monaco-editor`, `shadcn-vue` components, `lucide-vue-next`.

---

## 3. App authentication (Firebase Auth)

### 3.1 Flows

Email + password via the Firebase JS SDK. `createUserWithEmailAndPassword` on sign-up, then a `users/{uid}` profile doc is created client-side (rules allow create where `request.auth.uid == uid`). Sign-in with `signInWithEmailAndPassword`. Session persistence is the SDK default (`browserLocalPersistence`, IndexedDB) - survives refresh with no custom code, which satisfies the assignment's persistence requirement.

Router integration: the app boots into a splash state until the first `onAuthStateChanged` callback fires, then routes. Guards read a Pinia `auth` store hydrated from that listener, never `auth.currentUser` directly (it is `null` synchronously on cold load - the classic redirect-loop bug).

ID tokens: obtained per-request with `user.getIdToken()` (SDK caches and auto-refreshes ~5 minutes before the 60-minute expiry). `onIdTokenChanged` feeds two consumers: the workspace store (re-sends the token to the preview iframe, §9.4) and nothing else - backend calls fetch a fresh token at call time.

### 3.2 Edge cases

| Case | Behavior |
|---|---|
| `auth/email-already-in-use` | Inline field error, offer switch to sign-in |
| `auth/weak-password`, `auth/invalid-email` | Inline field errors from SDK error codes |
| Cold page load, deep link to `/p/:projectId` | Splash until auth resolves; unauthenticated → `/signin?next=…` |
| ID token expired mid-session | SDK refresh is transparent; a 401 from our functions triggers one forced `getIdToken(true)` retry, then sign-out |
| Multiple tabs | Fine for auth (shared persistence). Generation single-flight handles the workspace race (§7.1) |
| Account deleted server-side while session live | Backend `verifyIdToken` fails with `auth/user-not-found` → 401 → client signs out |

Deliberately not built (recorded in README improvements): email verification, password reset, anonymous auth.

---

## 4. HighLevel OAuth subsystem

### 4.1 Connect flow, step by step

1. Dashboard shows a Connect HighLevel button when `users/{uid}.hl.connected != true`. Click → `GET {functionsBase}/oauth/hl/start` with the Firebase ID token in `Authorization`.
2. `start` verifies the token, generates `state = base64url(randomBytes(32))`, writes `oauthStates/{state} = { uid, createdAt, expireAt: now+10m }`, and 302-redirects to:
   ```
   https://marketplace.gohighlevel.com/oauth/chooselocation
     ?response_type=code
     &client_id={HL_CLIENT_ID}
     &redirect_uri={functionsBase}/oauth/hl/callback
     &scope=contacts.readonly contacts.write conversations.readonly
            conversations/message.readonly conversations/message.write
            calendars.readonly calendars/events.readonly locations.readonly
     &state={state}
   ```
   Scope strings above are the working set; exact spellings get verified against the marketplace app config during implementation (VER-1, §14). `redirect_uri` must byte-match the URI registered in the marketplace app.
3. User picks a location and consents. HighLevel redirects to the callback with `?code=…&state=…`.
4. `callback` runs, in order:
   a. Load `oauthStates/{state}` in a transaction; if missing or `expireAt < now`, redirect to `/dashboard?hl=error&reason=state_invalid`. If present, **delete it inside the same transaction** (single use - this is the replay and CSRF defense; the state doc, not a cookie, binds the callback to a uid, so the flow survives third-party-cookie blocking).
   b. Exchange the code: `POST https://services.leadconnectorhq.com/oauth/token` with `grant_type=authorization_code`, `client_id`, `client_secret`, `code`, `redirect_uri` (form-encoded). Response carries `access_token`, `refresh_token`, `expires_in` (~86 400 s), `locationId`, `companyId`, `userType`, `scope`.
   c. Encrypt both tokens (§4.3). Write `hlConnections/{uid}` (full doc replace) and mirror `users/{uid}.hl = { connected: true, locationId, locationName }`. Location name comes from one `GET /locations/{locationId}` call; on failure, fall back to the raw `locationId` string - cosmetic only.
   d. Redirect to `/dashboard?hl=connected`.

### 4.2 Token refresh - single-flight transaction

Refresh is lazy, performed by `hlClient` inside the proxy and the grounding fetch. Trigger: `expiresAt - 60_000 < Date.now()` (60 s skew margin) or an HL 401 on a live call.

```ts
async function getFreshAccessToken(uid: string): Promise<string> {
  return db.runTransaction(async (tx) => {
    const ref = db.doc(`hlConnections/${uid}`);
    const snap = await tx.get(ref);
    if (!snap.exists || snap.get('status') === 'revoked') throw new HlNotConnected();
    const c = snap.data()!;
    if (c.expiresAt - 60_000 > Date.now()) return decrypt(c.accessTokenEnc); // another writer already refreshed
    const t = await hlTokenEndpoint({ grant_type: 'refresh_token',
                                      refresh_token: decrypt(c.refreshTokenEnc) });
    tx.update(ref, {
      accessTokenEnc: encrypt(t.access_token),
      refreshTokenEnc: encrypt(t.refresh_token ?? decrypt(c.refreshTokenEnc)),
      expiresAt: Date.now() + t.expires_in * 1000,
      status: 'connected', updatedAt: FieldValue.serverTimestamp(),
    });
    return t.access_token;
  });
}
```

The transaction re-read is what prevents the refresh stampede: N concurrent preview requests hitting an expired token serialize on the doc; the first refreshes, the rest see a future `expiresAt` on retry and return the stored token. This matters because HighLevel rotates refresh tokens - two parallel refreshes with the same refresh token would invalidate the connection.

`invalid_grant` from the token endpoint (user uninstalled the app, refresh token consumed elsewhere) → set `status: 'revoked'`, mirror `users/{uid}.hl.connected = false`, throw `HlNotConnected`. The proxy maps that to `409 HL_NOT_CONNECTED`; the dashboard flips back to the Connect button.

### 4.3 Token encryption at rest

AES-256-GCM, envelope format `base64( iv[12] ‖ authTag[16] ‖ ciphertext )`. Key: `TOKEN_ENC_KEY`, a 32-byte base64 secret in Secret Manager, loaded via `defineSecret` and bound to the callback, proxy, and generate functions only. GCM (authenticated) rather than any ECB/CBC construction, and app-layer encryption on top of Firestore's at-rest encryption so a rules mistake or an exported backup still doesn't expose usable tokens. AAD is set to the uid, which binds a ciphertext to its owner doc - copying an envelope between user docs fails decryption.

### 4.4 Edge cases

| Case | Behavior |
|---|---|
| User denies consent at HL | Callback gets `?error=access_denied` → redirect `/dashboard?hl=error&reason=denied`, no writes |
| Callback replay / double invocation (refresh, back button) | State doc already deleted → `state_invalid`. Dashboard shows "already connected" if `users/{uid}.hl.connected` is true, else the error toast |
| State expired (>10 min on the HL screen) | `state_invalid`; TTL policy on `expireAt` garbage-collects the doc regardless |
| Re-connect while already connected | Allowed; new tokens and location replace the old doc atomically. This is also the "switch location" path - one location per user, per the assignment |
| Code exchange returns 4xx/5xx | Log with correlation id, redirect `reason=exchange_failed`, no partial writes (encrypt-then-write happens only on success) |
| Two tabs run Connect concurrently | Two state docs, both valid; last callback wins the doc replace. Harmless |
| Clock skew between HL and us | 60 s early-refresh margin; `expiresAt` computed from our clock at write time |
| Secret rotation of `TOKEN_ENC_KEY` | Decrypt failure → treat as `revoked`, force re-connect. Documented operational cost; dual-key decrypt is a listed improvement |

---

## 5. Data model (Firestore)

### 5.1 Collections

All timestamps are Firestore `Timestamp` unless noted; `expiresAt` in `hlConnections` is epoch millis (number) because it participates in arithmetic inside transactions.

```
users/{uid}
  email: string
  displayName: string | null
  createdAt
  hl: { connected: boolean, locationId?: string, locationName?: string }   # mirror, display only

hlConnections/{uid}                          # server-only (INV-2)
  accessTokenEnc: string                     # AES-256-GCM envelope, AAD = uid
  refreshTokenEnc: string
  locationId: string
  companyId: string
  scopes: string[]
  expiresAt: number                          # epoch ms
  status: 'connected' | 'revoked'
  updatedAt

oauthStates/{state}                          # server-only, single-use
  uid: string
  createdAt
  expireAt: Timestamp                        # Firestore TTL policy target

projects/{projectId}                         # projectId = auto id
  ownerUid: string
  name: string                               # 1..80 chars
  description: string                        # 0..500 chars
  hlLocationId: string | null                # copied from connection at create time
  status: 'active' | 'deleted'
  deletedAt: Timestamp | null
  headSnapshotId: string
  activeGenerationId: string | null          # single-flight lock (INV-3)
  createdAt, updatedAt

projects/{p}/files/{fileId}                  # working tree; fileId = base64url(path)
  ownerUid: string                           # denormalized for rules
  path: 'index.html' | 'app.js' | 'styles.css'
  content: string                            # ≤ 100_000 bytes UTF-8
  size: number                               # bytes
  sha256: string                             # hex of UTF-8 bytes
  updatedAt
  updatedBy: 'llm' | 'user' | 'restore' | 'seed'

projects/{p}/blobs/{sha256}                  # immutable (INV-4)
  ownerUid: string
  content: string
  size: number
  createdAt

projects/{p}/snapshots/{snapshotId}          # snapshotId = ULID (sortable)
  ownerUid: string
  createdAt
  trigger: 'seed' | 'generation' | 'manual' | 'restore'
  generationId: string | null
  restoredFrom: string | null                # snapshotId, when trigger = restore
  label: string | null
  files: Array<{ path: string, sha256: string, size: number }>

projects/{p}/messages/{messageId}            # messageId = ULID
  ownerUid: string
  role: 'user' | 'assistant'
  content: string                            # narration only, ≤ 4_000 chars stored
  filesChanged: string[]                     # e.g. ['app.js'] - the "[updated app.js]" marker
  generationId: string | null
  createdAt

projects/{p}/generations/{generationId}      # generationId = ULID; status doc for reconnects
  ownerUid: string
  status: 'streaming' | 'completed' | 'failed' | 'cancelled'
  prompt: string
  model: string
  startedAt, completedAt: Timestamp | null
  usage: { inputTokens: number, outputTokens: number, cacheReadTokens: number } | null
  snapshotId: string | null
  filesChanged: string[]
  error: { code: string, message: string } | null
  rawPartial: string | null                  # truncated to 200_000 bytes on failure

rateLimits/{uid}                             # fixed-window counters (§12.1)
  genWindowStart: number, genCount: number
  proxyWindowStart: number, proxyCount: number
```

Doc ID choices: `fileId = base64url(path)` because `/` is illegal in document IDs and encodeURIComponent produces `%` sequences that are miserable in console URLs. ULIDs for snapshots/messages/generations give chronological ordering without a composite index for the common "latest N" queries.

Size math vs the 1 MiB document limit: worst case file doc ≈ 100 KB content + metadata, snapshot manifest ≈ 3 entries × ~120 bytes - nothing approaches the limit except `rawPartial`, which is why it truncates at 200 KB with a `…[truncated]` suffix.

### 5.2 Security rules

```
rules_version = '2';
service cloud.firestore {
  match /databases/{db}/documents {

    function signedIn() { return request.auth != null; }
    function isOwner()  { return signedIn() && request.auth.uid == resource.data.ownerUid; }
    function creatingOwn() { return signedIn() && request.auth.uid == request.resource.data.ownerUid; }

    match /users/{uid} {
      allow read, create, update: if signedIn() && request.auth.uid == uid;
      allow delete: if false;
    }

    match /hlConnections/{uid} { allow read, write: if false; }   // INV-2
    match /oauthStates/{s}     { allow read, write: if false; }
    match /rateLimits/{uid}    { allow read, write: if false; }

    match /projects/{pid} {
      allow create: if creatingOwn()
        && request.resource.data.name.size() <= 80
        && request.resource.data.status == 'active';
      allow read: if isOwner();
      allow update: if isOwner()
        && request.resource.data.ownerUid == resource.data.ownerUid          // no ownership transfer
        && !request.resource.data.diff(resource.data).affectedKeys()
             .hasAny(['headSnapshotId', 'activeGenerationId']);              // server-managed fields
      allow delete: if false;                                                // soft delete only

      match /files/{fid} {
        allow read: if isOwner();
        allow update: if isOwner()
          && request.resource.data.content.size() <= 100000
          && request.resource.data.path == resource.data.path                // path immutable
          && request.resource.data.updatedBy == 'user';
        allow create, delete: if false;                                      // tree shape is server-managed
      }
      match /blobs/{sha}       { allow read: if isOwner(); allow write: if false; }
      match /snapshots/{sid}   { allow read: if isOwner(); allow write: if false; }
      match /messages/{mid}    {
        allow read: if isOwner();
        allow create: if creatingOwn() && request.resource.data.role == 'user'
          && request.resource.data.content.size() <= 4000;
        allow update, delete: if false;
      }
      match /generations/{gid} { allow read: if isOwner(); allow write: if false; }
    }
  }
}
```

Notes. Client-side project *creation* is allowed (assignment permits Firestore-rules-plus-SDK CRUD) but a callable does it in practice so the starter seed (§8.1) happens atomically; the rule stays as defense in depth. `isOwner()` on subcollections reads the denormalized `ownerUid` - no `get()` on the parent, so no extra billed read per rule evaluation. User file edits must set `updatedBy: 'user'`; the generate function writes with the Admin SDK, which bypasses rules, so `'llm' | 'restore' | 'seed'` are unreachable from clients.

### 5.3 Indexes and TTL

`firestore.indexes.json`: one composite - `projects (ownerUid ASC, status ASC, updatedAt DESC)` for the dashboard list. Subcollection "latest N" queries (`messages`, `snapshots`, `generations` ordered by `__name__` or `createdAt`) ride single-field defaults. TTL policy on `oauthStates.expireAt` (console/Terraform config, not rules).

### 5.4 Data-model edge cases

| Case | Handling |
|---|---|
| Soft-deleted project accessed by direct URL | Rules still allow read (owner); UI checks `status` and shows a restore banner. List queries filter `status == 'active'` |
| Concurrent manual edits to the same file (two tabs) | Last write wins at the doc level; `sha256` recomputed on each save. Acceptable - single-user product per project |
| Snapshot references a blob that failed to write | Impossible by ordering: commit writes blobs first, manifest second (§7.8). A crash between them leaves orphan blobs (harmless, INV-4), never a dangling manifest |
| Manifest entry for a deleted `styles.css` | Deletion = absence from the manifest; restore of an older snapshot recreates the file doc |
| `rateLimits` doc missing | Treated as zeroed window; created lazily in the limiter transaction |

---

## 6. HighLevel proxy function

One HTTPS gen-2 function mounted at `/hl/*`, Express-style router, 256 MiB, 60 s timeout, `minInstances: 0`.

### 6.1 Request pipeline

1. CORS. `OPTIONS` → 204 with `Access-Control-Allow-Origin: *`, `Allow-Headers: authorization, content-type`, `Allow-Methods: GET, POST, PUT, OPTIONS`, `Max-Age: 3600`. Wildcard origin is deliberate and safe: the caller is a sandboxed iframe with an opaque origin (`Origin: null`), auth is a bearer token, and `Access-Control-Allow-Credentials` is never set - no cookies exist to leak.
2. Auth. `Authorization: Bearer <firebaseIdToken>` → `admin.auth().verifyIdToken`. Failure → `401 UNAUTHENTICATED`.
3. Rate limit. Fixed window per uid (§12.1). Exceeded → `429 RATE_LIMITED` with `Retry-After`.
4. Route match. Path + method against the whitelist table below. No match → `404 NOT_FOUND` (a generated app inventing `hl.opportunities.list()` dies here loudly, not at HighLevel).
5. Token. `getFreshAccessToken(uid)` (§4.2). `HlNotConnected` → `409 HL_NOT_CONNECTED`.
6. Param translation. Zod-parse incoming params (reject unknown keys), map to HL's names, inject `locationId` from the connection server-side. Generated code can never target a different location than the one the user consented to - the parameter does not exist on our side of the contract.
7. Upstream call. `fetch` to `https://services.leadconnectorhq.com` with `Authorization: Bearer <hlAccessToken>`, `Version: <per-route constant>`, 15 s `AbortSignal.timeout`. On HL 401: one refresh-and-retry, then give up.
8. Response normalization. Map HL's response envelope to the SDK shapes documented in the prompt spec (§7.2). Strip fields the spec doesn't promise - keeps generated code off undocumented surface that could shift under us.

### 6.2 Route whitelist

SDK-side contract is authoritative; the HL column is the working mapping, each verified against marketplace docs at implementation (VER-2) since paths and `Version` header values vary per API family.

| SDK call | Proxy route | HighLevel upstream (indicative) |
|---|---|---|
| `hl.contacts.list({limit, startAfterId})` | `GET /hl/contacts` | `GET /contacts/?locationId&limit&startAfterId` |
| `hl.contacts.search({query, limit})` | `GET /hl/contacts/search` | `POST /contacts/search` (body: locationId, query, pageLimit) |
| `hl.contacts.create(body)` | `POST /hl/contacts` | `POST /contacts/` |
| `hl.contacts.update(id, body)` | `PUT /hl/contacts/:id` | `PUT /contacts/:id` |
| `hl.conversations.list({limit})` | `GET /hl/conversations` | `GET /conversations/search?locationId&limit` |
| `hl.conversations.messages(id, {limit})` | `GET /hl/conversations/:id/messages` | `GET /conversations/:id/messages` |
| `hl.conversations.send(id, {type, message})` | `POST /hl/conversations/:id/messages` | `POST /conversations/messages` |
| `hl.calendars.list()` | `GET /hl/calendars` | `GET /calendars/?locationId` |
| `hl.calendars.appointments({calendarId, startTime, endTime})` | `GET /hl/calendars/appointments` | `GET /calendars/events?locationId&calendarId&startTime&endTime` |
| `hl.calendars.availability(id, {startDate, endDate})` | `GET /hl/calendars/:id/availability` | `GET /calendars/:id/free-slots?startDate&endDate` |

Path params (`:id`) are validated as `^[A-Za-z0-9_-]{1,64}$` before interpolation - no traversal, no query smuggling via a crafted contactId.

### 6.3 Error taxonomy toward the SDK

Every non-2xx from the proxy is `{ code, message, retryAfter? }` JSON. The shim throws `HlError` carrying `status` + `code`; generated apps render `err.message` per the UI rules, so these messages are written for end users.

| HTTP | code | Meaning / message style |
|---|---|---|
| 401 | `UNAUTHENTICATED` | Preview token invalid/expired (shim retries once after re-handshake, §9.4) |
| 403 | `FORBIDDEN` | Project not owned by caller |
| 404 | `NOT_FOUND` | Route not in whitelist, or HL 404 passthrough ("Contact not found") |
| 409 | `HL_NOT_CONNECTED` | "Connect your HighLevel account to load data." |
| 422 | `VALIDATION_FAILED` | Zod details, e.g. "limit must be ≤ 100" |
| 429 | `RATE_LIMITED` / `HL_RATE_LIMITED` | Ours vs HL's; HL's `Retry-After` forwarded when present |
| 502 | `HL_UPSTREAM_ERROR` | HL 5xx or timeout: "HighLevel didn't respond. Try again." |

### 6.4 Proxy edge cases

| Case | Handling |
|---|---|
| HL 401 that survives a refresh | Connection genuinely dead mid-session → mark `revoked`, return `409 HL_NOT_CONNECTED` |
| HL 429 burst (preview mounts three calls at once) | Forward as `HL_RATE_LIMITED` + `Retry-After`; UI rules require an error state, so the app degrades visibly instead of blanking |
| Oversized upstream response | 2 MB cap on proxy responses; contacts/appointments lists are truncated to the requested `limit` anyway; cap exists for pathological payloads |
| `startAfterId` pagination cursor from a different location | HL rejects it; surfaces as 422 passthrough. Documented in SDK spec: cursors are opaque and single-session |
| Slow HL (>15 s) | Abort → `502 HL_UPSTREAM_ERROR`; keeps preview snappy and the function well under its own timeout |
| Missing `Version` header value drift | Per-route constants in one config map; a contract test hits each route against the sandbox in CI (VER-2) |

---

## 7. Generation orchestrator

One HTTPS gen-2 function: `POST /generate`, streaming response, 1 GiB memory, `timeoutSeconds: 540`, `concurrency: 1` (each invocation holds an LLM stream and a file buffer; don't multiplex). The internal deadline is `startedAt + 480s`: the last 60 s are reserved so persistence and the terminal SSE event always land inside the platform timeout (INV-6).

### 7.1 Entry, auth, single-flight

Request body (zod): `{ projectId: string, prompt: string (1..4000 chars) }`. Pipeline before any token is spent:

1. `verifyIdToken`; load project; `ownerUid` check; `status == 'active'` check.
2. Rate limit: `genCount` window (§12.1).
3. Single-flight transaction on `projects/{pid}` (INV-3):
   - If `activeGenerationId` is set, read that generation doc **inside the transaction**. If its status is `streaming` and `startedAt > now − 600s`, abort → `409 GENERATION_IN_FLIGHT`.
   - If it is `streaming` but older than 600 s, the owning instance crashed without cleanup (OOM, platform kill): mark it `failed` with `error.code = 'ORPHANED'` and take over. 600 s > the 540 s function ceiling, so a live generation can never be stolen.
   - Write `activeGenerationId = <new ULID>`, create `generations/{id}` with `status: 'streaming'`, `prompt`, `model`, `startedAt`.
4. Append the user message to `messages` (server-side write so it shares the generation's `createdAt` ordering).
5. Open the SSE response (§7.4) and emit `meta`.

Every terminal path - completed, failed, cancelled, orphan-marked - clears `activeGenerationId` back to `null` in the same write batch that sets the terminal status, so the lock and the status can't diverge.

### 7.2 Context assembly

Blocks in order, with hard budgets. Budgets are enforced by truncation rules, not hope.

| Block | Content | Budget | Volatility |
|---|---|---|---|
| A | Role + hard rules | ~400 tok | Static forever → **cache breakpoint 1** after C |
| B | Runtime contract + output protocol (incl. the gold-standard exemplar) | ~1 800 tok | Static |
| C | `hl-sdk` interface spec + one real example response per method, `sdk-spec-v1` | ~2 500 tok | Static per spec version |
| D | Grounding: live samples from the connected location | ≤ 800 tok | Per project session |
| E | Current working tree, all three files verbatim | ≤ 8 000 tok | Stable within session → **cache breakpoint 2** after E |
| F | Chat history, last 8 turns, file blocks stripped | ≤ 1 500 tok | Per turn |
| G | User prompt | ≤ 4 000 chars | Per turn |

Assembly details and their reasons:

- A-C are byte-identical across all users and projects. Any edit to them is a spec version bump (`sdk-spec-v2`) so cache behavior is predictable and prompt regressions are bisectable.
- D (grounding) = three parallel internal calls through `hlClient` with a 5 s combined timeout: `contacts.list({limit: 3})`, `calendars.list()` (capped at 10), `calendars.appointments` for the first calendar over the next 7 days (capped at 2). Values >120 chars truncated. Failure or no connection → canned static samples plus one line telling the model the data is illustrative. Grounding failure never fails a generation.
- E is read as the working tree at transaction time and the same read is retained as `baseTree` for the commit merge (§7.8) - assembly and merge see one consistent tree even if something writes mid-stream.
- F stripping: past assistant messages contribute `content` (narration) plus `filesChanged` rendered as `[updated app.js, styles.css]`. Never past file bodies - E supersedes them. This is the difference between ~150 and ~4 000 tokens per historical turn.
- If E exceeds 8 000 tokens (user pasted a novel into styles.css), files are truncated middle-out with an explicit `…[truncated N bytes]…` marker and the model is told edits to truncated regions require the user to trim the file. Degraded but honest.

### 7.3 Anthropic call

```ts
const stream = anthropic.messages.stream({
  model: MODEL,                    // Sonnet-class, env-pinned
  max_tokens: 12_288,
  temperature: 0.3,
  system: [
    { type: 'text', text: blocksABC, cache_control: { type: 'ephemeral' } },
  ],
  messages: [
    { role: 'user', content: [
        { type: 'text', text: blockD },
        { type: 'text', text: blockE, cache_control: { type: 'ephemeral' } },
    ]},
    ...historyF,
    { role: 'user', content: promptG },
  ],
}, { signal: abort.signal });
```

`abort` is an `AbortController` fired by any of: client disconnect + cancel intent (§7.9), the 480 s internal deadline, or a hard output cap (2× total file budget in accumulated bytes - runaway guard beyond `max_tokens`). `usage` from the final message event (including cache read/write tokens) lands on the generation doc.

### 7.4 SSE endpoint and wire protocol

Headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`, `Connection: keep-alive`. `res.flushHeaders()` immediately. **The frontend calls the function's direct Cloud Run URL** - Firebase Hosting rewrites buffer responses and cap at 60 s, which silently kills SSE (VER-3 has the smoke test).

Frame format: `event: <name>\ndata: <json>\n\n`. Comment heartbeat `: ping\n\n` every 15 s from a timer cleared on stream end. Event schemas:

| event | data | Client action |
|---|---|---|
| `meta` | `{generationId, model}` | Bind stream to generation doc |
| `text` | `{delta}` | Append to live assistant bubble |
| `file_start` | `{path, action}` | Open/focus tab, editor read-only, clear model if `action != 'delete'` |
| `file_delta` | `{path, delta}` | Append to Monaco model |
| `file_end` | `{path, sha256, bytes}` | Mark tab clean; local sha check optional |
| `done` | `{snapshotId, files: [{path, sha256}], usage}` | Unlock editor, rebuild preview, refresh snapshot list |
| `error` | `{code, message, partialPreserved: boolean}` | Unlock editor, toast, offer retry |

All `res.write` calls go through a guard that becomes a no-op once the socket errors or closes - writing to a dead response must never throw into the pump loop (§7.9).

### 7.5 Streaming tag parser

Pure module, no I/O: `feed(delta) → ParserEvent[]`, `finish() → ParserEvent[]`. States `TEXT | IN_FILE`.

Grammar the model is contractually bound to (block B): narration text, then zero or more file blocks -
`<file path="P" action="create|update">…</file>` or `<file path="P" action="delete"/>`.

Mechanics:

- Holdback. In each state, the parser withholds the longest buffer suffix that is a proper prefix of the next marker (`<file` in TEXT, `</file>` in IN_FILE) and emits the rest. A marker split as `…<fi` + `le path…` across deltas is reassembled invisibly; worst-case holdback is `len(marker) − 1` chars, so streaming latency cost is single-digit characters.
- Open-tag attributes may also split across deltas: once `<file` is seen, the parser waits for the closing `>` before emitting anything further, buffering at most 256 chars of attribute text (past that → `MALFORMED_OUTPUT`, hard abort - no legitimate tag is that long).
- Attribute parsing accepts exactly `path` and `action`, double-quoted, any order. `path` not in the allowed set or `action` invalid → hard abort with `MALFORMED_OUTPUT` before a single byte of that file streams (assertAllowedPath from the HLD).
- Content trimming: one leading newline after the open tag and one trailing newline before the close tag are stripped, so files don't accumulate blank first/last lines across turns.
- `finish()` (upstream stream ended): in TEXT, flush held text. In IN_FILE, the model got truncated mid-file (max_tokens or abort) → emit `ParseError('UNCLOSED_FILE', path)`; the file is not staged.

Corner cases, decided:

| Case | Decision |
|---|---|
| Literal `</file>` inside generated code (e.g. in a JS string) | First close marker wins; the file truncates there and almost certainly fails acorn → repair pass. Block B forbids the literal sequence and tells the model to write `<\/file>` inside strings; the exemplar demonstrates it. Accepted residual risk, caught by validation not silence |
| Duplicate block for the same path in one turn | Last block wins; earlier one is discarded at staging with a logged warning. Client already rendered the first stream - `file_start` for the same path resets the Monaco model, so the UI self-corrects |
| Unknown/extra attributes on the tag | Ignored (forward compatibility), logged |
| `action="delete"` with a body | Body discarded, warning logged, delete honored |
| Text between file blocks | Legal; forwarded as `text` events (models narrate between files: "Now the styles:") |
| Markdown fence wrapping the whole output (```) | Stripped pre-parser by a one-shot regex on the first delta batch - a known failure mode of models under formatting pressure |
| Zero file blocks | Legal "answer-only" turn (block B rule 4): no snapshot, narration becomes the assistant message, `done` carries `files: []` and `snapshotId: null` |

Multibyte safety: the Anthropic SDK yields JS strings (already decoded), so the parser operates on code points and never splits a UTF-8 sequence; `sha256`/`size` are computed on `Buffer.from(content, 'utf8')` at staging.

### 7.6 Validation gates

Per file, at `file_end` (stage or reject the file):

1. Path in `{index.html, app.js, styles.css}` (already guaranteed by the parser; asserted again - belt and suspenders).
2. `size ≤ 100_000` bytes.
3. `action='delete'` allowed only for `styles.css`; deleting either required file → generation-level `VALIDATION_FAILED`.
4. `app.js`: `acorn.parse(content, { ecmaVersion: 'latest', sourceType: 'module' })`. Syntax error → candidate for the repair pass with the acorn message and location.
5. `index.html`: must contain `id="app"`; must not contain `<script` (all script comes from the shell - this also blocks the srcdoc-escape vector at the source, in addition to `esc()` in the builder).
6. `styles.css`: size only. A broken stylesheet degrades visually; not worth a CSS parser.

Per generation, at stream end: staged set non-empty **or** text-only turn; total staged ≤ 300 KB; no-op detection (every staged sha equals the baseTree sha → skip snapshot, treat as text-only, log - models occasionally re-emit identical files); narration non-empty (fallback string "Updated the app." if the model skipped it).

### 7.7 Repair pass (build-time, exactly one)

Trigger: exactly one file failed gate 4, or `finish()` reported `UNCLOSED_FILE`, and the deadline has ≥ 60 s remaining. Non-streamed follow-up request: system = A-C (cache hit), user = the broken file + the error + "Emit the corrected `<file>` block for this one file only." `max_tokens: 6_000`. The SSE stream shows a fresh `file_start`/`file_delta`/`file_end` for that path - the retry is visible as a rewrite, which reads honestly in the editor. Repaired file re-enters gate 4. Second failure, multiple failed files, or insufficient deadline → generation `failed` (`MALFORMED_OUTPUT`), `rawPartial` preserved. One retry is the whole policy: it catches the dominant failure class (truncation/typo) and caps worst-case latency and spend.

### 7.8 Commit (persistence)

Runs only when all gates pass, inside the last-60 s reserve if need be:

1. Compute ops: staged files → `{path, sha256, content}[]`, plus deletes.
2. Write blobs for shas not already present (`create` with precondition-exists tolerated as success - INV-4 makes duplicate writes no-ops semantically).
3. `newManifest = baseTree.manifest` overlaid with ops (deletes remove entries). `baseTree` is the §7.2 read - the merge base is the tree the model actually saw. A user edit that raced in mid-stream (only possible via a second client bypassing the UI lock) is overwritten for LLM-touched paths and kept for untouched ones; the pre-race state remains reachable through the previous snapshot. Documented, not defended further.
4. One `WriteBatch` (< 20 ops, far under the 500 cap): snapshot doc (trigger `generation`), file-doc upserts/deletes with `updatedBy: 'llm'`, project `headSnapshotId` + `updatedAt` + `activeGenerationId: null`, assistant message (narration + `filesChanged`), generation doc → `completed` with `usage` + `snapshotId`.
5. Emit `done`, `res.end()`, clear heartbeat.

Crash between 2 and 4 leaves orphan blobs and a `streaming` generation that the next request orphan-marks (§7.1). No state in which a snapshot references a missing blob, and no state in which `headSnapshotId` moved without its files (batch atomicity) - INV-1 and INV-4 hold across every crash point.

### 7.9 Failure, disconnect, cancellation

Failure classifier (order matters):

| Condition | code | rawPartial | SSE terminal |
|---|---|---|---|
| Anthropic 429/529 before first token | `LLM_OVERLOADED` | - | `error`, retryable: client offers "Try again" |
| Anthropic error mid-stream | `LLM_STREAM_ERROR` | yes | `error`, `partialPreserved: true` |
| Parser hard abort | `MALFORMED_OUTPUT` | yes | `error` |
| Gate failure after repair | `MALFORMED_OUTPUT` | yes | `error` |
| Internal deadline hit | `GENERATION_TIMEOUT` | yes | `error` |
| Commit write failure (rare) | `PERSISTENCE_FAILED` | yes | `error`; head untouched, retry is safe |

`rawPartial` = accumulated raw model text, truncated to 200 KB, on the generation doc - the "partial results preserved" requirement, inspectable without corrupting the tree.

Client disconnect ≠ cancellation. `req.on('close')` sets `clientGone = true` (the SSE write guard goes dark) but the pump keeps running: the LLM stream completes, gates run, commit lands, generation doc reaches a terminal state. The reconnecting client never re-attaches to the SSE stream (stateless instances, no replay buffer); it attaches an `onSnapshot` listener to `generations/{id}` - the same listener it *always* holds from `meta` onward - and resolves from the doc. The SSE stream is a latency optimization; the generation doc is the source of truth. That one sentence is the disconnection story.

Cancellation is disconnect + intent: the client sets `cancelRequested` in its store, aborts the fetch, and the server-side close handler checks a companion signal - a `cancellations/{generationId}` doc written by a tiny callable before the abort. Close + cancellation doc → fire the AbortController, mark `cancelled`, keep `rawPartial`, clear the lock. Close without the doc (network blip, laptop lid) → run to completion as above. This distinction is what makes "my wifi dropped" recoverable while "Stop" is instant.


---

## 8. Snapshots, restore, diff

### 8.1 Seed

`createProject` (callable) writes, in one batch: the project doc, three file docs from the starter template (`updatedBy: 'seed'`), three blobs, and snapshot #0 (`trigger: 'seed'`, ULID sorts first). Every project therefore has a non-empty tree and a restorable floor; turn 1 and turn 10 of generation are the same code path.

### 8.2 Manual-edit commits

Manual Monaco edits save to the working tree (debounced client write, §10.4) without snapshotting - snapshots mark generation boundaries, not keystrokes. Two protections around that choice:

- Before a generation's commit, if `baseTree` contains shas not present in `headSnapshot`'s manifest (i.e., uncommitted manual edits existed when the turn started), the commit first writes an implicit snapshot `trigger: 'manual'`, label "Before generation" - the user's hand-written state is never the only unreachable version.
- The snapshot sheet exposes an explicit "Save snapshot" button → callable that snapshots the current tree with a user label. Cheap (manifest + at most 3 blobs) and makes the version-control story feel deliberate in the demo.

### 8.3 Restore algorithm

`restoreSnapshot(projectId, snapshotId)` callable:

1. Ownership + `status: 'active'` checks; **reject with `409 GENERATION_IN_FLIGHT` if `activeGenerationId` is set** - restoring under a live stream would fork reality.
2. Read target manifest; read blobs for its shas (≤ 3 gets).
3. One batch: upsert file docs from blob contents (`updatedBy: 'restore'`), delete file docs for paths absent from the manifest, write a **new** snapshot `{trigger: 'restore', restoredFrom: snapshotId}` with the same manifest, move `headSnapshotId` to the new snapshot, bump `updatedAt`.
4. Client rebuilds `srcdoc` from the (now-updated) working tree listener. Preview equals restored state within one reload.

Restore appends rather than rewinds - history is append-only, so a restore is itself undoable by restoring the snapshot before it, and `restoredFrom` keeps the lineage legible in the sheet. Restoring the current head is a no-op short-circuit (manifests equal → return early, no snapshot spam).

### 8.4 Diff view (bonus)

Per snapshot row: compare its manifest to its predecessor's (previous ULID). Equal sha → unchanged; missing/new → deleted/created; differing → fetch both blobs, client-side line diff (`diff` npm package), render in a shadcn dialog with Monaco's diff editor (`monaco.editor.createDiffEditor`) since it's already loaded. Zero server work - the content-addressed design pays out here.

### 8.5 Blob GC

Not built; documented. Orphan blobs (crashed commits, superseded duplicates) cost bytes, break nothing (INV-4). The listed improvement is a scheduled function that mark-sweeps blobs unreferenced by any manifest older than 24 h. Deliberately out of scope for the take-home: GC bugs destroy data, orphans don't.

---

## 9. Preview runtime

### 9.1 srcdoc assembly

`buildSrcdoc({files, proxyUrl})` per the HLD: platform shell (doctype, charset, viewport, CSP meta, Tailwind CDN, import map pinning `vue` → `vue@3` `esm-browser.prod.js`, `<style>` with `[v-cloak]{display:none}` prepended to `styles.css`, `window.__GENESIS__`, inlined `hl-sdk.js`), then the model's `index.html` as body, then `app.js` as an inline `<script type="module">`.

Escaping rule: every embedded file passes `s.replaceAll('</script', '<\\/script')` (case-insensitive) - a literal `</script>` in generated content would otherwise terminate the inline module and truncate the document. Gate 5 already bans `<script` in `index.html`; the escape covers `app.js` strings and `styles.css` content.

CSP (meta tag, since srcdoc has no response headers):

```
default-src 'none';
script-src 'unsafe-inline' https://cdn.tailwindcss.com https://unpkg.com;
style-src  'unsafe-inline' https://cdn.tailwindcss.com;
connect-src {proxyUrl-origin};
img-src https: data:;
font-src https:;
```

`'unsafe-inline'` for scripts is forced by the inline-module architecture; the enforcement that matters is `connect-src` - generated code physically cannot exfiltrate to or fetch from anywhere but the proxy (INV-5). Vue's full build compiles templates with `new Function`, which some CSP modes flag: if `unsafe-eval` proves required for the chosen Vue build during implementation, it is added to `script-src` with a note - it widens what inline code can do, not where it can connect, and connect-src remains the security boundary (VER-4).

### 9.2 Sandbox and origin model

`<iframe sandbox="allow-scripts">` and nothing else. Opaque origin ⇒ no cookies, no `localStorage`/`sessionStorage` (they throw - the SDK spec tells the model so, and the exemplar keeps state in Vue refs), no same-origin access to the parent, no Firebase session reachability. `allow-same-origin` is never added; a code review rule, not a config knob.

### 9.3 postMessage protocol

| Message | Direction | Payload |
|---|---|---|
| `genesis:ready` | iframe → parent | - (shim booted) |
| `genesis:token` | parent → iframe | `{token, projectId}` |
| `genesis:token-refresh` | iframe → parent | - (shim saw a 401) |
| `genesis:error` | iframe → parent | `{message, stack?}` |

Parent sends with `targetOrigin: '*'` (the only legal target for an opaque-origin frame) but only to the `contentWindow` of the iframe element it created, and only token material - acceptable because the token is already the caller's own short-lived credential. Parent-side listener filters `e.source === iframeEl.contentWindow`; shim-side filters `e.source === window.parent`. Both sides ignore everything else, including messages from a compromised generated app trying to spoof `genesis:*` types at other windows - there are none reachable.

Token lifecycle: parent re-sends `genesis:token` on every `onIdTokenChanged` and on `genesis:token-refresh`. The shim's `ready()` gate (HLD) queues all `hl.*` calls until the first token lands, which absorbs the race where `onMounted` fires before the handshake completes.

### 9.4 Runtime error channel

Shim registers `window.addEventListener('error')` and `'unhandledrejection'`, forwards `{message, stack}` capped at 2 KB, deduplicated by message within a 3 s window (a render-loop error would otherwise flood the channel). Parent renders one chat affordance - "Preview threw: `<message>` - Fix this" - whose click sends a structured user turn embedding message + stack. That is the entire runtime repair loop: user-triggered, one turn, no autonomy.

### 9.5 Preview edge cases

| Case | Handling |
|---|---|
| CDN unreachable (offline demo, corp proxy) | Import map/Tailwind fail → shim posts `genesis:error` ("Failed to fetch module") → visible in chat rather than a silent white frame |
| Generated `app.js` never mounts (logic bug, no exception) | Escape hatch: parent shows a "Reload preview" button; `v-cloak` keeps raw mustaches from flashing meanwhile |
| Infinite loop in generated code | Tab-level jank confined to the iframe process; Reload preview rebuilds srcdoc. No watchdog in v1 (listed improvement: `setTimeout` liveness ping from shim) |
| User opens preview before first HL connect | Calls fail with `HL_NOT_CONNECTED` → generated error states render the §6.3 message; dashboard badge points at Connect |
| Very large srcdoc | Three files ≤ 300 KB + shell ≈ well under browser srcdoc limits (tens of MB); no action |

---

## 10. Frontend architecture

### 10.1 Stores (Pinia)

`auth`: user, idToken snapshot, `onAuthStateChanged`/`onIdTokenChanged` wiring. `projects`: dashboard list (query `ownerUid == uid && status == 'active'` ordered `updatedAt desc`), create/rename/delete callables. `workspace` (per open project): file docs listener → Monaco models; messages listener; generation state machine; snapshot list; preview srcdoc string. The workspace store is the only writer of editor lock state.

Generation state machine (client): `idle → requesting → streaming → committing → idle | error`. Transitions driven by SSE events; `committing` covers the gap between last `file_end` and `done`. A parallel `onSnapshot` on the generation doc (attached at `meta`) is the reconciliation input: if SSE dies, the doc listener alone can drive `streaming → idle/error` (§7.9).

### 10.2 SSE client

`fetch(generateUrl, {method:'POST', headers:{authorization, 'content-type'}, body, signal})`, then read `res.body` with a `ReadableStream` reader and `TextDecoder('utf-8', …)` called with `{stream: true}` - this is what keeps a multibyte character split across network chunks intact. Frame assembly: append decoded text to a buffer, split on `\n\n`, keep the trailing partial frame in the buffer, parse complete frames into `{event, data}` (lines starting `:` are heartbeats - reset a 45 s stall watchdog and drop). Stall watchdog firing, network error, or non-200 → treat as disconnect (not error) and fall back to the generation-doc listener. `EventSource` is not used anywhere: it cannot POST, cannot set `Authorization`, and its auto-reconnect would re-trigger generations.

### 10.3 Monaco integration

One `monaco.editor.createModel(content, lang, uri)` per path, languages `html|javascript|css` by extension. `file_start` → ensure tab, focus it, `editor.updateOptions({readOnly: true})` (workspace-wide during `streaming`), reset model if the same path streams twice (§7.5 duplicate rule). `file_delta` → `model.applyEdits` append at end + `revealLine(lineCount)` for the follow-the-cursor effect; appends are O(delta) and hold up at token rate. `done`/`error` → `readOnly: false`. File tree = the three paths with dirty dots from the working-tree listener vs local model state.

### 10.4 Manual edits

Debounced 800 ms after last keystroke: compute sha client-side, `updateDoc(files/{fid}, {content, size, sha256, updatedBy:'user', updatedAt})` (rules §5.2 cap size and pin path). Preview does **not** auto-rebuild on manual save - an explicit "Run" button rebuilds srcdoc, so half-typed code doesn't thrash the iframe. Save while `streaming` is impossible by construction (readOnly). A second tab could bypass the UI lock; the outcome is defined in §7.8 step 3 and accepted.

### 10.5 Chat panel and snapshot sheet

Chat renders the messages listener plus one ephemeral streaming bubble fed by `text` deltas; on `done` the bubble is replaced by the persisted assistant message (identical content - no flicker because narration was stored verbatim). Input disabled during `streaming` with a Stop button (cancel flow §7.9). Snapshot sheet: shadcn `Sheet`, rows = snapshots ordered by ULID desc with trigger badge, relative time, `filesChanged` chips (derived from manifest diff vs predecessor), per-row Restore (confirm dialog when tree is dirty vs head) and Diff.

---

## 11. Deployment and configuration

| Function | Trigger | Memory / timeout | Secrets bound |
|---|---|---|---|
| `generate` | HTTPS (direct URL) | 1 GiB / 540 s / concurrency 1 | `ANTHROPIC_API_KEY`, `TOKEN_ENC_KEY` |
| `hlProxy` | HTTPS (direct URL) | 256 MiB / 60 s | `HL_CLIENT_ID`, `HL_CLIENT_SECRET`, `TOKEN_ENC_KEY` |
| `oauthStart` / `oauthCallback` | HTTPS | 256 MiB / 60 s | `HL_CLIENT_ID`, `HL_CLIENT_SECRET`, `TOKEN_ENC_KEY` |
| `projects` / `snapshots` / `cancelGeneration` | Callable | 256 MiB / 60 s | - |

Frontend env (`.env.example`): `VITE_FIREBASE_CONFIG` (JSON), `VITE_FUNCTIONS_BASE` (cloudfunctions/run.app base for direct calls), `VITE_PROXY_URL`. Functions secrets via `firebase functions:secrets:set`; nothing token-like in `firebase functions:config` or source (assignment hard requirement). Hosting serves the SPA plus rewrite `** → /index.html`; **no rewrites to `generate` or `hlProxy`** (§7.4). OAuth redirect URI registered in the marketplace app = the deployed `oauthCallback` URL exactly; the emulator flow uses a second marketplace app with the localhost callback, documented in README.

Local dev: `firebase emulators:start` (auth, firestore, functions, hosting) with `FIREBASE_AUTH_EMULATOR_HOST`/`FIRESTORE_EMULATOR_HOST` respected by the Admin SDK; HL calls hit the real sandbox account (no HL emulator exists); Anthropic calls are real with a dev key. Emulator rules tests cover INV-2 and the §5.2 update constraints.

## 12. Rate limiting and cost guardrails

### 12.1 Fixed-window counters

Transaction on `rateLimits/{uid}`: if `now − windowStart > windowMs` reset window, else increment; over limit → 429 + `Retry-After: windowEnd − now`. Windows: generations 10/hour/user, proxy 120/min/user (a dashboard mounting 3 calls plus a search burst fits; a `while(true) hl.contacts.list()` in generated code does not - the limiter is also the blast shield against pathological generated code). One extra document read/write per request; acceptable at take-home scale, swap target is per-instance token bucket + Redis, listed as improvement.

### 12.2 Cost caps

Per generation: `max_tokens 12_288`, one repair at 6_000, grounding ≤ ~800 input - worst case ≈ 18 k output + cached input. Per user per day: generation window math caps spend at a known ceiling; `usage` on every generation doc makes actual spend queryable. `MODEL` is env-pinned so a cost incident is a config rollback, not a deploy.

## 13. Testing strategy (what gets tests, in priority order)

1. Parser (pure): golden transcripts - split markers at every offset (property test: random re-chunking of a fixed transcript must yield identical events), unclosed file, duplicate path, fence-wrapped output, attribute split, text-only turn.
2. Rules (emulator): INV-2 denial, subcollection owner checks, `headSnapshotId`/`activeGenerationId` client-write denial, file update size/path pins.
3. Refresh transaction: two concurrent `getFreshAccessToken` against a stubbed token endpoint → exactly one upstream refresh.
4. Commit: crash injection between blob write and batch → next generation orphan-marks and succeeds; restore-under-lock rejected.
5. Proxy contract (against HL sandbox, CI-tagged): each of the 10 routes round-trips; 401-refresh-retry path with a forced-expired token.
6. E2E happy path (manual script for the Loom): sign up → connect → prompt → stream → preview shows sandbox data → edit → run → snapshot → restore.

## 14. Assumptions and verification register

| ID | Assumption / open item | Verify against |
|---|---|---|
| VER-1 | Exact OAuth scope strings; access token TTL ~24 h; refresh rotation behavior | Marketplace app config + first token response |
| VER-2 | Upstream paths, `Version` header values, param names per route (§6.2) | marketplace.gohighlevel.com/docs + sandbox contract tests |
| VER-3 | SSE streams end-to-end on deployed gen-2 direct URL (no intermediary buffering) | curl smoke test in deployment notes |
| VER-4 | Chosen Vue ESM build's CSP needs (`unsafe-eval` or not) with template-from-innerHTML | First deployed preview |
| VER-5 | HL search endpoint semantics (query matching fields, pagination shape) | Sandbox probing; SDK spec examples regenerated from real responses |
| A-1 | One HL location per user (assignment text) - schema and proxy assume it | - |
| A-2 | Take-home scale: no CDN pinning/self-hosting of Vue/Tailwind, no blob GC, no multi-region | README improvements list |
