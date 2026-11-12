import json

import pytest

from ops.agent_utility_dry_run import CASES, collect, prepare, report


def write(path, value):
    path.write_text(json.dumps(value), encoding="utf-8")


def test_agent_rehearsal_freezes_packets_and_never_reports_human_utility(tmp_path):
    packs = tmp_path / "packs"
    packs.mkdir()
    for team, role in CASES:
        profile = {"team_name": team, "player_pools": [{"role": role}], "season_tendencies": []}
        write(
            packs / f"t1-vs-{team}.json",
            {
                "cutoff": "2026-11-11T00:00:00Z",
                "target": profile,
                "own": profile,
                "league_meta": [],
                "levers": {
                    "expected_picks": [{"role": role, "champions": [{"champion_id": "Example"}]}],
                    "deny_comfort": [],
                },
            },
        )
    output = tmp_path / "run"
    assert prepare(packs, output)["responses_expected"] == 28
    for participant in range(1, 5):
        write(
            output / f"analyst-{participant}-responses.json",
            [
                {
                    "case_id": f"case-{i + 1:02d}",
                    "decision": "conditional review",
                    "evidence_refs": [f"/{i}/evidence/role"],
                }
                for i in range(7)
            ],
        )
    assert collect(output)["responses"] == 28
    packet = json.loads((output / "blind-packet.json").read_text(encoding="utf-8"))
    assert all("arm" not in p and "participant" not in p for p in packet)
    ratings = [
        {
            "response_id": p["response_id"],
            "evidence": 3,
            "actionability": 3,
            "completeness": 3,
            "critical_error": False,
            "rationale": "fixture",
        }
        for p in packet
    ]
    for judge in (1, 2):
        write(output / f"judge-{judge}-ratings.json", ratings)
    result = report(output)
    assert result["ratings"] == 56
    assert result["human_utility_proven"] is False
    assert result["time_comparison"] == "NOT_MEASURED"
    write(output / "judge-2-ratings.json", ratings[:-1] + ratings[:1])
    with pytest.raises(ValueError, match="unique"):
        report(output)
    path = output / "analyst-1-input.json"
    changed = json.loads(path.read_text(encoding="utf-8"))
    changed[0]["evidence"]["role"] = "OTHER"
    write(path, changed)
    with pytest.raises(ValueError, match="packet changed"):
        collect(output)
