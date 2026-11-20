import { useMemo } from "react";
import { roleLabel } from "./champion-roles";
import type { DraftSide } from "./draft-agent";
import type { OpponentTeam, RadarReport } from "./radar-types";
import type { LiveRoster } from "./roster-comparison";
import { ROSTER_ROLES } from "./roster-scenario";
import { buildSimulationExample, EXAMPLE_BANS } from "./simulation-example";
import "./simulation-example.css";

type SimulationExamplePanelProps = {
  report: RadarReport;
  blueTeam: OpponentTeam | null;
  redTeam: OpponentTeam | null;
  firstPickSide: DraftSide;
  roster: LiveRoster | null;
  hasHistoricalPlayers: boolean;
  nameOf: (championId: string) => string;
  /** From exampleBlockReason (same check the parent handler repeats); null = may apply. */
  blockReason: string | null;
  onApply: () => void;
};

/**
 * Collapsed "try with an example" section. Read-only preview of the authored example on the
 * current teams and unchanged roster; the button only asks the parent to apply it to an empty first
 * set. Nothing is run: the user starts the experiment themselves after the readiness check.
 */
export function SimulationExamplePanel({ report, blueTeam, redTeam, firstPickSide, roster, hasHistoricalPlayers, nameOf, blockReason, onApply }: SimulationExamplePanelProps) {
  const example = useMemo(() => buildSimulationExample({ report, blueTeam, redTeam, firstPickSide, roster, hasHistoricalPlayers }),
    [report, blueTeam, redTeam, firstPickSide, roster, hasHistoricalPlayers]);
  const reason = example.ok ? blockReason : example.message;
  return (
    <details className="simulation-example" lang="ko">
      <summary>처음이라면 예시로 체험</summary>
      <p className="simulation-example-note">예시의 밴픽·포지션 배정을 사용하며 실제 경기나 팀 전략이 아닙니다. 선수 구성은 바꾸지 않고 실험은 직접 실행합니다.</p>
      {example.ok && (
        <div className="simulation-example-teams">
          {(["BLUE", "RED"] as const).map((side) => {
            const team = example.snapshot.draft.teams[side];
            const slots = example.snapshot.draft.roster.teams[team.id];
            return (
              <section key={side} className="simulation-example-team" aria-label={`${side} ${team.name}`}>
                <h4>{side} · {team.name}</h4>
                <ul>
                  {ROSTER_ROLES.map((role) => (
                    <li key={role}><span>{roleLabel[role]}</span><b>{nameOf(example.roles[team.id][role])}</b><span>{slots[role]?.player_name ?? "—"}</span></li>
                  ))}
                </ul>
                <p className="simulation-example-bans">밴: {EXAMPLE_BANS[side].map(nameOf).join(", ")}</p>
              </section>
            );
          })}
        </div>
      )}
      {reason && <p className="simulation-example-reason" role="status">{reason}</p>}
      <button type="button" className="simulation-example-apply" disabled={Boolean(reason)} onClick={onApply}>이 예시로 입력 준비</button>
    </details>
  );
}
