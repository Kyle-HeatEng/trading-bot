import { useEffect, useState } from 'react'
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { LiveStrip } from '#/components/live-strip'
import { TradeChart } from '#/components/trade-chart'
import { TradeList } from '#/components/trade-list'
import {
  applyRealtimeMarket,
  type DashboardIndicatorHighlightKey,
  type DashboardSnapshot,
} from '#/lib/dashboard'
import { useKrakenMarket } from '#/lib/use-kraken-market'

const getDashboardSnapshot = createServerFn({ method: 'GET' }).handler(
  async () => {
    const { readDashboardSnapshot } = await import('#/server/dashboard')
    return readDashboardSnapshot()
  },
)

function dashboardQueryOptions() {
  return queryOptions({
    queryKey: ['dashboard'],
    queryFn: () => getDashboardSnapshot(),
    staleTime: 10_000,
    refetchInterval: 15_000,
  })
}

export const Route = createFileRoute('/')({
  loader: ({ context }) => context.queryClient.ensureQueryData(dashboardQueryOptions()),
  component: App,
})

function App() {
  const { data } = useSuspenseQuery(dashboardQueryOptions())
  const realtimeMarket = useKrakenMarket()
  const snapshot = applyRealtimeMarket(data as DashboardSnapshot, realtimeMarket)
  const [selectedTradeId, setSelectedTradeId] = useState<number | 'all'>('all')
  const [highlightedIndicator, setHighlightedIndicator] =
    useState<DashboardIndicatorHighlightKey | null>(null)

  useEffect(() => {
    if (snapshot.trades.length === 0) {
      if (selectedTradeId !== 'all') {
        setSelectedTradeId('all')
      }
      return
    }

    if (selectedTradeId === 'all') {
      return
    }

    if (!snapshot.trades.some((trade) => trade.id === selectedTradeId)) {
      setSelectedTradeId('all')
    }
  }, [selectedTradeId, snapshot.trades])

  return (
    <main className="page-wrap px-4 pb-10 pt-6">
      <section className="space-y-4">
        <LiveStrip
          snapshot={snapshot}
          highlightedIndicator={highlightedIndicator}
          onIndicatorHover={setHighlightedIndicator}
        />

        <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
          <TradeList
            trades={snapshot.trades}
            stats={snapshot.stats}
            selectedTradeId={selectedTradeId}
            onSelect={setSelectedTradeId}
          />
          <TradeChart
            candles={snapshot.candles}
            indicators={snapshot.indicators}
            trades={snapshot.trades}
            focusedTradeId={selectedTradeId}
            highlightedIndicator={highlightedIndicator}
          />
        </div>
      </section>
    </main>
  )
}
