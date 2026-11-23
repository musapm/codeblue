'use client'

import { useEffect, useRef, useState } from 'react'
import { publicEnv } from '@/lib/env/public'

/**
 * Cloudflare Turnstile challenge for forms that create a Supabase Auth session (sign-in,
 * sign-up, password reset, anonymous visitor sessions). Renders nothing unless
 * NEXT_PUBLIC_TURNSTILE_SITE_KEY is set. The token goes into a hidden `captchaToken` field;
 * Supabase Auth verifies it when CAPTCHA protection is enabled there (docs/authentication.md).
 *
 * Tokens are single-use: change `resetKey` (e.g. pass the action state) to get a fresh one
 * after a failed submission.
 */

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string
  reset: (id: string) => void
  remove: (id: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
let scriptPromise: Promise<void> | null = null

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve()
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = SCRIPT_SRC
      script.async = true
      script.onload = () => resolve()
      script.onerror = () => {
        scriptPromise = null
        reject(new Error('turnstile script failed'))
      }
      document.head.appendChild(script)
    })
  }
  return scriptPromise
}

export function TurnstileField({ locale, resetKey, onToken }: { locale: string; resetKey?: unknown; onToken?: (token: string) => void }) {
  const siteKey = publicEnv.turnstileSiteKey
  const container = useRef<HTMLDivElement>(null)
  const widget = useRef<string | null>(null)
  const callback = useRef(onToken)
  const [token, setToken] = useState('')

  useEffect(() => {
    callback.current = onToken
  }, [onToken])

  useEffect(() => {
    if (!siteKey || !container.current) return
    let cancelled = false
    loadScript()
      .then(() => {
        if (cancelled || !container.current || !window.turnstile) return
        widget.current = window.turnstile.render(container.current, {
          sitekey: siteKey,
          language: locale,
          callback: (t: string) => {
            setToken(t)
            callback.current?.(t)
          },
          'expired-callback': () => setToken(''),
          'error-callback': () => setToken(''),
        })
      })
      .catch(() => setToken(''))
    return () => {
      cancelled = true
      if (widget.current && window.turnstile) window.turnstile.remove(widget.current)
      widget.current = null
    }
  }, [siteKey, locale])

  useEffect(() => {
    if (resetKey === undefined || !widget.current || !window.turnstile) return
    window.turnstile.reset(widget.current)
    setToken('')
  }, [resetKey])

  if (!siteKey) return null
  return (
    <div>
      <div ref={container} />
      <input type="hidden" name="captchaToken" value={token} />
    </div>
  )
}
