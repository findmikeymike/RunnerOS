import {
  optionContractIdentitySchema,
  type OptionContractIdentity,
} from '@trade-god/contracts'

export type OptionContractQuery = {
  underlying: string
  expiration: string
  strike: string
  right: 'call' | 'put'
}

export interface OptionsContractResolver {
  resolveContract(query: OptionContractQuery): Promise<OptionContractIdentity>
}

export class OptionsContractResolutionError extends Error {
  readonly code = 'OPTIONS_PROVIDER_DIVERGENCE' as const

  constructor(message: string) {
    super(message)
    this.name = 'OptionsContractResolutionError'
  }
}

export async function resolveExactOptionContract(
  resolver: OptionsContractResolver,
  query: OptionContractQuery,
): Promise<OptionContractIdentity> {
  const contract = optionContractIdentitySchema.parse(await resolver.resolveContract(query))
  if (contract.underlying !== query.underlying
    || contract.expiration !== query.expiration
    || contract.strike !== query.strike
    || contract.right !== query.right) {
    throw new OptionsContractResolutionError('Resolved contract does not match the exact query')
  }
  return contract
}
