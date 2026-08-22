import json
from copy import deepcopy
from datetime import UTC, datetime, timedelta

import pytest
from test_creator import radar_report

from pro_meta_intelligence.creator import CreatorBriefBuilder
from pro_meta_intelligence.publishing import SnapshotFeedPublisher

PUBLISHED_AT = datetime(2026, 8, 15, 13, tzinfo=UTC)


def test_feed_publishes_immutable_snapshot_before_current_heads(tmp_path) -> None:
    radar = radar_report()
    creator = CreatorBriefBuilder().build(radar).to_dict()
    result = SnapshotFeedPublisher(tmp_path).publish(
        radar,
        creator,
        published_at=PUBLISHED_AT,
    )

    assert result.created is True
    assert json.loads(result.current_path.read_text(encoding="utf-8")) == radar
    assert json.loads(result.current_creator_path.read_text(encoding="utf-8")) == creator
    manifest = json.loads((result.snapshot_path.parent / "manifest.json").read_text("utf-8"))
    index = json.loads(result.index_path.read_text(encoding="utf-8"))
    assert manifest["snapshot_id"] == result.snapshot_id
    assert index["current_snapshot_id"] == result.snapshot_id
    assert index["snapshots"] == [manifest]


def test_feed_reuses_identical_version_without_rewriting_publication_time(tmp_path) -> None:
    radar = radar_report()
    creator = CreatorBriefBuilder().build(radar).to_dict()
    publisher = SnapshotFeedPublisher(tmp_path)

    first = publisher.publish(radar, creator, published_at=PUBLISHED_AT)
    second = publisher.publish(radar, creator, published_at=PUBLISHED_AT + timedelta(days=1))
    manifest = json.loads((first.snapshot_path.parent / "manifest.json").read_text("utf-8"))
    index = json.loads(second.index_path.read_text(encoding="utf-8"))

    assert second.created is False
    assert second.snapshot_id == first.snapshot_id
    assert manifest["published_at"] == PUBLISHED_AT.isoformat()
    assert len(index["snapshots"]) == 1


def test_feed_detects_tampered_immutable_snapshot_before_moving_current(tmp_path) -> None:
    radar = radar_report()
    creator = CreatorBriefBuilder().build(radar).to_dict()
    publisher = SnapshotFeedPublisher(tmp_path)
    result = publisher.publish(radar, creator, published_at=PUBLISHED_AT)
    current_before = result.current_path.read_bytes()
    result.snapshot_path.write_text("{}\n", encoding="utf-8")

    with pytest.raises(ValueError, match="immutable snapshot content mismatch"):
        publisher.publish(radar, creator, published_at=PUBLISHED_AT)

    assert result.current_path.read_bytes() == current_before


def test_feed_trims_only_index_and_retains_immutable_archive(tmp_path) -> None:
    publisher = SnapshotFeedPublisher(tmp_path, max_index_entries=1)
    first_radar = radar_report()
    first_creator = CreatorBriefBuilder().build(first_radar).to_dict()
    first = publisher.publish(first_radar, first_creator, published_at=PUBLISHED_AT)
    second_radar = deepcopy(first_radar)
    second_radar["cutoff"] = "2026-08-22T12:00:00+00:00"
    second_creator = CreatorBriefBuilder().build(second_radar).to_dict()
    second = publisher.publish(
        second_radar,
        second_creator,
        published_at=PUBLISHED_AT + timedelta(days=7),
    )
    index = json.loads(second.index_path.read_text(encoding="utf-8"))

    assert index["current_snapshot_id"] == second.snapshot_id
    assert [item["snapshot_id"] for item in index["snapshots"]] == [second.snapshot_id]
    assert first.snapshot_path.exists()


def test_feed_rejects_creator_brief_for_a_different_snapshot(tmp_path) -> None:
    radar = radar_report()
    creator = CreatorBriefBuilder().build(radar).to_dict()
    creator["source_snapshot"]["patch_id"] = "different"

    with pytest.raises(ValueError, match="does not reference"):
        SnapshotFeedPublisher(tmp_path).publish(radar, creator, published_at=PUBLISHED_AT)


def test_feed_backfill_cannot_roll_current_head_backward(tmp_path) -> None:
    publisher = SnapshotFeedPublisher(tmp_path)
    newest = radar_report()
    newest["cutoff"] = "2026-08-22T12:00:00+00:00"
    newest_creator = CreatorBriefBuilder().build(newest).to_dict()
    newest_result = publisher.publish(
        newest,
        newest_creator,
        published_at=PUBLISHED_AT + timedelta(days=7),
    )
    older = radar_report()
    older_creator = CreatorBriefBuilder().build(older).to_dict()

    publisher.publish(older, older_creator, published_at=PUBLISHED_AT)
    current = json.loads((tmp_path / "current.json").read_text(encoding="utf-8"))
    index = json.loads((tmp_path / "index.json").read_text(encoding="utf-8"))

    assert current["cutoff"] == newest["cutoff"]
    assert index["current_snapshot_id"] == newest_result.snapshot_id


def test_feed_same_cutoff_correction_uses_later_publication(tmp_path) -> None:
    publisher = SnapshotFeedPublisher(tmp_path)
    original = radar_report()
    original_creator = CreatorBriefBuilder().build(original).to_dict()
    first = publisher.publish(original, original_creator, published_at=PUBLISHED_AT)
    corrected = deepcopy(original)
    corrected["entries"][0]["metrics"]["current_pick_count"] = 3
    corrected_creator = CreatorBriefBuilder().build(corrected).to_dict()
    second = publisher.publish(
        corrected,
        corrected_creator,
        published_at=PUBLISHED_AT + timedelta(hours=1),
    )
    index = json.loads((tmp_path / "index.json").read_text(encoding="utf-8"))

    assert second.snapshot_id != first.snapshot_id
    assert index["current_snapshot_id"] == second.snapshot_id
    assert json.loads((tmp_path / "current.json").read_text("utf-8")) == corrected


def test_feed_rejects_publication_time_before_radar_cutoff(tmp_path) -> None:
    radar = radar_report()
    creator = CreatorBriefBuilder().build(radar).to_dict()

    with pytest.raises(ValueError, match="earlier than the radar cutoff"):
        SnapshotFeedPublisher(tmp_path).publish(
            radar,
            creator,
            published_at=datetime(2026, 8, 15, 11, tzinfo=UTC),
        )
