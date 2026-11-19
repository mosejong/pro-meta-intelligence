#!/usr/bin/env node
// Runs `node --test` over an explicit file list with a whole-process wall-clock
// deadline. `--test-timeout` only bounds test bodies; it does not stop a test
// process that stays alive on lingering handles after its tests finish. This
// wrapper bounds the child process itself and kills only the tree it spawned.
import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { constants as osConstants } from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

export const DEFAULT_DEADLINE_MS = 300_000;
export const TIMEOUT_EXIT_CODE = 124;
export const USAGE_EXIT_CODE = 2;
export const NODE_TEST_FLAGS = Object.freeze([
  "--test",
  "--test-concurrency=4",
  "--test-timeout=120000",
]);

const HANDLED_SIGNALS = Object.freeze(["SIGINT", "SIGTERM"]);
const DEFAULT_KILL_GRACE_MS = 10_000;

export function buildNodeTestArgs(files) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new TypeError("at least one test file is required");
  }
  for (const file of files) {
    if (typeof file !== "string" || file.length === 0) {
      throw new TypeError("test file paths must be non-empty strings");
    }
    if (file.startsWith("-")) {
      throw new TypeError("test file list must not contain flags");
    }
  }
  return [...NODE_TEST_FLAGS, ...files];
}

function taskkillPath() {
  const systemRoot = process.env.SystemRoot || process.env.windir || "C:\\Windows";
  return path.join(systemRoot, "System32", "taskkill.exe");
}

// Kills only the process tree rooted at `pid`, which must be a child this
// module spawned. Windows: taskkill /T on that PID. POSIX: the child was
// spawned detached as its own process group leader, so signal that group.
export function killProcessTree(pid, platform = process.platform) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return Promise.resolve({ ok: false, detail: "no child pid" });
  }
  if (platform === "win32") {
    return new Promise((resolve) => {
      let killer;
      try {
        killer = spawn(taskkillPath(), ["/PID", String(pid), "/T", "/F"], {
          stdio: "ignore",
          windowsHide: true,
          shell: false,
        });
      } catch (error) {
        resolve({ ok: false, detail: `taskkill failed to start (${error?.code ?? "error"})` });
        return;
      }
      killer.once("error", (error) => {
        resolve({ ok: false, detail: `taskkill failed to start (${error?.code ?? "error"})` });
      });
      killer.once("exit", (code, signal) => {
        resolve({ ok: code === 0, detail: `taskkill exit ${code ?? signal}` });
      });
    });
  }
  try {
    process.kill(-pid, "SIGKILL");
    return Promise.resolve({ ok: true, detail: "SIGKILL sent to child process group" });
  } catch (error) {
    // ESRCH: the group is already gone.
    return Promise.resolve({ ok: error?.code === "ESRCH", detail: `group kill ${error?.code ?? "error"}` });
  }
}

/**
 * Spawns `command args` (no shell) and enforces a wall-clock deadline on the
 * whole child process. Resolves (never rejects) with a frozen result:
 * { exitCode, signal, error, timedOut, interruptedBy, killFailed, killDetail, pid }.
 */
export function runCommandWithDeadline(command, args, options = {}) {
  const {
    timeoutMs,
    cwd,
    env,
    stdio = "inherit",
    handleSignals = true,
    killGraceMs = DEFAULT_KILL_GRACE_MS,
    killTree = killProcessTree,
  } = options;

  if (typeof command !== "string" || command.length === 0) {
    throw new TypeError("command must be a non-empty string");
  }
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) {
    throw new TypeError("args must be an array of strings");
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("timeoutMs must be a positive integer");
  }
  if (!Number.isInteger(killGraceMs) || killGraceMs <= 0) {
    throw new TypeError("killGraceMs must be a positive integer");
  }

  const posix = process.platform !== "win32";

  return new Promise((resolve) => {
    let child = null;
    let settled = false;
    let timedOut = false;
    let interruptedBy = null;
    let terminating = false;
    let killDetail = null;
    let deadlineTimer = null;
    let graceTimer = null;
    const signalHandlers = [];

    const cleanup = () => {
      if (deadlineTimer !== null) clearTimeout(deadlineTimer);
      if (graceTimer !== null) clearTimeout(graceTimer);
      deadlineTimer = null;
      graceTimer = null;
      for (const [signal, handler] of signalHandlers) process.removeListener(signal, handler);
      signalHandlers.length = 0;
      if (child) {
        child.removeListener("exit", onExit);
        child.removeListener("error", onError);
      }
    };

    const settle = (fields) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(
        Object.freeze({
          exitCode: null,
          signal: null,
          error: null,
          killFailed: false,
          ...fields,
          timedOut,
          interruptedBy,
          killDetail,
          pid: child?.pid ?? null,
        }),
      );
    };

    const terminate = () => {
      if (terminating || settled) return;
      terminating = true;
      if (deadlineTimer !== null) {
        clearTimeout(deadlineTimer);
        deadlineTimer = null;
      }
      const pid = child?.pid;
      Promise.resolve()
        .then(() => killTree(pid))
        .then(
          (result) => {
            killDetail = result?.detail ?? null;
          },
          (error) => {
            killDetail = `kill failed (${error?.code ?? error?.message ?? "error"})`;
          },
        );
      graceTimer = setTimeout(() => {
        graceTimer = null;
        // The child did not exit after the kill attempt. Do not wait forever,
        // and do not pretend it succeeded: report killFailed.
        child?.unref();
        settle({ killFailed: true });
      }, killGraceMs);
    };

    function onExit(code, signal) {
      settle({ exitCode: code, signal });
    }

    function onError(error) {
      // Before a pid exists this is a spawn failure. After spawn, errors come
      // only from child.kill/send, which this module does not use.
      if (child && child.pid === undefined) settle({ error });
    }

    try {
      child = spawn(command, args, {
        cwd,
        env,
        stdio,
        detached: posix,
        windowsHide: true,
        shell: false,
      });
    } catch (error) {
      settle({ error });
      return;
    }

    child.once("exit", onExit);
    child.on("error", onError);
    if (settled) return;

    deadlineTimer = setTimeout(() => {
      deadlineTimer = null;
      timedOut = true;
      terminate();
    }, timeoutMs);

    if (handleSignals) {
      for (const signal of HANDLED_SIGNALS) {
        const handler = () => {
          if (interruptedBy === null) interruptedBy = signal;
          terminate();
        };
        signalHandlers.push([signal, handler]);
        process.on(signal, handler);
      }
    }
  });
}

export function resolveExitCode(result) {
  if (result.timedOut) return TIMEOUT_EXIT_CODE;
  if (result.interruptedBy) return 128 + (osConstants.signals[result.interruptedBy] ?? 0);
  if (result.error) return 1;
  if (result.killFailed) return 1;
  if (Number.isInteger(result.exitCode)) return result.exitCode;
  if (result.signal) return 128 + (osConstants.signals[result.signal] ?? 0);
  return 1;
}

function report(message) {
  process.stderr.write(`[run-unit-tests] ${message}\n`);
}

export async function main(files) {
  let nodeArgs;
  try {
    nodeArgs = buildNodeTestArgs(files);
  } catch (error) {
    report(`usage: node scripts/run-unit-tests.mjs <test files...> (${error.message})`);
    return USAGE_EXIT_CODE;
  }

  const result = await runCommandWithDeadline(process.execPath, nodeArgs, {
    timeoutMs: DEFAULT_DEADLINE_MS,
  });

  if (result.error) {
    report(`failed to start the node test process (${result.error.code ?? "error"})`);
  }
  if (result.timedOut) {
    report(
      `whole-process deadline of ${DEFAULT_DEADLINE_MS}ms exceeded; terminated child process tree ` +
        `(pid ${result.pid}, ${result.killDetail ?? "kill pending"}). This is a failure.`,
    );
  }
  if (result.interruptedBy) {
    report(`received ${result.interruptedBy}; terminated child process tree (pid ${result.pid}).`);
  }
  if (result.killFailed) {
    report(`child process tree (pid ${result.pid}) did not exit after the kill attempt; it may still be running.`);
  }

  return resolveExitCode(result);
}

function isMainModule() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return pathToFileURL(realpathSync(entry)).href === import.meta.url;
  } catch {
    return false;
  }
}

if (isMainModule()) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      report(`internal error: ${error?.message ?? error}`);
      process.exitCode = 1;
    },
  );
}
