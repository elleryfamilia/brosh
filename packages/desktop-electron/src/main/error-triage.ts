/**
 * Error Triage Module
 *
 * Uses `claude -p --model haiku` to decide whether a terminal error
 * is worth notifying the user about, and generates a contextual summary.
 *
 * Returns null on any failure (timeout, parse error, process error)
 * so the caller can fall back to "no badge" behavior.
 */

import { spawn, type ChildProcess } from "child_process";

const debug = (msg: string, ...args: unknown[]) => {
  console.log(`[error-triage] ${msg}`, ...args);
};

export interface TriageResult {
  shouldNotify: boolean;
  message: string;
}

interface TriageHandle {
  promise: Promise<TriageResult | null>;
  cancel: () => void;
}

const TRIAGE_TIMEOUT_MS = 8000;

/**
 * Build the prompt sent to Claude for error triage.
 */
export function buildTriagePrompt(
  command: string | null,
  exitCode: number,
  recentOutput: string
): string {
  const trimmedOutput = recentOutput.trim();
  return `You are an error triage system. A terminal command just failed.

Command: ${command || "unknown"}
Exit code: ${exitCode}
Recent output (last 30 lines):
\`\`\`
${trimmedOutput}
\`\`\`

Respond with ONLY a JSON object (no markdown, no explanation):
{"shouldNotify": true/false, "message": "one-sentence contextual help"}

DEFAULT: shouldNotify=true. Most non-zero exit codes indicate real problems the user needs help with.

shouldNotify=false ONLY when:
- The command is explicitly designed to return non-zero (e.g., "false", "test" expressions, "grep" with no matches)
- User intentionally interrupted (Ctrl+C / SIGINT / SIGTERM)
- Build/test watchers that restart on failure (expected workflow)
- The user already received a notification for the same type of error recently (visible in the terminal output above)

shouldNotify=true for ANY real execution error, including but not limited to:
- Module/package not found (require, import, pip, npm errors)
- File or directory not found (ENOENT, "No such file")
- Permission denied
- Syntax errors, parse errors, compilation errors
- Runtime exceptions, crashes, segfaults
- Missing commands or dependencies
- Configuration errors
- Failed tests or assertions
- Network errors, connection refused
- Any error message in the output that indicates something went wrong

When in doubt, notify. It is better to show a notification for a real error than to miss one.

If shouldNotify=false, message can be empty string.
If shouldNotify=true, message should be a brief, actionable one-sentence summary of what went wrong.`;
}

/**
 * Spawn `claude -p --model haiku --output-format json` to triage an error.
 *
 * Returns a handle with:
 * - `promise`: resolves to TriageResult or null on failure
 * - `cancel()`: kills the process early
 */
export function triageError(
  claudePath: string,
  prompt: string,
  cwd?: string
): TriageHandle {
  let proc: ChildProcess | null = null;
  let killed = false;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const cancel = () => {
    killed = true;
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    if (proc && !proc.killed) {
      proc.kill("SIGTERM");
    }
  };

  const promise = new Promise<TriageResult | null>((resolve) => {
    try {
      proc = spawn(
        claudePath,
        ["-p", "--model", "haiku", "--output-format", "json"],
        {
          cwd: cwd || process.cwd(),
          stdio: ["pipe", "pipe", "pipe"],
          env: { ...process.env },
        }
      );

      // Write prompt to stdin and close it
      if (proc.stdin) {
        proc.stdin.write(prompt);
        proc.stdin.end();
      }

      let stdout = "";
      let stderr = "";

      proc.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      proc.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      // Timeout: kill process after TRIAGE_TIMEOUT_MS
      timeoutId = setTimeout(() => {
        if (!killed && proc && !proc.killed) {
          debug(`Triage timed out after ${TRIAGE_TIMEOUT_MS}ms`);
          proc.kill("SIGTERM");
          killed = true;
          resolve(null);
        }
      }, TRIAGE_TIMEOUT_MS);

      proc.on("error", (err) => {
        debug(`Triage process error: ${err.message}`);
        if (timeoutId) clearTimeout(timeoutId);
        resolve(null);
      });

      proc.on("close", (code) => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }

        if (killed) {
          // Already resolved via timeout or cancel
          return;
        }

        if (code !== 0) {
          debug(`Triage process exited with code ${code}: ${stderr.trim()}`);
          resolve(null);
          return;
        }

        // Parse the JSON response
        const result = parseTriageResponse(stdout);
        resolve(result);
      });
    } catch (err) {
      debug(`Failed to spawn triage process: ${err}`);
      resolve(null);
    }
  });

  return { promise, cancel };
}

/**
 * Parse the triage response from Claude.
 *
 * `claude --output-format json` wraps the response in a `{ result: "..." }` envelope.
 * The inner `result` string contains the actual JSON we asked for.
 */
function parseTriageResponse(stdout: string): TriageResult | null {
  try {
    const trimmed = stdout.trim();
    if (!trimmed) return null;

    // First, try parsing the outer envelope
    let innerJson: string;
    try {
      const envelope = JSON.parse(trimmed);
      if (envelope && typeof envelope.result === "string") {
        innerJson = envelope.result;
      } else if (
        envelope &&
        typeof envelope.shouldNotify === "boolean"
      ) {
        // Direct format (no envelope)
        return {
          shouldNotify: envelope.shouldNotify,
          message: String(envelope.message || ""),
        };
      } else {
        debug("Unexpected envelope format:", trimmed.substring(0, 200));
        return null;
      }
    } catch {
      // Maybe it's direct JSON without envelope
      innerJson = trimmed;
    }

    // Parse the inner JSON
    // Claude sometimes wraps JSON in markdown code fences
    let cleaned = innerJson.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
    }

    const parsed = JSON.parse(cleaned);
    if (typeof parsed.shouldNotify !== "boolean") {
      debug("Missing shouldNotify in triage response:", cleaned.substring(0, 200));
      return null;
    }

    return {
      shouldNotify: parsed.shouldNotify,
      message: String(parsed.message || ""),
    };
  } catch (err) {
    debug(`Failed to parse triage response: ${err}`);
    debug(`Raw stdout: ${stdout.substring(0, 500)}`);
    return null;
  }
}
