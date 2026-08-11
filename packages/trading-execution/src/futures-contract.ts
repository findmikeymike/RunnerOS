const FUTURES_MONTH: Readonly<Record<string, string>> = Object.freeze({
  F: '01', G: '02', H: '03', J: '04', K: '05', M: '06',
  N: '07', Q: '08', U: '09', V: '10', X: '11', Z: '12',
})

const FUTURES_ECONOMIC_SPEC: Readonly<Record<
  string,
  { tick_size: string; point_value_usd: string }
>> = Object.freeze({
  ES: { tick_size: '0.25', point_value_usd: '50' },
  MES: { tick_size: '0.25', point_value_usd: '5' },
  NQ: { tick_size: '0.25', point_value_usd: '20' },
  MNQ: { tick_size: '0.25', point_value_usd: '2' },
  YM: { tick_size: '1', point_value_usd: '5' },
  MYM: { tick_size: '1', point_value_usd: '0.5' },
  RTY: { tick_size: '0.1', point_value_usd: '50' },
  M2K: { tick_size: '0.1', point_value_usd: '5' },
})

export const resolveFuturesEconomicSpec = (
  root: string,
): { tick_size: string; point_value_usd: string } | undefined => (
  FUTURES_ECONOMIC_SPEC[root.trim().toUpperCase()]
)

export function resolveFuturesContractIdentity(
  input: string,
  reference: string | Date,
): { root: string; symbol: string; expiry?: string; active?: boolean } {
  const referenceDate = reference instanceof Date ? reference : new Date(reference)
  if (!Number.isFinite(referenceDate.getTime())) {
    throw new Error('Futures contract resolution requires a valid reference time.')
  }
  const referenceYear = referenceDate.getUTCFullYear()
  const referenceMonth = referenceDate.getUTCMonth() + 1
  const symbol = input.trim().toUpperCase()
  const exact = symbol.match(/^([A-Z0-9]+)([FGHJKMNQUVXZ])(\d{1,2})$/)
  if (!exact) return { root: symbol, symbol }
  const [, root, monthCode, yearCode] = exact
  const month = FUTURES_MONTH[monthCode!]
  if (!month || !root || !yearCode) return { root: symbol, symbol }
  const suffix = Number(yearCode)
  const candidates = yearCode.length === 2
    ? [2000 + suffix]
    : [
        Math.floor(referenceYear / 10) * 10 - 10 + suffix,
        Math.floor(referenceYear / 10) * 10 + suffix,
        Math.floor(referenceYear / 10) * 10 + 10 + suffix,
      ]
  const year = candidates
    .filter((candidate) => candidate >= referenceYear - 1 && candidate <= referenceYear + 15)
    .sort((left, right) => Math.abs(left - referenceYear) - Math.abs(right - referenceYear))[0]
  if (!year) return { root: symbol, symbol }
  const expiry = `${year}-${month}`
  const expiryMonth = Number(month)
  return {
    root,
    symbol,
    expiry,
    active: year > referenceYear || (year === referenceYear && expiryMonth >= referenceMonth),
  }
}
