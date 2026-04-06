import { useEffect, useRef, useState } from 'react'
import { Settings2, Eye, EyeOff } from 'lucide-react'
import type {
  IChartApi,
  IPriceLine,
  ISeriesMarkersPluginApi,
  ISeriesApi,
  SeriesMarker,
  Time,
  UTCTimestamp,
} from 'lightweight-charts'
import type * as LightweightCharts from 'lightweight-charts'
import type {
  DashboardCandle,
  DashboardIndicatorHighlightKey,
  DashboardIndicatorPoint,
  DashboardIndicatorSeries,
  DashboardTrade,
} from '#/lib/dashboard'
import { formatDateTime, formatSignedPercent, formatSignedUsd, formatUsd } from '#/lib/format'
import {
  INDICATOR_GROUPS,
  useIndicatorVisibility,
} from '#/lib/use-indicator-visibility'
import { Badge } from '#/components/ui/badge'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import {
  HoverCard,
  HoverCardTrigger,
  HoverCardContent,
} from '#/components/ui/hover-card'

interface PositionOverlayRect {
  tradeId: number
  direction: DashboardTrade['direction']
  status: string
  left: number
  width: number
  entryY: number
  markY: number
  profitTop: number
  profitHeight: number
  riskTop: number
  riskHeight: number
  labelTop: number
  labelLeft: number
  pnlValue: number | null
  pnlText: string
  priceText: string
  focused: boolean
}

interface ChartSeriesRefs {
  candle: ISeriesApi<'Candlestick'> | null
  markers: ISeriesMarkersPluginApi<Time> | null
  overlay: ISeriesApi<'Baseline'> | null
  ema9: ISeriesApi<'Line'> | null
  ema21: ISeriesApi<'Line'> | null
  bbUpper: ISeriesApi<'Line'> | null
  bbMiddle: ISeriesApi<'Line'> | null
  bbLower: ISeriesApi<'Line'> | null
  rsi: ISeriesApi<'Line'> | null
  rsi30: ISeriesApi<'Line'> | null
  rsi50: ISeriesApi<'Line'> | null
  rsi70: ISeriesApi<'Line'> | null
  macdLine: ISeriesApi<'Line'> | null
  macdSignal: ISeriesApi<'Line'> | null
  macdHistogram: ISeriesApi<'Histogram'> | null
  macdZero: ISeriesApi<'Line'> | null
  stochasticK: ISeriesApi<'Line'> | null
  mfi: ISeriesApi<'Line'> | null
  osc20: ISeriesApi<'Line'> | null
  osc80: ISeriesApi<'Line'> | null
}

function createEmptySeriesRefs(): ChartSeriesRefs {
  return {
    candle: null,
    markers: null,
    overlay: null,
    ema9: null,
    ema21: null,
    bbUpper: null,
    bbMiddle: null,
    bbLower: null,
    rsi: null,
    rsi30: null,
    rsi50: null,
    rsi70: null,
    macdLine: null,
    macdSignal: null,
    macdHistogram: null,
    macdZero: null,
    stochasticK: null,
    mfi: null,
    osc20: null,
    osc80: null,
  }
}

function toChartTime(timeMs: number) {
  return Math.floor(timeMs / 1000) as UTCTimestamp
}

function tradePnl(trade: DashboardTrade) {
  return trade.status === 'open' ? trade.livePnl : trade.realizedPnl
}

function tradePnlPct(trade: DashboardTrade) {
  return trade.status === 'open' ? trade.livePnlPct : trade.realizedPnlPct
}

function pnlToneClass(value: number | null | undefined) {
  if (value == null) return 'text-foreground'
  return value >= 0 ? 'text-[var(--profit)]' : 'text-[var(--loss)]'
}

function markerForTrade(
  trade: DashboardTrade,
  kind: 'entry' | 'exit',
): SeriesMarker<UTCTimestamp> | null {
  const time = kind === 'entry' ? trade.entryTime : trade.exitTime
  if (!time) {
    return null
  }

  const isLong = trade.direction === 'LONG'

  if (kind === 'entry') {
    return {
      time: toChartTime(time),
      position: isLong ? 'belowBar' : 'aboveBar',
      color: isLong ? '#35d07f' : '#ff7a90',
      shape: isLong ? 'arrowUp' : 'arrowDown',
      text: `${isLong ? 'L' : 'S'} #${trade.id}`,
    }
  }

  return {
    time: toChartTime(time),
    position: isLong ? 'aboveBar' : 'belowBar',
    color: '#f4d35e',
    shape: 'circle',
    text: `Exit #${trade.id}`,
  }
}

function chartTheme() {
  const isDark = document.documentElement.classList.contains('dark')

  return {
    background: isDark ? '#0c1220' : '#f6f9ff',
    text: isDark ? '#dce7ff' : '#1e2840',
    grid: isDark ? 'rgba(143, 169, 255, 0.11)' : 'rgba(73, 95, 153, 0.1)',
    border: isDark ? 'rgba(143, 169, 255, 0.18)' : 'rgba(73, 95, 153, 0.16)',
    guide: isDark ? 'rgba(220, 231, 255, 0.18)' : 'rgba(30, 40, 64, 0.18)',
  }
}

export function lineData(points: DashboardIndicatorPoint[]) {
  return points.map((point) =>
    point.value == null
      ? { time: toChartTime(point.time) }
      : { time: toChartTime(point.time), value: point.value },
  )
}

function constantLineData(candles: DashboardCandle[], value: number) {
  return candles.map((candle) => ({
    time: toChartTime(candle.time),
    value,
  }))
}

export function histogramData(
  points: DashboardIndicatorPoint[],
  tone: 'normal' | 'dim' | 'active' = 'normal',
) {
  const positiveColor =
    tone === 'active'
      ? 'rgba(53,208,127,1)'
      : tone === 'dim'
        ? 'rgba(53,208,127,0.28)'
        : 'rgba(53,208,127,0.8)'
  const negativeColor =
    tone === 'active'
      ? 'rgba(255,122,144,1)'
      : tone === 'dim'
        ? 'rgba(255,122,144,0.28)'
        : 'rgba(255,122,144,0.8)'

  return points.map((point) =>
    point.value == null
      ? { time: toChartTime(point.time) }
      : {
          time: toChartTime(point.time),
          value: point.value,
          color: point.value >= 0 ? positiveColor : negativeColor,
        },
  )
}

const INDICATOR_COLORS: Record<DashboardIndicatorHighlightKey, string> = {
  ema9: '#f4d35e',
  ema21: '#4ea1ff',
  bbands: '#c2a5ff',
  rsi: '#7fd6ff',
  macdHistogram: '#8ab6ff',
  stochasticK: '#35d07f',
  mfi: '#ff9f43',
}

function IndicatorSettingsHoverCard() {
  const { visibility, toggle, setAll } = useIndicatorVisibility()
  const allOn = Object.values(visibility).every(Boolean)
  const categories = [...new Set(INDICATOR_GROUPS.map((g) => g.category))]

  return (
    <HoverCard openDelay={100} closeDelay={200}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-md border border-[var(--panel-border)] bg-[var(--panel-subtle)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--panel-border)] hover:text-[var(--foreground)]"
        >
          <Settings2 className="h-3.5 w-3.5" />
          Indicators
        </button>
      </HoverCardTrigger>
      <HoverCardContent align="start" sideOffset={8} className="w-56 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--muted-foreground)]">
            Toggle indicators
          </span>
          <button
            type="button"
            onClick={() => setAll(!allOn)}
            className="text-[10px] font-medium text-[var(--accent-soft)] hover:underline"
          >
            {allOn ? 'Hide all' : 'Show all'}
          </button>
        </div>
        {categories.map((cat) => (
          <div key={cat} className="mt-2 first:mt-0">
            <p className="mb-1 text-[9px] font-bold uppercase tracking-[0.16em] text-[var(--muted-foreground)]">
              {cat}
            </p>
            {INDICATOR_GROUPS.filter((g) => g.category === cat).map((ind) => {
              const on = visibility[ind.key]
              return (
                <button
                  key={ind.key}
                  type="button"
                  onClick={() => toggle(ind.key)}
                  className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors hover:bg-[var(--panel-subtle)]"
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full transition-opacity"
                    style={{ backgroundColor: ind.color, opacity: on ? 1 : 0.25 }}
                  />
                  <span
                    className="flex-1 font-medium transition-opacity"
                    style={{ opacity: on ? 1 : 0.45 }}
                  >
                    {ind.label}
                  </span>
                  {on ? (
                    <Eye className="h-3.5 w-3.5 text-[var(--foreground)]" />
                  ) : (
                    <EyeOff className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
                  )}
                </button>
              )
            })}
          </div>
        ))}
      </HoverCardContent>
    </HoverCard>
  )
}

function indicatorTone(
  highlightedIndicator: DashboardIndicatorHighlightKey | null,
  key: DashboardIndicatorHighlightKey,
) {
  if (highlightedIndicator == null) {
    return 'normal'
  }

  return highlightedIndicator === key ? 'active' : 'dim'
}

function seriesColor(baseColor: string, tone: 'normal' | 'dim' | 'active') {
  if (tone === 'active') {
    return baseColor
  }

  if (tone === 'dim') {
    return `${baseColor}55`
  }

  return baseColor
}

function applyPaneLayout(chart: IChartApi) {
  const panes = chart.panes()
  panes[0]?.setHeight(500)
  panes[1]?.setHeight(150)
  panes[2]?.setHeight(140)
  panes[3]?.setHeight(140)
}

function applyTheme(chart: IChartApi, series: ChartSeriesRefs) {
  const palette = chartTheme()

  chart.applyOptions({
    layout: {
      background: {
        color: palette.background,
      },
      textColor: palette.text,
      attributionLogo: false,
      fontFamily: 'IBM Plex Sans, sans-serif',
    },
    grid: {
      vertLines: { color: palette.grid },
      horzLines: { color: palette.grid },
    },
    rightPriceScale: { borderColor: palette.border },
    timeScale: {
      borderColor: palette.border,
      timeVisible: true,
      secondsVisible: false,
    },
  })

  const guideOptions = {
    color: palette.guide,
  }

  series.rsi30?.applyOptions(guideOptions)
  series.rsi50?.applyOptions(guideOptions)
  series.rsi70?.applyOptions(guideOptions)
  series.macdZero?.applyOptions(guideOptions)
  series.osc20?.applyOptions(guideOptions)
  series.osc80?.applyOptions(guideOptions)
}

function applyIndicatorEmphasis(
  series: ChartSeriesRefs,
  indicators: DashboardIndicatorSeries,
  highlightedIndicator: DashboardIndicatorHighlightKey | null,
) {
  const ema9Tone = indicatorTone(highlightedIndicator, 'ema9')
  const ema21Tone = indicatorTone(highlightedIndicator, 'ema21')
  const bbTone = indicatorTone(highlightedIndicator, 'bbands')
  const rsiTone = indicatorTone(highlightedIndicator, 'rsi')
  const macdTone = indicatorTone(highlightedIndicator, 'macdHistogram')
  const stochTone = indicatorTone(highlightedIndicator, 'stochasticK')
  const mfiTone = indicatorTone(highlightedIndicator, 'mfi')

  series.ema9?.applyOptions({
    color: seriesColor(INDICATOR_COLORS.ema9, ema9Tone),
    lineWidth: ema9Tone === 'active' ? 3 : 2,
  })
  series.ema21?.applyOptions({
    color: seriesColor(INDICATOR_COLORS.ema21, ema21Tone),
    lineWidth: ema21Tone === 'active' ? 3 : 2,
  })
  series.bbUpper?.applyOptions({
    color: seriesColor(INDICATOR_COLORS.bbands, bbTone),
    lineWidth: bbTone === 'active' ? 2 : 1,
  })
  series.bbMiddle?.applyOptions({
    color: seriesColor('#a88ef0', bbTone),
    lineWidth: bbTone === 'active' ? 2 : 1,
  })
  series.bbLower?.applyOptions({
    color: seriesColor(INDICATOR_COLORS.bbands, bbTone),
    lineWidth: bbTone === 'active' ? 2 : 1,
  })
  series.rsi?.applyOptions({
    color: seriesColor(INDICATOR_COLORS.rsi, rsiTone),
    lineWidth: rsiTone === 'active' ? 3 : 2,
  })
  series.stochasticK?.applyOptions({
    color: seriesColor(INDICATOR_COLORS.stochasticK, stochTone),
    lineWidth: stochTone === 'active' ? 3 : 2,
  })
  series.mfi?.applyOptions({
    color: seriesColor(INDICATOR_COLORS.mfi, mfiTone),
    lineWidth: mfiTone === 'active' ? 3 : 2,
  })
  series.macdLine?.applyOptions({
    color: seriesColor('#4ea1ff', macdTone),
    lineWidth: macdTone === 'active' ? 3 : 2,
  })
  series.macdSignal?.applyOptions({
    color: seriesColor('#ff9f43', macdTone),
    lineWidth: macdTone === 'active' ? 3 : 2,
  })
  series.macdHistogram?.setData(
    histogramData(
      indicators.macdHistogram,
      macdTone === 'dim' ? 'dim' : macdTone === 'active' ? 'active' : 'normal',
    ),
  )
}

export function TradeChart({
  candles,
  indicators,
  trades,
  focusedTradeId,
  highlightedIndicator,
}: {
  candles: DashboardCandle[]
  indicators: DashboardIndicatorSeries
  trades: DashboardTrade[]
  focusedTradeId: number | 'all'
  highlightedIndicator: DashboardIndicatorHighlightKey | null
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartLibRef = useRef<typeof LightweightCharts | null>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRefs = useRef<ChartSeriesRefs>(createEmptySeriesRefs())
  const priceLinesRef = useRef<IPriceLine[]>([])
  const hasFittedRef = useRef(false)
  const shouldResetRangeRef = useRef(true)
  const previousFocusedTradeIdRef = useRef<number | 'all'>(focusedTradeId)
  const [isChartReady, setIsChartReady] = useState(false)
  const [positionOverlays, setPositionOverlays] = useState<PositionOverlayRect[]>([])
  const { visibility } = useIndicatorVisibility()

  const focusedTrade =
    focusedTradeId === 'all'
      ? null
      : trades.find((trade) => trade.id === focusedTradeId) ?? null

  useEffect(() => {
    if (previousFocusedTradeIdRef.current !== focusedTradeId) {
      shouldResetRangeRef.current = true
      previousFocusedTradeIdRef.current = focusedTradeId
    }

    hasFittedRef.current = false
  }, [focusedTradeId])

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }

    let mounted = true
    let cleanup = () => {}

    void (async () => {
      const lib = await import('lightweight-charts')
      if (!mounted || !container) {
        return
      }

      chartLibRef.current = lib

      const chart = lib.createChart(container, {
        autoSize: true,
        height: 930,
        layout: {
          background: {
            color: chartTheme().background,
          },
          textColor: chartTheme().text,
          attributionLogo: false,
          fontFamily: 'IBM Plex Sans, sans-serif',
        },
        grid: {
          vertLines: {
            color: chartTheme().grid,
          },
          horzLines: {
            color: chartTheme().grid,
          },
        },
        rightPriceScale: {
          borderColor: chartTheme().border,
        },
        timeScale: {
          borderColor: chartTheme().border,
          timeVisible: true,
          secondsVisible: false,
        },
        crosshair: {
          vertLine: {
            color: 'rgba(111, 133, 255, 0.34)',
          },
          horzLine: {
            color: 'rgba(111, 133, 255, 0.34)',
          },
        },
      })

      const nextSeries = createEmptySeriesRefs()

      nextSeries.candle = chart.addSeries(lib.CandlestickSeries, {
        upColor: '#35d07f',
        downColor: '#ff7a90',
        wickUpColor: '#35d07f',
        wickDownColor: '#ff7a90',
        borderVisible: false,
      })
      nextSeries.markers = lib.createSeriesMarkers(nextSeries.candle, [])

      nextSeries.ema9 = chart.addSeries(
        lib.LineSeries,
        {
          color: '#f4d35e',
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        },
        0,
      )
      nextSeries.ema21 = chart.addSeries(
        lib.LineSeries,
        {
          color: '#4ea1ff',
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        },
        0,
      )
      nextSeries.bbUpper = chart.addSeries(
        lib.LineSeries,
        {
          color: 'rgba(194, 165, 255, 0.85)',
          lineWidth: 1,
          lineStyle: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        },
        0,
      )
      nextSeries.bbMiddle = chart.addSeries(
        lib.LineSeries,
        {
          color: 'rgba(194, 165, 255, 0.55)',
          lineWidth: 1,
          lineStyle: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        },
        0,
      )
      nextSeries.bbLower = chart.addSeries(
        lib.LineSeries,
        {
          color: 'rgba(194, 165, 255, 0.85)',
          lineWidth: 1,
          lineStyle: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        },
        0,
      )

      nextSeries.rsi = chart.addSeries(
        lib.LineSeries,
        {
          color: '#7fd6ff',
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        },
        1,
      )
      nextSeries.rsi30 = chart.addSeries(
        lib.LineSeries,
        {
          lineWidth: 1,
          lineStyle: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        },
        1,
      )
      nextSeries.rsi50 = chart.addSeries(
        lib.LineSeries,
        {
          lineWidth: 1,
          lineStyle: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        },
        1,
      )
      nextSeries.rsi70 = chart.addSeries(
        lib.LineSeries,
        {
          lineWidth: 1,
          lineStyle: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        },
        1,
      )

      nextSeries.macdHistogram = chart.addSeries(
        lib.HistogramSeries,
        {
          priceLineVisible: false,
          lastValueVisible: false,
          base: 0,
        },
        2,
      )
      nextSeries.macdLine = chart.addSeries(
        lib.LineSeries,
        {
          color: '#4ea1ff',
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        },
        2,
      )
      nextSeries.macdSignal = chart.addSeries(
        lib.LineSeries,
        {
          color: '#ff9f43',
          lineWidth: 2,
          lineStyle: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        },
        2,
      )
      nextSeries.macdZero = chart.addSeries(
        lib.LineSeries,
        {
          lineWidth: 1,
          lineStyle: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        },
        2,
      )

      nextSeries.stochasticK = chart.addSeries(
        lib.LineSeries,
        {
          color: '#35d07f',
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        },
        3,
      )
      nextSeries.mfi = chart.addSeries(
        lib.LineSeries,
        {
          color: '#ff9f43',
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        },
        3,
      )
      nextSeries.osc20 = chart.addSeries(
        lib.LineSeries,
        {
          lineWidth: 1,
          lineStyle: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        },
        3,
      )
      nextSeries.osc80 = chart.addSeries(
        lib.LineSeries,
        {
          lineWidth: 1,
          lineStyle: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        },
        3,
      )

      chartRef.current = chart
      seriesRefs.current = nextSeries
      applyPaneLayout(chart)
      applyTheme(chart, nextSeries)
      setIsChartReady(true)

      const observer = new MutationObserver(() => {
        applyTheme(chart, seriesRefs.current)
      })

      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class'],
      })

      cleanup = () => {
        observer.disconnect()
        chart.remove()
        chartLibRef.current = null
        chartRef.current = null
        seriesRefs.current = createEmptySeriesRefs()
        priceLinesRef.current = []
        setIsChartReady(false)
      }
    })()

    return () => {
      mounted = false
      cleanup()
    }
  }, [])

  useEffect(() => {
    const chart = chartRef.current
    const series = seriesRefs.current
    if (!isChartReady || !chart || !series.candle || !series.markers) {
      return
    }

    series.candle.setData(
      candles.map((candle) => ({
        time: toChartTime(candle.time),
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      })),
    )

    const empty: { time: UTCTimestamp }[] = []
    series.ema9?.setData(visibility.ema9 ? lineData(indicators.ema9) : empty)
    series.ema21?.setData(visibility.ema21 ? lineData(indicators.ema21) : empty)
    series.bbUpper?.setData(visibility.bbands ? lineData(indicators.bbUpper) : empty)
    series.bbMiddle?.setData(visibility.bbands ? lineData(indicators.bbMiddle) : empty)
    series.bbLower?.setData(visibility.bbands ? lineData(indicators.bbLower) : empty)
    series.rsi?.setData(visibility.rsi ? lineData(indicators.rsi) : empty)
    series.rsi30?.setData(visibility.rsi ? constantLineData(candles, 30) : empty)
    series.rsi50?.setData(visibility.rsi ? constantLineData(candles, 50) : empty)
    series.rsi70?.setData(visibility.rsi ? constantLineData(candles, 70) : empty)
    series.macdLine?.setData(visibility.macd ? lineData(indicators.macdLine) : empty)
    series.macdSignal?.setData(visibility.macd ? lineData(indicators.macdSignal) : empty)
    series.macdHistogram?.setData(visibility.macd ? histogramData(indicators.macdHistogram) : empty)
    series.macdZero?.setData(visibility.macd ? constantLineData(candles, 0) : empty)
    series.stochasticK?.setData(visibility.stochasticK ? lineData(indicators.stochasticK) : empty)
    series.mfi?.setData(visibility.mfi ? lineData(indicators.mfi) : empty)
    series.osc20?.setData(visibility.stochasticK || visibility.mfi ? constantLineData(candles, 20) : empty)
    series.osc80?.setData(visibility.stochasticK || visibility.mfi ? constantLineData(candles, 80) : empty)

    const markers = trades
      .flatMap((trade) => {
        const list: (SeriesMarker<UTCTimestamp> | null)[] = [
          markerForTrade(trade, 'entry'),
          markerForTrade(trade, 'exit'),
        ]
        if (trade.signalTime && trade.entryTime && trade.signalTime !== trade.entryTime) {
          list.push({
            time: toChartTime(trade.signalTime),
            position: 'inBar',
            color: '#f4d35e',
            shape: 'square',
            text: `Sig #${trade.id}`,
          })
        }
        return list
      })
      .filter((marker): marker is SeriesMarker<UTCTimestamp> => marker != null)
      .sort((left, right) => Number(left.time) - Number(right.time))

    series.markers.setMarkers(markers)
    applyPaneLayout(chart)
    applyIndicatorEmphasis(series, indicators, highlightedIndicator)

    if (!hasFittedRef.current && candles.length > 0) {
      chart.timeScale().fitContent()
      hasFittedRef.current = true
      shouldResetRangeRef.current = false
    }
  }, [candles, highlightedIndicator, indicators, isChartReady, trades, visibility])

  useEffect(() => {
    const series = seriesRefs.current
    if (!isChartReady) {
      return
    }

    applyIndicatorEmphasis(series, indicators, highlightedIndicator)
  }, [highlightedIndicator, indicators, isChartReady])

  useEffect(() => {
    const chart = chartRef.current
    const candleSeries = seriesRefs.current.candle
    if (!isChartReady || !chart || !candleSeries || candles.length === 0) {
      setPositionOverlays([])
      return
    }

    const latestCandleTime = candles.at(-1)?.time ?? null

    const buildOverlay = (trade: DashboardTrade): PositionOverlayRect | null => {
      if (!trade.entryPrice || !trade.entryTime || !latestCandleTime) {
        return null
      }
      if (!trade.tpPrice || !trade.slPrice) {
        return null
      }

      const endTime = trade.exitTime ?? latestCandleTime
      const startX = chart.timeScale().timeToCoordinate(toChartTime(trade.entryTime))
      const endX = chart.timeScale().timeToCoordinate(toChartTime(endTime))
      const entryY = candleSeries.priceToCoordinate(trade.entryPrice)
      const markPrice = trade.markPrice ?? trade.entryPrice
      const markY = candleSeries.priceToCoordinate(markPrice)
      if (
        startX == null ||
        endX == null ||
        entryY == null ||
        markY == null ||
        Number.isNaN(startX) ||
        Number.isNaN(endX)
      ) {
        return null
      }

      const left = Math.min(startX, endX)
      const width = Math.max(Math.abs(endX - startX), 36)
      const isLong = trade.direction === 'LONG'

      let profitUpperPrice: number
      let profitLowerPrice: number
      let riskUpperPrice: number
      let riskLowerPrice: number

      if (isLong) {
        profitUpperPrice = trade.tpPrice
        profitLowerPrice = trade.entryPrice
        riskUpperPrice = trade.entryPrice
        riskLowerPrice = trade.slPrice
      } else {
        profitUpperPrice = trade.entryPrice
        profitLowerPrice = trade.tpPrice
        riskUpperPrice = trade.slPrice
        riskLowerPrice = trade.entryPrice
      }

      const profitTopY = candleSeries.priceToCoordinate(profitUpperPrice)
      const profitBottomY = candleSeries.priceToCoordinate(profitLowerPrice)
      const riskTopY = candleSeries.priceToCoordinate(riskUpperPrice)
      const riskBottomY = candleSeries.priceToCoordinate(riskLowerPrice)

      if (
        profitTopY == null ||
        profitBottomY == null ||
        riskTopY == null ||
        riskBottomY == null
      ) {
        return null
      }

      const profitTop = Math.min(profitTopY, profitBottomY)
      const profitHeight = Math.max(Math.abs(profitBottomY - profitTopY), 14)
      const riskTop = Math.min(riskTopY, riskBottomY)
      const riskHeight = Math.max(Math.abs(riskBottomY - riskTopY), 14)
      const labelTop = Math.max(Math.min(profitTop, riskTop) - 30, 10)
      const labelLeft = left + 8

      return {
        tradeId: trade.id,
        direction: trade.direction,
        status: trade.status,
        left,
        width,
        entryY,
        markY,
        profitTop,
        profitHeight,
        riskTop,
        riskHeight,
        labelTop,
        labelLeft,
        pnlValue: tradePnl(trade),
        pnlText: `${formatSignedUsd(tradePnl(trade))} · ${formatSignedPercent(
          tradePnlPct(trade),
        )}`,
        priceText: `${formatUsd(trade.entryPrice)} -> ${formatUsd(markPrice)}`,
        focused: focusedTradeId !== 'all' && focusedTradeId === trade.id,
      }
    }

    const computeOverlays = () => {
      const overlayTrades =
        focusedTradeId === 'all'
          ? trades
          : focusedTrade
            ? [focusedTrade]
            : []

      setPositionOverlays(
        overlayTrades
          .map((trade) => buildOverlay(trade))
          .filter((overlay): overlay is PositionOverlayRect => overlay != null),
      )
    }

    computeOverlays()

    const handleRangeChange = () => {
      computeOverlays()
    }

    const resizeObserver = new ResizeObserver(() => {
      computeOverlays()
    })

    resizeObserver.observe(chart.chartElement())
    chart.timeScale().subscribeVisibleTimeRangeChange(handleRangeChange)

    return () => {
      resizeObserver.disconnect()
      chart.timeScale().unsubscribeVisibleTimeRangeChange(handleRangeChange)
    }
  }, [candles, focusedTrade, focusedTradeId, isChartReady, trades])

  useEffect(() => {
    const chart = chartRef.current
    const chartLib = chartLibRef.current
    const overlaySeries = seriesRefs.current.overlay
    if (!isChartReady || !chart || !chartLib) {
      return
    }

    if (overlaySeries) {
      chart.removeSeries(overlaySeries)
      seriesRefs.current.overlay = null
    }

    priceLinesRef.current = []

    if (!focusedTrade || !focusedTrade.entryPrice) {
      if (shouldResetRangeRef.current) {
        chart.timeScale().fitContent()
        shouldResetRangeRef.current = false
      }
      return
    }

    const viewStart = focusedTrade.signalTime ?? focusedTrade.entryTime
    const tradeEndTime = focusedTrade.exitTime ?? candles.at(-1)?.time ?? focusedTrade.entryTime

    const tradeCandles = candles.filter((candle) => {
      if (!viewStart) return false
      return candle.time >= viewStart && candle.time <= (tradeEndTime ?? viewStart)
    })

    if (tradeCandles.length === 0) {
      return
    }

    const isLong = focusedTrade.direction === 'LONG'
    const nextOverlay = chart.addSeries(
      chartLib.BaselineSeries,
      {
        baseValue: {
          type: 'price',
          price: focusedTrade.entryPrice,
        },
        lineWidth: 2,
        lineVisible: true,
        topLineColor: isLong ? '#22c55e' : '#ef4444',
        topFillColor1: isLong ? 'rgba(34,197,94,0.28)' : 'rgba(239,68,68,0.22)',
        topFillColor2: isLong ? 'rgba(34,197,94,0.03)' : 'rgba(239,68,68,0.03)',
        bottomLineColor: isLong ? '#ef4444' : '#22c55e',
        bottomFillColor1: isLong ? 'rgba(239,68,68,0.22)' : 'rgba(34,197,94,0.28)',
        bottomFillColor2: isLong ? 'rgba(239,68,68,0.03)' : 'rgba(34,197,94,0.03)',
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
      },
      0,
    )

    nextOverlay.setData(
      tradeCandles.map((candle) => ({
        time: toChartTime(candle.time),
        value: candle.close,
      })),
    )

    const entryLine = nextOverlay.createPriceLine({
      price: focusedTrade.entryPrice,
      color: '#f4d35e',
      lineWidth: 1,
      lineStyle: 2,
      title: 'Entry',
    })
    priceLinesRef.current.push(entryLine)

    if (focusedTrade.markPrice != null) {
      const pnlValue = tradePnl(focusedTrade)
      const markLine = nextOverlay.createPriceLine({
        price: focusedTrade.markPrice,
        color: pnlValue != null && pnlValue >= 0 ? '#35d07f' : '#ff7a90',
        lineWidth: 1,
        lineStyle: 0,
        title: focusedTrade.status === 'open' ? 'Live' : 'Exit',
      })
      priceLinesRef.current.push(markLine)
    }

    if (focusedTrade.tpPrice != null) {
      priceLinesRef.current.push(
        nextOverlay.createPriceLine({
          price: focusedTrade.tpPrice,
          color: '#35d07f',
          lineWidth: 1,
          lineStyle: 2,
          title: 'TP',
        }),
      )
    }

    if (focusedTrade.slPrice != null) {
      priceLinesRef.current.push(
        nextOverlay.createPriceLine({
          price: focusedTrade.slPrice,
          color: '#ff7a90',
          lineWidth: 1,
          lineStyle: 2,
          title: 'SL',
        }),
      )
    }

    seriesRefs.current.overlay = nextOverlay

    const start = Math.max(
      tradeCandles[0].time - 5 * 60_000,
      candles[0]?.time ?? tradeCandles[0].time,
    )
    const end = Math.min(
      tradeCandles.at(-1)!.time + 15 * 60_000,
      candles.at(-1)?.time ?? tradeCandles.at(-1)!.time,
    )

    if (shouldResetRangeRef.current) {
      chart.timeScale().setVisibleRange({
        from: toChartTime(start),
        to: toChartTime(end),
      })
      shouldResetRangeRef.current = false
    }

    return () => {
      if (seriesRefs.current.overlay) {
        chart.removeSeries(seriesRefs.current.overlay)
        seriesRefs.current.overlay = null
      }
      priceLinesRef.current = []
    }
  }, [candles, focusedTrade, isChartReady])

  return (
    <Card className="h-full overflow-hidden">
      <CardHeader className="border-b border-[var(--panel-border)] py-3">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <CardTitle>BTC/USD · 1m</CardTitle>
            <IndicatorSettingsHoverCard />
          </div>
          {focusedTrade ? (
            <div className="space-y-2 text-right">
              <div className="flex justify-end gap-2">
                <Badge
                  variant={focusedTrade.direction === 'LONG' ? 'success' : 'danger'}
                >
                  {focusedTrade.direction}
                </Badge>
                <Badge
                  variant={focusedTrade.status === 'open' ? 'accent' : 'neutral'}
                >
                  {focusedTrade.status}
                </Badge>
              </div>
              <p className="text-sm text-[var(--muted-foreground)]">
                #{focusedTrade.id} · {formatDateTime(focusedTrade.entryTime)}
              </p>
              <p className="text-sm text-[var(--foreground)]">
                {formatUsd(focusedTrade.entryPrice)} to{' '}
                {formatUsd(focusedTrade.markPrice)} ·{' '}
                <span className={pnlToneClass(tradePnl(focusedTrade))}>
                  {formatSignedUsd(tradePnl(focusedTrade))} /{' '}
                  {formatSignedPercent(tradePnlPct(focusedTrade))}
                </span>
              </p>
            </div>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-0">
        <div className="relative h-[930px] w-full overflow-hidden" data-testid="trade-chart">
          <div
            ref={containerRef}
            className="absolute inset-0 h-full w-full"
          />
          <div className="pointer-events-none absolute inset-0 z-10">
            {positionOverlays.map((overlay) => (
              <div key={overlay.tradeId}>
                <div
                  className="absolute border border-[rgba(52,208,127,0.5)] bg-[rgba(53,208,127,0.18)]"
                  style={{
                    left: overlay.left,
                    width: overlay.width,
                    top: overlay.profitTop,
                    height: overlay.profitHeight,
                    opacity: overlay.focused ? 1 : 0.4,
                  }}
                />
                <div
                  className="absolute border border-[rgba(255,68,68,0.5)] bg-[rgba(239,68,68,0.14)]"
                  style={{
                    left: overlay.left,
                    width: overlay.width,
                    top: overlay.riskTop,
                    height: overlay.riskHeight,
                    opacity: overlay.focused ? 1 : 0.4,
                  }}
                />
                <div
                  className="absolute border-t border-dashed border-[rgba(244,211,94,0.9)]"
                  style={{
                    left: overlay.left,
                    width: overlay.width,
                    top: overlay.entryY,
                  }}
                />
                <div
                  className="absolute border-t border-solid"
                  style={{
                    left: overlay.left,
                    width: overlay.width,
                    top: overlay.markY,
                    borderColor:
                      overlay.direction === 'LONG'
                        ? 'rgba(53,208,127,0.9)'
                        : 'rgba(255,122,144,0.9)',
                  }}
                />
                {overlay.focused ? (
                  <div
                    className="absolute max-w-[240px] border border-[var(--panel-border)] bg-white/92 px-3 py-2 text-xs text-foreground backdrop-blur-sm dark:bg-[rgba(6,10,18,0.92)]"
                    style={{
                      left: overlay.labelLeft,
                      top: overlay.labelTop,
                    }}
                  >
                    <div className="font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                      {overlay.direction} #{overlay.tradeId}
                    </div>
                    <div className={`mt-1 font-medium ${pnlToneClass(overlay.pnlValue)}`}>
                      {overlay.pnlText}
                    </div>
                    <div className="mt-1 text-muted-foreground">
                      {overlay.priceText}
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
