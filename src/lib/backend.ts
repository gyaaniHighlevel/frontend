import { FirebaseError } from 'firebase/app'
import { Timestamp } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { functions } from '@/lib/firebase'
import { ApiError, type ErrorBody } from '@/lib/api'
import type { FilePath, FileUpdatedBy, Project, ProjectFile, Snapshot, SnapshotEntry, SnapshotTrigger, UserProfile } from '@/types'

/** Firestore timestamps as REST/callable responses serialize them (§4). */
export interface TimestampJson {
  _seconds: number
  _nanoseconds: number
}

/** Normalizes both transports' timestamp encodings to a Date. */
export function toDate(t: TimestampJson | Timestamp): Date {
  if (t instanceof Timestamp) return t.toDate()
  return new Date(t._seconds * 1000 + Math.round(t._nanoseconds / 1e6))
}

// --- Wire shapes (REST responses; Firestore docs carry real Timestamps) ---

export interface ProjectWire {
  id: string
  ownerUid: string
  name: string
  description: string
  hlLocationId: string | null
  status: 'active' | 'deleted'
  deletedAt: TimestampJson | null
  headSnapshotId: string
  activeGenerationId: string | null
  createdAt: TimestampJson
  updatedAt: TimestampJson
}

export interface FileWire {
  ownerUid: string
  path: FilePath
  content: string
  size: number
  sha256: string
  updatedAt: TimestampJson | Timestamp
  updatedBy: FileUpdatedBy
}

export interface SnapshotWire {
  id: string
  ownerUid: string
  createdAt: TimestampJson
  trigger: SnapshotTrigger
  generationId: string | null
  restoredFrom: string | null
  label: string | null
  files: SnapshotEntry[]
}

export interface ProfileWire {
  email: string
  displayName: string | null
  createdAt: TimestampJson
  hl: { connected: boolean; locationId?: string; locationName?: string }
}

export const mapProject = (w: ProjectWire): Project => ({
  id: w.id,
  name: w.name,
  description: w.description,
  status: w.status,
  headSnapshotId: w.headSnapshotId,
  createdAt: toDate(w.createdAt),
  updatedAt: toDate(w.updatedAt),
})

export const mapFile = (w: FileWire): ProjectFile => ({
  path: w.path,
  content: w.content,
  size: w.size,
  sha256: w.sha256,
  updatedAt: toDate(w.updatedAt),
  updatedBy: w.updatedBy,
})

export const mapSnapshot = (w: SnapshotWire): Snapshot => ({
  id: w.id,
  createdAt: toDate(w.createdAt),
  trigger: w.trigger,
  restoredFrom: w.restoredFrom,
  label: w.label,
  files: w.files,
})

export const mapProfile = (w: ProfileWire): UserProfile => ({
  email: w.email,
  displayName: w.displayName,
  hl: { connected: w.hl.connected, locationId: w.hl.locationId, locationName: w.hl.locationName },
})

// --- Callables (mutations go through these; the SDK handles ID tokens) ---

export const createUserProfile = httpsCallable<{ displayName?: string }, { created: boolean }>(
  functions,
  'createUserProfile',
)

export const createProject = httpsCallable<
  { name: string; description?: string },
  { projectId: string; snapshotId: string }
>(functions, 'createProject')

export const renameProject = httpsCallable<
  { projectId: string; name?: string; description?: string },
  { projectId: string }
>(functions, 'renameProject')

export const softDeleteProject = httpsCallable<
  { projectId: string },
  { projectId: string; status: 'deleted' }
>(functions, 'softDeleteProject')

export const restoreProject = httpsCallable<
  { projectId: string },
  { projectId: string; status: 'active' }
>(functions, 'restoreProject')

export const saveSnapshot = httpsCallable<
  { projectId: string; label?: string | null },
  { snapshotId: string }
>(functions, 'saveSnapshot')

export const restoreSnapshot = httpsCallable<
  { projectId: string; snapshotId: string },
  { snapshotId: string; restored: boolean }
>(functions, 'restoreSnapshot')

/**
 * User-facing message for any backend failure. Callables carry the same
 * `{ code, message }` body as REST in `error.details` (§4) — prefer it.
 */
export function backendErrorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message
  if (e instanceof FirebaseError) {
    const details = (e as FirebaseError & { details?: ErrorBody }).details
    if (details?.message) return details.message
  }
  return 'Something went wrong. Try again.'
}
