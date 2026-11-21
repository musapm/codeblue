import 'server-only'
import { notFound } from 'next/navigation'
import { lang } from 'next/root-params'
import { isLocale, type Locale } from './config'
import { getDictionary } from './get-dictionary'

/** Current locale from the `[lang]` root segment (Server Components only). */
export async function getLocale(): Promise<Locale> {
  const value = await lang()
  if (!isLocale(value)) notFound()
  return value
}

/** Locale + dictionary for the current request. */
export async function getI18n() {
  const locale = await getLocale()
  return { locale, dict: getDictionary(locale) }
}
