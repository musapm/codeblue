import { LegalPage } from '@/components/marketing/legal-page'
import { getMarketingContent } from '@/content/marketing'
import { getLocale } from '@/lib/i18n/server'
import { marketingMetadata } from '@/lib/marketing/metadata'

export const generateMetadata = () => marketingMetadata('privacy', '/privacy')

export default async function PrivacyPage() {
  const content = getMarketingContent(await getLocale())
  return <LegalPage title={content.privacy.title} sections={content.privacy.sections} legal={content.legal} />
}
