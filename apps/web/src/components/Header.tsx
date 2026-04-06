import { Link } from '@tanstack/react-router'
import { Activity } from 'lucide-react'
import ThemeToggle from './ThemeToggle'

export default function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-[var(--panel-border)] bg-[var(--panel)]">
      <nav className="page-wrap flex items-center gap-6 py-3">
        <Link
          to="/"
          className="flex items-center gap-2.5 no-underline"
        >
          <Activity className="h-4 w-4 text-[var(--accent)]" />
          <span className="text-xs font-bold tracking-[0.16em] text-[var(--muted-foreground)] uppercase">
            Trading bot
          </span>
          <span className="text-[var(--panel-border)]">/</span>
          <span className="text-sm font-semibold text-[var(--foreground)]">
            Execution dashboard
          </span>
        </Link>

        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </nav>
    </header>
  )
}
