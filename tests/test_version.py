import tomllib
from pathlib import Path

from pro_meta_intelligence import __version__
from pro_meta_intelligence._version import USER_AGENT


def test_runtime_and_project_versions_stay_synchronized() -> None:
    project = tomllib.loads(Path("pyproject.toml").read_text(encoding="utf-8"))

    assert __version__ == project["project"]["version"]
    assert USER_AGENT.startswith(f"ProMetaIntelligence/{__version__} ")
