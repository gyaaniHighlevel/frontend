<script setup lang="ts">
import { useRouter } from 'vue-router'
import { LogOut } from '@lucide/vue'
import ConnectHL from '@/components/ConnectHL.vue'
import { useAuthStore } from '@/stores/auth'
import { useProjectsStore } from '@/stores/projects'

const router = useRouter()
const auth = useAuthStore()
const projects = useProjectsStore()

async function signOut() {
  await auth.signOut()
  router.push({ name: '/signin' })
}

const navItems = [{ label: 'Projects', active: true }]
</script>

<template>
  <aside class="flex w-[236px] shrink-0 flex-col gap-[26px] border-r border-border bg-surface px-4 py-5">
    <div class="flex items-center gap-[9px]">
      <div class="size-[26px] rounded-[7px] bg-linear-150 from-[#3b82f6] to-[#1d4ed8]" />
      <span class="text-[15px] font-bold text-foreground">Genesis</span>
    </div>

    <nav class="flex flex-col gap-0.5">
      <a
        v-for="item in navItems"
        :key="item.label"
        href="#"
        class="rounded-[7px] px-2.5 py-2 text-[13.5px] leading-none"
        :class="
          item.active
            ? 'bg-accent font-semibold text-accent-foreground'
            : 'font-medium text-[#5b6879] hover:bg-white hover:no-underline'
        "
        @click.prevent
      >
        {{ item.label }}
      </a>
    </nav>

    <div v-if="projects.recentNames.length" class="flex flex-col gap-2">
      <div class="font-mono text-[10.5px] font-semibold tracking-[0.1em] uppercase text-[#94a3b8]">
        Recent
      </div>
      <div class="text-[13px] leading-[1.9] font-medium text-[#5b6879]">
        <div v-for="name in projects.recentNames" :key="name">{{ name }}</div>
      </div>
    </div>

    <div class="mt-auto">
      <ConnectHL />
    </div>

    <div class="flex items-center gap-[9px] border-t border-border pt-3.5">
      <div
        class="size-7 rounded-full bg-[#cfdcf5] text-center text-[11.5px] leading-7 font-semibold text-primary"
      >
        {{ auth.initials }}
      </div>
      <div class="min-w-0 flex-1">
        <div class="truncate text-[12.5px] leading-tight font-semibold text-foreground">
          {{ auth.user?.displayName }}
        </div>
        <div class="text-[11.5px] leading-tight text-[#8894a6]">{{ auth.user?.plan }}</div>
      </div>
      <button
        type="button"
        class="rounded-md p-1.5 text-[#8894a6] transition-colors hover:bg-white hover:text-foreground"
        aria-label="Sign out"
        title="Sign out"
        @click="signOut"
      >
        <LogOut class="size-4" />
      </button>
    </div>
  </aside>
</template>
