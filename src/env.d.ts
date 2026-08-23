/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Firebase web config object as a single-line JSON string. */
  readonly VITE_FIREBASE_CONFIG: string
  /** Base URL of the `api` Cloud Function (frontend-integration.md §2.2). */
  readonly VITE_API_BASE: string
  /** 'true' to route Auth/Firestore/Functions through the local emulators. */
  readonly VITE_USE_EMULATORS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
