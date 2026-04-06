import { useCallback, useSyncExternalStore } from 'react'

export type IndicatorGroup = 'ema9' | 'ema21' | 'bbands' | 'rsi' | 'macd' | 'stochasticK' | 'mfi'

export const INDICATOR_GROUPS: {
  key: IndicatorGroup
  label: string
  color: string
  category: string
}[] = [
  { key: 'ema9', label: 'EMA 9', color: '#f4d35e', category: 'Price' },
  { key: 'ema21', label: 'EMA 21', color: '#4ea1ff', category: 'Price' },
  { key: 'bbands', label: 'Bollinger Bands', color: '#c2a5ff', category: 'Price' },
  { key: 'rsi', label: 'RSI', color: '#7fd6ff', category: 'Momentum' },
  { key: 'macd', label: 'MACD', color: '#8ab6ff', category: 'Momentum' },
  { key: 'stochasticK', label: 'Stoch K', color: '#35d07f', category: 'Oscillators' },
  { key: 'mfi', label: 'MFI', color: '#ff9f43', category: 'Oscillators' },
]

const STORAGE_KEY = 'chart-indicator-visibility'

type VisibilityMap = Record<IndicatorGroup, boolean>

const DEFAULT_VISIBILITY: VisibilityMap = {
  ema9: true,
  ema21: true,
  bbands: true,
  rsi: true,
  macd: true,
  stochasticK: true,
  mfi: true,
}

let listeners: (() => void)[] = []
let cached: VisibilityMap | null = null

function read(): VisibilityMap {
  if (cached) return cached
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      cached = { ...DEFAULT_VISIBILITY, ...JSON.parse(raw) }
      return cached
    }
  } catch {
    // fall through
  }
  cached = { ...DEFAULT_VISIBILITY }
  return cached
}

function write(next: VisibilityMap) {
  cached = next
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  for (const fn of listeners) fn()
}

function subscribe(fn: () => void) {
  listeners.push(fn)
  return () => {
    listeners = listeners.filter((l) => l !== fn)
  }
}

function getSnapshot() {
  return read()
}

export function useIndicatorVisibility() {
  const visibility = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  const toggle = useCallback((key: IndicatorGroup) => {
    const current = read()
    write({ ...current, [key]: !current[key] })
  }, [])

  const setAll = useCallback((visible: boolean) => {
    const next = { ...read() }
    for (const k of Object.keys(next) as IndicatorGroup[]) {
      next[k] = visible
    }
    write(next)
  }, [])

  return { visibility, toggle, setAll }
}
