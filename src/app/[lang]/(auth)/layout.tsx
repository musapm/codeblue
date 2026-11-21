import Link from 'next/link'
import { CircleCheck } from 'lucide-react'
import { Logo } from '@/components/brand/logo'
import { LanguageSwitcher } from '@/components/i18n/language-switcher'
import { localizedPath } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'

export default async function AuthLayout({ children }: LayoutProps<'/[lang]'>) {
  const { locale, dict } = await getI18n()

  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <aside className="relative hidden overflow-hidden bg-secondary p-10 text-secondary-foreground lg:flex lg:flex-col">
        <div
          aria-hidden
          className="pointer-events-none absolute -end-24 -bottom-24 size-[28rem] rounded-full border-[56px] border-white/5"
        />
        <Link href={localizedPath(locale, '/')} className="relative w-fit rounded-md">
          <Logo inverted />
        </Link>
        <div className="relative mt-auto max-w-md space-y-6">
          <h2 className="text-2xl font-semibold tracking-tight">{dict.auth.sidePanelTitle}</h2>
          <ul className="space-y-3">
            {dict.auth.sidePanelPoints.map((point) => (
              <li key={point} className="flex items-start gap-3 text-sm opacity-90">
                <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-accent" />
                {point}
              </li>
            ))}
          </ul>
        </div>
      </aside>

      <div className="flex flex-col">
        <header className="flex h-16 items-center justify-between px-5 sm:px-8">
          <Link href={localizedPath(locale, '/')} className="rounded-md lg:invisible">
            <Logo />
          </Link>
          <LanguageSwitcher locale={locale} label={dict.common.language} />
        </header>
        <main id="main" className="flex flex-1 items-center justify-center px-5 pt-6 pb-16 sm:px-8">
          {children}
        </main>
      </div>
    </div>
  )
}
