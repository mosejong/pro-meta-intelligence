.PHONY: install test lint evaluate sources fetch-ddragon

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
