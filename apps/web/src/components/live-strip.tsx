import { motion } from 'framer-motion'
import { BrainCircuit, ShieldAlert, Wallet } from 'lucide-react'
import type {
  DashboardIndicatorHighlightKey,
  DashboardLatestSignal,
  DashboardPolymarketMarket,
  DashboardSentimentPoint,
  DashboardSnapshot,
} from '#/lib/dashboard'
import {
  formatCompactNumber,
  formatDateTime,
  formatPercent,
  formatSignedPercent,
  formatSignedUsd,
  formatUsd,
  formatUsdCompact,
} from '#/lib/format'
import { Badge } from '#/components/ui/badge'
import { Card, CardContent } from '#/components/ui/card'
import {
  HoverCard,
  HoverCardTrigger,
  HoverCardContent,
} from '#/components/ui/hover-card'

function metricTone(value: number | null | undefined) {
  if (value == null) return 'text-[var(--foreground)]'
  return value >= 0 ? 'text-[var(--profit)]' : 'text-[var(--loss)]'
}

function IndicatorCell({
  highlightKey,
  isHighlighted,
  label,
  onHover,
  value,
  tone,
}: {
  highlightKey?: DashboardIndicatorHighlightKey
  isHighlighted: boolean
  label: string
  onHover: (key: DashboardIndicatorHighlightKey | null) => void
  value: string
  tone?: string
}) {
  const isInteractive = highlightKey != null

  return (
    <motion.button
      type="button"
      onMouseEnter={() => onHover(highlightKey ?? null)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(highlightKey ?? null)}
      onBlur={() => onHover(null)}
      whileHover={isInteractive ? { y: -1 } : undefined}
      animate={
        isHighlighted
          ? {
              backgroundColor: 'rgba(78,161,255,0.12)',
              boxShadow: 'inset 0 0 0 1px rgba(78,161,255,0.3)',
            }
          : {
              backgroundColor: 'rgba(0,0,0,0)',
              boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0)',
            }
      }
      transition={{ type: 'spring', stiffness: 340, damping: 28 }}
      className={`rounded px-2 py-1.5 text-left ${
        isInteractive ? 'cursor-pointer' : 'cursor-default'
      }`}
      aria-pressed={isHighlighted}
    >
      <p className="text-[8px] font-bold tracking-[0.14em] uppercase text-[var(--muted-foreground)]">
        {label}
      </p>
      <p className={`num mt-0.5 text-[12px] font-semibold leading-tight ${tone ?? 'text-[var(--foreground)]'}`}>
        {value}
      </p>
    </motion.button>
  )
}

interface CellDef {
  label: string
  value: string
  tone?: string
  highlightKey?: DashboardIndicatorHighlightKey
}

function buildAnalyticsCells(sig: DashboardLatestSignal): CellDef[] {
  const cells: CellDef[] = []
  if (sig.rsi != null)
    cells.push({ label: 'RSI', value: sig.rsi.toFixed(1), highlightKey: 'rsi' })
  if (sig.macdHistogram != null)
    cells.push({
      label: 'MACD H',
      value: (sig.macdHistogram >= 0 ? '+' : '') + sig.macdHistogram.toFixed(2),
      tone: sig.macdHistogram >= 0 ? 'text-[var(--profit)]' : 'text-[var(--loss)]',
      highlightKey: 'macdHistogram',
    })
  if (sig.ema9 != null)
    cells.push({ label: 'EMA 9', value: formatUsdCompact(sig.ema9), highlightKey: 'ema9' })
  if (sig.ema21 != null)
    cells.push({ label: 'EMA 21', value: formatUsdCompact(sig.ema21), highlightKey: 'ema21' })
  if (sig.bbPct != null)
    cells.push({ label: 'BB%', value: formatPercent(sig.bbPct * 100), highlightKey: 'bbands' })
  if (sig.stochasticK != null)
    cells.push({ label: 'Stoch K', value: sig.stochasticK.toFixed(1), highlightKey: 'stochasticK' })
  if (sig.mfi != null)
    cells.push({ label: 'MFI', value: sig.mfi.toFixed(1), highlightKey: 'mfi' })
  if (sig.obImbalance != null)
    cells.push({
      label: 'OB Imb',
      value: (sig.obImbalance >= 0 ? '+' : '') + sig.obImbalance.toFixed(3),
      tone: sig.obImbalance >= 0 ? 'text-[var(--profit)]' : 'text-[var(--loss)]',
    })
  if (sig.spreadBps != null)
    cells.push({ label: 'Spread', value: `${sig.spreadBps.toFixed(1)}bps` })
  return cells
}

interface PredictionCellDef {
  label: string
  value: string
  tone?: string
  historyKey: 'fearGreedIndex' | 'polymarketBullishProb'
}

function buildPredictionCells(sig: DashboardLatestSignal): PredictionCellDef[] {
  const cells: PredictionCellDef[] = []
  if (sig.fearGreedIndex != null)
    cells.push({
      label: 'Fear/Greed',
      value: `${sig.fearGreedIndex} ${sig.fearGreedLabel ?? ''}`,
      tone: sig.fearGreedIndex >= 50 ? 'text-[var(--profit)]' : 'text-[var(--loss)]',
      historyKey: 'fearGreedIndex',
    })
  if (sig.polymarketBullishProb != null)
    cells.push({
      label: 'Polymarket Bull',
      value: formatPercent(sig.polymarketBullishProb * 100),
      tone: sig.polymarketBullishProb >= 0.5 ? 'text-[var(--profit)]' : 'text-[var(--loss)]',
      historyKey: 'polymarketBullishProb',
    })
  return cells
}

function Sparkline({
  points,
  width = 180,
  height = 48,
  color = '#4ea1ff',
}: {
  points: (number | null)[]
  width?: number
  height?: number
  color?: string
}) {
  const values = points.filter((v): v is number => v != null)
  if (values.length < 2) {
    return (
      <div style={{ width, height }} className="flex items-center justify-center text-[10px] text-[var(--muted-foreground)]">
        Not enough data
      </div>
    )
  }
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const pad = 2

  const d = values
    .map((v, i) => {
      const x = pad + (i / (values.length - 1)) * (width - pad * 2)
      const y = height - pad - ((v - min) / range) * (height - pad * 2)
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')

  return (
    <svg width={width} height={height} className="block">
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <circle
        cx={pad + ((values.length - 1) / (values.length - 1)) * (width - pad * 2)}
        cy={height - pad - ((values.at(-1)! - min) / range) * (height - pad * 2)}
        r={3}
        fill={color}
      />
    </svg>
  )
}

function SentimentCell({
  cell,
  history,
}: {
  cell: PredictionCellDef
  history: DashboardSentimentPoint[]
}) {
  const points = history.map((p) => {
    const raw = p[cell.historyKey]
    if (cell.historyKey === 'polymarketBullishProb' && raw != null) return raw * 100
    return raw
  })
  const color = cell.historyKey === 'fearGreedIndex' ? '#ff9f43' : '#4ea1ff'

  return (
    <HoverCard openDelay={150} closeDelay={100}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          className="rounded px-2 py-1.5 text-left transition-colors hover:bg-[var(--panel-border)]"
        >
          <p className="text-[8px] font-bold tracking-[0.14em] uppercase text-[var(--muted-foreground)]">
            {cell.label}
          </p>
          <p className={`num mt-0.5 text-[12px] font-semibold leading-tight ${cell.tone ?? 'text-[var(--foreground)]'}`}>
            {cell.value}
          </p>
        </button>
      </HoverCardTrigger>
      <HoverCardContent side="top" align="center" sideOffset={8} className="w-auto p-3">
        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--muted-foreground)]">
          {cell.label} — last {points.filter((v) => v != null).length} signals
        </p>
        <Sparkline points={points} color={color} />
        <div className="mt-1.5 flex justify-between text-[10px] text-[var(--muted-foreground)]">
          <span>{formatDateTime(history[0]?.time)}</span>
          <span>{formatDateTime(history.at(-1)?.time)}</span>
        </div>
      </HoverCardContent>
    </HoverCard>
  )
}

function probTone(prob: number) {
  if (prob >= 0.6) return 'text-[var(--profit)]'
  if (prob <= 0.4) return 'text-[var(--loss)]'
  return 'text-[var(--foreground)]'
}

function PolymarketCell({
  bullishProb,
  markets,
  history,
}: {
  bullishProb: number
  markets: DashboardPolymarketMarket[]
  history: DashboardSentimentPoint[]
}) {
  const points = history.map((p) =>
    p.polymarketBullishProb != null ? p.polymarketBullishProb * 100 : null,
  )

  return (
    <HoverCard openDelay={150} closeDelay={200}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          className="rounded px-2 py-1.5 text-left transition-colors hover:bg-[var(--panel-border)]"
        >
          <p className="text-[8px] font-bold tracking-[0.14em] uppercase text-[var(--muted-foreground)]">
            Polymarket
          </p>
          <p className={`num mt-0.5 text-[12px] font-semibold leading-tight ${probTone(bullishProb)}`}>
            {formatPercent(bullishProb * 100)} bull
          </p>
        </button>
      </HoverCardTrigger>
      <HoverCardContent side="top" align="start" sideOffset={8} className="w-80 p-0">
        {/* Graph */}
        <div className="border-b border-[var(--panel-border)] px-3 pt-3 pb-2">
          <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--muted-foreground)]">
            BTC Bullish Probability
          </p>
          <Sparkline points={points} width={260} height={56} color="#4ea1ff" />
          <div className="mt-1 flex justify-between text-[9px] text-[var(--muted-foreground)]">
            <span>{formatDateTime(history[0]?.time)}</span>
            <span>{formatDateTime(history.at(-1)?.time)}</span>
          </div>
        </div>

        {/* Individual markets */}
        {markets.length > 0 ? (
          <div className="max-h-48 overflow-y-auto px-3 py-2">
            <p className="mb-1.5 text-[9px] font-bold uppercase tracking-[0.14em] text-[var(--muted-foreground)]">
              Active markets ({markets.length})
            </p>
            <div className="flex flex-col gap-1.5">
              {markets.map((m) => (
                <div key={m.conditionId} className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] leading-snug text-[var(--foreground)]">
                      {m.question}
                    </p>
                    <p className="mt-0.5 text-[10px] text-[var(--muted-foreground)]">
                      ${formatCompactNumber(m.liquidity)} liquidity
                    </p>
                  </div>
                  <span className={`num shrink-0 text-[12px] font-semibold ${probTone(m.yesProbability)}`}>
                    {formatPercent(m.yesProbability * 100)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="px-3 py-2">
            <p className="text-[10px] text-[var(--muted-foreground)]">No active BTC markets found</p>
          </div>
        )}
      </HoverCardContent>
    </HoverCard>
  )
}

function signalActionVariant(action: string | null) {
  if (!action) return 'neutral' as const
  if (action === 'BUY') return 'success' as const
  if (action === 'SELL') return 'danger' as const
  return 'neutral' as const
}

function AgentAnalysis({ signal }: { signal: DashboardLatestSignal }) {
  const hasAiAnalysis = signal.aiReasoning || signal.aiRiskNotes
  const hasSignalBreakdown = signal.ruleAction || signal.aiAction

  return (
    <div className="flex flex-col gap-4 bg-[var(--panel)] px-5 py-4">
      {/* Header + decision chain */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-[10px] font-bold tracking-[0.14em] uppercase text-[var(--muted-foreground)]">
          <BrainCircuit className="h-4 w-4" />
          Agent analysis
        </div>
        {hasSignalBreakdown && (
          <div className="flex flex-wrap items-center gap-2 rounded-md bg-[var(--panel-subtle)] px-3 py-1.5">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-medium text-[var(--muted-foreground)]">Rule</span>
              <Badge variant={signalActionVariant(signal.ruleAction)} className="text-[10px]">
                {signal.ruleAction}
              </Badge>
            </div>
            <span className="text-[var(--muted-foreground)]">&rarr;</span>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-medium text-[var(--muted-foreground)]">AI</span>
              <Badge variant={signalActionVariant(signal.aiAction)} className="text-[10px]">
                {signal.aiAction ?? 'N/A'}
              </Badge>
              {signal.aiConfidence != null && (
                <span className="text-[10px] text-[var(--muted-foreground)]">
                  {formatPercent(signal.aiConfidence * 100)}
                </span>
              )}
            </div>
            <span className="text-[var(--muted-foreground)]">&rarr;</span>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-medium text-[var(--muted-foreground)]">Final</span>
              <Badge variant={signalActionVariant(signal.finalAction)} className="text-[10px]">
                {signal.finalAction}
              </Badge>
            </div>
          </div>
        )}
        <span className="ml-auto text-[10px] text-[var(--muted-foreground)]">
          {formatDateTime(signal.candleTime)}
        </span>
      </div>

      {/* Reasoning & risk — full width, readable */}
      {hasAiAnalysis ? (
        <div className="flex flex-col gap-3">
          {signal.aiReasoning && (
            <div>
              <p className="mb-1 text-[9px] font-bold tracking-[0.16em] uppercase text-[var(--muted-foreground)]">
                Reasoning
              </p>
              <p className="text-[13px] leading-relaxed text-[var(--foreground)]">
                {signal.aiReasoning}
              </p>
            </div>
          )}
          {signal.aiRiskNotes && (
            <div>
              <p className="mb-1 text-[9px] font-bold tracking-[0.16em] uppercase text-[var(--muted-foreground)]">
                Risk notes
              </p>
              <p className="text-[12px] leading-relaxed text-[var(--muted-foreground)]">
                {signal.aiRiskNotes}
              </p>
            </div>
          )}
        </div>
      ) : (
        <p className="text-[11px] text-[var(--muted-foreground)]">
          No AI analysis available for the latest signal.
        </p>
      )}
    </div>
  )
}

export function LiveStrip({
  snapshot,
  highlightedIndicator,
  onIndicatorHover,
}: {
  snapshot: DashboardSnapshot
  highlightedIndicator: DashboardIndicatorHighlightKey | null
  onIndicatorHover: (key: DashboardIndicatorHighlightKey | null) => void
}) {
  const { market, stats, sentimentHistory } = snapshot
  const analyticsCells = market.latestSignal ? buildAnalyticsCells(market.latestSignal) : []
  const predictionCells = market.latestSignal ? buildPredictionCells(market.latestSignal) : []

  const growthPct =
    stats.startingEquity > 0
      ? ((stats.accountBalance - stats.startingEquity) / stats.startingEquity) * 100
      : null

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        <div className="grid gap-px bg-[var(--panel-border)] lg:grid-cols-[1fr_minmax(320px,2fr)]">

          {/* ── Left: account metrics (full height) ── */}
          <div className="grid gap-px bg-[var(--panel-border)]">
            {/* Price bar */}
            <div className="flex items-center gap-4 bg-[var(--panel)] px-5 py-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant={market.isStale ? 'danger' : 'success'}>
                  {market.isStale ? 'Stale' : 'Live'}
                </Badge>
                <Badge variant="accent">{market.pair}</Badge>
                <Badge variant="neutral">{market.openPosition}</Badge>
              </div>
              <div className="ml-auto text-right">
                <div className="num text-lg font-semibold leading-none tracking-tight text-[var(--foreground)]">
                  {formatUsd(market.price)}
                </div>
                <div className="mt-1 flex items-baseline justify-end gap-2">
                  <span className={`num text-xs font-semibold ${metricTone(market.change)}`}>
                    {formatSignedPercent(market.changePct)}
                  </span>
                  <span className="text-[10px] text-[var(--muted-foreground)]">
                    {formatDateTime(market.updatedAt)}
                  </span>
                </div>
              </div>
            </div>

            {/* Balance + P&L side by side */}
            <div className="grid grid-cols-2 gap-px bg-[var(--panel-border)]">
              <div className="bg-[var(--panel)] px-5 py-3">
                <div className="flex items-center gap-2 text-[9px] font-bold tracking-[0.14em] uppercase text-[var(--muted-foreground)]">
                  <Wallet className="h-3.5 w-3.5" />
                  Balance
                </div>
                <div className="num mt-1.5 text-xl font-semibold leading-none text-[var(--foreground)]">
                  {formatUsd(stats.accountBalance)}
                </div>
                <p className="mt-1 text-[10px] text-[var(--muted-foreground)]">
                  From <span className="num">{formatUsd(stats.startingEquity)}</span>
                  {growthPct != null && (
                    <span className={`ml-1.5 num font-semibold ${metricTone(growthPct)}`}>
                      {formatSignedPercent(growthPct)}
                    </span>
                  )}
                </p>
              </div>
              <div className="bg-[var(--panel)] px-5 py-3">
                <div className="flex items-center gap-2 text-[9px] font-bold tracking-[0.14em] uppercase text-[var(--muted-foreground)]">
                  <ShieldAlert className="h-3.5 w-3.5" />
                  Closed P&amp;L
                </div>
                <div className={`num mt-1.5 text-xl font-semibold leading-none ${metricTone(stats.netRealizedPnl)}`}>
                  {formatUsd(stats.netRealizedPnl)}
                </div>
                <p className="mt-1 text-[10px] text-[var(--muted-foreground)]">
                  Win rate <span className="num">{formatPercent(stats.winRate)}</span>
                  <span className="ml-1.5 text-[var(--profit)]">
                    ↑<span className="num">{formatSignedUsd(stats.totalMaxProfit)}</span>
                  </span>
                  <span className="ml-1 text-[var(--loss)]">
                    ↓<span className="num">{formatSignedUsd(stats.totalMaxLoss)}</span>
                  </span>
                </p>
              </div>
            </div>

            {/* Positions + Range + Signal */}
            <div className="grid grid-cols-3 gap-px bg-[var(--panel-border)]">
              <div className="bg-[var(--panel)] px-4 py-2.5">
                <p className="text-[9px] font-bold tracking-[0.14em] uppercase text-[var(--muted-foreground)]">Positions</p>
                <p className="num mt-1 text-sm font-semibold">
                  {stats.openTrades} <span className="text-[10px] font-normal text-[var(--muted-foreground)]">open</span>
                  {' / '}
                  {stats.totalTrades} <span className="text-[10px] font-normal text-[var(--muted-foreground)]">total</span>
                </p>
                <p className="mt-0.5 text-[10px] text-[var(--muted-foreground)]">
                  <span className="num">{stats.longTrades}</span>L · <span className="num">{stats.shortTrades}</span>S
                </p>
              </div>
              <div className="bg-[var(--panel)] px-4 py-2.5">
                <p className="text-[9px] font-bold tracking-[0.14em] uppercase text-[var(--muted-foreground)]">1h range</p>
                <div className="mt-1 space-y-0.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-[var(--muted-foreground)]">H</span>
                    <span className="num font-semibold">{formatUsdCompact(market.high1h)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--muted-foreground)]">L</span>
                    <span className="num font-semibold">{formatUsdCompact(market.low1h)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--muted-foreground)]">Vol</span>
                    <span className="num font-semibold">{formatCompactNumber(market.volume1h)}</span>
                  </div>
                </div>
              </div>
              <div className="bg-[var(--panel)] px-4 py-2.5">
                <p className="text-[9px] font-bold tracking-[0.14em] uppercase text-[var(--muted-foreground)]">Signal</p>
                <p className="num mt-1 text-sm font-semibold">{market.latestSignal?.finalAction ?? '—'}</p>
                {market.latestSignal?.aiConfidence != null && (
                  <p className="mt-0.5 text-[10px] text-[var(--muted-foreground)]">
                    {formatPercent(market.latestSignal.aiConfidence * 100)} conf
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* ── Right: agent + indicators (stacked) ── */}
          <div className="grid grid-rows-[1fr_auto_auto] gap-px bg-[var(--panel-border)]">
            {/* Agent analysis */}
            <div className="bg-[var(--panel)]">
              {market.latestSignal ? (
                <AgentAnalysis signal={market.latestSignal} />
              ) : (
                <div className="flex h-full items-center justify-center px-5 py-6">
                  <p className="text-[11px] text-[var(--muted-foreground)]">Waiting for first signal…</p>
                </div>
              )}
            </div>

            {/* Analytics indicators */}
            {analyticsCells.length > 0 && (
              <div className="bg-[var(--panel-subtle)] px-3 py-2">
                <p className="mb-1.5 text-[9px] font-bold tracking-[0.16em] uppercase text-[var(--muted-foreground)]">
                  Analytics
                  <span className="ml-2 font-normal normal-case tracking-normal">
                    {formatDateTime(market.latestSignal?.candleTime)}
                  </span>
                </p>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(80px,1fr))] gap-1">
                  {analyticsCells.map(({ highlightKey, label, value, tone }) => (
                    <IndicatorCell
                      key={label}
                      highlightKey={highlightKey}
                      isHighlighted={highlightKey != null && highlightedIndicator === highlightKey}
                      label={label}
                      onHover={onIndicatorHover}
                      value={value}
                      tone={tone}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Prediction markets */}
            {predictionCells.length > 0 && (
              <div className="bg-[var(--panel-subtle)] px-3 py-2">
                <p className="mb-1.5 text-[9px] font-bold tracking-[0.16em] uppercase text-[var(--muted-foreground)]">
                  Prediction markets
                </p>
                <div className="flex flex-wrap gap-1">
                  {predictionCells
                    .filter((c) => c.historyKey === 'fearGreedIndex')
                    .map((cell) => (
                      <SentimentCell
                        key={cell.label}
                        cell={cell}
                        history={sentimentHistory}
                      />
                    ))}
                  {market.latestSignal?.polymarketBullishProb != null && (
                    <PolymarketCell
                      bullishProb={market.latestSignal.polymarketBullishProb}
                      markets={market.latestSignal.polymarketMarkets}
                      history={sentimentHistory}
                    />
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
