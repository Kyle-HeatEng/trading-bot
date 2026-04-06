import { useEffect, useState } from 'react'
import type { DashboardRealtimeMarket } from '#/lib/dashboard'

const KRAKEN_WS_URL = 'wss://ws.kraken.com'
const KRAKEN_PAIR = 'XBT/USD'
const STALE_AFTER_MS = 15_000
const RECONNECT_DELAY_MS = 1_500

type KrakenTickerMessage = {
  c?: [string, string]
}

function isTickerMessage(value: unknown): value is [number, KrakenTickerMessage, string, string] {
  return Array.isArray(value) && value.length >= 4 && typeof value[2] === 'string'
}

export function useKrakenMarket() {
  const [market, setMarket] = useState<DashboardRealtimeMarket | null>(null)

  useEffect(() => {
    let socket: WebSocket | null = null
    let reconnectTimer: number | null = null
    let staleTimer: number | null = null
    let isClosed = false

    const clearTimers = () => {
      if (reconnectTimer != null) {
        window.clearTimeout(reconnectTimer)
      }
      if (staleTimer != null) {
        window.clearTimeout(staleTimer)
      }
      reconnectTimer = null
      staleTimer = null
    }

    const armStaleTimer = () => {
      if (staleTimer != null) {
        window.clearTimeout(staleTimer)
      }
      staleTimer = window.setTimeout(() => {
        setMarket((current) => {
          if (!current) {
            return current
          }
          if (Date.now() - current.updatedAt < STALE_AFTER_MS) {
            return current
          }
          return null
        })
      }, STALE_AFTER_MS)
    }

    const connect = () => {
      socket = new WebSocket(KRAKEN_WS_URL)

      socket.addEventListener('open', () => {
        socket?.send(
          JSON.stringify({
            event: 'subscribe',
            pair: [KRAKEN_PAIR],
            subscription: { name: 'ticker' },
          }),
        )
      })

      socket.addEventListener('message', (event) => {
        const parsed = JSON.parse(event.data as string) as unknown
        if (!isTickerMessage(parsed)) {
          return
        }

        const channelName = parsed[2]
        const pair = parsed[3]
        if (channelName !== 'ticker' || pair !== KRAKEN_PAIR) {
          return
        }

        const lastTradePrice = Number.parseFloat(parsed[1]?.c?.[0] ?? '')
        if (!Number.isFinite(lastTradePrice) || lastTradePrice <= 0) {
          return
        }

        setMarket({
          price: lastTradePrice,
          updatedAt: Date.now(),
        })
        armStaleTimer()
      })

      socket.addEventListener('close', () => {
        if (isClosed) {
          return
        }
        reconnectTimer = window.setTimeout(connect, RECONNECT_DELAY_MS)
      })

      socket.addEventListener('error', () => {
        socket?.close()
      })
    }

    connect()

    return () => {
      isClosed = true
      clearTimers()
      socket?.close()
    }
  }, [])

  return market
}
