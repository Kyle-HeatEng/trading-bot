import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { BOT_CONFIG_YAML, BOT_DATA_DB } from '#/server/repo-paths'
import { parse as parseYaml } from 'yaml'
import type {
  DashboardCandle,
  DashboardLatestSignal,
  DashboardSnapshot,
  DashboardStats,
  DashboardTrade,
  DashboardTradeContext,
  TradeDirection,
} from '#/lib/dashboard'
import { buildIndicatorSeries } from '#/server/indicator-series'

interface CandleRow {
  open_time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

interface LatestSignalRow {
  id: number
  candle_time: number
  rule_action: string
  rule_strength: number | null
  final_action: string
  ai_action: string | null
  ai_confidence: number | null
  ai_reasoning: string | null
  ai_risk_notes: string | null
  snapshot_json: string | null
}

interface TradeRow {
  id: number
  side: 'buy' | 'sell'
  status: string
  entry_price: number | null
  exit_price: number | null
  size_btc: number
  realized_pnl: number | null
  realized_pnl_pct: number | null
  fee_total: number | null
  entry_time: number | null
  exit_time: number | null
  exit_reason: string | null
  signal_json: string | null
}

interface StoredTradeSignal {
  candleTime?: number
  finalSignal?: {
    action?: string
    confidence?: number
    ruleSignal?: {
      action?: string
      reasons?: string[]
    }
    aiDecision?: {
      action?: string
      reasoning?: string
      riskNotes?: string
      risk_notes?: string
    }
  }
  snapshot?: {
    price?: number
    indicators?: {
      rsi?: number
      ema9?: number
      ema21?: number
      macdHistogram?: number
      spreadBps?: number
    }
    taapi?: Record<string, number | string | null> | null
    sentiment?: {
      fearGreedLabel?: string
      fearGreedIndex?: number
      polymarketBullishProb?: number | null
    }
  }
}

interface SignalSnapshot {
  price?: number
  indicators?: {
    rsi?: number
    macd?: number
    macdHistogram?: number
    stochasticK?: number
    mfi?: number
    ema9?: number
    ema21?: number
    bbPct?: number
    vwapDeviation?: number
    obImbalance?: number
    spreadBps?: number
  }
  sentiment?: {
    fearGreedIndex?: number
    fearGreedLabel?: string
    polymarketBullishProb?: number | null
    polymarketMarkets?: {
      conditionId: string
      question: string
      yesProbability: number
      liquidity: number
    }[]
  }
}

const DEFAULT_PAPER_EQUITY = 1000
const KRAKEN_BALANCE_TTL_MS = 60_000

let krakenBalanceCache: { equity: number; fetchedAt: number } | null = null

async function fetchKrakenEquity(btcPrice: number): Promise<number | null> {
  const apiKey = process.env.KRAKEN_API_KEY
  const apiSecret = process.env.KRAKEN_API_SECRET
  if (!apiKey || !apiSecret) return null

  if (
    krakenBalanceCache &&
    Date.now() - krakenBalanceCache.fetchedAt < KRAKEN_BALANCE_TTL_MS
  ) {
    return krakenBalanceCache.equity
  }

  try {
    const nonce = String(Date.now() * 1000)
    const urlPath = '/0/private/Balance'
    const body = `nonce=${nonce}`

    const sha256 = crypto.createHash('sha256').update(nonce + body).digest()
    const signature = crypto
      .createHmac('sha512', Buffer.from(apiSecret, 'base64'))
      .update(Buffer.concat([Buffer.from(urlPath), sha256]))
      .digest('base64')

    const res = await fetch(`https://api.kraken.com${urlPath}`, {
      method: 'POST',
      headers: {
        'API-Key': apiKey,
        'API-Sign': signature,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      signal: AbortSignal.timeout(10_000),
    })

    if (!res.ok) return null

    const data = (await res.json()) as {
      result?: Record<string, string>
      error?: string[]
    }
    if (data.error?.length) return null

    const usd = parseFloat(data.result?.ZUSD ?? '0')
    const btc = parseFloat(data.result?.XXBT ?? '0')
    const equity = usd + btc * btcPrice

    krakenBalanceCache = { equity, fetchedAt: Date.now() }
    return equity
  } catch {
    return krakenBalanceCache?.equity ?? null
  }
}

function readStartingEquity(db: InstanceType<typeof Database>): number {
  const envEquity = process.env.STARTING_EQUITY
  if (envEquity) {
    const parsed = Number(envEquity)
    if (!Number.isNaN(parsed) && parsed > 0) return parsed
  }

  try {
    const row = db
      .prepare(
        `SELECT starting_equity FROM daily_stats
         WHERE starting_equity IS NOT NULL
         ORDER BY date DESC LIMIT 1`,
      )
      .get() as { starting_equity: number } | undefined
    if (row?.starting_equity) return row.starting_equity
  } catch {
    // daily_stats may not exist yet
  }

  return DEFAULT_PAPER_EQUITY
}

function readStrategyConfig(): { takeProfitPct: number; stopLossPct: number } {
  try {
    const configPath = BOT_CONFIG_YAML
    const raw = fs.readFileSync(configPath, 'utf-8')
    const parsed = parseYaml(raw) as {
      strategy?: { takeProfitPct?: number; stopLossPct?: number }
    }
    return {
      takeProfitPct: (parsed?.strategy?.takeProfitPct ?? 0.6) / 100,
      stopLossPct: (parsed?.strategy?.stopLossPct ?? 0.3) / 100,
    }
  } catch {
    return { takeProfitPct: 0.006, stopLossPct: 0.003 }
  }
}

let cachedDb: InstanceType<typeof Database> | null = null

function getDbPath() {
  if (process.env.BOT_DB_PATH) {
    return process.env.BOT_DB_PATH
  }

  return BOT_DATA_DB
}

function getDb() {
  if (cachedDb) {
    return cachedDb
  }

  const dbPath = getDbPath()
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Trading bot DB not found at ${dbPath}`)
  }

  cachedDb = new Database(dbPath, {
    readonly: true,
    fileMustExist: true,
  })

  return cachedDb
}

function safeParseJson<T>(value: string | null) {
  if (!value) {
    return null
  }

  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

function floorToMinute(timestampMs: number | null) {
  if (!timestampMs) {
    return null
  }

  return Math.floor(timestampMs / 60_000) * 60_000
}

function calcPnl(
  direction: TradeDirection,
  entryPrice: number | null,
  markPrice: number | null,
  sizeBtc: number,
) {
  if (!entryPrice || !markPrice) {
    return { pnl: null, pnlPct: null }
  }

  const priceDelta =
    direction === 'LONG' ? markPrice - entryPrice : entryPrice - markPrice

  return {
    pnl: priceDelta * sizeBtc,
    pnlPct: (priceDelta / entryPrice) * 100,
  }
}

function buildTradeContext(signal: StoredTradeSignal | null): DashboardTradeContext | null {
  if (!signal) {
    return null
  }

  const taapiSignals = Object.entries(signal.snapshot?.taapi ?? {})
    .filter(([, value]) => value != null)
    .map(([key]) => key)
    .slice(0, 6)

  return {
    action: signal.finalSignal?.action ?? null,
    confidence: signal.finalSignal?.confidence ?? null,
    ruleAction: signal.finalSignal?.ruleSignal?.action ?? null,
    ruleReasons: signal.finalSignal?.ruleSignal?.reasons ?? [],
    aiAction: signal.finalSignal?.aiDecision?.action ?? null,
    reasoning: signal.finalSignal?.aiDecision?.reasoning ?? null,
    riskNotes:
      signal.finalSignal?.aiDecision?.riskNotes ??
      signal.finalSignal?.aiDecision?.risk_notes ??
      null,
    fearGreedLabel: signal.snapshot?.sentiment?.fearGreedLabel ?? null,
    fearGreedIndex: signal.snapshot?.sentiment?.fearGreedIndex ?? null,
    polymarketBullishProb:
      signal.snapshot?.sentiment?.polymarketBullishProb ?? null,
    rsi: signal.snapshot?.indicators?.rsi ?? null,
    ema9: signal.snapshot?.indicators?.ema9 ?? null,
    ema21: signal.snapshot?.indicators?.ema21 ?? null,
    macdHistogram: signal.snapshot?.indicators?.macdHistogram ?? null,
    spreadBps: signal.snapshot?.indicators?.spreadBps ?? null,
    taapiSignals,
  }
}

export async function readDashboardSnapshot(): Promise<DashboardSnapshot> {
  const db = getDb()
  const candlesDesc = db
    .prepare(
      `
        SELECT open_time, open, high, low, close, volume
        FROM candles
        WHERE pair = ? AND timeframe = ?
        ORDER BY open_time DESC
        LIMIT ?
      `,
    )
    .all('XBT/USD', 60, 720) as CandleRow[]

  const candles = candlesDesc
    .slice()
    .reverse()
    .map<DashboardCandle>((row) => ({
      time: row.open_time,
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      volume: row.volume,
    }))

  const latestCandle = candles.at(-1) ?? null
  const previousCandle = candles.at(-2) ?? null
  const recentHourCandles = candles.slice(-60)
  const indicators = buildIndicatorSeries(candles)

  const latestSignalRow = db
    .prepare(
      `
        SELECT s.id, s.candle_time, s.rule_action, s.rule_strength, s.final_action,
               s.ai_action, s.ai_confidence, s.ai_reasoning, s.snapshot_json,
               ad.risk_notes AS ai_risk_notes
        FROM signals s
        LEFT JOIN ai_decisions ad ON ad.signal_id = s.id
        ORDER BY s.candle_time DESC
        LIMIT 1
      `,
    )
    .get() as LatestSignalRow | undefined

  const hasUsableAi = latestSignalRow?.ai_action != null
    && latestSignalRow.ai_confidence !== 0
    && latestSignalRow.ai_reasoning !== 'Parse error'

  if (latestSignalRow && !hasUsableAi) {
    const recentAiRow = db
      .prepare(
        `
          SELECT s.ai_action, s.ai_confidence, s.ai_reasoning,
                 ad.risk_notes AS ai_risk_notes
          FROM signals s
          LEFT JOIN ai_decisions ad ON ad.signal_id = s.id
          WHERE s.ai_action IS NOT NULL
            AND s.ai_confidence > 0
            AND s.ai_reasoning != 'Parse error'
          ORDER BY s.candle_time DESC
          LIMIT 1
        `,
      )
      .get() as Pick<LatestSignalRow, 'ai_action' | 'ai_confidence' | 'ai_reasoning' | 'ai_risk_notes'> | undefined

    if (recentAiRow) {
      latestSignalRow.ai_action = recentAiRow.ai_action
      latestSignalRow.ai_confidence = recentAiRow.ai_confidence
      latestSignalRow.ai_reasoning = recentAiRow.ai_reasoning
      latestSignalRow.ai_risk_notes = recentAiRow.ai_risk_notes
    }
  }

  const latestSignalSnapshot = safeParseJson<SignalSnapshot>(
    latestSignalRow?.snapshot_json ?? null,
  )

  const ind = latestSignalSnapshot?.indicators
  const sent = latestSignalSnapshot?.sentiment

  const latestSignal: DashboardLatestSignal | null = latestSignalRow
    ? {
        id: latestSignalRow.id,
        candleTime: latestSignalRow.candle_time,
        ruleAction: latestSignalRow.rule_action,
        ruleStrength: latestSignalRow.rule_strength,
        finalAction: latestSignalRow.final_action,
        aiAction: latestSignalRow.ai_action,
        aiConfidence: latestSignalRow.ai_confidence,
        aiReasoning: latestSignalRow.ai_reasoning,
        aiRiskNotes: latestSignalRow.ai_risk_notes ?? null,
        price: latestSignalSnapshot?.price ?? null,
        rsi: ind?.rsi ?? null,
        macdHistogram: ind?.macdHistogram ?? null,
        ema9: ind?.ema9 ?? null,
        ema21: ind?.ema21 ?? null,
        bbPct: ind?.bbPct ?? null,
        stochasticK: ind?.stochasticK ?? null,
        mfi: ind?.mfi ?? null,
        obImbalance: ind?.obImbalance ?? null,
        spreadBps: ind?.spreadBps ?? null,
        vwapDeviation: ind?.vwapDeviation ?? null,
        fearGreedIndex: sent?.fearGreedIndex ?? null,
        fearGreedLabel: sent?.fearGreedLabel ?? null,
        polymarketBullishProb: sent?.polymarketBullishProb ?? null,
        polymarketMarkets: (sent?.polymarketMarkets ?? []).map((m) => ({
          conditionId: m.conditionId,
          question: m.question,
          yesProbability: m.yesProbability,
          liquidity: m.liquidity,
        })),
      }
    : null

  const tradeRows = db
    .prepare(
      `
        SELECT
          id,
          side,
          status,
          entry_price,
          exit_price,
          size_btc,
          realized_pnl,
          realized_pnl_pct,
          fee_total,
          entry_time,
          exit_time,
          exit_reason,
          signal_json
        FROM trades
        ORDER BY COALESCE(entry_time, id) DESC
        LIMIT 100
      `,
    )
    .all() as TradeRow[]

  const { takeProfitPct, stopLossPct } = readStrategyConfig()

  const trades = tradeRows.map<DashboardTrade>((row) => {
    const direction: TradeDirection = row.side === 'buy' ? 'LONG' : 'SHORT'
    const markPrice = row.exit_price ?? latestCandle?.close ?? null
    const livePnlData =
      row.status === 'open'
        ? calcPnl(direction, row.entry_price, markPrice, row.size_btc)
        : { pnl: null, pnlPct: null }
    const signal = safeParseJson<StoredTradeSignal>(row.signal_json)

    const tpPrice =
      row.entry_price != null
        ? direction === 'LONG'
          ? row.entry_price * (1 + takeProfitPct)
          : row.entry_price * (1 - takeProfitPct)
        : null
    const slPrice =
      row.entry_price != null
        ? direction === 'LONG'
          ? row.entry_price * (1 - stopLossPct)
          : row.entry_price * (1 + stopLossPct)
        : null

    const tpPnl = calcPnl(direction, row.entry_price, tpPrice, row.size_btc)
    const slPnl = calcPnl(direction, row.entry_price, slPrice, row.size_btc)

    return {
      id: row.id,
      direction,
      side: row.side,
      status: row.status,
      entryPrice: row.entry_price,
      exitPrice: row.exit_price,
      tpPrice,
      slPrice,
      sizeBtc: row.size_btc,
      feeTotal: row.fee_total,
      realizedPnl: row.realized_pnl,
      realizedPnlPct: row.realized_pnl_pct,
      livePnl: livePnlData.pnl,
      livePnlPct: livePnlData.pnlPct,
      maxPotentialProfit: tpPnl.pnl,
      maxPotentialLoss: slPnl.pnl != null ? -Math.abs(slPnl.pnl) : null,
      signalTime: signal?.candleTime ? floorToMinute(signal.candleTime) : null,
      entryTime: floorToMinute(row.entry_time),
      exitTime: floorToMinute(row.exit_time),
      exitReason: row.exit_reason,
      markPrice,
      context: buildTradeContext(signal),
    }
  })

  const closedTrades = trades.filter((trade) => trade.status === 'closed')
  const winningClosedTrades = closedTrades.filter(
    (trade) => (trade.realizedPnl ?? 0) > 0,
  )

  const netRealizedPnl = trades.reduce(
    (sum, trade) => sum + (trade.realizedPnl ?? 0),
    0,
  )
  const unrealizedPnl = trades.reduce(
    (sum, trade) => sum + (trade.status === 'open' ? (trade.livePnl ?? 0) : 0),
    0,
  )

  const btcPrice = latestCandle?.close ?? 0
  const krakenEquity = await fetchKrakenEquity(btcPrice)

  const startingEquity = krakenEquity != null
    ? krakenEquity - netRealizedPnl - unrealizedPnl
    : readStartingEquity(db)
  const accountBalance = krakenEquity ?? startingEquity + netRealizedPnl + unrealizedPnl

  const stats: DashboardStats = {
    totalTrades: trades.length,
    openTrades: trades.filter((trade) => trade.status === 'open').length,
    closedTrades: closedTrades.length,
    longTrades: trades.filter((trade) => trade.direction === 'LONG').length,
    shortTrades: trades.filter((trade) => trade.direction === 'SHORT').length,
    winRate:
      closedTrades.length > 0
        ? (winningClosedTrades.length / closedTrades.length) * 100
        : null,
    netRealizedPnl,
    totalMaxProfit: trades.reduce(
      (sum, trade) => sum + (trade.maxPotentialProfit ?? 0),
      0,
    ),
    totalMaxLoss: trades.reduce(
      (sum, trade) => sum + (trade.maxPotentialLoss ?? 0),
      0,
    ),
    startingEquity,
    accountBalance,
  }

  const openTrade = trades.find((trade) => trade.status === 'open') ?? null
  const updatedAt = latestCandle?.time ?? null
  const isStale = updatedAt == null ? true : Date.now() - updatedAt > 120_000

  const sentimentRows = db
    .prepare(
      `
        SELECT s.candle_time, s.snapshot_json
        FROM signals s
        WHERE s.snapshot_json IS NOT NULL
        ORDER BY s.candle_time DESC
        LIMIT 50
      `,
    )
    .all() as { candle_time: number; snapshot_json: string }[]

  const sentimentHistory = sentimentRows
    .map((row) => {
      const snap = safeParseJson<SignalSnapshot>(row.snapshot_json)
      return {
        time: row.candle_time,
        fearGreedIndex: snap?.sentiment?.fearGreedIndex ?? null,
        polymarketBullishProb: snap?.sentiment?.polymarketBullishProb ?? null,
      }
    })
    .reverse()

  return {
    market: {
      pair: 'BTC/USD',
      price: latestCandle?.close ?? null,
      change:
        latestCandle && previousCandle
          ? latestCandle.close - previousCandle.close
          : null,
      changePct:
        latestCandle && previousCandle && previousCandle.close !== 0
          ? ((latestCandle.close - previousCandle.close) / previousCandle.close) *
            100
          : null,
      updatedAt,
      high1h:
        recentHourCandles.length > 0
          ? Math.max(...recentHourCandles.map((candle) => candle.high))
          : null,
      low1h:
        recentHourCandles.length > 0
          ? Math.min(...recentHourCandles.map((candle) => candle.low))
          : null,
      volume1h: recentHourCandles.reduce(
        (sum, candle) => sum + candle.volume,
        0,
      ),
      openPosition: openTrade?.direction ?? 'FLAT',
      openTradeId: openTrade?.id ?? null,
      latestSignal,
      isStale,
    },
    stats,
    candles,
    indicators,
    trades,
    sentimentHistory,
  }
}
