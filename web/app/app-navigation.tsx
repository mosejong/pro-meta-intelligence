"use client";

import { productSpaceHref, type ProductSpace } from "./product-space";
import "./app-navigation.css";
import { MenuIcon } from "./menu-icon";
import { useLocale, type MessageKey } from "./locale";

// The home page is the mock draft studio, so "밴픽" covers both "/" and "/draft/".
const destinations = [
  { space: "DRAFT", label: "nav.draft" },
  { space: "TEAM", label: "nav.team" },
  { space: "RADAR", label: "nav.radar" },
] as const satisfies ReadonlyArray<{ space: ProductSpace; label: MessageKey }>;

const allSpaces: Array<{ space: ProductSpace; label: MessageKey }> = [
  { space: "DRAFT", label: "space.DRAFT" },
  { space: "TEAM", label: "space.TEAM" },
  { space: "RADAR", label: "space.RADAR" },
  { space: "CREATOR", label: "space.CREATOR" },
  { space: "PROOF", label: "space.PROOF" },
];

const isDraftSpace = (space: ProductSpace) => space === "ONBOARDING" || space === "DRAFT";
const isCurrent = (current: ProductSpace, target: ProductSpace) =>
  (current === "T1" ? "TEAM" : current) === target || (target === "DRAFT" && isDraftSpace(current));
// On the home page the draft link stays on "./"; elsewhere it points at /draft/.
const hrefFor = (current: ProductSpace, target: ProductSpace) =>
  productSpaceHref(current, target === "DRAFT" && current === "ONBOARDING" ? "ONBOARDING" : target);

export function AppNavigation({ currentSpace }: { currentSpace: ProductSpace }) {
  const { t } = useLocale();
  return <nav className="app-bottom-navigation" aria-label={t("nav.label")}>
    {destinations.map((item) => <a key={item.space} href={hrefFor(currentSpace, item.space)} aria-current={isCurrent(currentSpace, item.space) ? "page" : undefined}><MenuIcon name={item.space} /><strong>{t(item.label)}</strong></a>)}
    <details className="app-nav-more">
      <summary><MenuIcon name="MENU" /><strong>{t("nav.more")}</strong></summary>
      <ul aria-label={t("nav.moreLabel")}>
        {allSpaces.map((item) => <li key={item.space}><a href={hrefFor(currentSpace, item.space)} aria-current={isCurrent(currentSpace, item.space) ? "page" : undefined}>{t(item.label)}</a></li>)}
      </ul>
    </details>
  </nav>;
}
