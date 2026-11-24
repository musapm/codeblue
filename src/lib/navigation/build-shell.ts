import type { ShellNavSection } from '@/components/app-shell/app-shell'
import type { Dictionary } from '@/lib/i18n/get-dictionary'
import { filterNav, type AccessSnapshot, type NavSection } from './workspace-nav'

/** Turn the navigation model into serializable, translated props for the client shell. */
export function buildShellSections(
  sections: NavSection[],
  access: AccessSnapshot,
  basePath: string,
  labels: { sections: Record<string, string>; items: Record<string, string> },
  dict: Dictionary,
): ShellNavSection[] {
  return filterNav(sections, access).map((section) => ({
    key: section.key,
    label: labels.sections[section.key] ?? '',
    items: section.items.map((item) => ({
      key: item.key,
      href: item.segment ? `${basePath}/${item.segment}` : basePath,
      label: labels.items[item.key] ?? item.key,
      icon: item.icon,
      status: item.status,
      phase: item.phase,
      plannedLabel: item.status === 'planned' ? dict.common.plannedPhase(item.phase) : undefined,
    })),
  }))
}

export function shellLabels(dict: Dictionary, navigation: string) {
  return {
    navigation,
    openMenu: dict.common.openMenu,
    closeMenu: dict.common.closeMenu,
    language: dict.common.language,
    switchWorkspace: dict.workspace.switchWorkspace,
    account: dict.workspace.account,
    signedInAs: dict.workspace.signedInAs,
    signOut: dict.common.signOut,
    twoStep: dict.auth.twoStep.menu,
  }
}
