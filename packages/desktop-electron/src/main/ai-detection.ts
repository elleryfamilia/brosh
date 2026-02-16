/**
 * Natural Language Detection Module
 *
 * ML-based classification using the brosh-ky model to distinguish
 * between shell commands and natural language queries.
 *
 * Classification is invoked only when the user presses Enter.
 * Fallback to COMMAND mode if ML is unavailable.
 */

import { execSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import {
  classifyWithML,
  preloadModel,
  getModelStatus,
  type MLClassificationResult,
} from "./ml-classifier.js";
import { distance } from "fastest-levenshtein";

// Debug logging
const debug = (msg: string, ...args: unknown[]) => {
  if (process.env.DEBUG_AI_DETECTION) {
    console.log(`[ai-detection] ${msg}`, ...args);
  }
};

/**
 * Known subcommands for common tools
 * These are stable and rarely change - safe to hardcode
 */
const SUBCOMMAND_REGISTRY: Record<string, Set<string>> = {
  git: new Set([
    'add', 'bisect', 'branch', 'checkout', 'cherry-pick', 'clone', 'commit',
    'diff', 'fetch', 'grep', 'init', 'log', 'merge', 'mv', 'pull', 'push',
    'rebase', 'remote', 'reset', 'restore', 'revert', 'rm', 'show', 'stash',
    'status', 'switch', 'tag', 'worktree',
  ]),
  npm: new Set([
    'access', 'adduser', 'audit', 'bugs', 'cache', 'ci', 'completion',
    'config', 'dedupe', 'deprecate', 'diff', 'dist-tag', 'docs', 'doctor',
    'edit', 'exec', 'explain', 'explore', 'find-dupes', 'fund', 'help',
    'hook', 'init', 'install', 'link', 'll', 'login', 'logout', 'ls',
    'org', 'outdated', 'owner', 'pack', 'ping', 'pkg', 'prefix', 'profile',
    'prune', 'publish', 'query', 'rebuild', 'repo', 'restart', 'root',
    'run', 'search', 'set', 'shrinkwrap', 'star', 'stars', 'start', 'stop',
    'team', 'test', 'token', 'uninstall', 'unpublish', 'unstar', 'update',
    'version', 'view', 'whoami',
  ]),
  docker: new Set([
    'attach', 'build', 'commit', 'compose', 'container', 'context', 'cp',
    'create', 'diff', 'events', 'exec', 'export', 'history', 'image',
    'images', 'import', 'info', 'inspect', 'kill', 'load', 'login', 'logout',
    'logs', 'manifest', 'network', 'node', 'pause', 'plugin', 'port', 'ps',
    'pull', 'push', 'rename', 'restart', 'rm', 'rmi', 'run', 'save', 'search',
    'secret', 'service', 'stack', 'start', 'stats', 'stop', 'swarm', 'system',
    'tag', 'top', 'trust', 'unpause', 'update', 'version', 'volume', 'wait',
  ]),
  kubectl: new Set([
    'annotate', 'api-resources', 'api-versions', 'apply', 'attach', 'auth',
    'autoscale', 'certificate', 'cluster-info', 'completion', 'config',
    'cordon', 'cp', 'create', 'debug', 'delete', 'describe', 'diff', 'drain',
    'edit', 'events', 'exec', 'explain', 'expose', 'get', 'kustomize', 'label',
    'logs', 'patch', 'plugin', 'port-forward', 'proxy', 'replace', 'rollout',
    'run', 'scale', 'set', 'taint', 'top', 'uncordon', 'version', 'wait',
  ]),
  brew: new Set([
    'analytics', 'autoremove', 'cask', 'cleanup', 'commands', 'config',
    'deps', 'desc', 'doctor', 'fetch', 'formulae', 'home', 'info', 'install',
    'leaves', 'link', 'list', 'log', 'migrate', 'missing', 'options',
    'outdated', 'pin', 'postinstall', 'reinstall', 'search', 'services',
    'shellenv', 'tap', 'uninstall', 'unlink', 'unpin', 'untap', 'update',
    'upgrade', 'uses',
  ]),
  yarn: new Set([
    'add', 'audit', 'autoclean', 'bin', 'cache', 'check', 'config', 'create',
    'dlx', 'exec', 'generate-lock-entry', 'global', 'help', 'import', 'info',
    'init', 'install', 'licenses', 'link', 'list', 'login', 'logout', 'node',
    'outdated', 'owner', 'pack', 'plugin', 'policies', 'publish', 'rebuild',
    'remove', 'run', 'search', 'set', 'tag', 'team', 'unlink', 'unplug',
    'upgrade', 'upgrade-interactive', 'version', 'versions', 'why', 'workspace',
    'workspaces',
  ]),
  cargo: new Set([
    'add', 'bench', 'build', 'check', 'clean', 'clippy', 'doc', 'fetch',
    'fix', 'fmt', 'generate-lockfile', 'help', 'init', 'install', 'locate-project',
    'login', 'logout', 'metadata', 'new', 'owner', 'package', 'pkgid', 'publish',
    'read-manifest', 'remove', 'report', 'run', 'rustc', 'rustdoc', 'search',
    'test', 'tree', 'uninstall', 'update', 'vendor', 'verify-project', 'version',
    'yank',
  ]),
  gh: new Set([
    'api', 'auth', 'browse', 'cache', 'codespace', 'completion', 'config',
    'extension', 'gist', 'gpg-key', 'issue', 'label', 'org', 'pr', 'project',
    'release', 'repo', 'ruleset', 'run', 'search', 'secret', 'ssh-key',
    'status', 'variable', 'workflow',
  ]),
  pnpm: new Set([
    'add', 'audit', 'bin', 'cache', 'config', 'create', 'dedupe', 'deploy',
    'dlx', 'doctor', 'env', 'exec', 'fetch', 'import', 'init', 'install',
    'licenses', 'link', 'list', 'outdated', 'pack', 'patch', 'prune', 'publish',
    'rebuild', 'recursive', 'remove', 'root', 'run', 'server', 'setup', 'start',
    'store', 'test', 'unlink', 'update', 'why',
  ]),
  // Shell prompt/theme tools (often shell functions, not in PATH)
  p10k: new Set([
    'configure', 'reload', 'display', 'segment', 'help',
  ]),
  starship: new Set([
    'bug-report', 'completions', 'config', 'explain', 'init', 'module',
    'preset', 'print-config', 'prompt', 'session', 'time', 'timings', 'toggle',
  ]),
  'oh-my-posh': new Set([
    'cache', 'config', 'debug', 'disable', 'enable', 'font', 'get', 'init',
    'notice', 'print', 'prompt', 'toggle', 'upgrade', 'version',
  ]),
};

/**
 * Check if a command has known subcommands in our registry
 */
export function commandHasSubcommands(command: string): boolean {
  return command.toLowerCase() in SUBCOMMAND_REGISTRY;
}

/**
 * Check if the second word is a valid subcommand for the given command
 */
export function hasValidSubcommand(command: string, secondWord: string): boolean {
  const subcommands = SUBCOMMAND_REGISTRY[command.toLowerCase()];
  if (!subcommands) return false; // Not a command we track
  return subcommands.has(secondWord.toLowerCase());
}

/**
 * Get the set of subcommands for a command
 */
export function getSubcommands(command: string): Set<string> | undefined {
  return SUBCOMMAND_REGISTRY[command.toLowerCase()];
}

/**
 * Classification result
 */
export type InputClassification = "COMMAND" | "NATURAL_LANGUAGE" | "AMBIGUOUS";

export interface ClassificationResult {
  classification: InputClassification;
  confidence: number;
  tier: "ml" | "fallback";
  reason?: string;
  mlResult?: MLClassificationResult;
}

/**
 * ML classification settings
 */
let mlEnabled = true; // Enable ML by default
let mlPreloaded = false;

/**
 * Enable or disable ML-based classification
 */
export function setMLEnabled(enabled: boolean): void {
  mlEnabled = enabled;
  debug(`ML classification ${enabled ? "enabled" : "disabled"}`);
}

/**
 * Check if ML classification is enabled
 */
export function isMLEnabled(): boolean {
  return mlEnabled;
}

/**
 * Get ML model status
 */
export { getModelStatus } from "./ml-classifier.js";

/**
 * Command cache for O(1) lookup of known commands
 */
class CommandCache {
  private commands: Set<string> = new Set();
  private aliases: Set<string> = new Set();
  private functions: Set<string> = new Set();
  private initialized = false;

  // Shell builtins that are always available
  private readonly builtins = new Set([
    "cd",
    "echo",
    "exit",
    "export",
    "alias",
    "source",
    "pwd",
    "pushd",
    "popd",
    "dirs",
    "set",
    "unset",
    "readonly",
    "declare",
    "local",
    "typeset",
    "return",
    "break",
    "continue",
    "shift",
    "eval",
    "exec",
    "trap",
    "wait",
    "kill",
    "jobs",
    "fg",
    "bg",
    "test",
    "[",
    "[[",
    "true",
    "false",
    "read",
    "printf",
    "let",
    "history",
    "type",
    "which",
    "command",
    "builtin",
    "hash",
    "umask",
    "ulimit",
    "times",
    "getopts",
    "enable",
    "disown",
    "suspend",
    "logout",
    "compgen",
    "complete",
    "compopt",
    "mapfile",
    "readarray",
    // zsh specific
    "where",
    "whence",
    "autoload",
    "bindkey",
    "zstyle",
    "setopt",
    "unsetopt",
  ]);

  /**
   * Initialize the command cache by scanning PATH
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Get commands from PATH using compgen (bash) or rehash (zsh)
      const shell = process.env.SHELL || "/bin/bash";
      const isZsh = shell.includes("zsh");

      // Use a subshell to get all available commands
      const cmd = isZsh
        ? `zsh -c 'print -l \${(k)commands}'`
        : `bash -c 'compgen -c'`;

      const output = execSync(cmd, {
        encoding: "utf-8",
        timeout: 5000,
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large PATH
      });

      output.split("\n").forEach((line) => {
        const cmd = line.trim();
        if (cmd) {
          this.commands.add(cmd);
        }
      });

      // Also get aliases (requires interactive shell to source rc files)
      try {
        const aliasCmd = isZsh ? `zsh -ic 'alias'` : `bash -ic 'alias'`;
        const aliasOutput = execSync(aliasCmd, {
          encoding: "utf-8",
          timeout: 3000,
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        aliasOutput.split("\n").forEach((line) => {
          // Parse "alias name='...'" or "name=..."
          const match = line.match(/^(?:alias\s+)?([^=]+)=/);
          if (match) {
            this.aliases.add(match[1].trim());
          }
        });
      } catch {
        // Aliases are optional, ignore errors
      }

      // Also get shell functions (requires interactive shell to source rc files)
      // This catches functions like p10k, nvm, pyenv, etc.
      try {
        const funcCmd = isZsh
          ? `zsh -ic 'print -l \${(k)functions}'`
          : `bash -ic 'declare -F | cut -d" " -f3'`;
        const funcOutput = execSync(funcCmd, {
          encoding: "utf-8",
          timeout: 5000,
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        funcOutput.split("\n").forEach((line) => {
          const func = line.trim();
          // Filter out internal/private functions (starting with _ or -)
          if (func && !func.startsWith('_') && !func.startsWith('-')) {
            this.functions.add(func);
          }
        });
      } catch {
        // Functions are optional, ignore errors
      }

      this.initialized = true;
      debug(
        `Initialized with ${this.commands.size} commands, ${this.aliases.size} aliases, and ${this.functions.size} functions`
      );
    } catch (error) {
      console.error("[ai-detection] Failed to initialize command cache:", error);
      this.initialized = true; // Mark as initialized to avoid repeated failures
    }
  }

  /**
   * Check if a command exists in PATH by searching directories
   */
  private checkPathDirectly(command: string): boolean {
    // Skip empty or very short commands
    if (!command || command.length < 2) return false;

    // Skip if command contains path separators (already handled)
    if (command.includes('/')) return false;

    const pathEnv = process.env.PATH || '';
    const pathDirs = pathEnv.split(path.delimiter);

    for (const dir of pathDirs) {
      if (!dir) continue;
      const fullPath = path.join(dir, command);
      if (fs.existsSync(fullPath)) {
        try {
          const stats = fs.statSync(fullPath);
          // Check if it's a file and executable
          if (stats.isFile()) {
            return true;
          }
        } catch {
          // Ignore permission errors, etc.
        }
      }
    }
    return false;
  }

  /**
   * Check if a command exists using shell's `command -v`
   * This catches shell functions, aliases, and commands not in our cache
   */
  private checkViaShell(command: string): boolean {
    try {
      // Use `command -v` which is POSIX standard and works in bash/zsh/sh
      execSync(`command -v ${command}`, {
        encoding: 'utf-8',
        timeout: 1000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if a word is a known command, alias, function, or builtin
   */
  isKnownCommand(word: string): boolean {
    // Quick check for builtins first (always available)
    if (this.builtins.has(word)) return true;

    // Check cached commands, aliases, and functions
    if (this.commands.has(word)) return true;
    if (this.aliases.has(word)) return true;
    if (this.functions.has(word)) return true;

    // Check if it looks like a path to an executable
    if (word.startsWith("./") || word.startsWith("/") || word.startsWith("~")) {
      return true;
    }

    // Fallback: Check PATH directly for commands not in cache
    // This catches commands installed after cache initialization
    if (this.checkPathDirectly(word)) {
      // Add to cache for future lookups
      this.commands.add(word);
      debug(`Discovered command in PATH: ${word}`);
      return true;
    }

    // Last resort: Query the shell itself
    // This catches shell functions and other edge cases
    if (this.checkViaShell(word)) {
      // Add to cache for future lookups
      this.commands.add(word);
      debug(`Discovered command via shell: ${word}`);
      return true;
    }

    return false;
  }

  /**
   * Get initialization status
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get all known commands for fuzzy matching
   */
  getAllCommands(): string[] {
    return [...this.builtins, ...this.commands, ...this.aliases, ...this.functions];
  }
}

// Singleton command cache
const commandCache = new CommandCache();

/**
 * Initialize the detection system (call once on startup)
 *
 * @param options - Configuration options
 * @param options.preloadML - Whether to preload the ML model (slower startup, faster first classification)
 */
export async function initializeDetection(options?: {
  preloadML?: boolean;
}): Promise<void> {
  await commandCache.initialize();

  // Optionally preload ML model in background
  if (options?.preloadML && mlEnabled) {
    debug("Preloading ML model in background...");
    preloadModel()
      .then((success) => {
        mlPreloaded = success;
        debug(`ML model preload ${success ? "succeeded" : "failed"}`);
      })
      .catch((err) => {
        debug(`ML model preload error: ${err}`);
      });
  }
}

/**
 * Check if a word is a known command (O(1) lookup)
 * Used for real-time input mode feedback
 */
export function isKnownCommand(word: string): boolean {
  return commandCache.isKnownCommand(word);
}


/**
 * Main classification function (async, ML-only)
 *
 * Uses the brosh-ky ML model for all classification.
 * Falls back to COMMAND mode if ML is unavailable.
 */
export async function classifyInput(input: string): Promise<ClassificationResult> {
  const trimmed = input.trim();

  // Empty input - let shell handle it
  if (!trimmed) {
    return {
      classification: "COMMAND",
      confidence: 1.0,
      tier: "fallback",
      reason: "empty input",
    };
  }

  // If ML is disabled, fall back to shell
  if (!mlEnabled) {
    debug("ML disabled, falling back to shell");
    return {
      classification: "COMMAND",
      confidence: 0.5,
      tier: "fallback",
      reason: "ML disabled",
    };
  }

  // Use ML classifier
  try {
    debug("Running ML classification...");
    const mlResult = await classifyWithML(input);

    if (mlResult) {
      debug(
        `ML: ${mlResult.classification} (${mlResult.confidence.toFixed(2)}) in ${mlResult.inferenceTimeMs.toFixed(1)}ms`
      );

      return {
        classification: mlResult.classification,
        confidence: mlResult.confidence,
        tier: "ml",
        reason: `ML classifier (command: ${mlResult.scores.command.toFixed(2)}, NL: ${mlResult.scores.naturalLanguage.toFixed(2)})`,
        mlResult,
      };
    }
  } catch (error) {
    debug(`ML classification failed: ${error}`);
  }

  // ML unavailable or failed - fall back to shell
  debug("ML unavailable, falling back to shell");
  return {
    classification: "COMMAND",
    confidence: 0.5,
    tier: "fallback",
    reason: "ML unavailable",
  };
}

/**
 * Tier 3: Check if command output indicates "command not found"
 *
 * Called after command execution to catch false negatives.
 */
export function isCommandNotFound(stderr: string): boolean {
  const patterns = [
    /command not found/i,
    /not found/i,
    /unknown command/i,
    /not recognized/i,
    /: not found$/m,
    /No such file or directory/i,
  ];

  return patterns.some((p) => p.test(stderr));
}

/**
 * User override prefixes
 *
 * Users can force interpretation:
 * - `!command` forces command mode (strips the !)
 * - `?query` forces AI mode (strips the ?)
 */
export function checkOverridePrefix(input: string): {
  override: "COMMAND" | "NATURAL_LANGUAGE" | null;
  cleanedInput: string;
} {
  const trimmed = input.trim();

  if (trimmed.startsWith("!") && trimmed.length > 1) {
    return {
      override: "COMMAND",
      cleanedInput: trimmed.slice(1),
    };
  }

  if (trimmed.startsWith("?") && trimmed.length > 1) {
    return {
      override: "NATURAL_LANGUAGE",
      cleanedInput: trimmed.slice(1),
    };
  }

  return {
    override: null,
    cleanedInput: trimmed,
  };
}

/**
 * Typo suggestion result
 */
export interface TypoSuggestion {
  original: string;
  suggested: string;
  type: 'command' | 'subcommand';
  distance: number;
  fullSuggestion: string;
}

/**
 * Check if two words are transpositions of each other (same chars, different order)
 */
function isTransposition(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return [...a.toLowerCase()].sort().join('') === [...b.toLowerCase()].sort().join('');
}

/**
 * Find closest match for a potential typo
 * Returns null if no close match found
 *
 * Uses a scoring system that considers:
 * 1. Edit distance (lower is better)
 * 2. Whether it's a transposition (same letters, reordered) - strongly preferred
 * 3. Whether it shares the same first letter - mildly preferred
 *
 * This helps prefer "npm" over "cmp" for typo "nmp" even though
 * standard Levenshtein distance is lower for "cmp".
 */
export function findTypoSuggestion(
  word: string,
  candidates: Set<string> | string[],
  maxDistance: number = 2
): string | null {
  const candidateArray = Array.isArray(candidates) ? candidates : [...candidates];
  const wordLower = word.toLowerCase();

  let bestMatch: string | null = null;
  let bestScore = Infinity;

  for (const candidate of candidateArray) {
    // Quick length check - skip if too different
    if (Math.abs(candidate.length - word.length) > maxDistance) continue;

    const candidateLower = candidate.toLowerCase();
    const d = distance(wordLower, candidateLower);

    if (d > 0 && d <= maxDistance) {
      // Calculate a score that prefers transpositions and same-first-letter matches
      // Lower score is better
      let score = d * 10; // Base score from edit distance

      // Strong preference for transpositions (same letters, just reordered)
      // e.g., "nmp" → "npm" should be preferred over "nmp" → "cmp"
      if (isTransposition(word, candidate)) {
        score -= 15; // Big bonus for transpositions
      }

      // Mild preference for same first letter
      // e.g., "gti" starts with 'g', "git" starts with 'g'
      if (wordLower[0] === candidateLower[0]) {
        score -= 3;
      }

      // Mild preference for same last letter
      if (wordLower[wordLower.length - 1] === candidateLower[candidateLower.length - 1]) {
        score -= 2;
      }

      if (score < bestScore) {
        bestScore = score;
        bestMatch = candidate;
      }
    }
  }

  return bestMatch;
}

/**
 * Common question/NL starter words that should never be treated as command typos
 */
const NL_STARTER_WORDS = new Set([
  'how', 'what', 'why', 'where', 'when', 'who', 'which', 'whose',
  'can', 'could', 'would', 'should', 'will', 'shall', 'may', 'might', 'must',
  'is', 'are', 'was', 'were', 'am', 'be', 'been', 'being',
  'do', 'does', 'did', 'have', 'has', 'had',
  'i', 'you', 'he', 'she', 'it', 'we', 'they',
  'my', 'your', 'his', 'her', 'its', 'our', 'their',
  'this', 'that', 'these', 'those',
  'please', 'help', 'show', 'tell', 'explain', 'describe', 'list', 'find', 'search',
  'the', 'a', 'an',
  // Conversational words - common in AI chat responses
  'yes', 'no', 'ok', 'okay', 'sure', 'thanks', 'thank', 'sorry', 'hi', 'hello',
  'hey', 'great', 'good', 'nice', 'cool', 'awesome', 'perfect', 'fine', 'right',
  'yeah', 'yep', 'nope', 'maybe', 'probably', 'definitely', 'absolutely',
]);

/**
 * Check if input contains typos and suggest corrections
 *
 * Returns a TypoSuggestion if a likely typo is detected, null otherwise.
 * Uses edit distance to find close matches:
 * - For words <= 2 chars: max distance of 1
 * - For words 3-5 chars: max distance of 2 (catches transpositions like gti→git)
 * - For longer words: max distance of 2
 *
 * Note: Standard Levenshtein treats transpositions as 2 edits (e.g., "gti" → "git" = 2),
 * so we use a threshold of 2 for most words to catch common typos.
 */
export function detectTypos(input: string): TypoSuggestion | null {
  const trimmed = input.trim();

  // Early return for empty input
  if (!trimmed) {
    return null;
  }

  const words = trimmed.split(/\s+/);
  const firstWord = words[0];
  const secondWord = words[1];

  // Strip punctuation from first word for NL detection (e.g., "yes," → "yes")
  const firstWordClean = firstWord.replace(/[.,!?;:'"]+$/, '').toLowerCase();

  // Skip typo detection for common NL starter words
  // These are clearly not command typos
  if (NL_STARTER_WORDS.has(firstWordClean)) {
    return null;
  }

  // Skip typo detection for contractions (i'm, don't, what's, etc.)
  // These are clearly natural language, not command typos
  if (/\w'\w/.test(firstWord)) {
    return null;
  }

  // Check if first word is a typo of a known command
  if (!commandCache.isKnownCommand(firstWord)) {
    // Get threshold based on word length
    // Use 2 for most words to catch transpositions (gti→git, nmp→npm)
    const maxDist = firstWord.length <= 2 ? 1 : 2;
    debug(`Checking typo for "${firstWord}" with maxDist=${maxDist}`);
    const suggestion = findTypoSuggestion(firstWord, commandCache.getAllCommands(), maxDist);

    if (suggestion) {
      // Additional validation: reject suggestions with very different lengths
      // "how" (3) → "w" (1) is not a useful suggestion
      const lengthDiff = Math.abs(firstWord.length - suggestion.length);
      if (lengthDiff > 1) {
        debug(`Rejecting suggestion "${suggestion}" - length difference too large (${lengthDiff})`);
        return null;
      }

      // Reject shorter suggestions that don't share the first letter
      // "eza" → "la" is not useful (different first letter, suggestion is shorter)
      // This prevents unknown commands from matching unrelated short aliases
      const firstWordLower = firstWord.toLowerCase();
      const suggestionLower = suggestion.toLowerCase();
      if (suggestion.length < firstWord.length && firstWordLower[0] !== suggestionLower[0]) {
        debug(`Rejecting suggestion "${suggestion}" - shorter and different first letter`);
        return null;
      }

      // Build the corrected command
      const fullSuggestion = [suggestion, ...words.slice(1)].join(' ');

      // Validate the corrected command looks reasonable
      // For commands with subcommands (git, npm, etc.), check the subcommand is valid
      // This prevents "gti how do I revert" → "git how do I revert" (not a valid git subcommand)
      if (commandHasSubcommands(suggestion)) {
        const subcommands = SUBCOMMAND_REGISTRY[suggestion.toLowerCase()];
        const nextWord = words[1];
        // If there's a next word and the command has known subcommands,
        // reject if the next word isn't a valid subcommand
        if (nextWord && subcommands && !subcommands.has(nextWord.toLowerCase())) {
          // Check if it looks like a flag or path (those are OK)
          if (!/^[-./~]/.test(nextWord)) {
            debug(`Rejecting suggestion "${fullSuggestion}" - invalid subcommand "${nextWord}"`);
            return null;
          }
        }
      }

      const d = distance(firstWord.toLowerCase(), suggestion.toLowerCase());
      debug(`Found typo suggestion: "${firstWord}" → "${suggestion}" (distance=${d})`);

      return {
        original: firstWord,
        suggested: suggestion,
        type: 'command',
        distance: d,
        fullSuggestion,
      };
    } else {
      debug(`No typo suggestion found for "${firstWord}"`);
    }
  }

  // Check if second word is a typo of a subcommand
  if (secondWord && commandHasSubcommands(firstWord)) {
    const subcommands = SUBCOMMAND_REGISTRY[firstWord.toLowerCase()];
    if (subcommands && !subcommands.has(secondWord.toLowerCase())) {
      // Use 2 for most words to catch transpositions (comit→commit, stauts→status)
      const maxDist = secondWord.length <= 2 ? 1 : 2;
      const suggestion = findTypoSuggestion(secondWord, subcommands, maxDist);

      if (suggestion) {
        const d = distance(secondWord.toLowerCase(), suggestion.toLowerCase());
        // Build the full corrected command
        const fullSuggestion = [firstWord, suggestion, ...words.slice(2)].join(' ');

        return {
          original: secondWord,
          suggested: suggestion,
          type: 'subcommand',
          distance: d,
          fullSuggestion,
        };
      }
    }
  }

  return null;
}
