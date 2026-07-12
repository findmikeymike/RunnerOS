import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { tradingRunReceiptSchema, type TradingRunReceipt } from '@trade-god/contracts'

export class TradingRunReceiptStore {
  constructor(private readonly directory: string) {}

  async write(receipt: TradingRunReceipt): Promise<void> {
    const parsed = tradingRunReceiptSchema.parse(receipt)
    await mkdir(this.directory, { recursive: true })
    const destination = path.join(this.directory, `${parsed.receipt_id}.json`)
    const temporary = `${destination}.${process.pid}.tmp`
    await writeFile(temporary, `${JSON.stringify(parsed, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, destination)
  }

  async read(receiptId: string): Promise<TradingRunReceipt> {
    return tradingRunReceiptSchema.parse(JSON.parse(await readFile(path.join(this.directory, `${receiptId}.json`), 'utf8')))
  }
}
