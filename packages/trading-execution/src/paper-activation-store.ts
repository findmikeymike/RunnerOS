import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  paperActivationEventSchema,
  paperActivationReviewSchema,
  type PaperActivationEvent,
  type PaperActivationReview,
} from '@trade-god/contracts'

import { canonicalJson, sha256 } from './canonical.ts'

interface PaperActivationStoreBody {
  store_schema_version: 'paper-activation-store@1'
  reviews: PaperActivationReview[]
  events: PaperActivationEvent[]
  updated_at: string
}

interface PaperActivationStoreFile extends PaperActivationStoreBody {
  content_checksum: string
}

const verifiedReview = (input: unknown): PaperActivationReview => {
  const review = paperActivationReviewSchema.parse(input)
  const { content_checksum: _checksum, ...unsigned } = review
  if (sha256(unsigned) !== review.content_checksum) {
    throw new Error(`Paper activation review ${review.review_id} failed checksum validation.`)
  }
  return review
}

const verifiedEvent = (input: unknown): PaperActivationEvent => {
  const event = paperActivationEventSchema.parse(input)
  const { content_checksum: _checksum, ...unsigned } = event
  if (sha256(unsigned) !== event.content_checksum) {
    throw new Error(`Paper activation event ${event.event_id} failed checksum validation.`)
  }
  return event
}

export class FilePaperActivationStore {
  private readonly file: string
  private queue: Promise<void> = Promise.resolve()

  constructor(
    root: string,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    this.file = path.join(root, 'paper-activation-journal.json')
  }

  async listReviews(): Promise<PaperActivationReview[]> {
    return (await this.read()).reviews.map((review) => structuredClone(review))
  }

  async getReview(reviewId: string): Promise<PaperActivationReview> {
    const review = (await this.read()).reviews.find((candidate) => candidate.review_id === reviewId)
    if (!review) throw new Error(`Paper activation review ${reviewId} was not found.`)
    return structuredClone(review)
  }

  async saveReview(input: PaperActivationReview): Promise<PaperActivationReview> {
    const review = verifiedReview(input)
    return this.withLock(async () => {
      const current = await this.read()
      const existing = current.reviews.find((candidate) => candidate.review_id === review.review_id)
      if (existing && canonicalJson(existing) !== canonicalJson(review)) {
        throw new Error(`Paper activation review ${review.review_id} is immutable.`)
      }
      if (!existing) {
        await this.write({
          store_schema_version: 'paper-activation-store@1',
          reviews: [...current.reviews, review],
          events: current.events,
          updated_at: this.now(),
        })
      }
      return structuredClone(review)
    })
  }

  async appendEvent(input: PaperActivationEvent): Promise<PaperActivationEvent> {
    const event = verifiedEvent(input)
    return this.withLock(async () => {
      const current = await this.read()
      const review = current.reviews.find((candidate) => candidate.review_id === event.review_id)
      if (
        !review
        || review.content_checksum !== event.review_checksum
        || review.state_checksum !== event.state_checksum
      ) throw new Error('Paper activation event does not bind the exact persisted review.')
      const existing = current.events.find((candidate) => candidate.event_id === event.event_id)
      if (existing && canonicalJson(existing) !== canonicalJson(event)) {
        throw new Error(`Paper activation event ${event.event_id} is immutable.`)
      }
      if (existing) return structuredClone(existing)
      const releaseEvents = current.events.filter((candidate) => candidate.release_id === event.release_id)
      const last = releaseEvents.at(-1)
      const transitionAllowed = !last
        ? event.status === 'prepared'
        : last.status === 'prepared'
          ? event.status === 'dismissed' || event.status === 'halted'
          : last.status === 'dismissed'
            ? event.status === 'released' || event.status === 'halted'
            : false
      if (
        !transitionAllowed
        || (last && (
          last.review_id !== event.review_id
          || last.review_checksum !== event.review_checksum
          || last.state_checksum !== event.state_checksum
        ))
      ) throw new Error('Paper activation release event transition is invalid.')
      await this.write({
        store_schema_version: 'paper-activation-store@1',
        reviews: current.reviews,
        events: [...current.events, event],
        updated_at: this.now(),
      })
      return structuredClone(event)
    })
  }

  async listEvents(): Promise<PaperActivationEvent[]> {
    return (await this.read()).events.map((event) => structuredClone(event))
  }

  async listIncomplete(): Promise<PaperActivationEvent[]> {
    const latest = new Map<string, PaperActivationEvent>()
    for (const event of (await this.read()).events) latest.set(event.release_id, event)
    return [...latest.values()]
      .filter((event) => event.status === 'prepared' || event.status === 'dismissed')
      .map((event) => structuredClone(event))
  }

  private async read(): Promise<PaperActivationStoreFile> {
    try {
      const raw = JSON.parse(await readFile(this.file, 'utf8')) as Record<string, unknown>
      if (
        raw.store_schema_version !== 'paper-activation-store@1'
        || !Array.isArray(raw.reviews)
        || !Array.isArray(raw.events)
        || typeof raw.updated_at !== 'string'
        || !Number.isFinite(Date.parse(raw.updated_at))
        || typeof raw.content_checksum !== 'string'
      ) throw new Error('Paper activation journal is invalid.')
      const body: PaperActivationStoreBody = {
        store_schema_version: 'paper-activation-store@1',
        reviews: raw.reviews.map(verifiedReview),
        events: raw.events.map(verifiedEvent),
        updated_at: raw.updated_at,
      }
      validateEventChains(body.reviews, body.events)
      if (sha256(body) !== raw.content_checksum) {
        throw new Error('Paper activation journal failed checksum validation.')
      }
      return { ...body, content_checksum: raw.content_checksum }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        const body: PaperActivationStoreBody = {
          store_schema_version: 'paper-activation-store@1',
          reviews: [],
          events: [],
          updated_at: this.now(),
        }
        return { ...body, content_checksum: sha256(body) }
      }
      throw error
    }
  }

  private async write(body: PaperActivationStoreBody): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true })
    const temporary = `${this.file}.${process.pid}.${randomUUID()}.tmp`
    await writeFile(temporary, `${JSON.stringify({
      ...body,
      content_checksum: sha256(body),
    }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, this.file)
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.queue
    let release!: () => void
    this.queue = previous.catch(() => undefined).then(() => new Promise<void>((resolve) => {
      release = resolve
    }))
    await previous.catch(() => undefined)
    try {
      return await operation()
    } finally {
      release()
    }
  }
}

const validateEventChains = (
  reviews: PaperActivationReview[],
  events: PaperActivationEvent[],
): void => {
  const reviewById = new Map(reviews.map((review) => [review.review_id, review]))
  const latestByRelease = new Map<string, PaperActivationEvent>()
  for (const event of events) {
    const review = reviewById.get(event.review_id)
    if (
      !review
      || review.content_checksum !== event.review_checksum
      || review.state_checksum !== event.state_checksum
    ) throw new Error('Paper activation journal contains an event with invalid review lineage.')
    const previous = latestByRelease.get(event.release_id)
    const allowed = !previous
      ? event.status === 'prepared'
      : previous.status === 'prepared'
        ? event.status === 'dismissed' || event.status === 'halted'
        : previous.status === 'dismissed'
          ? event.status === 'released' || event.status === 'halted'
          : false
    if (
      !allowed
      || (previous && (
        previous.review_id !== event.review_id
        || previous.review_checksum !== event.review_checksum
        || previous.state_checksum !== event.state_checksum
      ))
    ) throw new Error('Paper activation journal contains an invalid release event chain.')
    latestByRelease.set(event.release_id, event)
  }
}
