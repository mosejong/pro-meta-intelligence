"""Deterministic Creator Mode packets grounded only in Meta Radar facts."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True, slots=True)
class CreatorBrief:
    payload: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return self.payload

    def to_json(self, *, indent: int = 2) -> str:
        return json.dumps(self.payload, ensure_ascii=False, indent=indent, sort_keys=True) + "\n"


class CreatorBriefBuilder:
    """Turn eligible radar entries into claim-locked narrative briefs without an LLM."""

    template_version = "creator-brief-v1"

    def build(self, report: dict[str, Any], *, top_k: int = 3) -> CreatorBrief:
        if top_k < 1:
            raise ValueError("top_k must be positive")
        self._validate_report(report)
        entries = [entry for entry in report["entries"] if entry["eligible_for_review"]][:top_k]
        source_versions = report["evidence_index"]["source_versions"]
        warnings = [] if entries else ["NO_ELIGIBLE_CANDIDATES"]
        payload = {
            "schema_version": "1",
            "mode": "CREATOR",
            "template_version": self.template_version,
            "human_review_required": True,
            "publication_ready": False,
            "source_snapshot": {
                "radar_schema_version": report["schema_version"],
                "cutoff": report["cutoff"],
                "patch_id": report["patch_id"],
                "fixture_only": report["fixture_only"],
                "source_versions": source_versions,
            },
            "warnings": warnings,
            "narrative_constraints": [
                "do not introduce facts absent from approved_claims",
                "preserve every number and time window exactly",
                "distinguish adoption patterns from champion strength or causality",
                "include the counterpoint before the takeaway",
                "retain evidence event IDs and source hashes in the final source list",
                "require human approval before publication",
            ],
            "topic_candidates": [self._candidate(report, entry) for entry in entries],
            "ai_handoff": {
                "status": "OPTIONAL_DRAFTING_ONLY",
                "allowed_operations": [
                    "rephrase approved claims",
                    "expand the approved chapter outline",
                    "translate while preserving claim meaning and numbers",
                ],
                "forbidden_operations": [
                    "invent new evidence",
                    "claim causality or champion strength",
                    "remove counterpoints or sample warnings",
                    "publish without human review",
                ],
            },
        }
        return CreatorBrief(payload)

    def _candidate(self, report: dict[str, Any], entry: dict[str, Any]) -> dict[str, Any]:
        metrics = entry["metrics"]
        champion = entry["champion_id"]
        role = entry["role"]
        days = report["windows"]["recent"]["days"]
        region = metrics["most_divergent_region"]
        region_delta = metrics["most_divergent_region_delta"]
        candidate_id = f"{champion}:{role}"
        claims = [
            {
                "claim_id": f"{candidate_id}:pick-presence",
                "text": (
                    f"최근 {days}일 {champion} {role} 픽 점유율은 "
                    f"{_percent(metrics['current_pick_presence'])}이며 이전 구간 대비 "
                    f"{_points(metrics['pick_presence_delta'])} 변했다."
                ),
                "metric": "pick_presence_delta",
                "value": metrics["pick_presence_delta"],
            },
            {
                "claim_id": f"{candidate_id}:team-demand",
                "text": (
                    f"최근 채택 팀은 {metrics['current_distinct_team_count']}개이며 팀 수요는 "
                    f"이전 구간 대비 {_points(metrics['demand_velocity'])} 변했다."
                ),
                "metric": "demand_velocity",
                "value": metrics["demand_velocity"],
            },
        ]
        if region is not None and region_delta is not None:
            claims.append(
                {
                    "claim_id": f"{candidate_id}:regional-divergence",
                    "text": (
                        f"{region}의 최근 픽 점유율은 글로벌 점유율과 "
                        f"{_points(region_delta)} 차이가 난다."
                    ),
                    "metric": "most_divergent_region_delta",
                    "value": region_delta,
                }
            )

        counterpoint = _counterpoint(metrics)
        title_candidates = [
            f"왜 지금 {champion} {role}인가: {_points(metrics['pick_presence_delta'])} 변화의 근거",
            f"{champion} {role}은 진짜 신호일까? 데이터와 반론",
        ]
        if region is not None and region_delta is not None:
            title_candidates.insert(
                1,
                f"{region}에서 먼저 보인 {champion} {role}, 글로벌과 {_points(region_delta)} 차이",
            )

        return {
            "candidate_id": candidate_id,
            "radar_rank": entry["rank"],
            "champion_id": champion,
            "role": role,
            "title_candidates": title_candidates,
            "thumbnail_copy": [f"{champion} {role}", _points(metrics["pick_presence_delta"])],
            "hook": (
                f"{champion} {role}의 픽 점유율과 채택 팀 수가 같은 구간에서 움직였습니다. "
                "이 신호가 검토할 가치가 있는지 근거와 반론을 함께 보겠습니다."
            ),
            "approved_claims": claims,
            "counterpoint": counterpoint,
            "falsifiers": [
                {
                    "metric": "demand_velocity",
                    "condition": "next comparable snapshot is less than or equal to zero",
                },
                {
                    "metric": "current_distinct_team_count",
                    "condition": "adoption does not expand beyond the currently observed teams",
                },
            ],
            "chapter_outline": [
                {"chapter": "HOOK", "uses": [claims[0]["claim_id"]]},
                {"chapter": "WHAT CHANGED", "uses": [claim["claim_id"] for claim in claims]},
                {"chapter": "WHY IT MAY MATTER", "uses": [claims[1]["claim_id"]]},
                {"chapter": "COUNTERPOINT", "uses": []},
                {"chapter": "TAKEAWAY AND NEXT CHECK", "uses": []},
            ],
            "data_cards": [
                {
                    "card": "PICK_PRESENCE_COMPARISON",
                    "current": metrics["current_pick_presence"],
                    "prior": metrics["prior_pick_presence"],
                },
                {
                    "card": "TEAM_DEMAND_COMPARISON",
                    "current": metrics["current_demand"],
                    "prior": metrics["prior_demand"],
                },
                {
                    "card": "REGIONAL_PRESENCE",
                    "values": entry["region_presence"],
                },
            ],
            "short_summary": (
                f"{champion} {role}의 최근 픽 점유율은 "
                f"{_percent(metrics['current_pick_presence'])}로, "
                f"이전 구간 대비 {_points(metrics['pick_presence_delta'])} 변했습니다. "
                f"다만 {counterpoint}"
            ),
            "quality_flags": entry["quality_flags"],
            "evidence_event_ids": entry["evidence_event_ids"],
            "review_state": "HUMAN_REVIEW_REQUIRED",
        }

    @staticmethod
    def _validate_report(report: dict[str, Any]) -> None:
        if not isinstance(report, dict) or report.get("schema_version") != "1":
            raise ValueError("creator brief requires Meta Radar schema_version 1")
        if not isinstance(report.get("entries"), list):
            raise ValueError("creator brief requires radar entries")
        if not isinstance(report.get("evidence_index"), dict):
            raise ValueError("creator brief requires an evidence index")
        for entry in report["entries"]:
            if not isinstance(entry, dict) or not isinstance(entry.get("metrics"), dict):
                raise ValueError("creator brief received a malformed radar entry")


def _counterpoint(metrics: dict[str, Any]) -> str:
    concentration = metrics["team_concentration"]
    if concentration is not None and concentration >= 0.75:
        return (
            f"최근 픽의 {_percent(concentration)}가 한 팀에 집중돼 있어 "
            "리그 전체 확산으로 해석하기 이르다."
        )
    if metrics["current_pick_count"] < 3:
        return (
            f"최근 근거가 {metrics['current_pick_count']}경기에 불과해 다음 스냅샷에서 "
            "재확인이 필요하다."
        )
    return "관측된 채택 변화만으로 챔피언의 강함, 승리 기여, 인과관계를 증명할 수 없다."


def _percent(value: float) -> str:
    return f"{value * 100:.1f}%"


def _points(value: float) -> str:
    amount = value * 100
    return f"{amount:+.1f}pp"
