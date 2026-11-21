import { Logo } from '@/components/brand/logo'
import { SiteFooter } from '@/components/marketing/site-footer'
import { SiteHeader } from '@/components/marketing/site-header'
import { localizedPath } from '@/lib/i18n/config'
import { getI18n } from '@/lib/i18n/server'
import { getCopyrightYear } from '@/lib/time'

export default async function MarketingLayout({ children }: LayoutProps<'/[lang]'>) {
  const { locale, dict } = await getI18n()
  const year = await getCopyrightYear()
  const p = (path: string) => localizedPath(locale, path)

  const items = [
    { href: p('/product'), label: dict.nav.product },
    { href: p('/features'), label: dict.nav.features },
    { href: p('/solutions'), label: dict.nav.solutions },
    { href: p('/pricing'), label: dict.nav.pricing },
    { href: p('/demo'), label: dict.nav.demo },
    { href: p('/about'), label: dict.nav.about },
  ]

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader
        locale={locale}
        logo={<Logo />}
        items={items}
        labels={{
          main: dict.nav.main,
          signIn: dict.common.signIn,
          requestDemo: dict.common.requestDemo,
          language: dict.common.language,
          openMenu: dict.common.openMenu,
          closeMenu: dict.common.closeMenu,
        }}
      />
      <main id="main" className="flex-1">
        {children}
      </main>
      <SiteFooter locale={locale} dict={dict} year={year} />
    </div>
  )
}
