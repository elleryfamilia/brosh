/**
 * Environment variable helpers for brosh.
 *
 * Supports both BROSH_* and legacy TERMINAL_MCP_* env vars.
 * Legacy vars trigger a one-time deprecation warning on stderr.
 */

const warnedVars = new Set<string>();

/**
 * Read an environment variable, checking the new BROSH_* name first,
 * then falling back to the legacy TERMINAL_MCP_* name with a deprecation warning.
 */
export function getEnv(broshName: string, legacyName: string): string | undefined {
  const broshVal = process.env[broshName];
  if (broshVal !== undefined) {
    return broshVal;
  }

  const legacyVal = process.env[legacyName];
  if (legacyVal !== undefined) {
    if (!warnedVars.has(legacyName)) {
      warnedVars.add(legacyName);
      console.error(
        `[brosh] Warning: ${legacyName} is deprecated, use ${broshName} instead.`
      );
    }
    return legacyVal;
  }

  return undefined;
}

/**
 * Set both the new and legacy env var names on a process env object.
 * Used when spawning child processes that may check either name.
 */
export function setEnv(
  env: Record<string, string>,
  broshName: string,
  legacyName: string,
  value: string
): void {
  env[broshName] = value;
  env[legacyName] = value;
}
