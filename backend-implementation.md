# Genesis backend — implementation guide

Backend for Genesis: project management, LLM orchestration, SSE streaming, file versioning, and HighLevel API integrations. Firebase Cloud Functions **gen 2**, Node 20, **TypeScript** throughout. This document is the implementation companion to `genesis-lld.md` — section references (§) point there; nothing here contradicts it.

| | |
|---|---|
| Runtime | Cloud Functions gen 2, Node 20, TypeScript (strict) |
| Data | Firestore (single region), Secret Manager |
| LLM | Anthropic Messages API (`@anthropic-ai/sdk`), streaming |
| External | HighLevel REST (`services.leadconnectorhq.com`), HL marketplace OAuth |
| Invariants honored | INV-1 … INV-6 (LLD §1) |

---

## 1. Repository layout

```
/functions
  package.json              firebase-admin, firebase-functions@^5 (v2 API),
                            @anthropic-ai/sdk, acorn, zod, ulid
  tsconfig.json             strict: true, target ES2022, module NodeNext
  src/
    index.ts                exports every deployed function
    oauth/start.ts          GET  /oauth/hl/start
    oauth/callback.ts       GET  /oauth/hl/callback
    proxy/index.ts          ALL  /hl/*            (10 whitelisted routes)
    proxy/routes.ts         route table + zod schemas + normalizers
    generate/index.ts       POST /generate        (SSE orchestrator)
    generate/parser.ts      streaming tag parser (pure, no I/O)
    generate/context.ts     prompt block assembly + grounding fetch
    generate/gates.ts       per-file and per-generation validation
    generate/commit.ts      blob writes + atomic commit batch
    generate/repair.ts      single bounded repair pass
    projects/index.ts       callables: createProject, renameProject,
                            softDeleteProject, restoreProject
    snapshots/index.ts      callables: saveSnapshot, restoreSnapshot
    cancel/index.ts         callable: cancelGeneration
    lib/db.ts               typed doc refs + converters (types in §3)
    lib/auth.ts             verifyIdToken helper for raw HTTPS functions
    lib/hlClient.ts         HL REST client + getFreshAccessToken transaction
    lib/crypto.ts           AES-256-GCM envelope encrypt/decrypt
    lib/sse.ts              SSE framing, heartbeat, dead-socket write guard
    lib/rateLimit.ts        fixed-window limiter transaction
    lib/errors.ts           error taxonomy + AppError class
    lib/ids.ts              ulid(), fileId(path) = base64url(path)
  test/                     vitest: parser golden tests, rules emulator
                            tests, refresh-transaction test, commit crash
                            injection, proxy contract tests (CI-tagged)
firestore.rules
firestore.indexes.json
firebase.json  .firebaserc
```

Design stance carried through every module (LLD §1):

1. **Proxy pattern** — HL tokens exist only inside functions; never in generated code, client-readable docs, or the browser (INV-2).
2. **Fixed three-file contract** — the model may touch only `index.html`, `app.js`, `styles.css`; path validation is set membership.
3. **Content-addressed snapshots** — immutable `blobs/{sha256}` + manifest snapshots (INV-4).
4. **Single LLM call per turn** — constrained output contract + streaming validator + one repair pass; no agent chain.
5. **SSE is a latency optimization; the generation doc is the source of truth** (INV-6, §7.9).

---

## 2. Cloud Functions inventory

| Function | Trigger | Memory / timeout / conc. | Secrets bound | Purpose |
|---|---|---|---|---|
| `generate` | HTTPS `onRequest` (direct Cloud Run URL) | 1 GiB / 540 s / **concurrency 1** | `ANTHROPIC_API_KEY`, `TOKEN_ENC_KEY` | Generation turn: single-flight lock, context assembly, Anthropic stream, SSE fan-out, validation, commit |
| `hlProxy` | HTTPS `onRequest` (direct URL) | 256 MiB / 60 s | `HL_CLIENT_ID`, `HL_CLIENT_SECRET`, `TOKEN_ENC_KEY` | `window.hl.*` → HighLevel REST, whitelist-only |
| `oauthStart` | HTTPS `onRequest` | 256 MiB / 60 s | `HL_CLIENT_ID` | State doc + 302 to HL chooselocation |
| `oauthCallback` | HTTPS `onRequest` | 256 MiB / 60 s | `HL_CLIENT_ID`, `HL_CLIENT_SECRET`, `TOKEN_ENC_KEY` | State check, code exchange, encrypt + store connection |
| `createProject` | `onCall` | 256 MiB / 60 s | — | Project doc + seeded tree + snapshot #0, atomically |
| `renameProject` | `onCall` | 256 MiB / 60 s | — | Name/description update (server-side validation) |
| `softDeleteProject` / `restoreProject` | `onCall` | 256 MiB / 60 s | — | `status` flip + `deletedAt` |
| `saveSnapshot` | `onCall` | 256 MiB / 60 s | — | Manual snapshot of the current working tree with user label |
| `restoreSnapshot` | `onCall` | 256 MiB / 60 s | — | Append-only restore (§8) |
| `cancelGeneration` | `onCall` | 256 MiB / 60 s | — | Writes `cancellations/{generationId}` (cancel intent, §7.9) |

`generate` and `hlProxy` are called at their **direct run.app URLs** — never through Firebase Hosting rewrites, which buffer responses and cap at 60 s, silently killing SSE (LLD §7.4, VER-3).

Function definition pattern (gen 2 API):

```ts
// generate/index.ts
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';

const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');
const TOKEN_ENC_KEY = defineSecret('TOKEN_ENC_KEY');

export const generate = onRequest(
  {
    memory: '1GiB',
    timeoutSeconds: 540,
    concurrency: 1,          // one LLM stream + file buffer per instance
    minInstances: 0,
    secrets: [ANTHROPIC_API_KEY, TOKEN_ENC_KEY],
    cors: false,             // CORS handled manually (SSE preflight)
  },
  handleGenerate,
);
```

---

## 3. Firestore data model

### 3.1 TypeScript document types

One module (`lib/db.ts`) owns every document shape and typed `FirestoreDataConverter`s, so field names exist in exactly one place.

```ts
import { Timestamp } from 'firebase-admin/firestore';

export type FilePath = 'index.html' | 'app.js' | 'styles.css';
export const ALLOWED_PATHS: ReadonlySet<string> =
  new Set(['index.html', 'app.js', 'styles.css']);

// ---------- top-level collections ----------

/** users/{uid} — client-readable profile; `hl` is a display-only mirror. */
export interface UserDoc {
  email: string;
  displayName: string | null;
  createdAt: Timestamp;
  hl: { connected: boolean; locationId?: string; locationName?: string };
}

/** hlConnections/{uid} — SERVER-ONLY (INV-2). Rules deny all client access. */
export interface HlConnectionDoc {
  accessTokenEnc: string;      // AES-256-GCM envelope, AAD = uid
  refreshTokenEnc: string;
  locationId: string;
  companyId: string;
  scopes: string[];
  expiresAt: number;           // epoch ms (number: arithmetic in transactions)
  status: 'connected' | 'revoked';
  updatedAt: Timestamp;
}

/** oauthStates/{state} — server-only, single-use, TTL on expireAt. */
export interface OAuthStateDoc {
  uid: string;
  createdAt: Timestamp;
  expireAt: Timestamp;         // Firestore TTL policy target (now + 10 min)
}

/** rateLimits/{uid} — server-only fixed-window counters (§9 below). */
export interface RateLimitDoc {
  genWindowStart: number;  genCount: number;
  proxyWindowStart: number; proxyCount: number;
}

/** cancellations/{generationId} — cancel intent flag (§7.9). TTL-eligible. */
export interface CancellationDoc {
  uid: string;
  createdAt: Timestamp;
}

/** projects/{projectId} */
export interface ProjectDoc {
  ownerUid: string;
  name: string;                       // 1..80 chars
  description: string;                // 0..500 chars
  hlLocationId: string | null;        // copied from connection at create time
  status: 'active' | 'deleted';
  deletedAt: Timestamp | null;
  headSnapshotId: string;             // server-managed (INV-1)
  activeGenerationId: string | null;  // single-flight lock (INV-3)
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ---------- projects/{p} subcollections ----------
// Subcollections, not top-level: every query is project-scoped, doc IDs
// (base64url(path), sha256) are only unique per project, rules read the
// denormalized ownerUid without a parent get(), and the project subtree
// is the unit of lifecycle. Cross-project needs, if ever, use
// collectionGroup queries.

/** files/{fileId} — mutable working tree; fileId = base64url(path). */
export interface FileDoc {
  ownerUid: string;                   // denormalized for rules
  path: FilePath;
  content: string;                    // ≤ 100_000 bytes UTF-8
  size: number;                       // Buffer.byteLength(content, 'utf8')
  sha256: string;                     // hex over UTF-8 bytes
  updatedAt: Timestamp;
  updatedBy: 'llm' | 'user' | 'restore' | 'seed';
}

/** blobs/{sha256} — immutable, content-addressed (INV-4). */
export interface BlobDoc {
  ownerUid: string;
  content: string;
  size: number;
  createdAt: Timestamp;
}

/** snapshots/{snapshotId} — manifest only; snapshotId = ULID (sortable). */
export interface SnapshotDoc {
  ownerUid: string;
  createdAt: Timestamp;
  trigger: 'seed' | 'generation' | 'manual' | 'restore';
  generationId: string | null;
  restoredFrom: string | null;        // source snapshotId when trigger=restore
  label: string | null;
  files: Array<{ path: FilePath; sha256: string; size: number }>;
}

/** messages/{messageId} — chat transcript; messageId = ULID. */
export interface MessageDoc {
  ownerUid: string;
  role: 'user' | 'assistant';
  content: string;                    // narration only, ≤ 4_000 chars stored
  filesChanged: FilePath[];           // renders "[updated app.js]" chips
  generationId: string | null;
  createdAt: Timestamp;
}

/** generations/{generationId} — status doc; the reconnect source of truth. */
export interface GenerationDoc {
  ownerUid: string;
  status: 'streaming' | 'completed' | 'failed' | 'cancelled';
  prompt: string;
  model: string;
  startedAt: Timestamp;
  completedAt: Timestamp | null;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
  } | null;
  snapshotId: string | null;
  filesChanged: FilePath[];
  error: { code: string; message: string } | null;
  rawPartial: string | null;          // ≤ 200_000 bytes, '…[truncated]' suffix
}
```

ID helpers:

```ts
// lib/ids.ts
import { ulid } from 'ulid';
import { createHash } from 'node:crypto';

export const newId = ulid;                                    // sortable
export const fileId = (path: string) =>
  Buffer.from(path, 'utf8').toString('base64url');            // '/' illegal in doc IDs
export const sha256hex = (content: string) =>
  createHash('sha256').update(Buffer.from(content, 'utf8')).digest('hex');
```

### 3.2 Security rules

Verbatim intent from LLD §5.2 — deployed as `firestore.rules`, tested against the emulator (INV-2 denial, server-managed-field denial, file update pins):

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
    match /cancellations/{g}   { allow read, write: if false; }   // written by callable only

    match /projects/{pid} {
      allow create: if creatingOwn()
        && request.resource.data.name.size() <= 80
        && request.resource.data.status == 'active';
      allow read: if isOwner();
      allow update: if isOwner()
        && request.resource.data.ownerUid == resource.data.ownerUid
        && !request.resource.data.diff(resource.data).affectedKeys()
             .hasAny(['headSnapshotId', 'activeGenerationId']);   // server-managed
      allow delete: if false;                                     // soft delete only

      match /files/{fid} {
        allow read: if isOwner();
        allow update: if isOwner()
          && request.resource.data.content.size() <= 100000
          && request.resource.data.path == resource.data.path     // path immutable
          && request.resource.data.updatedBy == 'user';
        allow create, delete: if false;                           // tree shape server-managed
      }
      match /blobs/{sha}     { allow read: if isOwner(); allow write: if false; }
      match /snapshots/{sid} { allow read: if isOwner(); allow write: if false; }
      match /messages/{mid}  {
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

The Admin SDK bypasses rules, so `updatedBy: 'llm' | 'restore' | 'seed'` is unreachable from clients by construction; user edits *must* carry `updatedBy: 'user'`.

### 3.3 Indexes and TTL

```json
// firestore.indexes.json
{
  "indexes": [
    {
      "collectionGroup": "projects",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "ownerUid",  "order": "ASCENDING" },
        { "fieldPath": "status",    "order": "ASCENDING" },
        { "fieldPath": "updatedAt", "order": "DESCENDING" }
      ]
    }
  ],
  "fieldOverrides": []
}
```

That is the only composite index. Subcollection "latest N" queries order by `__name__` (ULIDs sort chronologically) or `createdAt` and ride single-field defaults. TTL policies (console/Terraform, not rules): `oauthStates.expireAt`, and optionally `cancellations.createdAt`-derived `expireAt` if added.

---

## 4. Shared libraries

### 4.1 Error taxonomy (`lib/errors.ts`)

Every non-2xx from any HTTPS function is `{ code, message, retryAfter? }` JSON. Messages for proxy errors are written for **end users** — generated apps render `err.message` verbatim.

```ts
export type ErrorCode =
  | 'UNAUTHENTICATED'      // 401  bad/expired Firebase ID token
  | 'FORBIDDEN'            // 403  not the resource owner
  | 'NOT_FOUND'            // 404  route not whitelisted, or HL 404 passthrough
  | 'HL_NOT_CONNECTED'     // 409  no live HL connection
  | 'GENERATION_IN_FLIGHT' // 409  single-flight lock held
  | 'VALIDATION_FAILED'    // 422  zod details / generation gate failure
  | 'RATE_LIMITED'         // 429  our fixed window
  | 'HL_RATE_LIMITED'      // 429  HL's 429, Retry-After forwarded
  | 'HL_UPSTREAM_ERROR'    // 502  HL 5xx or timeout
  // generation-terminal codes (on the generation doc / SSE error event):
  | 'LLM_OVERLOADED' | 'LLM_STREAM_ERROR' | 'MALFORMED_OUTPUT'
  | 'GENERATION_TIMEOUT' | 'PERSISTENCE_FAILED' | 'ORPHANED';

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly retryAfter?: number,
  ) { super(message); }
  toJSON() {
    return { code: this.code, message: this.message,
             ...(this.retryAfter ? { retryAfter: this.retryAfter } : {}) };
  }
}
```

### 4.2 Token encryption (`lib/crypto.ts`)

AES-256-GCM, envelope `base64(iv[12] ‖ authTag[16] ‖ ciphertext)`. AAD = uid, binding a ciphertext to its owner doc — copying an envelope between user docs fails decryption. App-layer encryption on top of Firestore's at-rest encryption so a rules mistake or exported backup still exposes nothing usable.

```ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const key = () => Buffer.from(process.env.TOKEN_ENC_KEY!, 'base64'); // 32 bytes

export function encrypt(plaintext: string, aadUid: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(aadUid, 'utf8'));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64');
}

export function decrypt(envelope: string, aadUid: string): string {
  const buf = Buffer.from(envelope, 'base64');
  const iv = buf.subarray(0, 12), tag = buf.subarray(12, 28), ct = buf.subarray(28);
  const d = createDecipheriv('aes-256-gcm', key(), iv);
  d.setAAD(Buffer.from(aadUid, 'utf8'));
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
}
```

Key rotation: decrypt failure → treat the connection as `revoked`, force re-connect (documented operational cost; dual-key decrypt is a listed improvement).

### 4.3 Auth helper (`lib/auth.ts`)

Raw HTTPS functions (`generate`, `hlProxy`, `oauthStart`) verify `Authorization: Bearer <firebaseIdToken>` themselves:

```ts
export async function requireAuth(req: Request): Promise<DecodedIdToken> {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
  if (!m) throw new AppError(401, 'UNAUTHENTICATED', 'Sign in to continue.');
  try {
    return await getAuth().verifyIdToken(m[1]);
  } catch {
    throw new AppError(401, 'UNAUTHENTICATED', 'Session expired. Sign in again.');
  }
}
```

Callables get `request.auth` from the SDK; each still checks `ownerUid` on the target doc.

### 4.4 SSE helper (`lib/sse.ts`)

Frame format `event: <name>\ndata: <json>\n\n`, comment heartbeat `: ping\n\n` every 15 s. **All writes pass a guard that becomes a no-op once the socket closes or errors** — writing to a dead response must never throw into the pump loop.

```ts
export type SseEvent =
  | { event: 'meta';       data: { generationId: string; model: string } }
  | { event: 'text';       data: { delta: string } }
  | { event: 'file_start'; data: { path: FilePath; action: 'create' | 'update' | 'delete' } }
  | { event: 'file_delta'; data: { path: FilePath; delta: string } }
  | { event: 'file_end';   data: { path: FilePath; sha256: string; bytes: number } }
  | { event: 'done';       data: { snapshotId: string | null;
                                   files: Array<{ path: FilePath; sha256: string }>;
                                   usage: GenerationDoc['usage'] } }
  | { event: 'error';      data: { code: ErrorCode; message: string;
                                   partialPreserved: boolean } };

export function openSse(res: Response) {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',
    'Connection': 'keep-alive',
  });
  res.flushHeaders();

  let dead = false;
  res.on('close', () => { dead = true; });
  res.on('error', () => { dead = true; });

  const heartbeat = setInterval(() => { if (!dead) res.write(': ping\n\n'); }, 15_000);

  return {
    send(e: SseEvent) {
      if (dead) return;
      res.write(`event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`);
    },
    get clientGone() { return dead; },
    close() { clearInterval(heartbeat); if (!dead) res.end(); },
  };
}
```

INV-6: every stream terminates with exactly one `done` or one `error`, even on upstream failure — enforced by a single `finally`-style terminal emitter in the orchestrator.

### 4.5 Rate limiter (`lib/rateLimit.ts`)

Fixed window per uid, one transaction per request. Windows: **generations 10/hour**, **proxy 120/min** (a dashboard mounting three calls plus a search burst fits; `while(true) hl.contacts.list()` in generated code does not — the limiter doubles as the blast shield against pathological generated code).

```ts
export async function checkLimit(
  uid: string, kind: 'gen' | 'proxy',
): Promise<void> {
  const cfg = kind === 'gen'
    ? { windowMs: 3_600_000, max: 10,  s: 'genWindowStart',   c: 'genCount' }
    : { windowMs: 60_000,    max: 120, s: 'proxyWindowStart', c: 'proxyCount' };

  await db.runTransaction(async (tx) => {
    const ref = db.doc(`rateLimits/${uid}`);
    const snap = await tx.get(ref);
    const now = Date.now();
    const start = (snap.get(cfg.s) as number) ?? 0;
    const count = (snap.get(cfg.c) as number) ?? 0;

    if (now - start > cfg.windowMs) {
      tx.set(ref, { [cfg.s]: now, [cfg.c]: 1 }, { merge: true });
    } else if (count >= cfg.max) {
      const retryAfter = Math.ceil((start + cfg.windowMs - now) / 1000);
      throw new AppError(429, 'RATE_LIMITED',
        'Rate limit reached. Try again shortly.', retryAfter);
    } else {
      tx.set(ref, { [cfg.c]: count + 1 }, { merge: true });
    }
  });
}
```

---

## 5. HighLevel integration

### 5.1 OAuth start (`oauth/start.ts`)

1. `requireAuth(req)`.
2. `state = base64url(randomBytes(32))`; write `oauthStates/{state} = { uid, createdAt, expireAt: now + 10 min }`.
3. 302 to `https://marketplace.gohighlevel.com/oauth/chooselocation` with `response_type=code`, `client_id`, byte-exact registered `redirect_uri`, the scope set below, and `state`.

Scopes (working set, spellings verified against the marketplace app during implementation — VER-1):

```
contacts.readonly contacts.write conversations.readonly
conversations/message.readonly conversations/message.write
calendars.readonly calendars/events.readonly locations.readonly
```

The state **doc**, not a cookie, binds the callback to a uid — the flow survives third-party-cookie blocking.

### 5.2 OAuth callback (`oauth/callback.ts`)

Ordered steps; no partial writes (encrypt-then-write happens only after a successful exchange):

1. `?error=access_denied` → redirect `/dashboard?hl=error&reason=denied`, no writes.
2. Transaction: load `oauthStates/{state}`; missing or expired → redirect `reason=state_invalid`; else **delete it inside the same transaction** (single use — replay + CSRF defense).
3. Exchange: `POST https://services.leadconnectorhq.com/oauth/token`, form-encoded `grant_type=authorization_code`, `client_id`, `client_secret`, `code`, `redirect_uri`. Response: `access_token`, `refresh_token`, `expires_in` (~86 400 s), `locationId`, `companyId`, `userType`, `scope`. 4xx/5xx → log with correlation id, redirect `reason=exchange_failed`.
4. Encrypt both tokens (AAD = uid). **Full doc replace** of `hlConnections/{uid}`; mirror `users/{uid}.hl = { connected: true, locationId, locationName }` (location name from one `GET /locations/{locationId}`; on failure fall back to the raw id — cosmetic only).
5. Redirect `/dashboard?hl=connected`.

Re-connect while connected is allowed and is also the "switch location" path (one location per user, A-1).

### 5.3 Token refresh — single-flight transaction (`lib/hlClient.ts`)

Lazy refresh, triggered by `expiresAt − 60 s < now` or an HL 401 on a live call. The transaction re-read prevents the refresh stampede — critical because **HighLevel rotates refresh tokens**; two parallel refreshes with the same refresh token would kill the connection.

```ts
export async function getFreshAccessToken(uid: string): Promise<string> {
  return db.runTransaction(async (tx) => {
    const ref = db.doc(`hlConnections/${uid}`);
    const snap = await tx.get(ref);
    if (!snap.exists || snap.get('status') === 'revoked') throw new HlNotConnected();
    const c = snap.data() as HlConnectionDoc;
    if (c.expiresAt - 60_000 > Date.now()) return decrypt(c.accessTokenEnc, uid);

    const t = await hlTokenEndpoint({
      grant_type: 'refresh_token',
      refresh_token: decrypt(c.refreshTokenEnc, uid),
    });
    tx.update(ref, {
      accessTokenEnc: encrypt(t.access_token, uid),
      refreshTokenEnc: encrypt(t.refresh_token ?? decrypt(c.refreshTokenEnc, uid), uid),
      expiresAt: Date.now() + t.expires_in * 1000,
      status: 'connected',
      updatedAt: FieldValue.serverTimestamp(),
    });
    return t.access_token;
  });
}
```

`invalid_grant` (user uninstalled the app, refresh token consumed elsewhere) → set `status: 'revoked'`, mirror `users/{uid}.hl.connected = false`, throw `HlNotConnected` → proxy maps to `409 HL_NOT_CONNECTED` → dashboard flips back to the Connect button.

`hlClient` also owns the upstream fetch wrapper: base `https://services.leadconnectorhq.com`, per-route `Version` header constant, 15 s `AbortSignal.timeout`, one refresh-and-retry on HL 401, then give up (connection genuinely dead → mark `revoked`).

### 5.4 Proxy (`proxy/index.ts`) — request pipeline

1. **CORS.** `OPTIONS` → 204, `Access-Control-Allow-Origin: *`, `Allow-Headers: authorization, content-type`, `Allow-Methods: GET, POST, PUT, OPTIONS`, `Max-Age: 3600`. Wildcard is deliberate and safe: the caller is a sandboxed iframe with `Origin: null`, auth is a bearer token, `Allow-Credentials` is never set.
2. **Auth.** `requireAuth` → `401 UNAUTHENTICATED` (the shim retries once after a token re-handshake).
3. **Rate limit.** `checkLimit(uid, 'proxy')` → `429` + `Retry-After`.
4. **Route match** against the whitelist. No match → `404 NOT_FOUND` — a generated app inventing `hl.opportunities.list()` dies here loudly, not at HighLevel.
5. **Token.** `getFreshAccessToken(uid)`; `HlNotConnected` → `409 HL_NOT_CONNECTED`.
6. **Param translation.** Zod-parse (`.strict()` — reject unknown keys), map to HL names, **inject `locationId` server-side from the connection**. The parameter does not exist on our side of the contract, so generated code can never target another location.
7. **Upstream call** via `hlClient`.
8. **Response normalization.** Map HL's envelope to the SDK shapes promised in prompt Block C; strip unpromised fields (keeps generated code off surface that could shift).

### 5.5 Route table (`proxy/routes.ts`)

SDK-side contract is authoritative; the upstream column is verified against marketplace docs + sandbox contract tests (VER-2). `Version` header values live in this one config map.

```ts
interface HlRoute {
  method: 'GET' | 'POST' | 'PUT';
  path: string;                              // proxy-side, e.g. '/contacts/:id'
  query?: z.ZodType; body?: z.ZodType;       // .strict() schemas
  upstream: (p: UpstreamParams) => UpstreamRequest;
  normalize: (hlJson: unknown) => unknown;   // → SDK spec shape
  version: string;                           // HL 'Version' header constant
}
```

| SDK call | Proxy route | HL upstream (indicative) |
|---|---|---|
| `hl.contacts.list({limit, startAfterId})` | `GET /hl/contacts` | `GET /contacts/?locationId&limit&startAfterId` |
| `hl.contacts.search({query, limit})` | `GET /hl/contacts/search` | `POST /contacts/search` |
| `hl.contacts.create(body)` | `POST /hl/contacts` | `POST /contacts/` |
| `hl.contacts.update(id, body)` | `PUT /hl/contacts/:id` | `PUT /contacts/:id` |
| `hl.conversations.list({limit})` | `GET /hl/conversations` | `GET /conversations/search?locationId&limit` |
| `hl.conversations.messages(id, {limit})` | `GET /hl/conversations/:id/messages` | `GET /conversations/:id/messages` |
| `hl.conversations.send(id, {type, message})` | `POST /hl/conversations/:id/messages` | `POST /conversations/messages` |
| `hl.calendars.list()` | `GET /hl/calendars` | `GET /calendars/?locationId` |
| `hl.calendars.appointments({calendarId, startTime, endTime})` | `GET /hl/calendars/appointments` | `GET /calendars/events?…` |
| `hl.calendars.availability(id, {startDate, endDate})` | `GET /hl/calendars/:id/availability` | `GET /calendars/:id/free-slots?…` |

Path params validated `^[A-Za-z0-9_-]{1,64}$` before interpolation — no traversal, no query smuggling via a crafted id. Proxy responses capped at 2 MB (pathological payload guard). HL 429 → forwarded as `HL_RATE_LIMITED` with `Retry-After` when present.

---

## 6. Project management (callables)

### 6.1 `createProject`

Client-side creation is allowed by rules (defense in depth) but the callable is the real path so the **seed happens atomically**: every project is born with a non-empty tree and a restorable floor, making turn 1 and turn 10 of generation the same code path.

```ts
export const createProject = onCall(async (request) => {
  const uid = requireCallableAuth(request);
  const { name, description } = CreateProjectSchema.parse(request.data);

  const conn = await db.doc(`users/${uid}`).get();          // hl mirror, display only
  const projectRef = db.collection('projects').doc();
  const snapshotId = newId();
  const batch = db.batch();

  const seedFiles = STARTER_TEMPLATE;                       // three FilePath → content
  const manifest: SnapshotDoc['files'] = [];

  for (const [path, content] of Object.entries(seedFiles) as [FilePath, string][]) {
    const sha = sha256hex(content);
    const size = Buffer.byteLength(content, 'utf8');
    manifest.push({ path, sha256: sha, size });
    batch.set(projectRef.collection('blobs').doc(sha),
      { ownerUid: uid, content, size, createdAt: now() });
    batch.set(projectRef.collection('files').doc(fileId(path)),
      { ownerUid: uid, path, content, size, sha256: sha,
        updatedAt: now(), updatedBy: 'seed' } satisfies FileDoc);
  }

  batch.set(projectRef.collection('snapshots').doc(snapshotId), {
    ownerUid: uid, createdAt: now(), trigger: 'seed',
    generationId: null, restoredFrom: null, label: 'Starter template',
    files: manifest,
  } satisfies SnapshotDoc);

  batch.set(projectRef, {
    ownerUid: uid, name, description,
    hlLocationId: conn.get('hl.locationId') ?? null,
    status: 'active', deletedAt: null,
    headSnapshotId: snapshotId, activeGenerationId: null,
    createdAt: now(), updatedAt: now(),
  } satisfies ProjectDoc);

  await batch.commit();
  return { projectId: projectRef.id };
});
```

### 6.2 `renameProject` / `softDeleteProject` / `restoreProject`

Ownership check → zod-validate (`name` 1..80, `description` 0..500) → update. Delete is `status: 'deleted'` + `deletedAt`; restore flips back. Hard delete does not exist (rules `allow delete: if false`). Dashboard queries filter `status == 'active'`; a soft-deleted project opened by direct URL renders a restore banner client-side.

---

## 7. Generation orchestrator (`POST /generate`)

The heart of the backend. One request = one generation turn. Request body (zod): `{ projectId: string, prompt: string /* 1..4000 chars */ }`. Internal deadline: `startedAt + 480 s` — the last 60 s of the 540 s function ceiling are reserved so persistence and the terminal SSE event always land (INV-6).

### 7.1 Entry, auth, single-flight lock

Before any LLM token is spent:

1. `requireAuth`; load project; `ownerUid` + `status == 'active'` checks.
2. `checkLimit(uid, 'gen')`.
3. **Single-flight transaction** on `projects/{pid}` (INV-3):

```ts
const generationId = newId();
await db.runTransaction(async (tx) => {
  const proj = await tx.get(projectRef);
  const activeId = proj.get('activeGenerationId') as string | null;

  if (activeId) {
    const gen = await tx.get(projectRef.collection('generations').doc(activeId));
    const startedAt = (gen.get('startedAt') as Timestamp)?.toMillis() ?? 0;
    if (gen.get('status') === 'streaming' && Date.now() - startedAt < 600_000) {
      throw new AppError(409, 'GENERATION_IN_FLIGHT',
        'A generation is already running for this project.');
    }
    // Older than 600s > the 540s function ceiling: owner instance crashed.
    // Mark orphaned and take over — a live generation can never be stolen.
    tx.update(gen.ref, {
      status: 'failed',
      error: { code: 'ORPHANED', message: 'Generation lost its instance.' },
      completedAt: FieldValue.serverTimestamp(),
    });
  }

  tx.update(projectRef, { activeGenerationId: generationId });
  tx.set(projectRef.collection('generations').doc(generationId), {
    ownerUid: uid, status: 'streaming', prompt, model: MODEL,
    startedAt: FieldValue.serverTimestamp(), completedAt: null,
    usage: null, snapshotId: null, filesChanged: [], error: null, rawPartial: null,
  } satisfies GenerationDoc);
});
```

4. Append the user message to `messages` (server-side write, shares the generation's ordering).
5. `openSse(res)`; emit `meta { generationId, model }`.

**Every terminal path** — completed, failed, cancelled, orphan-marked — clears `activeGenerationId` to `null` **in the same write batch** that sets the terminal status, so the lock and the status can't diverge.

### 7.2 Context assembly (`generate/context.ts`)

Blocks in order, budgets enforced by truncation rules:

| Block | Content | Budget | Cache |
|---|---|---|---|
| A | Role + hard rules | ~400 tok | static — |
| B | Runtime contract + output protocol + gold exemplar | ~1 800 tok | static — |
| C | `hl-sdk` interface spec + one real example response per method (`sdk-spec-v1`) | ~2 500 tok | **breakpoint 1** after C |
| D | Grounding: live samples from the connected location | ≤ 800 tok | per session |
| E | Current working tree, all three files verbatim | ≤ 8 000 tok | **breakpoint 2** after E |
| F | Chat history, last 8 turns, file blocks stripped | ≤ 1 500 tok | per turn |
| G | User prompt | ≤ 4 000 chars | per turn |

Implementation notes:

- A–C are byte-identical across all users/projects; any edit is a spec version bump (`sdk-spec-v2`) so cache behavior stays predictable and prompt regressions bisect.
- **Grounding (D):** three parallel `hlClient` calls with a **5 s combined timeout** — `contacts.list({limit: 3})`, `calendars.list()` (cap 10), `appointments` for the first calendar over the next 7 days (cap 2). Values > 120 chars truncated. Failure or no connection → canned static samples + one line telling the model the data is illustrative. **Grounding failure never fails a generation.**
- **E** is read once and retained as `baseTree` for the commit merge (§7.6) — assembly and merge see one consistent tree.
- **F** stripping: past assistant turns contribute narration + `filesChanged` rendered as `[updated app.js, styles.css]`, never file bodies (E supersedes them) — ~150 vs ~4 000 tokens per historical turn.
- E over budget → middle-out truncation with explicit `…[truncated N bytes]…` markers and a note that edits to truncated regions need the user to trim the file.

### 7.3 Anthropic call

```ts
const stream = anthropic.messages.stream({
  model: MODEL,                    // Sonnet-class, env-pinned (cost rollback = config change)
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

`abort: AbortController` fires on any of: **client disconnect + cancel intent** (§7.7), the **480 s internal deadline**, or the **runaway guard** (accumulated output > 2× total file budget — belt over `max_tokens`). Final `usage` (incl. cache read tokens) lands on the generation doc.

### 7.4 Streaming tag parser (`generate/parser.ts`)

Pure module, no I/O — `feed(delta): ParserEvent[]`, `finish(): ParserEvent[]`. Fully unit-testable with golden transcripts.

```ts
export type ParserEvent =
  | { kind: 'text';       delta: string }
  | { kind: 'file_start'; path: FilePath; action: 'create' | 'update' | 'delete' }
  | { kind: 'file_delta'; path: FilePath; delta: string }
  | { kind: 'file_end';   path: FilePath; content: string }
  | { kind: 'parse_error'; code: 'MALFORMED_OUTPUT' | 'UNCLOSED_FILE'; detail: string };

type State = 'TEXT' | 'IN_FILE';
```

Grammar the model is contractually bound to (Block B): narration text, then zero or more
`<file path="P" action="create|update">…</file>` or `<file path="P" action="delete"/>` blocks.

Mechanics:

- **Holdback:** in each state, withhold the longest buffer suffix that is a proper prefix of the next marker (`<file` in TEXT, `</file>` in IN_FILE); emit the rest. Markers split across deltas reassemble invisibly; worst-case latency cost is `len(marker) − 1` chars.
- **Attribute buffering:** after `<file`, wait for `>` before emitting, buffering ≤ 256 chars of attribute text (past that → `MALFORMED_OUTPUT` hard abort).
- Attributes: exactly `path` and `action`, double-quoted, any order. Path outside the allowed set or invalid action → hard abort **before a single byte of that file streams**.
- Trim one leading newline after the open tag and one trailing newline before the close tag.
- `finish()` in IN_FILE (truncated mid-file) → `parse_error('UNCLOSED_FILE')`; the file is not staged.
- Markdown fence wrapping the whole output → stripped pre-parser by a one-shot regex on the first delta batch.
- Duplicate block for a path in one turn → last wins at staging (logged); the client's `file_start` reset makes the UI self-correct.
- Literal `</file>` inside generated strings: first close marker wins; Block B mandates `<\/file>` inside strings and the exemplar demonstrates it; residual breakage is caught by acorn, not silence.
- Multibyte safety: the SDK yields decoded JS strings; sha/size computed on `Buffer.from(content, 'utf8')` at staging.

The orchestrator pump maps `ParserEvent`s 1:1 onto SSE events and accumulates raw text for `rawPartial`.

### 7.5 Validation gates (`generate/gates.ts`)

Per file, at `file_end` — stage or reject:

```ts
export function validateFile(path: FilePath, action: FileAction, content: string):
  | { ok: true; staged: StagedFile }
  | { ok: false; repairable: boolean; error: string } {
  // 1. path ∈ ALLOWED_PATHS       (parser guarantees; asserted again)
  // 2. Buffer.byteLength(content, 'utf8') <= 100_000
  // 3. action='delete' only for styles.css; deleting a required file
  //    → generation-level VALIDATION_FAILED (not repairable)
  // 4. app.js: acorn.parse(content, { ecmaVersion: 'latest', sourceType: 'module' })
  //    SyntaxError → repairable: true, with acorn message + location
  // 5. index.html: must contain id="app"; must NOT contain '<script'
  //    (all script comes from the shell; also kills the srcdoc-escape vector)
  // 6. styles.css: size only — a broken stylesheet degrades visually
}
```

Per generation, at stream end: staged set non-empty **or** text-only turn (legal: `done` with `files: []`, `snapshotId: null`); total staged ≤ 300 KB; **no-op detection** (every staged sha equals `baseTree`'s sha → treat as text-only, skip snapshot, log); narration non-empty (fallback `"Updated the app."`).

### 7.6 Commit (`generate/commit.ts`)

Runs only when all gates pass, inside the 60 s reserve if needed:

```ts
export async function commitGeneration(ctx: CommitContext): Promise<CommitResult> {
  // 1. ops = staged files → {path, sha256, content}[], plus deletes.

  // 2. Blobs first, individually (INV-4: duplicate writes are semantic no-ops;
  //    create-with-exists tolerated as success).
  await Promise.all(ctx.staged.map((f) =>
    writeBlobIfAbsent(ctx.projectRef, f.sha256, f.content, ctx.uid)));

  // 2b. Uncommitted manual edits present when the turn started?
  //     (baseTree shas ∉ headSnapshot manifest) → implicit snapshot
  //     trigger:'manual', label 'Before generation' — the user's hand-written
  //     state is never the only unreachable version. (LLD §8.2)

  // 3. newManifest = baseTree.manifest overlaid with ops (deletes remove
  //    entries). Merge base = the tree the model saw (§7.2).

  // 4. ONE WriteBatch (< 20 ops):
  const batch = db.batch();
  batch.set(snapRef, snapshotDoc);                          // trigger:'generation'
  for (const f of ctx.staged) batch.set(fileRef(f.path), fileDoc(f, 'llm'));
  for (const p of ctx.deleted) batch.delete(fileRef(p));
  batch.update(ctx.projectRef, {
    headSnapshotId: snapRef.id,
    updatedAt: FieldValue.serverTimestamp(),
    activeGenerationId: null,                               // lock release, same batch
  });
  batch.set(msgRef, assistantMessageDoc);                   // narration + filesChanged
  batch.update(genRef, { status: 'completed', usage, snapshotId: snapRef.id,
                         filesChanged, completedAt: FieldValue.serverTimestamp() });
  await batch.commit();

  // 5. caller emits SSE 'done', closes stream, clears heartbeat.
}
```

Crash between blob writes and the batch leaves **orphan blobs** (harmless, INV-4) and a `streaming` generation the next request orphan-marks. There is no crash point where a snapshot references a missing blob (blobs land first) or where `headSnapshotId` moved without its files (batch atomicity) — INV-1 holds everywhere.

### 7.7 Repair pass, failure classification, cancellation

**Repair (`generate/repair.ts`)** — exactly one, ever. Trigger: exactly one file failed gate 4 **or** `UNCLOSED_FILE`, and ≥ 60 s of deadline remains. Non-streamed follow-up: system = A–C (cache hit), user = broken file + error + "Emit the corrected `<file>` block for this one file only.", `max_tokens: 6_000`. The retry streams as a fresh `file_start`/`file_delta`/`file_end` — visible as an honest rewrite. Repaired file re-enters gate 4. Second failure, multiple failed files, or insufficient deadline → generation `failed` (`MALFORMED_OUTPUT`), `rawPartial` preserved.

**Failure classifier** (order matters):

| Condition | code | rawPartial | SSE terminal |
|---|---|---|---|
| Anthropic 429/529 before first token | `LLM_OVERLOADED` | — | `error` (client offers "Try again") |
| Anthropic error mid-stream | `LLM_STREAM_ERROR` | yes | `error`, `partialPreserved: true` |
| Parser hard abort | `MALFORMED_OUTPUT` | yes | `error` |
| Gate failure after repair | `MALFORMED_OUTPUT` | yes | `error` |
| Internal deadline hit | `GENERATION_TIMEOUT` | yes | `error` |
| Commit write failure | `PERSISTENCE_FAILED` | yes | `error`; head untouched, retry safe |

`rawPartial` = accumulated raw model text truncated to 200 KB with `…[truncated]` — the "partial results preserved" requirement, inspectable without corrupting the tree.

**Disconnect ≠ cancellation** (§7.9 of the LLD, the one-sentence story: *the SSE stream is a latency optimization; the generation doc is the source of truth*):

- `req.on('close')` sets the SSE guard dark, but the pump keeps running: LLM stream completes, gates run, commit lands, the generation doc reaches a terminal state. The reconnecting client resolves from its `onSnapshot` on `generations/{id}` (attached at `meta`), never by SSE replay.
- **Cancellation** = disconnect + intent: the client calls the `cancelGeneration` callable (writes `cancellations/{generationId}`) *then* aborts the fetch. The server's close handler checks for that doc: present → fire the AbortController, mark `cancelled`, keep `rawPartial`, clear the lock; absent (wifi blip, laptop lid) → run to completion.

```ts
export const cancelGeneration = onCall(async (request) => {
  const uid = requireCallableAuth(request);
  const { generationId, projectId } = CancelSchema.parse(request.data);
  await assertOwnsGeneration(uid, projectId, generationId);
  await db.doc(`cancellations/${generationId}`)
          .set({ uid, createdAt: FieldValue.serverTimestamp() });
  return { ok: true };
});
```

---

## 8. File versioning: snapshots, restore, diff

### 8.1 Model recap

- **Working tree** (`files/*`): the three mutable docs the editor and preview read.
- **Blobs** (`blobs/{sha256}`): immutable content store; dedupe is free (seed template shas repeat across every project's history).
- **Snapshots**: manifests `path → sha256` — a version is ~3 doc references, not 3 copies.
- `headSnapshotId`: which snapshot the working tree currently equals (INV-1).

Snapshots mark **generation boundaries, not keystrokes**. Manual Monaco edits save straight to the working tree (client-side debounced write under the §3.2 rules). Two protections: the implicit `'manual'` snapshot before a generation commit when uncommitted edits exist (§7.6 step 2b), and the explicit `saveSnapshot` callable.

### 8.2 `saveSnapshot` (manual)

Ownership check → read the three file docs → write missing blobs → snapshot doc `trigger: 'manual'` with the user's label → move `headSnapshotId`, in one batch. Cheap: manifest + at most 3 blobs.

### 8.3 `restoreSnapshot`

```ts
export const restoreSnapshot = onCall(async (request) => {
  const uid = requireCallableAuth(request);
  const { projectId, snapshotId } = RestoreSchema.parse(request.data);

  // 1. ownership + status=='active'; REJECT 409 GENERATION_IN_FLIGHT if
  //    activeGenerationId is set — restoring under a live stream forks reality.
  // 2. read target manifest; read its blobs (≤ 3 gets).
  // 3. no-op short-circuit: target manifest == head manifest → return early.
  // 4. one batch:
  //    - upsert file docs from blob contents (updatedBy: 'restore')
  //    - delete file docs for paths absent from the manifest
  //      (deletion = absence; restore recreates deleted styles.css)
  //    - NEW snapshot { trigger:'restore', restoredFrom: snapshotId },
  //      same manifest
  //    - headSnapshotId → new snapshot; bump updatedAt
});
```

Restore **appends, never rewinds** — history is append-only, so a restore is itself undoable, and `restoredFrom` keeps lineage legible in the snapshot sheet.

### 8.4 Diff — zero server work

Client-side entirely: compare a snapshot's manifest to its predecessor's (previous ULID). Equal sha → unchanged; missing/new → deleted/created; differing → fetch both blobs (rules allow owner reads) and render in Monaco's diff editor. The content-addressed design pays out here; no backend endpoint exists.

### 8.5 Blob GC — deliberately not built

Orphan blobs (crashed commits, superseded duplicates) cost bytes and break nothing (INV-4). Listed improvement: scheduled mark-sweep of blobs unreferenced by any manifest, older than 24 h. Out of scope: GC bugs destroy data; orphans don't.

---

## 9. Cost guardrails

- Per generation: `max_tokens 12_288` + one repair at 6 000 + grounding ≤ ~800 input → worst case ≈ 18 k output with cached input.
- Per user per day: the 10/hour generation window caps spend at a known ceiling.
- `usage` on every generation doc makes actual spend queryable (`collectionGroup('generations')` if a usage dashboard is ever wanted).
- `MODEL` is env-pinned: a cost incident is a config rollback, not a deploy.

---

## 10. Deployment and local dev

- **Secrets** via `firebase functions:secrets:set`: `ANTHROPIC_API_KEY`, `HL_CLIENT_ID`, `HL_CLIENT_SECRET`, `TOKEN_ENC_KEY` (32 random bytes, base64). Nothing token-like in `functions:config` or source (hard requirement).
- **Hosting**: SPA + `** → /index.html` rewrite only. **No rewrites to `generate` or `hlProxy`** — the frontend uses `VITE_FUNCTIONS_BASE` / `VITE_PROXY_URL` direct URLs (SSE survives; VER-3 smoke test: `curl -N` against the deployed generate URL must show frames arriving incrementally).
- **OAuth redirect URI** registered in the marketplace app = the deployed `oauthCallback` URL byte-exactly. Local dev uses a second marketplace app with the localhost callback.
- **Emulators**: `firebase emulators:start` (auth, firestore, functions, hosting); Admin SDK respects `FIREBASE_AUTH_EMULATOR_HOST` / `FIRESTORE_EMULATOR_HOST`. HL calls hit the real sandbox account (no HL emulator exists); Anthropic calls are real with a dev key.
- **TTL policies** on `oauthStates.expireAt` configured in the console/Terraform (not expressible in rules).

---

## 11. Testing plan (priority order, per LLD §13)

1. **Parser (pure, vitest):** golden transcripts; property test — random re-chunking of a fixed transcript must yield identical events; unclosed file; duplicate path; fence-wrapped output; attribute split across deltas; text-only turn.
2. **Rules (emulator):** INV-2 denial on `hlConnections`; subcollection owner checks; client write denial on `headSnapshotId`/`activeGenerationId`; file update size/path/`updatedBy` pins.
3. **Refresh transaction:** two concurrent `getFreshAccessToken` against a stubbed token endpoint → exactly one upstream refresh.
4. **Commit crash injection:** kill between blob write and batch → next generation orphan-marks and succeeds; `restoreSnapshot` under an active lock → 409.
5. **Proxy contract (CI-tagged, HL sandbox):** all 10 routes round-trip; 401-refresh-retry with a force-expired token; `Version` header per route.
6. **E2E happy path (manual demo script):** sign up → connect → prompt → stream → preview shows sandbox data → edit → run → snapshot → restore.

---

## 12. Open items carried from the LLD

| ID | Item | Resolve against |
|---|---|---|
| VER-1 | Exact OAuth scope spellings; token TTL; refresh rotation | Marketplace app config + first token response |
| VER-2 | Upstream paths / `Version` values / param names per route | marketplace docs + sandbox contract tests |
| VER-3 | SSE survives the deployed gen-2 direct URL unbuffered | curl smoke test |
| VER-5 | HL search endpoint semantics + pagination shape | Sandbox probing; regenerate SDK spec examples from real responses |
| A-1 | One HL location per user | assignment text |
| A-2 | Take-home scale: no blob GC, no Redis limiter, no multi-region | README improvements list |
