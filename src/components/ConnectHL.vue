<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { fetchHlStatus, HL_OAUTH_CHANNEL, type HlConnectionStatus } from '@/lib/hl'

const auth = useAuthStore()
const status = ref<HlConnectionStatus | null>(null)

// Full HighLevel install URL (chooselocation page with client_id,
// redirect_uri, scope) — set in .env.local once registered in the marketplace.
const installationUrl = import.meta.env.VITE_INSTALLATION_URL as string | undefined

function connectHighLevel() {
  if (!installationUrl) {
    console.warn('[HighLevel OAuth] VITE_INSTALLATION_URL is not set; cannot start OAuth flow')
    return
  }
  window.open(installationUrl, '_blank', 'noopener')
}

// Scopes live server-side only (hlConnections), so pull them once connected.
watch(
  () => auth.hl.connected,
  (connected) => {
    if (!connected) {
      status.value = null
      return
    }
    fetchHlStatus()
      .then((s) => (status.value = s))
      .catch((e) => console.error('[HighLevel OAuth] status fetch failed:', e))
  },
  { immediate: true },
)

// The OAuth callback lands in a separate tab; it pings this channel on success.
const channel = new BroadcastChannel(HL_OAUTH_CHANNEL)
channel.onmessage = () => void auth.refreshProfile()
onUnmounted(() => channel.close())
</script>

<template>
  <div class="flex flex-col gap-2 rounded-[9px] border border-border bg-white p-3">
    <template v-if="auth.hl.connected">
      <div class="flex items-center gap-[7px]">
        <span class="size-[7px] rounded-full bg-success-dot" />
        <span class="text-xs font-semibold text-foreground">HighLevel connected</span>
      </div>
      <div class="text-[11.5px] leading-[1.45] text-[#7a8698]">
        {{ auth.hl.locationType }} · {{ auth.hl.locationName || status?.locationId }}<br />
        {{ status?.scopes?.join(', ') }}
      </div>
    </template>
    <template v-else>
      <div class="flex items-center gap-[7px]">
        <span class="size-[7px] rounded-full bg-[#94a3b8]" />
        <span class="text-xs font-semibold text-foreground">HighLevel not connected</span>
      </div>
      <button
        type="button"
        class="rounded-[7px] bg-primary px-3 py-[7px] text-xs font-semibold text-primary-foreground hover:bg-primary/90"
        @click="connectHighLevel"
      >
        Connect HighLevel
      </button>
    </template>
  </div>
</template>
