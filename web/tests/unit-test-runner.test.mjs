import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  DEFAULT_DEADLINE_MS,
  NODE_TEST_FLAGS,
  TIMEOUT_EXIT_CODE,
  USAGE_EXIT_CODE,
  buildNodeTestArgs,
  resolveExitCode,
  runCommandWithDeadline,
} from "../scripts/run-unit-tests.mjs";

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const runnerPath = path.resolve(testsDir, "..", "scripts", "run-unit-tests.mjs");

test("npm test explicitly names existing unique test files", () => {
  const webRoot = path.resolve(testsDir, "..");
  const manifest = JSON.parse(readFileSync(path.join(webRoot, "package.json"), "utf8"));
  const marker = "node scripts/run-unit-tests.mjs ";
  assert.ok(manifest.scripts.test.includes(marker));
  const files = manifest.scripts.test.split(marker)[1].trim().split(/\s+/);
  assert.equal(new Set(files).size, files.length, "duplicate test entries");
  for (const file of files) {
    assert.match(file, /^tests\/[\w-]+\.test\.mjs$/, `invalid test path: ${file}`);
    assert.ok(statSync(path.join(webRoot, file)).isFile(), `missing test: ${file}`);
  }
  assert.ok(files.includes("tests/experiment-baseline-inputs.test.mjs"));
  assert.ok(files.includes("tests/experiment-comparison.test.mjs"));
});

function countTimeouts() {
  return process.getActiveResourcesInfo().filter((name) => name === "Timeout").length;
}

function snapshotResources() {
  return {
    sigint: process.listenerCount("SIGINT"),
    sigterm: process.listenerCount("SIGTERM"),
    timeouts: countTimeouts(),
  };
}

async function runChecked(command, args, options) {
  const argsBefore = JSON.stringify(args);
  const optionsBefore = JSON.stringify(options);
  const before = snapshotResources();
  const result = await runCommandWithDeadline(command, args, options);
  assert.equal(JSON.stringify(args), argsBefore, "args must not be mutated");
  assert.equal(JSON.stringify(options), optionsBefore, "options must not be mutated");
  assert.deepEqual(snapshotResources(), before, "no leaked signal listeners or timers");
  assert.ok(Object.isFrozen(result));
  return result;
}

test("CLI flags are fixed and the file list is passed through in order", () => {
  assert.deepEqual(NODE_TEST_FLAGS, ["--test", "--test-concurrency=4", "--test-timeout=120000"]);
  assert.equal(DEFAULT_DEADLINE_MS, 300_000);
  const files = Object.freeze(["tests/b.test.mjs", "tests/a.test.mjs"]);
  assert.deepEqual(buildNodeTestArgs(files), [...NODE_TEST_FLAGS, "tests/b.test.mjs", "tests/a.test.mjs"]);
  assert.throws(() => buildNodeTestArgs([]), TypeError);
  assert.throws(() => buildNodeTestArgs(["--test-force-exit"]), TypeError);
});

test("normal exit 0 and failure exit 7 are preserved", async () => {
  const ok = await runChecked(process.execPath, Object.freeze(["-e", "process.exit(0)"]), {
    timeoutMs: 20_000,
    stdio: "ignore",
  });
  assert.equal(ok.timedOut, false);
  assert.equal(ok.exitCode, 0);
  assert.equal(resolveExitCode(ok), 0);

  const failed = await runChecked(process.execPath, Object.freeze(["-e", "process.exit(7)"]), {
    timeoutMs: 20_000,
    stdio: "ignore",
  });
  assert.equal(failed.timedOut, false);
  assert.equal(failed.exitCode, 7);
  assert.equal(resolveExitCode(failed), 7);
});

test("spawn failure resolves as a non-zero failure", async () => {
  const missing = path.join(testsDir, `missing-runner-binary-${randomUUID()}`);
  const result = await runChecked(missing, Object.freeze([]), { timeoutMs: 20_000, stdio: "ignore" });
  assert.ok(result.error, "spawn error is reported");
  assert.equal(result.timedOut, false);
  assert.notEqual(resolveExitCode(result), 0);
});

test("a process kept alive after its assertion passed is cut at the deadline", async () => {
  // The node:test assertion passes, then a live interval would keep the
  // process up for 30s. A 2s whole-process deadline must terminate it.
  const fixture = [
    "const test = require('node:test');",
    "const assert = require('node:assert/strict');",
    "test('assertion finishes', () => { assert.equal(1, 1); });",
    "const live = setInterval(() => {}, 1000);",
    "setTimeout(() => clearInterval(live), 30000);",
  ].join(" ");
  const started = Date.now();
  const result = await runChecked(process.execPath, Object.freeze(["-e", fixture]), {
    timeoutMs: 2_000,
    stdio: "ignore",
  });
  const elapsed = Date.now() - started;
  assert.equal(result.timedOut, true);
  assert.equal(result.killFailed, false);
  assert.equal(resolveExitCode(result), TIMEOUT_EXIT_CODE);
  assert.ok(elapsed >= 2_000, `ran until the deadline (${elapsed}ms)`);
  assert.ok(elapsed < 15_000, `did not wait for the 30s fixture (${elapsed}ms)`);
});

test("timeout and interruption never resolve to success", () => {
  const base = { exitCode: 0, signal: null, error: null, killFailed: false, interruptedBy: null, timedOut: false };
  assert.equal(resolveExitCode({ ...base, timedOut: true }), TIMEOUT_EXIT_CODE);
  assert.equal(resolveExitCode({ ...base, interruptedBy: "SIGINT" }), 130);
  assert.equal(resolveExitCode({ ...base, interruptedBy: "SIGTERM" }), 143);
  assert.equal(resolveExitCode({ ...base, killFailed: true }), 1);
  assert.equal(resolveExitCode({ ...base, exitCode: null, signal: "SIGKILL" }), 137);
});

test("importing the runner has no side effects and an empty CLI list fails", () => {
  const imported = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", `await import(${JSON.stringify(pathToFileURL(runnerPath).href)});`],
    { encoding: "utf8", timeout: 20_000 },
  );
  assert.equal(imported.error, undefined);
  assert.equal(imported.status, 0);
  assert.equal(imported.stdout, "");
  assert.equal(imported.stderr, "");

  const empty = spawnSync(process.execPath, [runnerPath], { encoding: "utf8", timeout: 20_000 });
  assert.equal(empty.error, undefined);
  assert.equal(empty.status, USAGE_EXIT_CODE);
  assert.match(empty.stderr, /at least one test file is required/);
});
