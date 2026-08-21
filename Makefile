.PHONY: install test lint evaluate

install:
	python -m pip install -e ".[dev]"

test:
	python -m pytest

lint:
	python -m ruff check src tests
	python -m ruff format --check src tests

evaluate:
	python -m pro_meta_intelligence evaluate --output outputs/synthetic-backtest.json
