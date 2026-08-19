import type { WorkspaceFile } from '@/types'

/**
 * Mock "LLM output" for the three-file contract (LLD §1.2). index.html is body
 * markup only (no <script> — gate 5), app.js is an ESM module resolving `vue`
 * through the shell's import map, styles.css is optional chrome.
 */

const indexHtml = `<div id="app" v-cloak class="mx-auto flex h-full max-w-5xl flex-col p-6 font-sans text-slate-900">
  <header class="flex items-start justify-between border-b border-slate-100 pb-4">
    <div>
      <h1 class="text-lg font-bold tracking-tight">Today at Northbeam Media</h1>
      <p class="mt-0.5 text-xs text-slate-400">{{ syncedLabel }}</p>
    </div>
    <span class="chip">Last 30 days</span>
  </header>

  <div v-if="error" class="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
    {{ error }}
  </div>

  <div v-else-if="loading" class="py-16 text-center text-sm text-slate-400">
    Loading live HighLevel data…
  </div>

  <template v-else>
    <div class="mt-4 grid grid-cols-3 gap-3">
      <div class="stat-card">
        <div class="text-[11px] text-slate-400">New contacts</div>
        <div class="mt-1 text-[22px] font-bold">{{ contactsTotal }}</div>
      </div>
      <div class="stat-card">
        <div class="text-[11px] text-slate-400">Appointments (7d)</div>
        <div class="mt-1 text-[22px] font-bold">{{ appointmentsTotal }}</div>
      </div>
      <div class="stat-card">
        <div class="text-[11px] text-slate-400">Unread threads</div>
        <div class="mt-1 text-[22px] font-bold text-blue-700">{{ unread }}</div>
      </div>
    </div>

    <div class="mt-5 flex min-h-0 flex-1 gap-5">
      <section class="min-w-0 flex-[1.35]">
        <h2 class="text-[13px] font-semibold">Recent contacts</h2>
        <div class="mt-2 overflow-hidden rounded-lg border border-slate-200">
          <table class="w-full text-left text-[12.5px]">
            <thead>
              <tr class="bg-slate-50 text-[10.5px] uppercase tracking-wider text-slate-400">
                <th class="px-3 py-2 font-semibold">Name</th>
                <th class="px-3 py-2 font-semibold">Source</th>
                <th class="px-3 py-2 font-semibold">Added</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="contact in contacts" :key="contact.id" class="border-t border-slate-100">
                <td class="px-3 py-2.5 font-medium">{{ contact.name }}</td>
                <td class="px-3 py-2.5 text-slate-500">{{ contact.source }}</td>
                <td class="px-3 py-2.5 text-slate-400">{{ contact.addedLabel }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="min-w-0 flex-1">
        <h2 class="text-[13px] font-semibold">Upcoming appointments</h2>
        <div class="mt-2 flex flex-col gap-2">
          <div
            v-for="event in appointments"
            :key="event.id"
            class="appointment rounded-lg border border-slate-200 px-3 py-2.5"
            :style="{ borderLeftColor: event.color }"
          >
            <div class="text-[12.5px] font-semibold">{{ event.title }} · {{ event.contactName }}</div>
            <div class="mt-0.5 text-[11.5px] text-slate-400">{{ event.whenLabel }} · {{ event.calendar }}</div>
          </div>
        </div>
      </section>
    </div>
  </template>
</div>`

const appJs = `import { createApp, ref, onMounted } from 'vue'

createApp({
  setup() {
    const loading = ref(true)
    const error = ref(null)
    const contacts = ref([])
    const contactsTotal = ref(0)
    const appointments = ref([])
    const appointmentsTotal = ref(0)
    const unread = ref(0)
    const syncedLabel = ref('Syncing…')

    onMounted(async () => {
      try {
        const [contactsRes, eventsRes, threadsRes] = await Promise.all([
          hl.contacts.list({ limit: 25 }),
          hl.calendars.appointments({ startTime: Date.now(), endTime: Date.now() + 7 * 864e5 }),
          hl.conversations.list({ limit: 20 }),
        ])
        contacts.value = contactsRes.contacts
        contactsTotal.value = contactsRes.total
        appointments.value = eventsRes.events
        appointmentsTotal.value = eventsRes.total
        unread.value = threadsRes.unread
        syncedLabel.value = 'Synced 40 seconds ago'
      } catch (err) {
        error.value = err.message
      } finally {
        loading.value = false
      }
    })

    return {
      loading, error, contacts, contactsTotal,
      appointments, appointmentsTotal, unread, syncedLabel,
    }
  },
}).mount('#app')`

const stylesCss = `.chip {
  padding: 5px 10px;
  border-radius: 6px;
  background: #fffbbb;
  font-size: 11.5px;
  font-weight: 500;
  color: #475569;
}

.stat-card {
  padding: 12px 14px;
  border: 1px solid #e6eaf1;
  border-radius: 9px;
}

.appointment {
  border-left-width: 3px;
}`

export const seedFiles: WorkspaceFile[] = [
  { path: 'index.html', content: indexHtml },
  { path: 'app.js', content: appJs },
  { path: 'styles.css', content: stylesCss },
]
