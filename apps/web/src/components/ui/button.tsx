import type { ButtonHTMLAttributes } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '#/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 text-xs font-bold tracking-[0.1em] uppercase transition outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)] disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default:
          'bg-[var(--accent)] px-4 py-2 text-white hover:bg-[var(--accent-strong)]',
        secondary:
          'border border-[var(--panel-border)] bg-[var(--panel-subtle)] px-4 py-2 text-[var(--foreground)] hover:bg-[var(--panel-hover)]',
        ghost:
          'px-3 py-2 text-[var(--muted-foreground)] hover:bg-[var(--panel-hover)] hover:text-[var(--foreground)]',
      },
      size: {
        default: 'h-9',
        sm: 'h-7 px-3',
        lg: 'h-11 px-5',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function Button({
  className,
  variant,
  size,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
}
