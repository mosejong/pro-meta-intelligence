.PHONY: install test lint evaluate sources fetch-ddragon import-oe build-radar refresh-feed creator-brief

install:
	python -m pip install -e ".[dev]"

test:
	python -m pytest

lint:
	python -m ruff check src tests
	python -m ruff format --check src tests

evaluate:
	python -m pro_meta_intelligence evaluate --output outputs/synthetic-backtest.json

sources:
	python -m pro_meta_intelligence sources

fetch-ddragon:
	python -m pro_meta_intelligence fetch-ddragon --version latest --locale en_US

import-oe:
	@test -n "$(INPUT)" || (echo "usage: make import-oe INPUT=path/to/file.csv" && exit 2)
	python -m pro_meta_intelligence import-oe --input "$(INPUT)" --source-timezone UTC

build-radar:
	@test -n "$(INPUT)" || (echo "usage: make build-radar INPUT=path/to/file.csv" && exit 2)
	python -m pro_meta_intelligence build-radar --input "$(INPUT)" --source-timezone UTC

refresh-feed:
	@test -n "$(INPUT)" || (echo "usage: make refresh-feed INPUT=path/to/file.csv" && exit 2)
	python -m pro_meta_intelligence refresh-feed --input "$(INPUT)" --source-timezone UTC

creator-brief:
	@test -n "$(RADAR)" || (echo "usage: make creator-brief RADAR=path/to/radar.json" && exit 2)
	python -m pro_meta_intelligence build-creator-brief --radar "$(RADAR)"
