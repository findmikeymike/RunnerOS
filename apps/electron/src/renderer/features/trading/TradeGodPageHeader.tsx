import type { FC, ReactNode } from 'react'

interface TradeGodPageHeaderProps {
  eyebrow: string
  icon?: ReactNode
  title: string
  description: string
  actions?: ReactNode
}

const TradeGodPageHeader: FC<TradeGodPageHeaderProps> = ({
  eyebrow,
  icon,
  title,
  description,
  actions,
}) => (
  <header className="flex flex-wrap items-start justify-between gap-6 border-b border-border pb-6">
    <div className="min-w-0 max-w-[720px]">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase leading-4 tracking-[0.16em] text-blue-700">
        {icon}
        <span>{eyebrow}</span>
      </div>
      <h1 className="mt-2 text-[28px] font-semibold leading-[34px] tracking-[-0.025em] text-foreground">
        {title}
      </h1>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        {description}
      </p>
    </div>
    {actions ? <div className="flex min-h-10 flex-wrap items-center justify-end gap-2">{actions}</div> : null}
  </header>
)

export default TradeGodPageHeader
