// Account, cloud-save and hub API. Two implementations:
//   supabase.ts  production (Supabase auth/Postgres/Storage + Netlify publish function)
//   local.ts     development stand-in that simulates the server in IndexedDB
// Game data never goes through this API: only files with origin 'user'.
import type { Project } from '../project'

export interface User {
  id: string
  name: string
  avatar_url?: string
  is_moderator: boolean
}

export interface CloudProjectMeta {
  id: string
  name: string
  updated_at: string
  size_bytes: number
  thumbnail_url?: string
}

export interface HubAuthor { id: string; name: string; avatar_url?: string }

export interface HubMapMeta {
  id: string
  title: string
  description: string
  tags: string[]
  author: HubAuthor
  thumbnail_url?: string
  likes: number
  remixes: number
  downloads: number
  created_at: string
  updated_at: string
  remix_of: { id: string; title: string } | null
  liked_by_me?: boolean
  hidden?: boolean
  project_id?: string
}

/** project.files lists only user files; blobs come from downloadHubBlob. */
export interface HubMapDetail extends HubMapMeta { project: Project }

export type HubSort = 'new' | 'top' | 'remixed'

export interface HubQuery {
  search?: string
  sort: HubSort
  tag?: string
  author?: string
  /** 1-based. */
  page: number
  pageSize: number
}

export type ReportReason = 'game-data' | 'stolen' | 'offensive' | 'spam' | 'broken' | 'other'

export interface HubReport {
  id: string
  map_id: string
  map_title: string
  reason: ReportReason
  details: string
  reporter: string
  status: 'open' | 'dismissed' | 'actioned'
  created_at: string
}

export interface PublishInput {
  projectId: string
  title: string
  description: string
  tags: string[]
  /** Update an existing hub map you own instead of creating a new one. */
  mapId?: string
}

export class ConflictError extends Error {
  constructor(public remote_updated_at: string) { super('This project was changed on another device.') }
}

export class PublishRejected extends Error {
  constructor(message: string, public problems: string[] = []) { super(message) }
}

export interface Backend {
  readonly kind: 'supabase' | 'local'
  readonly label: string

  getUser(): Promise<User | null>
  onAuthChange(cb: (user: User | null) => void): () => void
  signInWithEmail(email: string): Promise<'link-sent' | 'signed-in'>
  signInWithProvider(provider: 'github' | 'discord' | 'google'): Promise<void>
  signOut(): Promise<void>
  updateProfile(name: string): Promise<User>

  listCloudProjects(): Promise<CloudProjectMeta[]>
  getCloudProject(id: string): Promise<{ project: Project; updated_at: string } | null>
  /** Throws ConflictError if expectedUpdatedAt is given and the server copy is newer. */
  putCloudProject(project: Project, thumbnail: Blob | null, opts?: { expectedUpdatedAt?: string }): Promise<{ updated_at: string }>
  deleteCloudProject(id: string): Promise<void>
  /** Which of these content hashes the signed-in user already stored. */
  hasBlobs(hashes: string[]): Promise<Set<string>>
  uploadBlob(hash: string, blob: Blob): Promise<void>
  downloadBlob(hash: string): Promise<Blob>

  listHub(q: HubQuery): Promise<{ items: HubMapMeta[]; total: number }>
  getHubMap(id: string): Promise<HubMapDetail | null>
  downloadHubBlob(mapId: string, hash: string): Promise<Blob>
  /** Server re-checks every file (game data, size, type) before anything goes public. */
  publish(input: PublishInput): Promise<{ id: string }>
  unpublish(mapId: string): Promise<void>
  myPublished(): Promise<HubMapMeta[]>
  setLike(mapId: string, liked: boolean): Promise<void>
  recordRemix(mapId: string): Promise<void>
  recordDownload(mapId: string): Promise<void>
  report(mapId: string, reason: ReportReason, details: string): Promise<void>
  /** Most used tags on visible maps (for filter chips). */
  popularTags?(limit?: number): Promise<{ tag: string; count: number }[]>

  listReports(): Promise<HubReport[]>
  resolveReport(id: string, action: 'dismiss' | 'hide'): Promise<void>
  setHidden(mapId: string, hidden: boolean): Promise<void>
}
