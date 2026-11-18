"use client";

/* eslint-disable @next/next/no-img-element -- champion portraits use Riot Data Dragon */
import { championAssetId, championImageUrl } from "./champion-assets";
import { roleLabel, type ChampionRoles } from "./champion-roles";
import type { DraftSelection, DraftSide } from "./draft-agent";
import { buildDraftPositionBoard } from "./draft-position-board";
import type { OpponentTeam } from "./radar-types";
import { ROSTER_ROLES, type RosterRole } from "./roster-scenario";
import "./draft-position-stack.css";

export type DraftPositionStackProps = {
  team: OpponentTeam | null;
  side: DraftSide;
  selections: DraftSelection[];
  staged: DraftSelection | null;
  assignments: ChampionRoles;
  unassigned?: string[];
  disabled: boolean;
  nameOf: (id: string) => string;
  onAssign: (championId: string, role: RosterRole | null) => void;
  onConfirm: () => void;
  onInspect: (selection: DraftSelection) => void;
  inspected: DraftSelection | null;
};

export function DraftPositionStack({ team, side, selections, staged, assignments, unassigned, disabled, nameOf, onAssign, onConfirm, onInspect, inspected }: DraftPositionStackProps) {
  const board = buildDraftPositionBoard({ team, side, selections, assignments, unassigned });
  const sideLabel = side === "BLUE" ? "블루" : "레드";
  const ordinal = (selection: DraftSelection) => `${selection.side === "BLUE" ? "B" : "R"}${selection.slot}`;
  const preview = staged?.side === side && staged.kind === "PICK" ? staged : null;

  function card(selection: DraftSelection, role: RosterRole | null, source: "ASSIGNED" | "SUGGESTED" | "EMPTY", observedRoles: RosterRole[]) {
    const id = championAssetId(selection.champion_id);
    const selected = inspected?.side === selection.side && inspected.kind === selection.kind && inspected.slot === selection.slot && inspected.turn === selection.turn && championAssetId(inspected.champion_id) === id;
    return <article className="filled" key={id} data-champion-id={id} data-turn={selection.turn} data-slot={selection.slot}>
      <b>{ordinal(selection)}</b>
      <img src={championImageUrl(id)} alt="" width={44} height={44} />
      <div className="draft-position-copy">
        <strong>{nameOf(id)}</strong>
        <span>{role ? `${roleLabel[role]} · ${source === "ASSIGNED" ? "배정" : "관측 제안"}` : "미배정"}</span>
        {observedRoles.length > 0 && <span>관측: {observedRoles.map((item) => roleLabel[item]).join(" · ")}</span>}
      </div>
      <div className="draft-position-controls">
        <select aria-label={`${sideLabel} ${nameOf(id)} 포지션`} value={role ?? ""} disabled={disabled} onChange={(event) => onAssign(id, event.target.value === "" ? null : event.target.value as RosterRole)}>
          <option value="">미배정</option>
          {ROSTER_ROLES.map((item) => <option key={item} value={item}>{roleLabel[item]}</option>)}
        </select>
        <button type="button" aria-label={`${sideLabel} ${ordinal(selection)} ${nameOf(id)} 상세 보기`} aria-pressed={selected} onClick={() => onInspect(selection)}>상세</button>
      </div>
    </article>;
  }

  return <div className="draft-pick-stack draft-position-board" aria-label={`${sideLabel} 포지션 배정`} lang="ko">
    <p className="draft-position-hint">관측 제안은 확정 배정이 아닙니다. 포지션을 검토한 뒤 확정하세요. 배정은 현재 연습에만 유지됩니다.</p>
    {ROSTER_ROLES.map((role) => {
      const position = board.positions.find((item) => item.role === role);
      return position?.selection
        ? card(position.selection, role, position.source, position.observed_roles)
        : <article className="draft-position-empty" key={role} aria-label={`${roleLabel[role]} 빈 슬롯`}><b>{roleLabel[role]}</b><div><strong>{roleLabel[role]}</strong><span>확정 PICK 배정 대기</span></div></article>;
    })}
    {board.unassigned.length > 0 && <section className="draft-position-unassigned" aria-label={`${sideLabel} 미배정 PICK`}>
      <h3>미배정 PICK</h3>
      {board.unassigned.map(({ selection, observed_roles }) => card(selection, null, "EMPTY", observed_roles))}
    </section>}
    {preview && <article className="staged" aria-label={`${sideLabel} 선택 미리보기`}>
      <b>{ordinal(preview)}</b><img src={championImageUrl(preview.champion_id)} alt="" width={44} height={44} />
      <div><strong>{nameOf(preview.champion_id)}</strong><span>선택 미리보기 · PICK 미확정</span></div>
    </article>}
    <button className="draft-position-confirm" type="button" disabled={disabled || !board.canConfirm} onClick={onConfirm}>{sideLabel} 포지션 확정</button>
  </div>;
}
