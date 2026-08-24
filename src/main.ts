import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createWebHistory } from 'vue-router'
import { routes } from 'vue-router/auto-routes'
import App from './App.vue'
import { useAuthStore } from './stores/auth'
import './assets/main.css'

const router = createRouter({
  history: createWebHistory(),
  routes,
})

const app = createApp(App)
app.use(createPinia())

// Instantiate before the first navigation so onAuthStateChanged is already wired
// when the guard awaits `ready` (auth-implementation.md §5).
const authStore = useAuthStore()

router.beforeEach(async (to) => {
  await authStore.ready
  const signedIn = !!authStore.firebaseUser
  if (to.meta.requiresAuth && !signedIn) {
    return { path: '/signin', query: { next: to.fullPath } }
  }
  if (to.meta.guestOnly && signedIn) {
    return { path: '/projects' }
  }
})

app.use(router)
app.mount('#app')
