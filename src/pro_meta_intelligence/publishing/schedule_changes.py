"""Deterministic change tracking for normalized official schedule snapshots."""

from __future__ import annotations

import hashlib
import json
from typing import Any

from pro_meta_intelligence.temporal import parse_datetime

CHANGE_HISTORY_LIMIT = 50


def _identity(value: str) -> str:
    return "".join(character for character in value.casefold() if character.isalnum())


def _participant_identities(event: dict[str, Any]) -> set[str]:
    return {
        _identity(str(value))
        for participant in event.get("participants", [])
        if isinstance(participant, dict)
        for value in (participant.get("name", ""), participant.get("code", ""))
        if value
    }


def _includes_team(event: dict[str, Any], watched_team: str) -> bool:
    return _identity(watched_team) in _participant_identities(event)


def _other_participant(event: dict[str, Any], watched_team: str) -> dict[str, str] | None:
    watched = _identity(watched_team)
    for participant in event.get("participants", []):
        if not isinstance(participant, dict):
            continue
        identities = {
            _identity(str(participant.get("name", ""))),
            _identity(str(participant.get("code", ""))),
        }
        if watched not in identities:
            return {
                "name": str(participant.get("name", "")),
                "code": str(participant.get("code", "")),
            }
    return None


def _participant_is_tbd(participant: dict[str, str] | None) -> bool:
    if participant is None:
        return True
    return any(_identity(value) == "tbd" for value in participant.values())


def _known_other_identity(event: dict[str, Any], watched_team: str) -> str | None:
    participant = _other_participant(event, watched_team)
    if _participant_is_tbd(participant):
        return None
    return _identity(participant["name"] or participant["code"])


def _event_view(event: dict[str, Any]) -> dict[str, Any]:
    return {
        "event_id": event.get("event_id"),
        "start_at": event.get("start_at"),
        "league": event.get("league"),
        "block": event.get("block"),
        "best_of": event.get("best_of"),
        "participants": event.get("participants", []),
    }


def _pair_events(
    previous_events: list[dict[str, Any]],
    current_events: list[dict[str, Any]],
    watched_team: str,
) -> tuple[
    list[tuple[dict[str, Any], dict[str, Any], str]],
    list[dict[str, Any]],
    list[dict[str, Any]],
]:
    remaining_previous = list(previous_events)
    remaining_current = list(current_events)
    pairs: list[tuple[dict[str, Any], dict[str, Any], str]] = []

    def take_matches(method: str, predicate: Any) -> None:
        for previous in list(remaining_previous):
            candidates = [current for current in remaining_current if predicate(previous, current)]
            if len(candidates) != 1:
                continue
            current = candidates[0]
            pairs.append((previous, current, method))
            remaining_previous.remove(previous)
            remaining_current.remove(current)

    take_matches(
        "EVENT_ID",
        lambda previous, current: previous.get("event_id") == current.get("event_id"),
    )
    take_matches(
        "SAME_SLOT",
        lambda previous, current: (
            previous.get("start_at") == current.get("start_at")
            and previous.get("league") == current.get("league")
            and previous.get("block") == current.get("block")
        ),
    )
    take_matches(
        "SAME_CONFIRMED_OPPONENT",
        lambda previous, current: (
            previous.get("league") == current.get("league")
            and _known_other_identity(previous, watched_team) is not None
            and _known_other_identity(previous, watched_team)
            == _known_other_identity(current, watched_team)
        ),
    )
    return pairs, remaining_previous, remaining_current


def _change_id(change: dict[str, Any], previous_hash: str | None, current_hash: str) -> str:
    canonical = json.dumps(
        {"previous_hash": previous_hash, "current_hash": current_hash, **change},
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return f"schedule-change:{hashlib.sha256(canonical.encode('utf-8')).hexdigest()[:20]}"


def _change(
    *,
    change_type: str,
    severity: str,
    summary: str,
    detected_at: str,
    correlation_method: str,
    previous_event: dict[str, Any] | None,
    current_event: dict[str, Any] | None,
    fields_changed: list[str],
    previous_hash: str | None,
    current_hash: str,
) -> dict[str, Any]:
    payload = {
        "detected_at": detected_at,
        "type": change_type,
        "severity": severity,
        "summary": summary,
        "correlation_method": correlation_method,
        "fields_changed": fields_changed,
        "previous_event": _event_view(previous_event) if previous_event else None,
        "current_event": _event_view(current_event) if current_event else None,
    }
    return {"change_id": _change_id(payload, previous_hash, current_hash), **payload}


def _compare_pair(
    previous: dict[str, Any],
    current: dict[str, Any],
    method: str,
    watched_team: str,
    detected_at: str,
    previous_hash: str | None,
    current_hash: str,
) -> list[dict[str, Any]]:
    changes: list[dict[str, Any]] = []
    previous_other = _other_participant(previous, watched_team)
    current_other = _other_participant(current, watched_team)
    if _participant_is_tbd(previous_other) and not _participant_is_tbd(current_other):
        changes.append(
            _change(
                change_type="PARTICIPANT_CONFIRMED",
                severity="ACTION_REQUIRED",
                summary=f"{watched_team} opponent confirmed as {current_other['name']}",
                detected_at=detected_at,
                correlation_method=method,
                previous_event=previous,
                current_event=current,
                fields_changed=["participants"],
                previous_hash=previous_hash,
                current_hash=current_hash,
            )
        )
    elif _participant_identities(previous) != _participant_identities(current):
        changes.append(
            _change(
                change_type="PARTICIPANT_CHANGED",
                severity="ACTION_REQUIRED",
                summary=f"{watched_team} fixture participant changed",
                detected_at=detected_at,
                correlation_method=method,
                previous_event=previous,
                current_event=current,
                fields_changed=["participants"],
                previous_hash=previous_hash,
                current_hash=current_hash,
            )
        )
    field_changes = [
        ("START_TIME_CHANGED", "ACTION_REQUIRED", "start_at", "fixture start time changed"),
        ("FORMAT_CHANGED", "REVIEW", "best_of", "series format changed"),
        ("STAGE_CHANGED", "REVIEW", "block", "league block changed"),
    ]
    for change_type, severity, field, label in field_changes:
        if previous.get(field) == current.get(field):
            continue
        changes.append(
            _change(
                change_type=change_type,
                severity=severity,
                summary=f"{watched_team} {label}",
                detected_at=detected_at,
                correlation_method=method,
                previous_event=previous,
                current_event=current,
                fields_changed=[field],
                previous_hash=previous_hash,
                current_hash=current_hash,
            )
        )
    return changes


def build_schedule_change_log(
    previous: dict[str, Any] | None,
    current: dict[str, Any],
    prior_log: dict[str, Any] | None = None,
    *,
    watched_team: str = "T1",
) -> dict[str, Any]:
    if current.get("artifact_type") != "pro-schedule-snapshot":
        raise ValueError("current schedule snapshot has an unsupported artifact type")
    if previous is not None and previous.get("artifact_type") != "pro-schedule-snapshot":
        raise ValueError("previous schedule snapshot has an unsupported artifact type")
    detected_at = str(current["retrieved_at"])
    current_hash = str(current["content_hash"])
    previous_hash = str(previous["content_hash"]) if previous else None
    previous_events = [
        event
        for event in (previous or {}).get("events", [])
        if isinstance(event, dict) and _includes_team(event, watched_team)
    ]
    current_events = [
        event
        for event in current.get("events", [])
        if isinstance(event, dict) and _includes_team(event, watched_team)
    ]
    changes: list[dict[str, Any]] = []
    if previous is not None:
        pairs, removed, added = _pair_events(previous_events, current_events, watched_team)
        for old, new, method in pairs:
            changes.extend(
                _compare_pair(
                    old,
                    new,
                    method,
                    watched_team,
                    detected_at,
                    previous_hash,
                    current_hash,
                )
            )
        current_at = parse_datetime(detected_at)
        for event in removed:
            expired = parse_datetime(str(event["start_at"])) <= current_at
            changes.append(
                _change(
                    change_type="EVENT_EXPIRED" if expired else "EVENT_REMOVED",
                    severity="INFO" if expired else "REVIEW",
                    summary=f"{watched_team} fixture left the future schedule",
                    detected_at=detected_at,
                    correlation_method="UNMATCHED",
                    previous_event=event,
                    current_event=None,
                    fields_changed=["event"],
                    previous_hash=previous_hash,
                    current_hash=current_hash,
                )
            )
        for event in added:
            changes.append(
                _change(
                    change_type="EVENT_ADDED",
                    severity="REVIEW",
                    summary=f"new {watched_team} fixture added",
                    detected_at=detected_at,
                    correlation_method="UNMATCHED",
                    previous_event=None,
                    current_event=event,
                    fields_changed=["event"],
                    previous_hash=previous_hash,
                    current_hash=current_hash,
                )
            )
    changes.sort(key=lambda item: (item["type"], item["change_id"]))
    old_history = (
        prior_log.get("history", [])
        if (
            isinstance(prior_log, dict)
            and prior_log.get("watched_team") == watched_team
            and isinstance(prior_log.get("history"), list)
        )
        else []
    )
    history = []
    seen: set[str] = set()
    for item in [*reversed(changes), *old_history]:
        if not isinstance(item, dict) or not isinstance(item.get("change_id"), str):
            continue
        if item["change_id"] in seen:
            continue
        seen.add(item["change_id"])
        history.append(item)
    history = history[:CHANGE_HISTORY_LIMIT]
    status = "INITIALIZED" if previous is None else "CHANGED" if changes else "UNCHANGED"
    return {
        "schema_version": "1",
        "artifact_type": "pro-schedule-change-log",
        "source_id": current.get("source_id"),
        "watched_team": watched_team,
        "generated_at": detected_at,
        "previous_snapshot": (
            {
                "retrieved_at": previous.get("retrieved_at"),
                "content_hash": previous_hash,
            }
            if previous
            else None
        ),
        "current_snapshot": {
            "retrieved_at": current.get("retrieved_at"),
            "content_hash": current_hash,
        },
        "latest_run": {
            "status": status,
            "change_count": len(changes),
            "changes": changes,
        },
        "history": history,
        "boundary": (
            "Tracks exact normalized schedule differences for the watched team. SAME_SLOT links "
            "events only when start time, league, and block match; SAME_CONFIRMED_OPPONENT links "
            "time changes only when the confirmed opponent and league match. Correlation is not "
            "an official provider series ID, and bracket participants are never inferred."
        ),
    }
