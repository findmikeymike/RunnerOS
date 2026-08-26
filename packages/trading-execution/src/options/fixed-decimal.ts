const INTERNAL_SCALE = 6
const INTERNAL_FACTOR = 1_000_000n

function parseDecimal(value: string): { units: bigint; displayScale: number } {
  const match = /^(-?)(0|[1-9]\d*)(?:\.(\d+))?$/.exec(value)
  if (!match) throw new Error(`Invalid canonical decimal: ${value}`)
  const fraction = match[3] ?? ''
  if (fraction.length > INTERNAL_SCALE) throw new Error('Decimal precision exceeds 6 places')
  const sign = match[1] === '-' ? -1n : 1n
  const whole = BigInt(match[2]!)
  const padded = fraction.padEnd(INTERNAL_SCALE, '0')
  return {
    units: sign * ((whole * INTERNAL_FACTOR) + BigInt(padded || '0')),
    displayScale: fraction.length,
  }
}

export class FixedDecimal {
  private constructor(
    private readonly units: bigint,
    private readonly displayScale: number,
  ) {}

  static from(value: string | FixedDecimal): FixedDecimal {
    if (value instanceof FixedDecimal) return value
    const parsed = parseDecimal(value)
    return new FixedDecimal(parsed.units, parsed.displayScale)
  }

  add(value: string | FixedDecimal): FixedDecimal {
    const other = FixedDecimal.from(value)
    return new FixedDecimal(this.units + other.units, Math.max(this.displayScale, other.displayScale))
  }

  subtract(value: string | FixedDecimal): FixedDecimal {
    const other = FixedDecimal.from(value)
    return new FixedDecimal(this.units - other.units, Math.max(this.displayScale, other.displayScale))
  }

  multiplyInteger(value: number): FixedDecimal {
    if (!Number.isSafeInteger(value)) throw new Error('Multiplier must be a safe integer')
    return new FixedDecimal(this.units * BigInt(value), this.displayScale)
  }

  multiply(value: string | FixedDecimal, displayScale = INTERNAL_SCALE): FixedDecimal {
    if (!Number.isInteger(displayScale) || displayScale < 0 || displayScale > INTERNAL_SCALE) {
      throw new Error('Display precision must be between 0 and 6')
    }
    const other = FixedDecimal.from(value)
    return new FixedDecimal((this.units * other.units) / INTERNAL_FACTOR, displayScale)
  }

  divide(value: string | FixedDecimal, displayScale = INTERNAL_SCALE): FixedDecimal {
    if (!Number.isInteger(displayScale) || displayScale < 0 || displayScale > INTERNAL_SCALE) {
      throw new Error('Display precision must be between 0 and 6')
    }
    const other = FixedDecimal.from(value)
    if (other.units === 0n) throw new Error('Divisor must be nonzero')
    return new FixedDecimal((this.units * INTERNAL_FACTOR) / other.units, displayScale)
  }

  divideInteger(value: number, displayScale = INTERNAL_SCALE): FixedDecimal {
    if (!Number.isSafeInteger(value) || value === 0) throw new Error('Divisor must be a nonzero safe integer')
    if (!Number.isInteger(displayScale) || displayScale < 0 || displayScale > INTERNAL_SCALE) {
      throw new Error('Display precision must be between 0 and 6')
    }
    return new FixedDecimal(this.units / BigInt(value), displayScale)
  }

  compare(value: string | FixedDecimal): number {
    const other = FixedDecimal.from(value)
    return this.units < other.units ? -1 : this.units > other.units ? 1 : 0
  }

  roundDownToTick(tick: string | FixedDecimal): FixedDecimal {
    const parsedTick = FixedDecimal.from(tick)
    if (parsedTick.units <= 0n) throw new Error('Tick must be positive')
    const quotient = this.units / parsedTick.units
    const remainder = this.units % parsedTick.units
    const floor = this.units < 0n && remainder !== 0n ? quotient - 1n : quotient
    return new FixedDecimal(floor * parsedTick.units, parsedTick.displayScale)
  }

  toString(): string {
    const negative = this.units < 0n
    const absolute = negative ? -this.units : this.units
    const whole = absolute / INTERNAL_FACTOR
    if (this.displayScale === 0) return `${negative ? '-' : ''}${whole}`
    const fraction = (absolute % INTERNAL_FACTOR)
      .toString()
      .padStart(INTERNAL_SCALE, '0')
      .slice(0, this.displayScale)
    return `${negative ? '-' : ''}${whole}.${fraction}`
  }

  toCanonicalString(minimumScale = 0): string {
    if (!Number.isInteger(minimumScale) || minimumScale < 0 || minimumScale > INTERNAL_SCALE) {
      throw new Error('Minimum scale must be between 0 and 6')
    }
    const rendered = this.toString()
    if (!rendered.includes('.')) return minimumScale === 0 ? rendered : `${rendered}.${'0'.repeat(minimumScale)}`
    const [whole, fraction = ''] = rendered.split('.')
    let kept = fraction
    while (kept.length > minimumScale && kept.endsWith('0')) kept = kept.slice(0, -1)
    if (kept.length < minimumScale) kept = kept.padEnd(minimumScale, '0')
    return kept.length === 0 ? whole! : `${whole}.${kept}`
  }
}
