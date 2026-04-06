export type TradeDirection = 'LONG' | 'SHORT'
export type DashboardIndicatorHighlightKey =
  | 'ema9'
  | 'ema21'
  | 'bbands'
  | 'rsi'
  | 'macdHistogram'
  | 'stochasticK'
  | 'mfi'

export interface DashboardCandle {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface DashboardIndicatorPoint {
  time: number
  value: number | null
}

export interface DashboardIndicatorSeries {
  ema9: DashboardIndicatorPoint[]
  ema21: DashboardIndicatorPoint[]
  bbUpper: DashboardIndicatorPoint[]
  bbMiddle: DashboardIndicatorPoint[]
  bbLower: DashboardIndicatorPoint[]
  rsi: DashboardIndicatorPoint[]
  macdLine: DashboardIndicatorPoint[]
  macdSignal: DashboardIndicatorPoint[]
  macdHistogram: DashboardIndicatorPoint[]
  stochasticK: DashboardIndicatorPoint[]
  mfi: DashboardIndicatorPoint[]
  obv: DashboardIndicatorPoint[]
}

export interface DashboardPolymarketMarket {
  conditionId: string
  question: string
  yesProbability: number
  liquidity: number
}

export interface DashboardLatestSignal {
  id: number
  candleTime: number
  ruleAction: string
  ruleStrength: number | null
  finalAction: string
  aiAction: string | null
  aiConfidence: number | null
  aiReasoning: string | null
  aiRiskNotes: string | null
  price: number | null
  rsi: number | null
  macdHistogram: number | null
  ema9: number | null
  ema21: number | null
  bbPct: number | null
  stochasticK: number | null
  mfi: number | null
  obImbalance: number | null
  spreadBps: number | null
  vwapDeviation: number | null
  fearGreedIndex: number | null
  fearGreedLabel: string | null
  polymarketBullishProb: number | null
  polymarketMarkets: DashboardPolymarketMarket[]
}

export interface DashboardTradeContext {
  action: string | null
  confidence: number | null
  ruleAction: string | null
  ruleReasons: string[]
  aiAction: string | null
  reasoning: string | null
  riskNotes: string | null
  fearGreedLabel: string | null
  fearGreedIndex: number | null
  polymarketBullishProb: number | null
  rsi: number | null
  ema9: number | null
  ema21: number | null
  macdHistogram: number | null
  spreadBps: number | null
  taapiSignals: string[]
}

export interface DashboardTrade {
  id: number
  direction: TradeDirection
  side: 'buy' | 'sell'
  status: string
  entryPrice: number | null
  exitPrice: number | null
  tpPrice: number | null
  slPrice: number | null
  sizeBtc: number
  feeTotal: number | null
  realizedPnl: number | null
  realizedPnlPct: number | null
  livePnl: number | null
  livePnlPct: number | null
  maxPotentialProfit: number | null
  maxPotentialLoss: number | null
  signalTime: number | null
  entryTime: number | null
  exitTime: number | null
  exitReason: string | null
  markPrice: number | null
  context: DashboardTradeContext | null
}

export interface DashboardStats {
  totalTrades: number
  openTrades: number
  closedTrades: number
  longTrades: number
  shortTrades: number
  winRate: number | null
  netRealizedPnl: number
  totalMaxProfit: number
  totalMaxLoss: number
  startingEquity: number
  accountBalance: number
}

export interface DashboardMarket {
  pair: string
  price: number | null
  change: number | null
  changePct: number | null
  updatedAt: number | null
  high1h: number | null
  low1h: number | null
  volume1h: number | null
  openPosition: TradeDirection | 'FLAT'
  openTradeId: number | null
  latestSignal: DashboardLatestSignal | null
  isStale: boolean
}

export interface DashboardSentimentPoint {
  time: number
  fearGreedIndex: number | null
  polymarketBullishProb: number | null
}

export interface DashboardSnapshot {
  market: DashboardMarket
  stats: DashboardStats
  candles: DashboardCandle[]
  indicators: DashboardIndicatorSeries
  trades: DashboardTrade[]
  sentimentHistory: DashboardSentimentPoint[]
}

export interface DashboardRealtimeMarket {
  price: number
  updatedAt: number
}

function calcLivePnl(
  direction: DashboardTrade['direction'],
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

export function applyRealtimeMarket(
  snapshot: DashboardSnapshot,
  realtime: DashboardRealtimeMarket | null,
) {
  if (!realtime) {
    return snapshot
  }

  const previousCandle = snapshot.candles.at(-2) ?? null
  const openTrades = snapshot.trades.map((trade) => {
    if (trade.status !== 'open') {
      return trade
    }

    const nextMarkPrice = realtime.price
    const nextLivePnl = calcLivePnl(
      trade.direction,
      trade.entryPrice,
      nextMarkPrice,
      trade.sizeBtc,
    )

    return {
      ...trade,
      markPrice: nextMarkPrice,
      livePnl: nextLivePnl.pnl,
      livePnlPct: nextLivePnl.pnlPct,
    }
  })

  const unrealizedPnl = openTrades.reduce(
    (sum, trade) => sum + (trade.status === 'open' ? (trade.livePnl ?? 0) : 0),
    0,
  )
  const accountBalance =
    snapshot.stats.startingEquity + snapshot.stats.netRealizedPnl + unrealizedPnl

  return {
    ...snapshot,
    market: {
      ...snapshot.market,
      price: realtime.price,
      updatedAt: realtime.updatedAt,
      isStale: false,
      change:
        previousCandle != null ? realtime.price - previousCandle.close : null,
      changePct:
        previousCandle != null && previousCandle.close !== 0
          ? ((realtime.price - previousCandle.close) / previousCandle.close) *
            100
          : null,
    },
    stats: { ...snapshot.stats, accountBalance },
    trades: openTrades,
  }
}
