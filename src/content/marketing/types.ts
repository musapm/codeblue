export type MarketingPageKey = 'home' | 'product' | 'features' | 'solutions' | 'pricing' | 'demo' | 'about' | 'contact' | 'privacy' | 'terms'

type Item = { title: string; body: string }

export type MarketingContent = {
  meta: Record<MarketingPageKey, { title: string; description: string }>
  home: {
    eyebrow: string
    title: string
    subtitle: string
    primaryCta: string
    secondaryCta: string
    preview: {
      label: string
      universityName: string
      assistantName: string
      question: string
      answer: string
      citationTitle: string
      citationMeta: string
      escalation: string
    }
    pillarsHeading: string
    pillars: Item[]
    agentsHeading: string
    agentsSubheading: string
    agents: (Item & { key: 'student' | 'admissions' | 'academic' | 'staff' | 'workflow' | 'campus' })[]
    howHeading: string
    howSteps: Item[]
    trustHeading: string
    trustBody: string
    trustItems: Item[]
    ctaTitle: string
    ctaBody: string
  }
  product: { title: string; intro: string; sections: (Item & { points: string[] })[] }
  features: { title: string; intro: string; groups: { title: string; items: Item[] }[] }
  solutions: { title: string; intro: string; audiences: (Item & { outcomes: string[] })[] }
  pricing: {
    title: string
    intro: string
    plans: { name: string; audience: string; features: string[]; highlighted?: boolean }[]
    priceLabel: string
    cta: string
    note: string
    faqHeading: string
    faq: { q: string; a: string }[]
  }
  demo: {
    title: string
    intro: string
    stepsHeading: string
    steps: Item[]
    whiteLabelHeading: string
    whiteLabelBody: string
    whiteLabelSwitch: string
    whiteLabelNote: string
  }
  about: { title: string; intro: string; principlesHeading: string; principles: Item[]; statusHeading: string; statusBody: string }
  contact: { title: string; intro: string; sideHeading: string; sidePoints: string[]; emailLabel: string }
  legal: { draftNotice: string; updatedLabel: string; updated: string }
  privacy: { title: string; sections: Item[] }
  terms: { title: string; sections: Item[] }
}
