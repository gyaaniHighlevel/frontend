import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { api } from '@/lib/api'
import {
  backendErrorMessage,
  createProject as createProjectFn,
  mapProject,
  renameProject as renameProjectFn,
  restoreProject as restoreProjectFn,
  softDeleteProject as softDeleteProjectFn,
  type ProjectWire,
} from '@/lib/backend'
import type { Project } from '@/types'

/**
 * Real projects store (frontend-integration.md §6): the list comes from
 * `GET /projects`, mutations go through the callables.
 */
export const useProjectsStore = defineStore('projects', () => {
  const projects = ref<Project[]>([])
  const deletedProjects = ref<Project[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const loaded = ref(false)

  async function fetchProjects(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const { items } = await api<{ items: ProjectWire[] }>('GET', '/projects?status=active&limit=100')
      projects.value = items.map(mapProject)
      loaded.value = true
    } catch (e) {
      error.value = backendErrorMessage(e)
    } finally {
      loading.value = false
    }
  }

  async function fetchDeleted(): Promise<void> {
    const { items } = await api<{ items: ProjectWire[] }>('GET', '/projects?status=deleted&limit=100')
    deletedProjects.value = items.map(mapProject)
  }

  /** Creates a project (backend seeds the starter files) → new projectId. */
  async function createProject(name: string, description?: string): Promise<string> {
    const { data } = await createProjectFn(description ? { name, description } : { name })
    return data.projectId
  }

  async function renameProject(projectId: string, name: string): Promise<void> {
    await renameProjectFn({ projectId, name })
    const project = projects.value.find((p) => p.id === projectId)
    if (project) project.name = name
  }

  /** Soft delete: files/snapshots survive; the project moves to the trash list. */
  async function softDeleteProject(projectId: string): Promise<void> {
    await softDeleteProjectFn({ projectId })
    const project = projects.value.find((p) => p.id === projectId)
    projects.value = projects.value.filter((p) => p.id !== projectId)
    if (project) deletedProjects.value = [{ ...project, status: 'deleted' }, ...deletedProjects.value]
  }

  async function restoreProject(projectId: string): Promise<void> {
    await restoreProjectFn({ projectId })
    deletedProjects.value = deletedProjects.value.filter((p) => p.id !== projectId)
    await fetchProjects()
  }

  return {
    projects,
    deletedProjects,
    loading,
    loaded,
    error,
    fetchProjects,
    fetchDeleted,
    createProject,
    renameProject,
    softDeleteProject,
    restoreProject,
  }
})
