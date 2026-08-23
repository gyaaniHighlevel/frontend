<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { FirebaseError } from 'firebase/app'
import { useAuthStore } from '@/stores/auth'
import AuthCard from '@/components/auth/AuthCard.vue'
import PasswordInput from '@/components/auth/PasswordInput.vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

definePage({
  meta: { guestOnly: true },
})

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const email = ref('')
const password = ref('')
const errors = reactive<{ email?: string; password?: string }>({})
const formError = ref<string>()
const submitting = ref(false)

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function validate() {
  errors.email = !email.value
    ? 'Email is required.'
    : !EMAIL_RE.test(email.value)
      ? 'Enter a valid email address.'
      : undefined
  errors.password = !password.value ? 'Password is required.' : undefined
  return !errors.email && !errors.password
}

function applyAuthError(err: unknown) {
  const code = err instanceof FirebaseError ? err.code : ''
  switch (code) {
    case 'auth/invalid-email':
      errors.email = 'Enter a valid email address.'
      break
    // With email enumeration protection, invalid-credential also covers
    // user-not-found / wrong-password (auth-implementation.md §4.4).
    case 'auth/invalid-credential':
    case 'auth/user-not-found':
    case 'auth/wrong-password':
      formError.value = 'Incorrect email or password.'
      break
    case 'auth/user-disabled':
      formError.value = 'This account has been disabled.'
      break
    case 'auth/too-many-requests':
      formError.value = 'Too many attempts. Try again later.'
      break
    case 'auth/network-request-failed':
      formError.value = 'Network error. Check your connection and try again.'
      break
    default:
      formError.value = 'Something went wrong. Please try again.'
      console.error('signin failed:', err)
  }
}

async function submit() {
  formError.value = undefined
  if (!validate()) return
  submitting.value = true
  try {
    await auth.signIn(email.value, password.value)
    const next = typeof route.query.next === 'string' ? route.query.next : undefined
    await router.push(next ?? '/projects')
  } catch (err) {
    applyAuthError(err)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <AuthCard title="Welcome back" subtitle="Sign in to keep building HighLevel apps.">
    <form class="flex flex-col gap-5" novalidate @submit.prevent="submit">
      <div class="flex flex-col gap-1.5">
        <Label for="email" class="font-semibold">Email</Label>
        <Input
          id="email"
          v-model="email"
          type="email"
          autocomplete="email"
          placeholder="you@agency.com"
          :aria-invalid="!!errors.email || undefined"
          aria-describedby="email-error"
          class="h-9 px-3 text-sm"
        />
        <p v-if="errors.email" id="email-error" class="text-xs text-destructive">
          {{ errors.email }}
        </p>
      </div>

      <div class="flex flex-col gap-1.5">
        <Label for="password" class="font-semibold">Password</Label>
        <PasswordInput
          id="password"
          v-model="password"
          autocomplete="current-password"
          placeholder="••••••••"
          :invalid="!!errors.password"
          described-by="password-error"
        />
        <p v-if="errors.password" id="password-error" class="text-xs text-destructive">
          {{ errors.password }}
        </p>
      </div>

      <p
        v-if="formError"
        role="alert"
        class="rounded-md bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive"
      >
        {{ formError }}
      </p>

      <Button type="submit" :disabled="submitting" class="h-9 w-full text-sm font-semibold">
        {{ submitting ? 'Signing in…' : 'Sign in' }}
      </Button>
    </form>

    <template #footer>
      New to Genesis?
      <RouterLink :to="{ name: '/signup' }" class="font-semibold text-primary hover:underline">
        Create an account
      </RouterLink>
    </template>
  </AuthCard>
</template>
