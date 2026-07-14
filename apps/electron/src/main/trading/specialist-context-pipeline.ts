import type { AgentContextDeliveryReceipt } from '@trade-god/contracts'

import type { LoadFixtureAgentSnapshotInput, MarketDataSidecarManager } from './market-data-sidecar-manager.ts'
import { AgentContextStore } from './agent-context-store.ts'

export interface RouteFixtureContextInput extends LoadFixtureAgentSnapshotInput {
  consumerAgentId: string
  capability: string
}

export class SpecialistContextPipeline {
  constructor(
    private readonly marketData: Pick<MarketDataSidecarManager, 'loadFixtureAgentSnapshot'>,
    private readonly store: AgentContextStore,
  ) {}

  async routeFixtureSnapshot(input: RouteFixtureContextInput): Promise<AgentContextDeliveryReceipt> {
    const snapshot = await this.marketData.loadFixtureAgentSnapshot(input)
    const reference = await this.store.publish(snapshot)
    return this.store.queue(reference, { agentId: input.consumerAgentId, capability: input.capability })
  }
}
