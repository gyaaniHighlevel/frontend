<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
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

const router = useRouter()
const auth = useAuthStore()

const displayName = ref('')
const email = ref('')
const password = ref('')
const errors = reactive<{ displayName?: string; email?: string; password?: string }>({})
const formError = ref<string>()
const submitting = ref(false)

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function validate() {
  errors.displayName = !displayName.value.trim() ? 'Name is required.' : undefined
  errors.email = !email.value
    ? 'Email is required.'
    : !EMAIL_RE.test(email.value)
      ? 'Enter a valid email address.'
      : undefined
  errors.password = !password.value
    ? 'Password is required.'
    : password.value.length < 8
      ? 'Password must be at least 8 characters.'
      : undefined
  return !errors.displayName && !errors.email && !errors.password
}

function applyAuthError(err: unknown) {
  const code = err instanceof FirebaseError ? err.code : ''
  switch (code) {
    case 'auth/email-already-in-use':
      errors.email = 'This email is already registered — sign in instead.'
      break
    case 'auth/invalid-email':
      errors.email = 'Enter a valid email address.'
      break
    case 'auth/weak-password':
      errors.password = 'Password is too weak. Use at least 8 characters.'
      break
    case 'auth/too-many-requests':
      formError.value = 'Too many attempts. Try again later.'
      break
    case 'auth/network-request-failed':
      formError.value = 'Network error. Check your connection and try again.'
      break
    default:
      formError.value = 'Something went wrong. Please try again.'
      console.error('signup failed:', err)
  }
}

async function submit() {
  formError.value = undefined
  if (!validate()) return
  submitting.value = true
  try {
    await auth.signUp(displayName.value.trim(), email.value, password.value)
    await router.push('/projects')
  } catch (err) {
    applyAuthError(err)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <AuthCard
    title="Create your account"
    subtitle="Describe an app; we generate it on your HighLevel data."
  >
    <form class="flex flex-col gap-5" novalidate @submit.prevent="submit">
      <div class="flex flex-col gap-1.5">
        <Label for="name" class="font-semibold">Name</Label>
        <Input
          id="name"
          v-model="displayName"
          type="text"
          autocomplete="name"
          placeholder="Ravi Shah"
          :aria-invalid="!!errors.displayName || undefined"
          aria-describedby="name-error"
          class="h-9 px-3 text-sm"
        />
        <p v-if="errors.displayName" id="name-error" class="text-xs text-destructive">
          {{ errors.displayName }}
        </p>
      </div>

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
          autocomplete="new-password"
          placeholder="At least 8 characters"
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
        {{ submitting ? 'Creating account…' : 'Create account' }}
      </Button>
    </form>

    <template #footer>
      Already have an account?
      <RouterLink :to="{ name: '/signin' }" class="font-semibold text-primary hover:underline">
        Sign in
      </RouterLink>
    </template>
  </AuthCard>
</template>
