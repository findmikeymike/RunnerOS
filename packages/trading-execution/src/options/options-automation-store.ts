import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  optionsAutomationRouteSchema,
  optionsEntryPolicySchema,
  type OptionsAutomationRoute,
  type OptionsEntryPolicy,
} from '@trade-god/contracts'

import { canonicalJson, sha256 } from '../canonical.ts'

export class FileOptionsAutomationStore {
  private readonly policiesDirectory: string
  private readonly routesDirectory: string

  constructor(private readonly root: string) {
    this.policiesDirectory = path.join(root, 'options-automation', 'policies')
    this.routesDirectory = path.join(root, 'options-automation', 'routes')
  }

  async savePolicy(input: OptionsEntryPolicy): Promise<OptionsEntryPolicy> {
    const policy = verify(input, optionsEntryPolicySchema, 'Options policy')
    await this.writeImmutable(this.policiesDirectory, this.policyFilename(policy.policy_id, policy.revision), policy)
    return policy
  }

  async getPolicy(policyId: string, revision: number): Promise<OptionsEntryPolicy> {
    const policy = verify(
      JSON.parse(await readFile(path.join(this.policiesDirectory, this.policyFilename(policyId, revision)), 'utf8')),
      optionsEntryPolicySchema,
      'Options policy',
    )
    if (policy.policy_id !== policyId || policy.revision !== revision) throw new Error('Options policy file identity is invalid.')
    return policy
  }

  async saveRoute(input: OptionsAutomationRoute): Promise<OptionsAutomationRoute> {
    const route = verify(input, optionsAutomationRouteSchema, 'Options route')
    const policy = await this.getPolicy(route.policy_id, route.policy_revision)
    if (policy.content_checksum !== route.policy_checksum
      || policy.source_route_id !== route.route_id
      || policy.connection_id !== route.connection_id
      || policy.account_id !== route.account_id
      || policy.provider_slug !== route.provider
      || policy.environment !== route.environment) {
      throw new Error('Options route does not bind its exact immutable policy and account.')
    }
    const revisions = await this.listRouteRevisions(route.route_id)
    const prior = revisions.at(-1)
    if (!prior && route.revision !== 1) throw new Error('A new options route must begin at revision 1.')
    if (prior) {
      if (route.revision !== prior.revision + 1) throw new Error('Options route revisions must be sequential and append-only.')
      if (route.guild_id !== prior.guild_id || route.channel_id !== prior.channel_id
        || route.thread_id !== prior.thread_id || route.author_id !== prior.author_id) {
        throw new Error('Discord source identity is immutable; create a new options route instead.')
      }
      if (prior.state === 'archived') throw new Error('Archived options routes cannot be changed.')
      if (route.created_at !== prior.created_at || Date.parse(route.updated_at) < Date.parse(prior.updated_at)) {
        throw new Error('Options route revision chronology is invalid.')
      }
    }
    const duplicate = (await this.listRoutes()).find((candidate) => (
      candidate.route_id !== route.route_id
      && candidate.state !== 'archived'
      && candidate.guild_id === route.guild_id
      && candidate.channel_id === route.channel_id
      && candidate.thread_id === route.thread_id
      && candidate.author_id === route.author_id
    ))
    if (duplicate) throw new Error('This exact Discord source is already assigned to another options route.')
    await this.writeImmutable(this.routesDirectory, this.routeFilename(route.route_id, route.revision), route)
    return route
  }

  async getRoute(routeId: string, revision?: number): Promise<OptionsAutomationRoute> {
    const routes = await this.listRouteRevisions(routeId)
    const route = revision === undefined ? routes.at(-1) : routes.find((candidate) => candidate.revision === revision)
    if (!route) throw new Error('Options route was not found.')
    return route
  }

  async listRoutes(): Promise<OptionsAutomationRoute[]> {
    let names: string[]
    try { names = await readdir(this.routesDirectory) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    const revisions = await Promise.all(names.filter((name) => name.endsWith('.json')).sort().map(async (name) => {
      const route = verify(JSON.parse(await readFile(path.join(this.routesDirectory, name), 'utf8')), optionsAutomationRouteSchema, 'Options route')
      if (name !== this.routeFilename(route.route_id, route.revision)) throw new Error('Options route file identity is invalid.')
      return route
    }))
    const latest = new Map<string, OptionsAutomationRoute>()
    for (const route of revisions) {
      if (!latest.has(route.route_id) || latest.get(route.route_id)!.revision < route.revision) latest.set(route.route_id, route)
    }
    const routes = [...latest.values()].sort((left, right) => left.route_id.localeCompare(right.route_id))
    const identities = new Set<string>()
    for (const route of routes) {
      if (route.state === 'archived') continue
      const identity = sha256({ guild: route.guild_id, channel: route.channel_id, thread: route.thread_id, author: route.author_id })
      if (identities.has(identity)) throw new Error('Duplicate Discord source identity violates options route isolation.')
      identities.add(identity)
    }
    return routes
  }

  async resolve(input: { guild_id: string; channel_id: string; thread_id: string | null; author_id: string }): Promise<OptionsAutomationRoute | undefined> {
    return (await this.listRoutes()).find((route) => route.state !== 'archived'
      && route.guild_id === input.guild_id
      && route.channel_id === input.channel_id
      && route.thread_id === input.thread_id
      && route.author_id === input.author_id)
  }

  private async listRouteRevisions(routeId: string): Promise<OptionsAutomationRoute[]> {
    let names: string[]
    try { names = await readdir(this.routesDirectory) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    const candidates = await Promise.all(names.filter((name) => name.endsWith('.json')).map(async (name) => {
      const route = verify(JSON.parse(await readFile(path.join(this.routesDirectory, name), 'utf8')), optionsAutomationRouteSchema, 'Options route')
      if (name !== this.routeFilename(route.route_id, route.revision)) throw new Error('Options route file identity is invalid.')
      return route
    }))
    return candidates.filter((route) => route.route_id === routeId).sort((left, right) => left.revision - right.revision)
  }

  private policyFilename(policyId: string, revision: number): string { return `${sha256({ policyId, revision })}.json` }
  private routeFilename(routeId: string, revision: number): string { return `${sha256({ routeId, revision })}.json` }

  private async writeImmutable(directory: string, filename: string, value: unknown): Promise<void> {
    await mkdir(directory, { recursive: true })
    try {
      await writeFile(path.join(directory, filename), `${canonicalJson(value)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const existing = JSON.parse(await readFile(path.join(directory, filename), 'utf8'))
      if (sha256(existing) !== sha256(value)) throw new Error('Immutable options automation evidence already exists with different content.')
    }
  }
}

function verify<T extends { content_checksum: string }>(input: unknown, schema: { parse(value: unknown): T }, label: string): T {
  const value = schema.parse(input)
  const { content_checksum: _checksum, ...unsigned } = value
  if (sha256(unsigned) !== value.content_checksum) throw new Error(`${label} checksum is invalid.`)
  return value
}
