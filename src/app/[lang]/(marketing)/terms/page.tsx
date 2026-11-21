import { LegalPage } from '@/components/marketing/legal-page'
import { getMarketingContent } from '@/content/marketing'
import { getLocale } from '@/lib/i18n/server'
import { marketingMetadata } from '@/lib/marketing/metadata'

export const generateMetadata = () => marketingMetadata('terms', '/terms')

export default async function TermsPage() {
  const content = getMarketingContent(await getLocale())
  return <LegalPage title={content.terms.title} sections={content.terms.sections} legal={content.legal} />
}
