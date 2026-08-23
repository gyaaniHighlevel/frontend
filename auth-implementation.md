# Genesis — Authentication & session management (Firebase, email + password)

Implementation plan for LLD §3 (App authentication), §5.1–5.2 (users collection + rules), and the token plumbing that connects the frontend to the Cloud Functions in §6/§7/§11. This replaces the mock `src/stores/auth.ts` currently on the `auth` branch.

| | |
|---|---|
| Status | Ready for implementation |
| Depends on | `genesis-lld.md` §3, §5, §11 |
| Scope | Email + password sign-up/sign-in, persistent sessions, router guards, ID-token delivery to Cloud Functions, `users/{uid}` profile doc |
| Out of scope (per LLD) | Email verification, password reset, anonymous auth, social providers |

---

## 1. What Firebase gives us vs. what we build

Firebase Auth owns the hard parts: credential storage/hashing, session persistence, token minting and refresh. There is **no custom session backend, no cookies, no server-side session store**. A "session" is the Firebase SDK holding a refresh token in IndexedDB (`browserLocalPersistence`, the SDK default) and exchanging it for 60-minute ID tokens automatically. This alone satisfies the persistence requirement — a page refresh restores the session with zero custom code.

We build four things:

1. Firebase project configuration (console-side, §2).
2. A real `auth` Pinia store wrapping the Firebase JS SDK (§4).
3. Router guards with a boot-splash gate (§5).
4. ID-token forwarding to every Cloud Function call, plus the 401-retry policy (§6).

No auth-specific Cloud Functions or HTTP routes are needed. Sign-up, sign-in, and token refresh all go **directly from the browser to Firebase Auth servers** via the SDK. Our functions only *verify* tokens; they never issue them.

---

## 2. Firebase console / project setup steps

Do these once, in order:

1. **Create the Firebase project** at console.firebase.google.com (or `firebase projects:create`). Note the project ID for `.firebaserc`.
2. **Register a Web App** (Project settings → Your apps → Web). Copy the config object (`apiKey`, `authDomain`, `projectId`, `appId`, …) into `.env.local` as `VITE_FIREBASE_CONFIG` (JSON string, per LLD §11). The `apiKey` is not a secret — it only identifies the project; security comes from rules and token verification.
3. **Enable the Email/Password provider**: Authentication → Sign-in method → Email/Password → Enable. Leave "Email link (passwordless)" off.
4. **(Recommended) Enable Email Enumeration Protection**: Authentication → Settings → User actions. Note the behavioral consequence: the SDK returns the generic `auth/invalid-credential` instead of distinguishing `auth/user-not-found` from `auth/wrong-password` — the sign-in error mapping in §4.4 assumes this.
5. **Authorized domains**: Authentication → Settings → Authorized domains. `localhost` and the `*.web.app` / `*.firebaseapp.com` hosting domains are pre-authorized; add any custom domain used for the demo.
6. **Create the Firestore database** (production mode, pick the region that will also host the gen-2 functions — keep them co-located).
7. **Deploy security rules** from LLD §5.2 (`firestore.rules`), including the `users/{uid}` block that permits client-side profile-doc creation:
   ```
   match /users/{uid} {
     allow read, create, update: if signedIn() && request.auth.uid == uid;
     allow delete: if false;
   }
   ```
8. **Upgrade to the Blaze plan** — required for gen-2 Cloud Functions later; auth itself works on Spark.
9. **Local emulators**: add `auth` and `firestore` to `firebase.json` emulators config. The frontend connects via `connectAuthEmulator` / `connectFirestoreEmulator` when `import.meta.env.DEV` and an emulator flag is set (§4.1).

Nothing auth-related goes into Secret Manager. `HL_CLIENT_SECRET`, `TOKEN_ENC_KEY`, etc. (LLD §11) belong to the OAuth/proxy subsystem, not this one.

---

## 3. Frontend dependencies and new files

Add to `package.json`: `firebase` (JS SDK v10+, modular API). Nothing else — no `firebaseui`, no wrapper libraries.

```
src/
  lib/firebase.ts          NEW  app init, auth + firestore singletons, emulator wiring
  stores/auth.ts           REWRITE  mock bodies → Firebase SDK (shape preserved)
  main.ts                  MODIFY  register router guard, gate mount on auth resolution
  App.vue                  MODIFY  splash state until authReady
  pages/signin.vue         MODIFY  async submit, error mapping, ?next redirect
  pages/signup.vue         MODIFY  async submit, error mapping, profile doc creation
```

`src/lib/firebase.ts`:

```ts
import { initializeApp } from 'firebase/app'
import { getAuth, connectAuthEmulator } from 'firebase/auth'
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore'

const app = initializeApp(JSON.parse(import.meta.env.VITE_FIREBASE_CONFIG))
export const auth = getAuth(app)      // browserLocalPersistence is the default — do not override
export const db = getFirestore(app)

if (import.meta.env.DEV && import.meta.env.VITE_USE_EMULATORS === 'true') {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
}
```

---

## 4. The `auth` store rewrite

The store's public shape (`user`, `hl`, `initials`, `signIn`, `signUp`, `signOut`) is what every view already binds to — keep it, extend it. New state: `authReady` (has the first `onAuthStateChanged` fired?) and `firebaseUser` (the raw `User` for `getIdToken`).

### 4.1 State and listener wiring

```ts
const firebaseUser = ref<User | null>(null)
const profile = ref<UserProfile | null>(null)   // users/{uid} doc (email, displayName, hl mirror)
const authReady = ref(false)

let resolveReady: () => void
const ready = new Promise<void>((r) => { resolveReady = r })

onAuthStateChanged(auth, (u) => {
  firebaseUser.value = u
  if (u) attachProfileListener(u.uid)           // onSnapshot on users/{uid} → profile + hl mirror
  else { detachProfileListener(); profile.value = null }
  if (!authReady.value) { authReady.value = true; resolveReady() }
})
```

`hl` (the connection badge the dashboard and ConnectHL.vue read) stops being local mock state — it is derived from `profile.value.hl`, the display-only mirror the OAuth callback maintains on `users/{uid}` (LLD §4.1c). One `onSnapshot` listener serves both.

`onIdTokenChanged(auth, …)` is wired separately with exactly one consumer, per LLD §3.1: the workspace store, which re-posts `genesis:token` to the preview iframe (§9.3/9.4). Backend calls do **not** subscribe to it — they fetch a fresh token at call time (§6.1).

### 4.2 Sign-up

```ts
async function signUp(displayName: string, email: string, password: string) {
  const cred = await createUserWithEmailAndPassword(auth, email, password)
  await updateProfile(cred.user, { displayName })
  await setDoc(doc(db, 'users', cred.user.uid), {
    email, displayName,
    createdAt: serverTimestamp(),
    hl: { connected: false },
  })
}
```

The profile doc is created **client-side**, allowed by the rules `create` clause (`request.auth.uid == uid`). If the `setDoc` fails after account creation (network drop between the two calls), the account exists without a profile doc — handle by making the profile listener self-heal: on first snapshot with `!exists`, re-run the `setDoc` from `firebaseUser` fields. Idempotent, and cheaper than an Auth `onCreate` trigger (which would add a function deploy for one edge case).

### 4.3 Sign-in and sign-out

`signIn` = `signInWithEmailAndPassword(auth, email, password)`. `signOut` = `firebaseSignOut(auth)` and then `router.push('/signin')`; the `onAuthStateChanged` callback clears state — do not clear it manually in `signOut`, the listener is the single writer.

### 4.4 Error mapping (LLD §3.2)

Views render inline field errors from a `code → message` map; the store rethrows a typed `AuthError` with the SDK code so pages decide placement:

| SDK code | UI behavior |
|---|---|
| `auth/email-already-in-use` | Inline on email field + "Sign in instead?" link swap |
| `auth/weak-password` | Inline on password field ("At least 6 characters") |
| `auth/invalid-email` | Inline on email field |
| `auth/invalid-credential` (also covers user-not-found / wrong-password under enumeration protection) | Form-level "Incorrect email or password" |
| `auth/too-many-requests` | Form-level "Too many attempts. Try again later." |
| anything else | Form-level generic + `console.error` of the raw code |

`signin.vue` / `signup.vue` change from the current fire-and-forget calls (`auth.signIn(...); router.push(...)`) to `await` + try/catch, with a submitting/disabled state on the button, and redirect to `route.query.next ?? '/projects'` on success.

---

## 5. Router integration — splash gate and guards

The classic bug the LLD calls out: `auth.currentUser` is `null` synchronously on cold load, so a naive guard redirects an authenticated user to `/signin` on every refresh. The fix has two parts:

**Boot splash.** `App.vue` renders a splash/skeleton while `!authStore.authReady`. The guard `await`s the store's `ready` promise before evaluating, so the first navigation (including deep links like `/p/abc123`) simply pauses until Firebase restores the session — typically < 100 ms warm.

**Guard reads the store, never `auth.currentUser`.** In `main.ts`:

```ts
router.beforeEach(async (to) => {
  const store = useAuthStore()
  await store.ready
  const signedIn = !!store.firebaseUser
  if (to.meta.requiresAuth && !signedIn)
    return { path: '/signin', query: { next: to.fullPath } }
  if (to.meta.guestOnly && signedIn)
    return { path: '/projects' }
})
```

Route table (unplugin-vue-router file routes, meta via `definePage`):

| Route | Page file | Meta | Notes |
|---|---|---|---|
| `/` | `pages/(home).vue` | public | Marketing/landing; CTA routes by auth state |
| `/signin` | `pages/signin.vue` | `guestOnly` | Accepts `?next=` |
| `/signup` | `pages/signup.vue` | `guestOnly` | |
| `/projects` | `pages/projects.vue` | `requiresAuth` | Dashboard |
| `/p/:projectId` | `pages/p/[projectId].vue` | `requiresAuth` | Workspace; deep-link target of the `?next=` flow |

The store initialization must happen before the first navigation — call `useAuthStore()` (which wires `onAuthStateChanged` in its setup body) in `main.ts` after `app.use(createPinia())` and before `app.use(router)`.

---

## 6. Connecting auth to the Cloud Functions

### 6.1 Token flow

Every backend surface authenticates with the **Firebase ID token** (a JWT, ~60 min lifetime, auto-refreshed by the SDK ~5 min before expiry). Per LLD §3.1, tokens are fetched **per request** — `await firebaseUser.getIdToken()` returns the cached token or transparently refreshes; we never cache tokens ourselves.

| Caller | Function (LLD §11) | How the token travels |
|---|---|---|
| SSE client (`lib/sseClient.ts`) | `generate` (HTTPS, direct Cloud Run URL) | `Authorization: Bearer <idToken>` header on the `fetch` POST |
| Connect HighLevel button | `oauthStart` (HTTPS) | `Authorization: Bearer <idToken>` |
| Preview iframe shim → proxy | `hlProxy` (HTTPS) | Parent posts the token via `genesis:token`; shim sends `Authorization: Bearer` (LLD §9.3) |
| Dashboard/workspace CRUD | `projects`, `snapshots`, `cancelGeneration` (callables) | `httpsCallable` attaches the token automatically — nothing to do |
| Direct Firestore reads/listeners | — | SDK attaches auth context; rules enforce `request.auth.uid` |

Add one helper in the auth store so call sites don't reach into Firebase:

```ts
async function getIdToken(force = false): Promise<string> {
  if (!firebaseUser.value) throw new Error('not-signed-in')
  return firebaseUser.value.getIdToken(force)
}
```

### 6.2 Server side (functions repo)

- HTTPS functions (`generate`, `hlProxy`, `oauthStart`): step 2 of the pipeline in LLD §6.1 — `admin.auth().verifyIdToken(bearer)` → `401 UNAUTHENTICATED` on failure. `checkRevoked` is not passed (extra network hop per request; the ≤ 60 min token lifetime bounds the exposure, and account deletion surfaces as `auth/user-not-found` anyway).
- Callables: `request.auth` is populated by the framework; reject when `request.auth == null` with `unauthenticated`.
- No auth routes exist server-side. `/signup`, `/signin`, token refresh — none of these are ours; they are SDK ↔ `identitytoolkit.googleapis.com` traffic.

### 6.3 401 retry policy (LLD §3.2)

One shared rule for all backend calls: on a `401` from our functions, retry **once** with `getIdToken(true)` (forced refresh); if the retry also 401s, call `signOut()` — the session is genuinely dead (account deleted/disabled server-side). Implement it once in the fetch wrapper used by `sseClient` and the proxy-URL helper, not per call site. The preview iframe path has its own variant already specified: shim posts `genesis:token-refresh`, parent re-sends a fresh token, shim retries once (LLD §9.4).

---

## 7. Session management summary

| Concern | Mechanism |
|---|---|
| Persistence across refresh/restart | `browserLocalPersistence` (IndexedDB) — SDK default, no code |
| Token lifetime / refresh | 60-min ID tokens; SDK auto-refreshes ~5 min early using the long-lived refresh token |
| Mid-session expiry | Transparent to us; belt-and-suspenders is the §6.3 forced-refresh retry |
| Multiple tabs | Shared persistence, safe for auth; workspace races are handled by generation single-flight (LLD §7.1), not by auth |
| Revocation (account deleted/disabled) | Backend `verifyIdToken` fails → 401 → forced-refresh retry fails → client signs out |
| Sign-out | `signOut(auth)` clears local persistence; listener resets store; guard bounces protected routes |
| Preview iframe sessions | Iframe has an opaque origin — **no** Firebase session inside it (LLD §9.2); it only ever holds the short-lived ID token handed over via postMessage |

---

## 8. Edge cases (restated from LLD §3.2 with owners)

| Case | Behavior | Where implemented |
|---|---|---|
| `auth/email-already-in-use` | Inline error, offer switch to sign-in | `signup.vue` |
| `auth/weak-password`, `auth/invalid-email` | Inline field errors | both auth pages |
| Cold load, deep link `/p/:id` | Splash until `authReady`; unauthenticated → `/signin?next=/p/:id` | `App.vue` + router guard |
| ID token expired mid-session | SDK refresh transparent; our-401 → one `getIdToken(true)` retry → sign-out | fetch wrapper (§6.3) |
| Profile doc missing after crashed sign-up | Listener self-heals with idempotent `setDoc` | auth store (§4.2) |
| Multiple tabs | No action needed for auth | — |
| Account deleted while session live | 401 chain ends in client sign-out | fetch wrapper |
| `VITE_FIREBASE_CONFIG` missing/malformed | Fail fast at boot with a readable error, not a blank splash | `lib/firebase.ts` |

---

## 9. Implementation order and test checklist

1. Firebase console setup (§2) + `firebase` dependency + `lib/firebase.ts`.
2. Rewrite `stores/auth.ts` (§4) — views keep compiling because the shape is preserved.
3. Splash gate + router guards + route meta (§5).
4. Wire `signin.vue` / `signup.vue` submit paths with error mapping (§4.4).
5. `getIdToken` helper + shared fetch wrapper with the 401 policy (§6) — this lands before any function exists; the wrapper is what the SSE client and proxy calls build on later.
6. Emulator rules tests: `users/{uid}` create allowed for own uid, denied for other uid; update denied cross-uid (extends the LLD §13 item 2 suite).

Manual verification for the demo script (LLD §13 item 6): sign up → refresh page (still signed in) → deep-link to `/p/:id` in a fresh tab (splash → workspace) → sign out → deep-link again (redirect to `/signin?next=…`) → sign in (lands back on the project).
