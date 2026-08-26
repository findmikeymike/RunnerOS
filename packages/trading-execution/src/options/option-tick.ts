import type { OptionContractIdentity } from '@trade-god/contracts'

import { FixedDecimal } from './fixed-decimal.ts'

export function optionTickForPrice(contract: OptionContractIdentity, price: string | FixedDecimal): string {
  const value = FixedDecimal.from(price)
  let selected = contract.increment_bands[0]!.increment
  for (const band of contract.increment_bands) {
    if (value.compare(band.minimum_price) < 0) break
    selected = band.increment
  }
  return selected
}

export function isOptionPriceOnTick(contract: OptionContractIdentity, price: string | FixedDecimal): boolean {
  const value = FixedDecimal.from(price)
  return value.roundDownToTick(optionTickForPrice(contract, value)).compare(value) === 0
}
