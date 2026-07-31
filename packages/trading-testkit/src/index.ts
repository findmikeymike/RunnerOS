import {
  ANALYSIS_ARTIFACT_SCHEMA_VERSION,
  analysisArtifactSchema,
  instrumentSchema,
  marketSessionWindowSchema,
  sessionSchema,
  sha256Schema,
  type AnalysisArtifact,
  type WireMeta,
} from '@trade-god/contracts'

interface FixtureManifest {
  fixture_id: string
  kind: 'synthetic-trades'
  source: string
  redistribution: 'project-owned'
  transformations: string[]
  events_file: string
  events_sha256: string
  event_count: number
  instrument: ReturnType<typeof instrumentSchema.parse>
  session: ReturnType<typeof sessionSchema.parse>
  session_window: ReturnType<typeof marketSessionWindowSchema.parse>
}

interface TradeEvent {
  event_time: string
  sequence: number
  price: string
  size: string
  aggressor: 'buy' | 'sell'
}

export interface LoadedTradeFixture {
  manifest: FixtureManifest
  events: TradeEvent[]
  rawEvents: string
}

export interface AnalyzeFixtureOptions {
  meta: WireMeta
  artifact_id: string
}

export class FixtureChecksumMismatchError extends Error {
  constructor() {
    super('Fixture checksum does not match its manifest.')
    this.name = 'FixtureChecksumMismatchError'
  }
}

function sha256(value: string): string {
  return new Bun.CryptoHasher('sha256').update(value).digest('hex')
}

function assertTradeEvent(value: unknown): asserts value is TradeEvent {
  if (!value || typeof value !== 'object') throw new Error('Fixture event must be an object.')
  const event = value as Record<string, unknown>
  if (typeof event.event_time !== 'string' || !event.event_time.endsWith('Z')) throw new Error('Fixture event time must be UTC.')
  if (!Number.isInteger(event.sequence) || Number(event.sequence) < 1) throw new Error('Fixture sequence must be a positive integer.')
  if (typeof event.price !== 'string' || typeof event.size !== 'string') throw new Error('Fixture price and size must be decimal strings.')
  if (event.aggressor !== 'buy' && event.aggressor !== 'sell') throw new Error('Fixture aggressor must be buy or sell.')
}

export async function loadEsDemoFixture(): Promise<LoadedTradeFixture> {
  const fixtureRoot = new URL('../fixtures/es-demo/', import.meta.url)
  const manifestRaw = await Bun.file(new URL('manifest.json', fixtureRoot)).text()
  const manifestValue = JSON.parse(manifestRaw) as Record<string, unknown>
  const eventsFile = String(manifestValue.events_file ?? '')
  const rawEvents = await Bun.file(new URL(eventsFile, fixtureRoot)).text()
  const eventValues = JSON.parse(rawEvents) as unknown[]
  const events = eventValues.map((event) => {
    assertTradeEvent(event)
    return event
  })

  const manifest: FixtureManifest = {
    fixture_id: String(manifestValue.fixture_id),
    kind: manifestValue.kind as FixtureManifest['kind'],
    source: String(manifestValue.source),
    redistribution: manifestValue.redistribution as FixtureManifest['redistribution'],
    transformations: Array.isArray(manifestValue.transformations) ? manifestValue.transformations.map(String) : [],
    events_file: eventsFile,
    events_sha256: sha256Schema.parse(manifestValue.events_sha256),
    event_count: Number(manifestValue.event_count),
    instrument: instrumentSchema.parse(manifestValue.instrument),
    session: sessionSchema.parse(manifestValue.session),
    session_window: marketSessionWindowSchema.parse(manifestValue.session_window),
  }

  if (manifest.kind !== 'synthetic-trades' || manifest.redistribution !== 'project-owned') {
    throw new Error('Fixture provenance is not approved for the Phase 0 testkit.')
  }
  if (manifest.event_count !== eventValues.length) throw new Error('Fixture event count does not match its manifest.')

  return { manifest, events, rawEvents }
}

export async function verifyFixtureChecksum(fixture: LoadedTradeFixture): Promise<boolean> {
  return sha256(fixture.rawEvents) === fixture.manifest.events_sha256
}

export function analyzeOrderFlowFixture(
  fixture: LoadedTradeFixture,
  options: AnalyzeFixtureOptions,
): AnalysisArtifact {
  if (sha256(fixture.rawEvents) !== fixture.manifest.events_sha256) throw new FixtureChecksumMismatchError()
  if (fixture.events.length === 0) throw new Error('Fixture contains no trade events.')

  let buyVolume = 0n
  let sellVolume = 0n
  const volumeByPrice = new Map<string, bigint>()

  for (const event of fixture.events) {
    const size = BigInt(event.size)
    if (size <= 0n) throw new Error('Fixture event size must be positive.')
    if (event.aggressor === 'buy') buyVolume += size
    else sellVolume += size
    volumeByPrice.set(event.price, (volumeByPrice.get(event.price) ?? 0n) + size)
  }

  const pointOfControlPrice = [...volumeByPrice.entries()]
    .sort(([priceA, volumeA], [priceB, volumeB]) => {
      if (volumeA !== volumeB) return volumeA > volumeB ? -1 : 1
      return Number(priceA) - Number(priceB)
    })[0]?.[0]

  if (!pointOfControlPrice) throw new Error('Fixture has no price-volume observations.')

  const configurationHash = sha256('order-flow-summary@0.1.0:{}')
  const deterministicContent = {
    artifact_schema_version: ANALYSIS_ARTIFACT_SCHEMA_VERSION,
    artifact_type: 'order-flow-summary' as const,
    algorithm: { name: 'order-flow-summary', version: '0.1.0', configuration_hash: configurationHash },
    input: { fixture_id: fixture.manifest.fixture_id, fixture_sha256: fixture.manifest.events_sha256 },
    instrument_id: fixture.manifest.instrument.id,
    session_id: fixture.manifest.session.session_id,
    event_time_range: {
      start: fixture.events[0]!.event_time,
      end: fixture.events[fixture.events.length - 1]!.event_time,
    },
    quality: { state: 'valid' as const, flags: [], warnings: [] },
    summary: {
      event_count: fixture.events.length,
      total_volume: (buyVolume + sellVolume).toString(),
      buy_volume: buyVolume.toString(),
      sell_volume: sellVolume.toString(),
      delta: (buyVolume - sellVolume).toString(),
      point_of_control_price: pointOfControlPrice,
    },
  }

  return analysisArtifactSchema.parse({
    meta: options.meta,
    artifact_id: options.artifact_id,
    ...deterministicContent,
    content_hash: sha256(JSON.stringify(deterministicContent)),
  })
}
