export interface LabInspirationSource {
  receiptId: string
  url: string
  observedAt: string
  excerpt?: string
}

export interface LabInspirationDiscovery {
  id: string
  title: string
  summary: string
  tension: string
  angles: string[]
  question: string
  sources: LabInspirationSource[]
}

export interface LabInspirationEdition {
  id: string
  topic: string
  createdAt: string
  state: 'running' | 'ready' | 'empty' | 'failed' | 'cancelled'
  discoveries: LabInspirationDiscovery[]
  error?: string
}

export interface LabInspirationStartInput { topic: string; sourceSlugs?: string[] }
export interface LabInspirationSaveInput {
  editionId: string
  discoveryId: string
  angleIndex?: number
  songId?: string
  newSongTitle?: string
}
export interface LabInspirationSaveResult { songId: string; alreadySaved: boolean }
