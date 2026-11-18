"use client";

import type { ReactNode } from "react";
import { useLocale, type MessageKey } from "./locale";
import { productSpaceHref, type ProductSpace } from "./product-space";
import "./workspace-header.css";

const resources = ["TEAM", "RADAR", "CREATOR", "PROOF"] as const;

/** Shared navigation; page-specific controls stay mounted in the action slot. */
export function WorkspaceHeader({ currentSpace, children }: { currentSpace: ProductSpace; children?: ReactNode }) {
  const { locale, t } = useLocale();
  const current = currentSpace === "T1" ? "TEAM" : currentSpace;
  const isDraft = current === "DRAFT" || current === "ONBOARDING";
  const spaceLabel = (space: ProductSpace) => t(`space.${space}` as MessageKey);
  const research = locale === "ko" ? "연구 자료" : "研究资料";
  const note = locale === "ko" ? "상대 분석·메타·검증 자료" : "对手分析、版本趋势与验证资料";
  return <header className="workspace-header" lang={locale}>
    <a className="workspace-brand" href={productSpaceHref(currentSpace, "ONBOARDING")} aria-label={t("draft.brandLabel")}>
      <span className="workspace-brand-mark">PM</span><span><strong>PRO META</strong><small>INTELLIGENCE</small></span>
    </a>
    <nav className="workspace-navigation" aria-label={t("draft.pagesLabel")}>
      <a className="workspace-primary" href={productSpaceHref(currentSpace, current === "ONBOARDING" ? "ONBOARDING" : "DRAFT")} aria-current={isDraft ? "page" : undefined}>{t("space.DRAFT")}</a>
      <details className="workspace-resources" data-active={!isDraft ? "true" : undefined}>
        <summary>{research}{!isDraft && <span className="workspace-current"> · {spaceLabel(current)}</span>}</summary>
        <div className="workspace-resource-menu">
          <p>{note}</p>
          {resources.map((space) => <a key={space} href={productSpaceHref(currentSpace, space)} aria-current={current === space ? "page" : undefined}>{spaceLabel(space)}</a>)}
        </div>
      </details>
    </nav>
    {children && <div className="workspace-actions">{children}</div>}
  </header>;
}
