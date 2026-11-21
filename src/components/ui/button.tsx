import { Slot } from 'radix-ui'
import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

const VARIANTS = {
  primary: 'bg-primary text-primary-foreground shadow-sm hover:bg-primary-hover',
  secondary: 'border border-input bg-background text-foreground shadow-xs hover:bg-muted',
  subtle: 'bg-primary-subtle text-primary-subtle-foreground hover:bg-primary-subtle/70',
  ghost: 'text-foreground hover:bg-muted',
  inverse: 'bg-white text-secondary shadow-sm hover:bg-white/90',
  danger: 'bg-danger text-white shadow-sm hover:bg-danger/90',
  link: 'text-primary underline-offset-4 hover:underline px-0 h-auto',
} as const

const SIZES = {
  sm: 'h-8 gap-1.5 rounded-md px-3 text-sm',
  md: 'h-10 gap-2 rounded-lg px-4 text-sm',
  lg: 'h-12 gap-2 rounded-lg px-6 text-base',
  icon: 'size-10 rounded-lg',
} as const

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof VARIANTS
  size?: keyof typeof SIZES
  /** Render the child element (e.g. a Link) with button styling. */
  asChild?: boolean
}

export function buttonClasses({ variant = 'primary', size = 'md', className }: Pick<ButtonProps, 'variant' | 'size' | 'className'> = {}) {
  return cn(
    'inline-flex shrink-0 cursor-pointer items-center justify-center font-medium whitespace-nowrap transition-colors select-none',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
    'disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50',
    '[&_svg]:size-4 [&_svg]:shrink-0',
    VARIANTS[variant],
    variant !== 'link' && SIZES[size],
    className,
  )
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, asChild = false, className, type, ...props },
  ref,
) {
  const Comp = asChild ? Slot.Root : 'button'
  return (
    <Comp
      ref={ref}
      // Default to type="button" so buttons inside forms never submit by accident.
      type={asChild ? undefined : (type ?? 'button')}
      className={buttonClasses({ variant, size, className })}
      {...props}
    />
  )
})
