<script setup lang="ts">
import { ref } from 'vue'
import { useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { ApiError } from '@/lib/api'
import { exchangeHlCode, HL_OAUTH_CHANNEL, type HlConnectionStatus } from '@/lib/hl'

// HighLevel OAuth 2.0 redirect target (marketplace.gohighlevel.com/docs/Authorization/OAuth2.0).
// HighLevel appends ?code=<authorization_code> after the user picks a location;
// we forward it to POST /oauth/hl/connect, which exchanges and stores the tokens.
const route = useRoute()
const auth = useAuthStore()

type State = 'exchanging' | 'success' | 'error' | 'no-code' | 'signed-out'
const state = ref<State>('exchanging')
const status = ref<HlConnectionStatus | null>(null)
const errorMessage = ref('')

async function run() {
  const raw = route.query.code
  const code = typeof raw === 'string' ? raw : null
  if (!code) {
    state.value = 'no-code'
    return
  }

  // This tab shares the persisted Firebase session with the opener; wait for
  // it to restore before calling the authenticated endpoint.
  await auth.ready
  if (!auth.firebaseUser) {
    state.value = 'signed-out'
    return
  }

  try {
    status.value = await exchangeHlCode(code)
    state.value = 'success'
    // Refresh this tab's profile and ping other tabs so their cards update.
    void auth.refreshProfile()
    new BroadcastChannel(HL_OAUTH_CHANNEL).postMessage('connected')
  } catch (e) {
    state.value = 'error'
    errorMessage.value =
      e instanceof ApiError ? e.message : 'Something went wrong while connecting HighLevel.'
    console.error('[HighLevel OAuth] code exchange failed:', e)
  }
}

void run()
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-background p-6">
    <div class="w-full max-w-md rounded-[9px] border border-border bg-white p-6 text-center">
      <template v-if="state === 'exchanging'">
        <div class="mb-2 flex items-center justify-center gap-[7px]">
          <span class="size-[7px] animate-pulse rounded-full bg-[#94a3b8]" />
          <span class="text-sm font-semibold text-foreground">Connecting HighLevel…</span>
        </div>
        <p class="text-xs text-[#7a8698]">Exchanging the authorization code. Keep this tab open.</p>
      </template>

      <template v-else-if="state === 'success'">
        <div class="mb-2 flex items-center justify-center gap-[7px]">
          <span class="size-[7px] rounded-full bg-success-dot" />
          <span class="text-sm font-semibold text-foreground">HighLevel connected</span>
        </div>
        <p class="text-xs text-[#7a8698]">
          <template v-if="status?.locationName">{{ status.locationName }} · </template>
          You can close this tab.
        </p>
      </template>

      <template v-else-if="state === 'error'">
        <div class="mb-2 flex items-center justify-center gap-[7px]">
          <span class="size-[7px] rounded-full bg-red-500" />
          <span class="text-sm font-semibold text-foreground">Connection failed</span>
        </div>
        <p class="text-xs text-[#7a8698]">{{ errorMessage }}</p>
      </template>

      <template v-else-if="state === 'signed-out'">
        <div class="mb-2 flex items-center justify-center gap-[7px]">
          <span class="size-[7px] rounded-full bg-[#94a3b8]" />
          <span class="text-sm font-semibold text-foreground">Sign in required</span>
        </div>
        <p class="text-xs text-[#7a8698]">
          Sign in to Genesis in this browser, then start the HighLevel connection again.
        </p>
      </template>

      <template v-else>
        <div class="mb-2 flex items-center justify-center gap-[7px]">
          <span class="size-[7px] rounded-full bg-[#94a3b8]" />
          <span class="text-sm font-semibold text-foreground">No authorization code</span>
        </div>
        <p class="text-xs text-[#7a8698]">
          This page expects a <code>?code=</code> query param from HighLevel's OAuth redirect.
        </p>
      </template>
    </div>
  </div>
</template>
