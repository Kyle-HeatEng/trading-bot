export default function Footer() {
  const year = new Date().getFullYear()

  return (
    <footer className="mt-10 border-t border-[var(--panel-border)] px-4 pb-10 pt-6 text-[var(--muted-foreground)]">
      <div className="page-wrap flex flex-col items-center justify-between gap-3 text-center sm:flex-row sm:text-left">
        <p className="m-0 text-sm">
          &copy; {year} Trading bot dashboard.
        </p>
        <p className="m-0 text-sm">
          Live market data from SQLite, UI built with TanStack Start.
        </p>
      </div>
    </footer>
  )
}
