import type { HTMLAttributes } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '#/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold tracking-[0.12em] uppercase',
  {
    variants: {
      variant: {
        neutral:
          'border border-[var(--panel-border)] bg-[var(--panel-subtle)] text-[var(--muted-foreground)]',
        success:
          'border border-[rgba(34,197,94,0.3)] bg-[rgba(34,197,94,0.08)] text-[var(--profit)]',
        danger:
          'border border-[rgba(239,68,68,0.3)] bg-[rgba(239,68,68,0.08)] text-[var(--loss)]',
        accent:
          'border border-[rgba(59,125,255,0.3)] bg-[rgba(59,125,255,0.08)] text-[var(--accent-soft)]',
      },
    },
    defaultVariants: {
      variant: 'neutral',
    },
  },
)

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}
