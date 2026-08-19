import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { Project } from '@/types'

const demoProjects: Project[] = [
  {
    id: 'contacts-calendar-hub',
    name: 'Contacts & Calendar Hub',
    description: 'Recent contacts with upcoming appointments in one view.',
    initials: 'CH',
    iconBg: '#e6efff',
    iconColor: '#1d4ed8',
    status: 'published',
    scopes: ['contacts', 'calendars'],
    version: 14,
    editedLabel: '12 min ago',
  },
  {
    id: 'inbox-triage',
    name: 'Inbox Triage',
    description: 'Sorts unread conversations by SLA breach risk.',
    initials: 'IT',
    iconBg: '#ede9fe',
    iconColor: '#7c3aed',
    status: 'generating',
    scopes: ['conversations'],
    version: 1,
    editedLabel: 'now',
    statusNote: 'Writing app.js',
    progress: 62,
  },
  {
    id: 'review-requests',
    name: 'Review Requests',
    description: 'Sends review asks after completed appointments.',
    initials: 'RR',
    iconBg: '#fff1e6',
    iconColor: '#c2410c',
    status: 'draft',
    scopes: ['conversations', 'calendars'],
    version: 3,
    editedLabel: 'yesterday',
  },
  {
    id: 'no-show-tracker',
    name: 'No-show Tracker',
    description: 'Flags repeat no-shows across every calendar.',
    initials: 'NS',
    iconBg: '#e6efff',
    iconColor: '#1d4ed8',
    status: 'published',
    scopes: ['calendars'],
    version: 9,
    editedLabel: '3 days ago',
  },
  {
    id: 'lead-router',
    name: 'Lead Router',
    description: 'Assigns inbound leads to the right sub-account.',
    initials: 'LR',
    iconBg: '#e6f6fb',
    iconColor: '#0369a1',
    status: 'failed',
    scopes: ['contacts'],
    version: 2,
    statusNote: 'scope missing: contacts.write',
    editedLabel: '2h ago',
  },
]

/** Mock projects store; Firestore listeners (LLD §10.1) replace this later. */
export const useProjectsStore = defineStore('projects', () => {
  const projects = ref<Project[]>([...demoProjects])

  const publishedCount = computed(
    () => projects.value.filter((p) => p.status === 'published').length,
  )

  const recentNames = computed(() => projects.value.slice(0, 3).map((p) => p.name))

  /** Dev-only helper for reviewing the dashboard's empty state. */
  function toggleDemoData() {
    projects.value = projects.value.length > 0 ? [] : [...demoProjects]
  }

  return { projects, publishedCount, recentNames, toggleDemoData }
})
