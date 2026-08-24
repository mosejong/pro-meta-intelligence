"""Validated local imports for Oracle's Elixir professional-match CSV snapshots."""

from __future__ import annotations

import csv
import hashlib
from collections import Counter
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta, timezone, tzinfo
from pathlib import Path
from typing import TextIO
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

from pro_meta_intelligence.models import (
    DraftAction,
    MatchRecord,
    PickBanEvent,
    Provenance,
    Side,
    require_aware,
)
from pro_meta_intelligence.sources import PolicyGate, SourceRegistry

SOURCE_ID = "oracles-elixir-match-data"
IMPORT_OPERATION = "IMPORT_LOCAL_CSV"
PLAYER_PARTICIPANT_IDS = frozenset(str(value) for value in range(1, 11))
TEAM_PARTICIPANT_IDS = frozenset({"100", "200"})
EXPECTED_PARTICIPANT_IDS = PLAYER_PARTICIPANT_IDS | TEAM_PARTICIPANT_IDS
PICK_COLUMNS = tuple(f"pick{value}" for value in range(1, 6))
BAN_COLUMNS = tuple(f"ban{value}" for value in range(1, 6))
REQUIRED_COLUMNS = frozenset(
    {
        "gameid",
        "datacompleteness",
        "league",
        "year",
        "split",
        "date",
        "game",
        "patch",
        "participantid",
        "side",
        "position",
        "teamname",
        "teamid",
        "firstPick",
        "champion",
        "result",
        *BAN_COLUMNS,
        *PICK_COLUMNS,
    }
)
ROLE_MAP = {
    "top": "TOP",
    "jng": "JUNGLE",
    "mid": "MID",
    "bot": "BOTTOM",
    "sup": "SUPPORT",
}
MAX_ISSUE_DETAILS = 100


class OracleElixirSchemaError(ValueError):
    """Raised when the file-level CSV contract cannot be interpreted safely."""


class _GameValidationError(ValueError):
    def __init__(self, code: str, detail: str) -> None:
        self.code = code
        super().__init__(detail)


@dataclass(frozen=True, slots=True)
class ImportIssue:
    game_key: str
    league: str
    patch_id: str | None
    code: str
    detail: str

    def to_dict(self) -> dict[str, str | None]:
        return {
            "game_key": self.game_key,
            "league": self.league,
            "patch_id": self.patch_id,
            "code": self.code,
            "detail": self.detail,
        }


@dataclass(frozen=True, slots=True)
class ImportReport:
    source_version: str
    retrieved_at: datetime
    source_timezone: str
    content_hash: str
    byte_length: int
    row_count: int
    discovered_game_count: int
    imported_game_count: int
    rejected_game_count: int
    issue_counts: tuple[tuple[str, int], ...]
    issue_context_counts: tuple[tuple[str | None, str, str, int], ...]
    issues: tuple[ImportIssue, ...]
    truncated_issue_count: int

    def to_dict(self) -> dict[str, object]:
        return {
            "source_id": SOURCE_ID,
            "source_version": self.source_version,
            "retrieved_at": self.retrieved_at.isoformat(),
            "source_timezone": self.source_timezone,
            "content_hash": self.content_hash,
            "byte_length": self.byte_length,
            "row_count": self.row_count,
            "discovered_game_count": self.discovered_game_count,
            "imported_game_count": self.imported_game_count,
            "rejected_game_count": self.rejected_game_count,
            "issue_counts": dict(self.issue_counts),
            "issue_context_counts": [
                {
                    "patch_id": patch_id,
                    "league": league,
                    "code": code,
                    "count": count,
                }
                for patch_id, league, code, count in self.issue_context_counts
            ],
            "issues": [issue.to_dict() for issue in self.issues],
            "truncated_issue_count": self.truncated_issue_count,
        }


@dataclass(frozen=True, slots=True)
class OracleElixirImport:
    matches: tuple[MatchRecord, ...]
    draft_events: tuple[PickBanEvent, ...]
    report: ImportReport


class OracleElixirCSVAdapter:
    """Normalize a provider-published CSV that is already present on local disk.

    The adapter never downloads a URL. The mutable annual file is versioned by SHA-256 and every
    normalized record receives the explicit retrieval time as its conservative availability time.
    """

    source_id = SOURCE_ID

    def __init__(self, registry: SourceRegistry) -> None:
        self._gate = PolicyGate(registry)

    def import_file(
        self,
        path: Path,
        *,
        retrieved_at: datetime,
        source_timezone: str,
        source_uri: str | None = None,
    ) -> OracleElixirImport:
        require_aware(retrieved_at, "retrieved_at")
        registration = self._gate.require(self.source_id, IMPORT_OPERATION, retrieved_at)
        resolved = path.resolve(strict=True)
        if not resolved.is_file():
            raise ValueError("Oracle's Elixir input must be a regular file")
        if resolved.stat().st_size > registration.maximum_response_bytes:
            raise ValueError(
                "Oracle's Elixir input exceeds the reviewed maximum file size of "
                f"{registration.maximum_response_bytes} bytes"
            )
        try:
            source_tz = _parse_timezone(source_timezone)
        except (KeyError, ValueError) as exc:
            raise ValueError(f"unknown source timezone: {source_timezone}") from exc

        content_hash, byte_length = _hash_file(resolved)
        normalized_source_uri = _validated_source_uri(
            source_uri,
            fallback_name=resolved.name,
            allowed_base_urls=registration.base_urls,
        )
        provenance = Provenance(
            source_id=self.source_id,
            source_type="PRO_MATCH_CSV_SNAPSHOT",
            source_uri=normalized_source_uri,
            source_version=content_hash,
            retrieved_at=retrieved_at,
            content_hash=content_hash,
            schema_version="oe-csv-2026-v1",
        )
        with resolved.open("r", encoding="utf-8-sig", newline="") as handle:
            matches, events, issues, row_count, game_count = self._read(
                handle,
                source_tz=source_tz,
                retrieved_at=retrieved_at,
                provenance=provenance,
            )
        issue_counts = Counter(issue.code for issue in issues)
        issue_context_counts = Counter(
            (issue.patch_id, issue.league, issue.code) for issue in issues
        )
        report = ImportReport(
            source_version=content_hash,
            retrieved_at=retrieved_at,
            source_timezone=source_timezone,
            content_hash=content_hash,
            byte_length=byte_length,
            row_count=row_count,
            discovered_game_count=game_count,
            imported_game_count=len(matches),
            rejected_game_count=game_count - len(matches),
            issue_counts=tuple(sorted(issue_counts.items())),
            issue_context_counts=tuple(
                (*context, count)
                for context, count in sorted(
                    issue_context_counts.items(),
                    key=lambda item: (
                        item[0][0] is None,
                        item[0][0] or "",
                        item[0][1],
                        item[0][2],
                    ),
                )
            ),
            issues=tuple(issues[:MAX_ISSUE_DETAILS]),
            truncated_issue_count=max(0, len(issues) - MAX_ISSUE_DETAILS),
        )
        return OracleElixirImport(tuple(matches), tuple(events), report)

    def _read(
        self,
        handle: TextIO,
        *,
        source_tz: tzinfo,
        retrieved_at: datetime,
        provenance: Provenance,
    ) -> tuple[list[MatchRecord], list[PickBanEvent], list[ImportIssue], int, int]:
        reader = csv.DictReader(handle)
        if reader.fieldnames is None:
            raise OracleElixirSchemaError("CSV is missing a header row")
        missing = sorted(REQUIRED_COLUMNS - set(reader.fieldnames))
        if missing:
            raise OracleElixirSchemaError(f"CSV is missing required columns: {', '.join(missing)}")

        matches: list[MatchRecord] = []
        events: list[PickBanEvent] = []
        issues: list[ImportIssue] = []
        closed_keys: set[tuple[str, str]] = set()
        current_key: tuple[str, str] | None = None
        current_rows: list[dict[str, str]] = []
        row_count = 0
        game_count = 0

        def flush() -> None:
            nonlocal game_count
            if current_key is None:
                return
            game_count += 1
            try:
                match, picks = _normalize_game(
                    current_key,
                    current_rows,
                    source_tz=source_tz,
                    retrieved_at=retrieved_at,
                    provenance=provenance,
                )
            except _GameValidationError as exc:
                issues.append(
                    ImportIssue(
                        game_key=_display_key(current_key),
                        league=current_key[0],
                        patch_id=_consistent_context_value(current_rows, "patch"),
                        code=exc.code,
                        detail=str(exc),
                    )
                )
            else:
                matches.append(match)
                events.extend(picks)
            closed_keys.add(current_key)

        for raw_row in reader:
            row_count += 1
            row = {key: value or "" for key, value in raw_row.items() if key is not None}
            key = (row["league"].strip(), row["gameid"].strip())
            if not all(key):
                raise OracleElixirSchemaError(
                    f"row {row_count} has a blank league or gameid and cannot be grouped safely"
                )
            if current_key is None:
                current_key = key
            elif key != current_key:
                flush()
                current_rows = []
                current_key = key
                if key in closed_keys:
                    raise OracleElixirSchemaError(
                        f"game rows are not contiguous: {_display_key(key)}"
                    )
            current_rows.append(row)
        flush()
        return matches, events, issues, row_count, game_count


def _normalize_game(
    key: tuple[str, str],
    rows: list[dict[str, str]],
    *,
    source_tz: tzinfo,
    retrieved_at: datetime,
    provenance: Provenance,
) -> tuple[MatchRecord, tuple[PickBanEvent, ...]]:
    if len(rows) != 12:
        raise _GameValidationError("INVALID_ROW_COUNT", f"expected 12 rows, found {len(rows)}")
    participant_ids = [row["participantid"].strip() for row in rows]
    if set(participant_ids) != EXPECTED_PARTICIPANT_IDS or len(set(participant_ids)) != 12:
        raise _GameValidationError(
            "INVALID_PARTICIPANTS", "expected participant IDs 1-10, 100, and 200 exactly once"
        )
    if any(row["datacompleteness"].strip().lower() != "complete" for row in rows):
        raise _GameValidationError("INCOMPLETE_GAME", "datacompleteness is not complete")

    by_participant = {row["participantid"].strip(): row for row in rows}
    player_rows = [by_participant[str(value)] for value in range(1, 11)]
    team_rows = [by_participant["100"], by_participant["200"]]
    _require_consistent_game_fields(rows)
    observed_at = _parse_source_datetime(rows[0]["date"], source_tz)
    if observed_at > retrieved_at:
        raise _GameValidationError(
            "OBSERVED_AFTER_RETRIEVAL", "game timestamp is later than snapshot retrieval"
        )
    side_rows = {_parse_side(row["side"]): row for row in team_rows}
    if set(side_rows) != {Side.BLUE, Side.RED}:
        raise _GameValidationError("INVALID_TEAM_SIDES", "expected one Blue and one Red team row")
    winners = [row for row in team_rows if row["result"].strip() == "1"]
    if len(winners) != 1:
        raise _GameValidationError("INVALID_WINNER", "expected exactly one winning team row")
    if any(not row["teamid"].strip() for row in team_rows):
        raise _GameValidationError("MISSING_TEAM_ID", "team rows require stable team IDs")

    league, game_id = key
    match_id = f"oe:{league}:{game_id}"
    year = rows[0]["year"].strip()
    split = rows[0]["split"].strip()
    match = MatchRecord(
        match_id=match_id,
        series_id=f"{match_id}:series-unavailable",
        league=league,
        tournament=" ".join(value for value in (year, league, split) if value),
        patch_id=rows[0]["patch"].strip(),
        blue_team_id=side_rows[Side.BLUE]["teamid"].strip(),
        red_team_id=side_rows[Side.RED]["teamid"].strip(),
        winner_team_id=winners[0]["teamid"].strip(),
        observed_at=observed_at,
        available_at=retrieved_at,
        provenance=provenance,
        blue_team_name=side_rows[Side.BLUE]["teamname"].strip() or None,
        red_team_name=side_rows[Side.RED]["teamname"].strip() or None,
    )

    player_by_side_champion: dict[tuple[Side, str], tuple[str, str | None, str | None]] = {}
    roles_by_side: dict[Side, set[str]] = {Side.BLUE: set(), Side.RED: set()}
    for row in player_rows:
        side = _parse_side(row["side"])
        champion = row["champion"].strip()
        role = ROLE_MAP.get(row["position"].strip().lower())
        if not champion or role is None:
            raise _GameValidationError(
                "INVALID_PLAYER_PICK", "player rows require champion and known position"
            )
        lookup_key = (side, champion.casefold())
        if lookup_key in player_by_side_champion:
            raise _GameValidationError("DUPLICATE_CHAMPION", "duplicate champion on one team")
        if row["teamid"].strip() != side_rows[side]["teamid"].strip():
            raise _GameValidationError(
                "PLAYER_TEAM_MISMATCH", "player team ID does not match the side's team row"
            )
        player_by_side_champion[lookup_key] = (
            role,
            row.get("playerid", "").strip() or None,
            row.get("playername", "").strip() or None,
        )
        roles_by_side[side].add(role)

    expected_roles = set(ROLE_MAP.values())
    if any(roles != expected_roles for roles in roles_by_side.values()):
        raise _GameValidationError(
            "INVALID_ROLE_SET", "each side must contain top, jungle, mid, bottom, and support"
        )

    first_pick_sides = [side for side, row in side_rows.items() if row["firstPick"].strip() == "1"]
    if len(first_pick_sides) != 1:
        raise _GameValidationError("INVALID_FIRST_PICK", "expected exactly one first-pick team")
    if {row["firstPick"].strip() for row in team_rows} != {"0", "1"}:
        raise _GameValidationError("INVALID_FIRST_PICK", "firstPick values must be 0 and 1")
    first_side = first_pick_sides[0]
    second_side = Side.RED if first_side is Side.BLUE else Side.BLUE
    pick_sequences = {first_side: (1, 4, 5, 8, 9), second_side: (2, 3, 6, 7, 10)}
    draft_events: list[PickBanEvent] = []
    ban_sequences = {first_side: (1, 3, 5, 8, 10), second_side: (2, 4, 6, 7, 9)}
    for side, team_row in side_rows.items():
        for column, sequence in zip(BAN_COLUMNS, ban_sequences[side], strict=True):
            champion = team_row[column].strip()
            if not champion:
                continue
            draft_events.append(
                PickBanEvent(
                    event_id=f"{match_id}:ban:{sequence}",
                    match_id=match_id,
                    sequence=sequence,
                    team_id=team_row["teamid"].strip(),
                    side=side,
                    action=DraftAction.BAN,
                    champion_id=champion,
                    role="UNKNOWN",
                    observed_at=observed_at,
                    available_at=retrieved_at,
                    provenance=provenance,
                )
            )
        ordered_champions = [team_row[column].strip() for column in PICK_COLUMNS]
        player_champions = {
            champion
            for candidate_side, champion in player_by_side_champion
            if candidate_side is side
        }
        if (
            len(set(ordered_champions)) != 5
            or {champion.casefold() for champion in ordered_champions} != player_champions
        ):
            raise _GameValidationError(
                "PICK_SET_MISMATCH", "team pick1-pick5 must match five unique player champions"
            )
        for column, sequence in zip(PICK_COLUMNS, pick_sequences[side], strict=True):
            champion = team_row[column].strip()
            player = player_by_side_champion.get((side, champion.casefold()))
            if not champion or player is None:
                raise _GameValidationError(
                    "PICK_ROLE_MISMATCH",
                    f"{column} does not match a player champion on {side.value}",
                )
            role, player_id, player_name = player
            draft_events.append(
                PickBanEvent(
                    event_id=f"{match_id}:pick:{sequence}",
                    match_id=match_id,
                    sequence=sequence,
                    team_id=team_row["teamid"].strip(),
                    side=side,
                    action=DraftAction.PICK,
                    champion_id=champion,
                    role=role,
                    observed_at=observed_at,
                    available_at=retrieved_at,
                    provenance=provenance,
                    player_id=player_id,
                    player_name=player_name,
                )
            )
    return match, tuple(
        sorted(draft_events, key=lambda event: (event.action.value, event.sequence))
    )


def _require_consistent_game_fields(rows: list[dict[str, str]]) -> None:
    for field in ("gameid", "league", "year", "date", "game", "patch"):
        values = {row[field].strip() for row in rows}
        if len(values) != 1 or not next(iter(values)):
            raise _GameValidationError(
                "INCONSISTENT_GAME_FIELD", f"field {field} is blank or inconsistent"
            )
    split_values = {row["split"].strip() for row in rows}
    if len(split_values) != 1:
        raise _GameValidationError("INCONSISTENT_GAME_FIELD", "field split is inconsistent")


def _consistent_context_value(rows: list[dict[str, str]], field: str) -> str | None:
    values = {row[field].strip() for row in rows}
    if len(values) != 1:
        return None
    value = next(iter(values))
    return value or None


def _parse_source_datetime(value: str, source_tz: tzinfo) -> datetime:
    try:
        parsed = datetime.strptime(value.strip(), "%Y-%m-%d %H:%M:%S")
    except ValueError as exc:
        raise _GameValidationError("INVALID_DATE", f"unsupported date value: {value!r}") from exc
    return parsed.replace(tzinfo=source_tz)


def _parse_timezone(value: str) -> tzinfo:
    normalized = value.strip()
    if normalized.upper() in {"UTC", "Z"}:
        return UTC
    if len(normalized) == 6 and normalized[0] in "+-" and normalized[3] == ":":
        try:
            hours = int(normalized[1:3])
            minutes = int(normalized[4:6])
        except ValueError as exc:
            raise ValueError(f"unknown source timezone: {value}") from exc
        if hours > 23 or minutes > 59:
            raise ValueError(f"unknown source timezone: {value}")
        offset = timedelta(hours=hours, minutes=minutes)
        return timezone(offset if normalized[0] == "+" else -offset)
    try:
        return ZoneInfo(normalized)
    except (KeyError, ValueError) as exc:
        raise ValueError(
            f"unknown source timezone: {value}; use UTC or an explicit offset such as +09:00"
        ) from exc


def _parse_side(value: str) -> Side:
    try:
        return Side(value.strip().upper())
    except ValueError as exc:
        raise _GameValidationError("INVALID_SIDE", f"unsupported side: {value!r}") from exc


def _hash_file(path: Path) -> tuple[str, int]:
    digest = hashlib.sha256()
    byte_length = 0
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
            byte_length += len(chunk)
    return f"sha256:{digest.hexdigest()}", byte_length


def _validated_source_uri(
    value: str | None,
    *,
    fallback_name: str,
    allowed_base_urls: tuple[str, ...],
) -> str:
    if value is None:
        return f"local-file:{fallback_name}"
    parsed = urlparse(value)
    allowed_hosts = {urlparse(base_url).hostname for base_url in allowed_base_urls}
    if parsed.scheme != "https" or parsed.hostname not in allowed_hosts:
        raise ValueError("source_uri must use a registered provider HTTPS host")
    return value


def _display_key(key: tuple[str, str]) -> str:
    return f"{key[0]}:{key[1]}"
