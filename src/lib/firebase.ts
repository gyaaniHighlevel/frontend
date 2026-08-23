import { initializeApp } from 'firebase/app'
import { connectAuthEmulator, getAuth } from 'firebase/auth'
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore'
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions'

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
export const firestore = getFirestore(firebaseApp)
// Region is mandatory: the backend deploys everything to us-central1.
export const functions = getFunctions(firebaseApp, 'us-central1')

if (import.meta.env.VITE_USE_EMULATORS === 'true') {
  connectAuthEmulator(firebaseAuth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFirestoreEmulator(firestore, '127.0.0.1', 8080)
  connectFunctionsEmulator(functions, '127.0.0.1', 5001)
}
