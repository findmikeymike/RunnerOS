import { z } from 'zod'

const observedSignalSourceSchema = z.object({
  sourceId: z.string(),
  serverId: z.string().nullable(),
  channelId: z.string(),
  threadId: z.string().nullable(),
  parentChannelId: z.string().nullable(),
  trader: z.object({
    discordUserId: z.string().nullable(),
    configuredTraderId: z.string().nullable(),
    configuredTraderEnabled: z.boolean().nullable(),
    displayName: z.string(),
    configurationStatus: z.enum([
      'missing-author-id',
      'ambiguous',
      'configured-enabled',
      'configured-disabled',
      'unconfigured',
    ]),
  }),
  identityStatus: z.enum([
    'complete',
    'missing-server-and-author',
    'missing-author',
    'missing-server',
  ]),
  daemonAllowlistStatus: z.enum(['all-channels', 'allowlisted', 'not-allowlisted']),
  lastObservedAt: z.string(),
  messageCount: z.number().int().nonnegative(),
  provenance: z.literal('observed-daemon-db'),
})

export const discoTraderSignalSourceCatalogSchema = z.object({
  schemaVersion: z.literal(1),
  readOnly: z.literal(true),
  configured: z.object({
    allowlistMode: z.enum(['all-channels', 'restricted']),
    channelAllowlist: z.array(z.string()),
    truncated: z.boolean(),
    invalidEntriesOmitted: z.number().int().nonnegative(),
  }),
  observed: z.object({
    limit: z.number().int().positive(),
    truncated: z.boolean(),
    sources: z.array(observedSignalSourceSchema),
  }),
})

export type DiscoTraderSignalSourceCatalog = z.infer<typeof discoTraderSignalSourceCatalogSchema>
export type DiscoTraderObservedSignalSource = DiscoTraderSignalSourceCatalog['observed']['sources'][number]

export function isSelectableSignalSource(source: DiscoTraderObservedSignalSource): boolean {
  return source.identityStatus === 'complete'
    && source.daemonAllowlistStatus !== 'not-allowlisted'
    && source.trader.configurationStatus === 'configured-enabled'
    && Boolean(source.serverId && source.trader.discordUserId)
}
