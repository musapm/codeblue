'use client'

import { Eye, EyeOff } from 'lucide-react'
import { forwardRef, useState, type InputHTMLAttributes } from 'react'
import { Input } from '@/components/ui/input'

type Props = InputHTMLAttributes<HTMLInputElement> & { showLabel: string; hideLabel: string }

export const PasswordInput = forwardRef<HTMLInputElement, Props>(function PasswordInput({ showLabel, hideLabel, ...props }, ref) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="relative">
      <Input ref={ref} type={visible ? 'text' : 'password'} dir="ltr" className="pe-11" {...props} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-pressed={visible}
        aria-label={visible ? hideLabel : showLabel}
        disabled={props.disabled}
        className="absolute inset-y-0 end-0 flex w-10 items-center justify-center rounded-e-lg text-muted-foreground hover:text-foreground disabled:opacity-50"
      >
        {visible ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
      </button>
    </div>
  )
})
