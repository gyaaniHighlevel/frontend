import { computed, ref, shallowRef, triggerRef } from 'vue'
import { defineStore } from 'pinia'
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  updateProfile,
  type User,
} from 'firebase/auth'
import { firebaseAuth } from '@/lib/firebase'
import { api, ApiError } from '@/lib/api'
import { createUserProfile, mapProfile, type ProfileWire } from '@/lib/backend'
import type { UserProfile } from '@/types'

export interface AuthUser {
  email: string
  displayName: string
  plan: string
}

export interface HlConnection {
  connected: boolean
  locationName: string
  locationType: string
  scopes: string[]
}

/**
 * Firebase-backed auth store (auth-implementation.md §4). Sessions persist via
 * the SDK's browserLocalPersistence; `ready` resolves once the first
 * onAuthStateChanged fires, so router guards never read a stale null user.
 *
 * The backend user profile (users/{uid}) is bootstrapped on sign-in/up via the
 * idempotent createUserProfile callable (frontend-integration.md §5) and
 * fetched on session restore.
 */
export const useAuthStore = defineStore('auth', () => {
  const firebaseUser = shallowRef<User | null>(null)
  const authReady = ref(false)
  const profile = ref<UserProfile | null>(null)

  // Set while signIn/signUp run their own bootstrap, so the auth listener's
  // restore-path fetch doesn't race createUserProfile with an empty payload.
  let authFlowActive = false

  let resolveReady: () => void
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve
  })

  async function fetchProfile(): Promise<void> {
    profile.value = mapProfile(await api<ProfileWire>('GET', '/users/me'))
  }

  /**
   * Idempotent profile bootstrap (§5): safe on both signup and sign-in, and
   * self-heals accounts whose profile call failed the first time.
   */
  async function bootstrapProfile(displayName?: string): Promise<void> {
    await createUserProfile(displayName ? { displayName } : {})
    await fetchProfile()
  }

  /** Session-restore path: profile should already exist; heal a 404 once. */
  async function loadProfile(): Promise<void> {
    try {
      await fetchProfile()
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        await bootstrapProfile().catch((err) => console.error('profile self-heal failed:', err))
      } else {
        console.error('profile fetch failed:', e)
      }
    }
  }

  // Single writer for auth state: sign-in/up/out all land here.
  onAuthStateChanged(firebaseAuth, (u) => {
    firebaseUser.value = u
    if (!u) profile.value = null
    else if (!authFlowActive && !profile.value) void loadProfile()
    if (!authReady.value) {
      authReady.value = true
      resolveReady()
    }
  })

  const user = computed<AuthUser | null>(() =>
    firebaseUser.value
      ? {
          email: firebaseUser.value.email ?? '',
          displayName:
            profile.value?.displayName ??
            firebaseUser.value.displayName ??
            firebaseUser.value.email ??
            'Account',
          plan: 'Free plan',
        }
      : null,
  )

  // Real users/{uid}.hl mirror — server-managed by the HighLevel OAuth exchange.
  // Scopes live in the server-only hlConnections doc; read them via GET /oauth/hl/status.
  const hl = computed<HlConnection>(() => ({
    connected: profile.value?.hl.connected ?? false,
    locationName: profile.value?.hl.locationName ?? '',
    locationType: profile.value?.hl.connected ? 'Location' : '',
    scopes: [],
  }))

  const initials = computed(() =>
    (user.value?.displayName ?? '')
      .split(' ')
      .map((part) => part[0])
      .join('')
      .toUpperCase()
      .slice(0, 2),
  )

  async function signIn(email: string, password: string) {
    authFlowActive = true
    try {
      await signInWithEmailAndPassword(firebaseAuth, email, password)
      // Non-fatal: the session is valid even if the profile call hiccups.
      await bootstrapProfile().catch((e) => console.error('profile bootstrap failed:', e))
    } finally {
      authFlowActive = false
    }
  }

  async function signUp(displayName: string, email: string, password: string) {
    authFlowActive = true
    try {
      const cred = await createUserWithEmailAndPassword(firebaseAuth, email, password)
      await updateProfile(cred.user, { displayName })
      // updateProfile mutates the same User object, so force dependents to recompute.
      triggerRef(firebaseUser)
      await bootstrapProfile(displayName).catch((e) => console.error('profile bootstrap failed:', e))
    } finally {
      authFlowActive = false
    }
  }

  async function signOut() {
    await firebaseSignOut(firebaseAuth)
  }

  /** Per-request ID token for Cloud Function calls (auth-implementation.md §6.1). */
  async function getIdToken(force = false): Promise<string> {
    if (!firebaseUser.value) throw new Error('not-signed-in')
    return firebaseUser.value.getIdToken(force)
  }

  return {
    firebaseUser,
    user,
    profile,
    hl,
    initials,
    authReady,
    ready,
    signIn,
    signUp,
    signOut,
    getIdToken,
    /** Re-fetch users/{uid}, e.g. after the HighLevel OAuth callback lands. */
    refreshProfile: loadProfile,
  }
})
