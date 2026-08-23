import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'

const raw = import.meta.env.VITE_FIREBASE_CONFIG

if (!raw) {
  throw new Error(
    'VITE_FIREBASE_CONFIG is not set. Copy .env.example to .env.local and paste the Firebase web config (see auth-implementation.md §2).',
  )
}

let config: Record<string, string>
try {
  config = JSON.parse(raw)
} catch {
  throw new Error('VITE_FIREBASE_CONFIG is not valid JSON. It must be the web config object on a single line.')
}

export const firebaseApp = initializeApp(config)

// browserLocalPersistence (IndexedDB) is the SDK default — sessions survive refresh/restart.
export const firebaseAuth = getAuth(firebaseApp)
