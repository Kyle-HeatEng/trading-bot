import { describe, expect, it } from 'vitest'
import { histogramData, lineData } from '#/components/trade-chart'

describe('trade chart data helpers', () => {
  it('preserves timestamps and emits whitespace points for missing line values', () => {
    const result = lineData([
      { time: 1_700_000_000_000, value: null },
      { time: 1_700_000_060_000, value: 42.5 },
    ])

    expect(result).toEqual([
      { time: 1_700_000_000 },
      { time: 1_700_000_060, value: 42.5 },
    ])
  })

  it('colors histogram bars by sign and keeps null values as whitespace', () => {
    const result = histogramData([
      { time: 1_700_000_000_000, value: null },
      { time: 1_700_000_060_000, value: 3.2 },
      { time: 1_700_000_120_000, value: -1.1 },
    ])

    expect(result).toEqual([
      { time: 1_700_000_000 },
      {
        time: 1_700_000_060,
        value: 3.2,
        color: 'rgba(53,208,127,0.8)',
      },
      {
        time: 1_700_000_120,
        value: -1.1,
        color: 'rgba(255,122,144,0.8)',
      },
    ])
  })
})
