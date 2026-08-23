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
 */
export const useAuthStore = defineStore('auth', () => {
  const firebaseUser = shallowRef<User | null>(null)
  const authReady = ref(false)

  let resolveReady: () => void
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve
  })

  // Single writer for auth state: sign-in/up/out all land here.
  onAuthStateChanged(firebaseAuth, (u) => {
    firebaseUser.value = u
    if (!authReady.value) {
      authReady.value = true
      resolveReady()
    }
  })

  const user = computed<AuthUser | null>(() =>
    firebaseUser.value
      ? {
          email: firebaseUser.value.email ?? '',
          displayName: firebaseUser.value.displayName ?? firebaseUser.value.email ?? 'Account',
          plan: 'Free plan',
        }
      : null,
  )

  // Mock until the users/{uid} Firestore mirror lands (auth-implementation.md §4.1);
  // no Firestore database exists yet.
  const hl = ref<HlConnection>({
    connected: true,
    locationName: 'Northbeam Media',
    locationType: 'Agency',
    scopes: ['Contacts', 'Conversations', 'Calendars'],
  })

  const initials = computed(() =>
    (user.value?.displayName ?? '')
      .split(' ')
      .map((part) => part[0])
      .join('')
      .toUpperCase()
      .slice(0, 2),
  )

  async function signIn(email: string, password: string) {
    await signInWithEmailAndPassword(firebaseAuth, email, password)
  }

  async function signUp(displayName: string, email: string, password: string) {
    const cred = await createUserWithEmailAndPassword(firebaseAuth, email, password)
    await updateProfile(cred.user, { displayName })
    // updateProfile mutates the same User object, so force dependents to recompute.
    triggerRef(firebaseUser)
  }

  async function signOut() {
    await firebaseSignOut(firebaseAuth)
  }

  /** Per-request ID token for Cloud Function calls (auth-implementation.md §6.1). */
  async function getIdToken(force = false): Promise<string> {
    if (!firebaseUser.value) throw new Error('not-signed-in')
    return firebaseUser.value.getIdToken(force)
  }

  return { firebaseUser, user, hl, initials, authReady, ready, signIn, signUp, signOut, getIdToken }
})
