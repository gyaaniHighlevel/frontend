<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const auth = useAuthStore()

const email = ref('')
const password = ref('')

function submit() {
  if (!email.value || !password.value) return
  auth.signIn(email.value, password.value)
  router.push({ name: '/projects' })
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-surface px-4">
    <div class="flex w-full max-w-[400px] flex-col gap-7">
      <div class="flex items-center justify-center gap-[9px]">
        <div class="size-[30px] rounded-lg bg-linear-150 from-[#3b82f6] to-[#1d4ed8]" />
        <span class="text-[17px] font-bold text-foreground">Genesis</span>
      </div>

      <form
        class="flex flex-col gap-5 rounded-[14px] border border-input bg-white p-7 shadow-[0_10px_30px_rgba(29,78,216,.08)]"
        @submit.prevent="submit"
      >
        <div class="flex flex-col gap-1 text-center">
          <h1 class="text-xl font-bold text-foreground">Welcome back</h1>
          <p class="text-[13.5px] text-[#7a8698]">Sign in to keep building HighLevel apps.</p>
        </div>

        <div class="flex flex-col gap-1.5">
          <label for="email" class="text-[12.5px] font-semibold text-foreground">Email</label>
          <input
            id="email"
            v-model="email"
            type="email"
            required
            placeholder="you@agency.com"
            class="rounded-lg border border-input px-3 py-[9px] text-sm text-foreground outline-none placeholder:text-[#98a3b4] focus:border-ring"
          />
        </div>

        <div class="flex flex-col gap-1.5">
          <label for="password" class="text-[12.5px] font-semibold text-foreground">Password</label>
          <input
            id="password"
            v-model="password"
            type="password"
            required
            placeholder="••••••••"
            class="rounded-lg border border-input px-3 py-[9px] text-sm text-foreground outline-none placeholder:text-[#98a3b4] focus:border-ring"
          />
        </div>

        <button
          type="submit"
          class="rounded-lg bg-primary px-4 py-2.5 text-[13.5px] font-semibold text-primary-foreground hover:bg-primary/90"
        >
          Sign in
        </button>
      </form>

      <p class="text-center text-[13px] text-[#7a8698]">
        New to Genesis?
        <RouterLink :to="{ name: '/signup' }" class="font-semibold text-primary">Create an account</RouterLink>
      </p>
    </div>
  </div>
</template>
