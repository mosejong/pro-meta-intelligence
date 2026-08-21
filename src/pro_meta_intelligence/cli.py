from __future__ import annotations

import argparse
from collections.abc import Sequence
from pathlib import Path

from pro_meta_intelligence.backtest import BacktestHarness
from pro_meta_intelligence.ingestion import load_synthetic_scenario
from pro_meta_intelligence.models import BacktestWindow


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="pro-meta")
    subparsers = parser.add_subparsers(dest="command", required=True)
    evaluate = subparsers.add_parser("evaluate", help="run the deterministic fixture backtest")
    evaluate.add_argument("--cutoff", help="ISO-8601 cutoff; fixture default if omitted")
    evaluate.add_argument("--evaluation-start", help="ISO-8601 outcome window start")
    evaluate.add_argument("--evaluation-end", help="ISO-8601 outcome window end")
    evaluate.add_argument("--top-k", type=int, help="candidate review budget")
    evaluate.add_argument("--output", type=Path, help="optional JSON output path")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command != "evaluate":
        raise AssertionError("unreachable command")

    scenario = load_synthetic_scenario()
    default = scenario.window
    from pro_meta_intelligence.ingestion.fixtures import parse_datetime

    window = BacktestWindow(
        cutoff=parse_datetime(args.cutoff) if args.cutoff else default.cutoff,
        evaluation_start=(
            parse_datetime(args.evaluation_start)
            if args.evaluation_start
            else default.evaluation_start
        ),
        evaluation_end=(
            parse_datetime(args.evaluation_end) if args.evaluation_end else default.evaluation_end
        ),
        top_k=args.top_k if args.top_k is not None else default.top_k,
    )
    output = BacktestHarness().run(scenario, window).to_json()
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(output, encoding="utf-8")
    else:
        print(output, end="")
    return 0
