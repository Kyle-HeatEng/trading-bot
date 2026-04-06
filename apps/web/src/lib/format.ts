const usdFormatter = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const compactUsdFormatter = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 2,
})

const percentFormatter = new Intl.NumberFormat('en-GB', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const btcFormatter = new Intl.NumberFormat('en-GB', {
  minimumFractionDigits: 5,
  maximumFractionDigits: 5,
})

const dateTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
})

export function formatUsd(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) {
    return '—'
  }

  return usdFormatter.format(value)
}

export function formatUsdCompact(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) {
    return '—'
  }

  return compactUsdFormatter.format(value)
}

export function formatSignedUsd(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) {
    return '—'
  }

  const sign = value > 0 ? '+' : ''
  return `${sign}${formatUsd(value)}`
}

export function formatPercent(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) {
    return '—'
  }

  return `${percentFormatter.format(value)}%`
}

export function formatSignedPercent(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) {
    return '—'
  }

  const sign = value > 0 ? '+' : ''
  return `${sign}${formatPercent(value)}`
}

export function formatBtc(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) {
    return '—'
  }

  return `${btcFormatter.format(value)} BTC`
}

export function formatDateTime(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) {
    return '—'
  }

  return dateTimeFormatter.format(value)
}

export function formatCompactNumber(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) {
    return '—'
  }

  return new Intl.NumberFormat('en-GB', {
    notation: 'compact',
    maximumFractionDigits: 2,
  }).format(value)
}
