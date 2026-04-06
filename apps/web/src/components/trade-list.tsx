import { ArrowRight, Bot, CandlestickChart } from 'lucide-react'
import type { DashboardStats, DashboardTrade, DashboardTradeContext } from '#/lib/dashboard'
import {
  formatBtc,
  formatDateTime,
  formatPercent,
  formatSignedPercent,
  formatSignedUsd,
  formatUsd,
  formatUsdCompact,
} from '#/lib/format'
import { cn } from '#/lib/utils'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'

function directionVariant(direction: DashboardTrade['direction']) {
  return direction === 'LONG' ? 'success' : 'danger'
}

function tradePnl(trade: DashboardTrade) {
  return trade.status === 'open' ? trade.livePnl : trade.realizedPnl
}

function tradePnlPct(trade: DashboardTrade) {
  return trade.status === 'open' ? trade.livePnlPct : trade.realizedPnlPct
}

function pnlTone(value: number | null | undefined) {
  if (value == null) return 'text-[var(--foreground)]'
  return value >= 0 ? 'text-[var(--profit)]' : 'text-[var(--loss)]'
}

function MetricTile({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="border border-[var(--panel-border)] bg-[var(--panel-subtle)] p-3">
      <p className="text-[10px] font-bold tracking-[0.14em] text-[var(--muted-foreground)] uppercase">
        {label}
      </p>
      <p className={cn('mt-1.5 text-base font-semibold text-[var(--foreground)]', mono && 'num')}>
        {value}
      </p>
    </div>
  )
}

function IndicatorChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-[var(--panel-border)] bg-[var(--panel-subtle)] px-3 py-2">
      <p className="text-[9px] font-bold tracking-[0.14em] uppercase text-[var(--muted-foreground)]">
        {label}
      </p>
      <p className="num mt-0.5 text-sm font-semibold text-[var(--foreground)]">{value}</p>
    </div>
  )
}

function signalVariant(action: string | null): 'success' | 'danger' | 'neutral' {
  if (action === 'BUY') return 'success'
  if (action === 'SELL') return 'danger'
  return 'neutral'
}

function EntryContext({
  ctx,
  exitReason,
}: {
  ctx: DashboardTradeContext
  exitReason: string | null
}) {
  const indicators = [
    ctx.rsi != null ? { label: 'RSI', value: ctx.rsi.toFixed(1) } : null,
    ctx.macdHistogram != null ? { label: 'MACD H', value: ctx.macdHistogram.toFixed(2) } : null,
    ctx.ema9 != null ? { label: 'EMA 9', value: formatUsdCompact(ctx.ema9) } : null,
    ctx.ema21 != null ? { label: 'EMA 21', value: formatUsdCompact(ctx.ema21) } : null,
    ctx.spreadBps != null ? { label: 'Spread', value: `${ctx.spreadBps.toFixed(1)}bps` } : null,
    ctx.polymarketBullishProb != null
      ? { label: 'Poly bull', value: formatPercent(ctx.polymarketBullishProb * 100) }
      : null,
  ].filter((x): x is { label: string; value: string } => x != null)

  return (
    <div className="border-t border-[var(--panel-border)]">
      {/* Section header */}
      <div className="flex items-center gap-2 border-b border-[var(--panel-border)] px-5 py-3">
        <Bot className="h-3.5 w-3.5 text-[var(--accent-soft)]" />
        <span className="text-[10px] font-bold tracking-[0.16em] uppercase text-[var(--muted-foreground)]">
          Entry context
        </span>
      </div>

      <div className="px-5 py-4 space-y-4">
        {/* Signal stack */}
        <div>
          <p className="trade-detail-label mb-2">Signal stack</p>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] font-bold tracking-[0.12em] uppercase text-[var(--muted-foreground)]">
                Rule
              </span>
              <Badge variant={signalVariant(ctx.ruleAction)}>{ctx.ruleAction ?? '—'}</Badge>
            </div>
            <ArrowRight className="h-3 w-3 text-[var(--muted-foreground)]" />
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] font-bold tracking-[0.12em] uppercase text-[var(--muted-foreground)]">
                AI
              </span>
              <Badge variant={signalVariant(ctx.aiAction)}>{ctx.aiAction ?? '—'}</Badge>
            </div>
            <ArrowRight className="h-3 w-3 text-[var(--muted-foreground)]" />
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] font-bold tracking-[0.12em] uppercase text-[var(--muted-foreground)]">
                Final
              </span>
              <Badge variant={signalVariant(ctx.action)}>{ctx.action ?? '—'}</Badge>
              {ctx.confidence != null && (
                <span className="num text-xs text-[var(--muted-foreground)]">
                  {formatPercent(ctx.confidence * 100)}
                </span>
              )}
            </div>
          </div>
          {/* Rule reasons */}
          {ctx.ruleReasons.length > 0 && (
            <ul className="mt-2 space-y-1">
              {ctx.ruleReasons.map((reason) => (
                <li key={reason} className="flex items-start gap-1.5 text-xs text-[var(--muted-foreground)]">
                  <span className="mt-0.5 shrink-0 text-[var(--accent-soft)]">·</span>
                  {reason}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Indicator grid */}
        {indicators.length > 0 && (
          <div>
            <p className="trade-detail-label mb-2">Indicators at entry</p>
            <div className="grid grid-cols-3 gap-px bg-[var(--panel-border)]">
              {indicators.map(({ label, value }) => (
                <IndicatorChip key={label} label={label} value={value} />
              ))}
            </div>
          </div>
        )}

        {/* Sentiment */}
        {(ctx.fearGreedLabel != null || ctx.fearGreedIndex != null) && (
          <div className="flex items-center gap-3">
            <p className="trade-detail-label">Sentiment</p>
            <span className="text-sm text-[var(--foreground)]">
              {ctx.fearGreedLabel ?? '—'}
              {ctx.fearGreedIndex != null ? (
                <span className="num text-[var(--muted-foreground)]"> ({ctx.fearGreedIndex})</span>
              ) : null}
            </span>
          </div>
        )}

        {/* TAAPI signals */}
        {ctx.taapiSignals.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {ctx.taapiSignals.map((signal) => (
              <Badge key={signal} variant="neutral">
                {signal}
              </Badge>
            ))}
          </div>
        )}

        {/* AI reasoning */}
        {ctx.reasoning ? (
          <div>
            <p className="trade-detail-label mb-1.5">AI reasoning</p>
            <p className="text-xs leading-relaxed text-[var(--muted-foreground)]">
              {ctx.reasoning}
            </p>
          </div>
        ) : null}

        {/* Risk notes */}
        {ctx.riskNotes ? (
          <div>
            <p className="trade-detail-label mb-1.5">Risk notes</p>
            <p className="text-xs leading-relaxed text-[var(--muted-foreground)]">
              {ctx.riskNotes}
            </p>
          </div>
        ) : null}

        {/* Exit reason */}
        {exitReason ? (
          <div>
            <p className="trade-detail-label mb-1.5">Exit reason</p>
            <p className="text-sm text-[var(--foreground)]">{exitReason}</p>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function TradeList({
  trades,
  stats,
  selectedTradeId,
  onSelect,
}: {
  trades: DashboardTrade[]
  stats: DashboardStats
  selectedTradeId: number | 'all'
  onSelect: (tradeId: number | 'all') => void
}) {
  const focusedTrade =
    selectedTradeId === 'all'
      ? null
      : trades.find((trade) => trade.id === selectedTradeId) ?? null

  return (
    <div className="flex h-full flex-col gap-4">

      {/* Detail / summary panel */}
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-4 border-b border-[var(--panel-border)] py-3 px-5">
          <CardTitle>
            {focusedTrade
              ? `Trade #${focusedTrade.id}`
              : 'Overview'}
          </CardTitle>
          <Button
            variant={selectedTradeId === 'all' ? 'default' : 'secondary'}
            size="sm"
            onClick={() => onSelect('all')}
          >
            View all
          </Button>
        </CardHeader>

        {focusedTrade ? (
          <div>
            {/* Trade header row */}
            <div className="flex flex-wrap items-center gap-2 border-b border-[var(--panel-border)] px-5 py-3">
              <Badge variant={directionVariant(focusedTrade.direction)}>
                {focusedTrade.direction}
              </Badge>
              <Badge variant={focusedTrade.status === 'open' ? 'accent' : 'neutral'}>
                {focusedTrade.status}
              </Badge>
              <span className="ml-auto text-xs text-[var(--muted-foreground)]">
                {formatDateTime(focusedTrade.entryTime)}
              </span>
            </div>

            {/* Price tiles */}
            <div className="grid grid-cols-2 gap-px bg-[var(--panel-border)] border-b border-[var(--panel-border)]">
              <MetricTile label="Entry" value={formatUsd(focusedTrade.entryPrice)} mono />
              <MetricTile
                label={focusedTrade.status === 'open' ? 'Mark' : 'Exit'}
                value={formatUsd(focusedTrade.markPrice)}
                mono
              />
              <MetricTile label="Take profit" value={formatUsd(focusedTrade.tpPrice)} mono />
              <MetricTile label="Stop loss" value={formatUsd(focusedTrade.slPrice)} mono />
              <MetricTile label="Size" value={formatBtc(focusedTrade.sizeBtc)} mono />
              <MetricTile
                label={focusedTrade.status === 'open' ? 'Live P&L' : 'Realized P&L'}
                value={`${formatSignedUsd(tradePnl(focusedTrade))} / ${formatSignedPercent(tradePnlPct(focusedTrade))}`}
                mono
              />
              <MetricTile label="Max profit (at TP)" value={formatSignedUsd(focusedTrade.maxPotentialProfit)} mono />
              <MetricTile label="Max loss (at SL)" value={formatSignedUsd(focusedTrade.maxPotentialLoss)} mono />
            </div>

            {/* Entry context */}
            {focusedTrade.context ? (
              <EntryContext
                ctx={focusedTrade.context}
                exitReason={focusedTrade.exitReason}
              />
            ) : focusedTrade.exitReason ? (
              <div className="border-t border-[var(--panel-border)] px-5 py-4">
                <p className="trade-detail-label mb-1.5">Exit reason</p>
                <p className="text-sm text-[var(--foreground)]">{focusedTrade.exitReason}</p>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-px bg-[var(--panel-border)] border-t border-[var(--panel-border)]">
            <MetricTile label="Total trades" value={`${stats.totalTrades}`} mono />
            <MetricTile label="Open trades" value={`${stats.openTrades}`} mono />
            <MetricTile label="Win rate" value={formatPercent(stats.winRate)} mono />
            <MetricTile label="Closed P&L" value={formatSignedUsd(stats.netRealizedPnl)} mono />
            <MetricTile label="Max potential profit" value={formatSignedUsd(stats.totalMaxProfit)} mono />
            <MetricTile label="Max potential loss" value={formatSignedUsd(stats.totalMaxLoss)} mono />
          </div>
        )}
      </Card>

      {/* Position history list */}
      <Card className="min-h-0 flex-1 flex flex-col">
        <CardHeader className="border-b border-[var(--panel-border)] py-3 px-5 flex-row items-center gap-2">
          <CandlestickChart className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
          <CardTitle>Position history</CardTitle>
        </CardHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {trades.length === 0 ? (
            <div className="px-5 py-8 text-xs text-[var(--muted-foreground)]">
              No trades written yet.
            </div>
          ) : null}

          {trades.map((trade) => {
            const isActive = selectedTradeId === trade.id
            const pnl = tradePnl(trade)
            const pnlPct = tradePnlPct(trade)
            return (
              <button
                key={trade.id}
                type="button"
                onClick={() => onSelect(trade.id)}
                className={cn(
                  'w-full border-b border-[var(--panel-border)] px-5 py-3 text-left transition',
                  isActive
                    ? 'border-l-2 border-l-[var(--accent)] bg-[var(--panel-hover)] pl-4'
                    : 'hover:bg-[var(--panel-hover)]',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge variant={directionVariant(trade.direction)}>
                      {trade.direction}
                    </Badge>
                    <Badge variant={trade.status === 'open' ? 'accent' : 'neutral'}>
                      {trade.status}
                    </Badge>
                    <span className="text-[10px] text-[var(--muted-foreground)]">#{trade.id}</span>
                  </div>
                  <span className="shrink-0 text-[10px] text-[var(--muted-foreground)]">
                    {formatDateTime(trade.entryTime)}
                  </span>
                </div>

                <div className="mt-2 flex items-center justify-between gap-3">
                  <span className="num text-xs text-[var(--muted-foreground)]">
                    {formatUsd(trade.entryPrice)}
                    {trade.entryPrice != null && (
                      <span className="ml-1.5 opacity-60">
                        ({formatUsd(trade.sizeBtc * trade.entryPrice)})
                      </span>
                    )}
                  </span>
                  <span className={cn('num text-xs font-semibold', pnlTone(pnl))}>
                    {formatSignedUsd(pnl)}{' '}
                    <span className="font-normal opacity-60">({formatSignedPercent(pnlPct)})</span>
                  </span>
                </div>
                <div className="mt-1.5 flex items-center justify-between gap-3">
                  <span className="num text-[10px] text-[var(--profit)]">
                    TP {formatSignedUsd(trade.maxPotentialProfit)}
                  </span>
                  <span className="num text-[10px] text-[var(--loss)]">
                    SL {formatSignedUsd(trade.maxPotentialLoss)}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      </Card>
    </div>
  )
}
