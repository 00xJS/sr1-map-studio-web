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
  /** The signed-in account's own email (only ever the viewer's own; never shown to others or sent anywhere). */
  email?: string
}

/**
 * Id of the hidden cloud save holding the user's My prefabs (lib/sync.ts).
 * Cloud ids are per user, so every account has its own. listCloudProjects leaves it out.
 */
export const LIBRARY_PROJECT_ID = 'sr1ms-my-prefabs'

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
  /** Average stars (0 with no ratings) and how many people rated. */
  rating: number
  ratings: number
  /** The signed-in user's stars, 0 for none. */
  my_rating?: number
  /** In-game screenshots the author added. */
  shots: string[]
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

/** 'top' is the best rated. */
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
  /** The Showcase copy of the map (hubRules.showcasePlan): recipes, no files. */
  snapshot: Project
  /** Content hashes of images already uploaded to the user's cloud storage. */
  thumb?: string
  shots: string[]
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

  /** The user's map saves, newest first (never the My prefabs library). */
  listCloudProjects(): Promise<CloudProjectMeta[]>
  getCloudProject(id: string): Promise<{ project: Project; updated_at: string } | null>
  /** Throws ConflictError if expectedUpdatedAt is given and the server copy is newer. */
  /** `thumbnail` null keeps the stored one, unless `clearThumb` takes it down. */
  putCloudProject(project: Project, thumbnail: Blob | null, opts?: { expectedUpdatedAt?: string; clearThumb?: boolean }): Promise<{ updated_at: string }>
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
  /** 1 to 5 stars, or 0 to take the rating back. */
  setRating(mapId: string, stars: number): Promise<void>
  /** The moderators' pick for this week, else the best-rated new map. */
  mapOfWeek(): Promise<HubMapMeta | null>
  /** Moderators: make this the map of the week. */
  featureMap(mapId: string): Promise<void>
  recordRemix(mapId: string): Promise<void>
  recordDownload(mapId: string): Promise<void>
  report(mapId: string, reason: ReportReason, details: string): Promise<void>
  /** Most used tags on visible maps (for filter chips). */
  popularTags?(limit?: number): Promise<{ tag: string; count: number }[]>

  listReports(): Promise<HubReport[]>
  resolveReport(id: string, action: 'dismiss' | 'hide'): Promise<void>
  setHidden(mapId: string, hidden: boolean): Promise<void>

  /** Supabase only: the signed-in session's token, for the play-link function. */
  accessToken?(): Promise<string | null>
}
