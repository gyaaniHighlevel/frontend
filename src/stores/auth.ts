import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

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
 * Mock auth store. The Firebase Auth wiring (LLD §3) replaces the bodies of
 * signIn/signUp/signOut later; the shape is what views depend on.
 */
export const useAuthStore = defineStore('auth', () => {
  const user = ref<AuthUser | null>({
    email: 'ravi@northbeam.media',
    displayName: 'Ravi Shah',
    plan: 'Free plan',
  })

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

  function signIn(email: string, _password: string) {
    user.value = { email, displayName: 'Ravi Shah', plan: 'Free plan' }
  }

  function signUp(displayName: string, email: string, _password: string) {
    user.value = { email, displayName, plan: 'Free plan' }
  }

  function signOut() {
    user.value = null
  }

  return { user, hl, initials, signIn, signUp, signOut }
})
