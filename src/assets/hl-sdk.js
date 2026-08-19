// hl-sdk.js — platform shim inlined into the preview srcdoc (LLD §9.1).
// Mock build: `window.hl.*` resolves with canned HighLevel data instead of
// forwarding to the Cloud Function proxy. The postMessage protocol (§9.3/§9.4)
// is kept so swapping in the real transport later doesn't touch generated code.
(() => {
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const jitter = () => 150 + Math.random() * 250

  const MOCK = {
    contacts: [
      { id: 'c1', name: 'Dana Whitfield', source: 'Facebook Ad', addedLabel: '2h ago' },
      { id: 'c2', name: 'Marcus Bell', source: 'Web form', addedLabel: '5h ago' },
      { id: 'c3', name: 'Priya Raman', source: 'Referral', addedLabel: 'Yesterday' },
      { id: 'c4', name: 'Tom Alvarez', source: 'Inbound call', addedLabel: 'Yesterday' },
      { id: 'c5', name: 'Elena Sorkin', source: 'Facebook Ad', addedLabel: '2 days ago' },
    ],
    contactsTotal: 128,
    appointments: [
      { id: 'a1', title: 'Discovery call', contactName: 'Dana Whitfield', whenLabel: 'Today 2:30 PM', calendar: 'Sales calendar', color: '#1d4ed8' },
      { id: 'a2', title: 'Onboarding', contactName: 'Marcus Bell', whenLabel: 'Today 4:00 PM', calendar: 'Success calendar', color: '#0ea5e9' },
      { id: 'a3', title: 'Strategy review', contactName: 'Priya Raman', whenLabel: 'Tomorrow 10:00 AM', calendar: 'Sales calendar', color: '#8b5cf6' },
      { id: 'a4', title: 'Follow-up', contactName: 'Tom Alvarez', whenLabel: 'Thu 9:15 AM', calendar: 'Sales calendar', color: '#94a3b8' },
    ],
    appointmentsTotal: 31,
    calendars: [
      { id: 'cal1', name: 'Sales calendar' },
      { id: 'cal2', name: 'Success calendar' },
    ],
    conversationsUnread: 9,
  }

  async function respond(data) {
    await delay(jitter())
    return JSON.parse(JSON.stringify(data))
  }

  window.hl = {
    contacts: {
      list: ({ limit = 25 } = {}) =>
        respond({ contacts: MOCK.contacts.slice(0, limit), total: MOCK.contactsTotal }),
      search: ({ query = '', limit = 25 } = {}) =>
        respond({
          contacts: MOCK.contacts
            .filter((c) => c.name.toLowerCase().includes(String(query).toLowerCase()))
            .slice(0, limit),
        }),
    },
    conversations: {
      list: ({ limit = 20 } = {}) =>
        respond({ conversations: [], unread: MOCK.conversationsUnread, limit }),
    },
    calendars: {
      list: () => respond({ calendars: MOCK.calendars }),
      appointments: ({ calendarId, startTime, endTime } = {}) =>
        respond({
          events: MOCK.appointments,
          total: MOCK.appointmentsTotal,
          range: { calendarId, startTime, endTime },
        }),
    },
  }

  // Runtime error channel (§9.4): forward errors to the parent, deduplicated
  // by message within a 3s window so render loops don't flood the channel.
  const recent = new Map()
  function forward(message, stack) {
    const now = Date.now()
    if (recent.get(message) && now - recent.get(message) < 3000) return
    recent.set(message, now)
    parent.postMessage(
      { type: 'genesis:error', message: String(message).slice(0, 2048), stack: stack ? String(stack).slice(0, 2048) : undefined },
      '*',
    )
  }
  window.addEventListener('error', (e) => forward(e.message, e.error && e.error.stack))
  window.addEventListener('unhandledrejection', (e) =>
    forward((e.reason && e.reason.message) || String(e.reason), e.reason && e.reason.stack),
  )

  parent.postMessage({ type: 'genesis:ready' }, '*')
})()
