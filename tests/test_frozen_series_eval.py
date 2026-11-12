import hashlib
import json
from datetime import UTC, datetime

import pytest

from ops.evaluate_frozen_blg_series import (
    load_frozen_pack,
    main,
    parse_args,
    require_pre_match,
)

FIRST_GAME = datetime(2026, 11, 8, 22, 14, tzinfo=UTC)


def write_pack(tmp_path, cutoff):
    path = tmp_path / "pack.json"
    path.write_text(json.dumps({"cutoff": cutoff}), encoding="utf-8")
    return path, hashlib.sha256(path.read_bytes()).hexdigest()


def test_frozen_pack_path_and_hash_are_required():
    with pytest.raises(SystemExit):
        parse_args(["--output", "out.json"])
    with pytest.raises(SystemExit):
        parse_args(["--frozen-pack", "pack.json", "--output", "out.json"])


def test_frozen_pack_must_match_its_recorded_hash(tmp_path):
    path, digest = write_pack(tmp_path, "2026-11-04T03:03:22+00:00")
    assert load_frozen_pack(path, digest)[1]["cutoff"].startswith("2026-11-04")
    with pytest.raises(ValueError, match="hash mismatch"):
        load_frozen_pack(path, "0" * 64)


def test_a_pack_collected_after_the_series_is_rejected(tmp_path):
    path, digest = write_pack(tmp_path, "2026-11-11T02:19:29+00:00")
    with pytest.raises(ValueError, match="not a pre-match pack"):
        require_pre_match(load_frozen_pack(path, digest)[1], FIRST_GAME)
    require_pre_match({"cutoff": "2026-11-04T03:03:22+00:00"}, FIRST_GAME)


def test_existing_results_are_not_overwritten(tmp_path):
    path, digest = write_pack(tmp_path, "2026-11-04T03:03:22+00:00")
    output = tmp_path / "result.json"
    output.write_text("{}", encoding="utf-8")
    with pytest.raises(SystemExit, match="not overwritten"):
        main(["--frozen-pack", str(path), "--pack-sha256", digest, "--output", str(output)])
    assert output.read_text(encoding="utf-8") == "{}"
