import * as pty from "node-pty";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execSync } from "child_process";
import xtermHeadless from "@xterm/headless";
const { Terminal } = xtermHeadless;
import { getDefaultShell } from "../utils/platform.js";
import { setEnv } from "../utils/env.js";
import type { SandboxController } from "../sandbox/index.js";

/**
 * Get system locale like Hyper does.
 * On macOS, reads from defaults. On Linux, checks environment.
 * Result is cached at module level so the execSync only runs once.
 */
let cachedSystemLocale: string | null = null;

export function getSystemLocale(): string {
  if (cachedSystemLocale !== null) return cachedSystemLocale;

  // Check if already set to UTF-8
  const lang = process.env.LANG || "";
  if (lang.toLowerCase().includes("utf-8") || lang.toLowerCase().includes("utf8")) {
    cachedSystemLocale = lang;
    return lang;
  }

  try {
    if (process.platform === "darwin") {
      // macOS: read from system preferences (no user input, safe static command)
      const output = execSync("defaults read -g AppleLocale 2>/dev/null", {
        encoding: "utf8",
        timeout: 1000,
      }).trim();
      if (output) {
        // Convert format: en_US -> en_US.UTF-8
        cachedSystemLocale = `${output.replace(/-/g, "_")}.UTF-8`;
        return cachedSystemLocale;
      }
    }
  } catch {
    // Fall through to default
  }

  // Default to en_US.UTF-8
  cachedSystemLocale = "en_US.UTF-8";
  return cachedSystemLocale;
}

// Custom prompt indicator for brosh (nf-md-palm_tree from Nerd Fonts, U+F1055)
const PROMPT_INDICATOR = "\uDB84\uDC55";

// ── Pre-warm caches ──────────────────────────────────────────────────
// These module-level caches store expensive-to-compute values so that
// the first TerminalSession.create() after app launch is fast.

/** Cached base env (process.env minus npm_* and optionally LC_*) */
let cachedBaseEnv: { filterLc: boolean; env: Record<string, string> } | null = null;

function getFilteredBaseEnv(filterLcVars: boolean): Record<string, string> {
  if (cachedBaseEnv && cachedBaseEnv.filterLc === filterLcVars) {
    return { ...cachedBaseEnv.env };
  }
  const baseEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (filterLcVars && key.startsWith("LC_")) continue;
    if (key.startsWith("npm_")) continue;
    if (value !== undefined) baseEnv[key] = value;
  }
  cachedBaseEnv = { filterLc: filterLcVars, env: baseEnv };
  return { ...baseEnv };
}

/** Pre-warmed zsh ZDOTDIR path (written once, reused across sessions) */
let preWarmedZdotdir: string | null = null;
/** Pre-warmed bash rcfile path */
let preWarmedBashRc: string | null = null;

/**
 * Pre-write shell RC files to a stable temp path so initialize() can skip
 * the synchronous fs.writeFileSync calls on the hot path.
 */
function preWarmRcFiles(): void {
  const defaultShell = path.basename(getDefaultShell());

  if (defaultShell === "zsh" && !preWarmedZdotdir) {
    const userZdotdir = process.env.ZDOTDIR || os.homedir();
    const zdotdir = path.join(os.tmpdir(), `brosh-zsh-${process.pid}`);
    fs.mkdirSync(zdotdir, { recursive: true });

    // .zshenv
    fs.writeFileSync(path.join(zdotdir, ".zshenv"),
      `typeset -g __BROSH_WRAPPER_ZDOTDIR="$ZDOTDIR"\n` +
      `export ZDOTDIR="${userZdotdir}"\n` +
      `HISTFILE="${userZdotdir}/.zsh_history"\n` +
      `[[ -f "${userZdotdir}/.zshenv" ]] && source "${userZdotdir}/.zshenv"\n` +
      `export ZDOTDIR="$__BROSH_WRAPPER_ZDOTDIR"\n` +
      `unset __BROSH_WRAPPER_ZDOTDIR\n` +
      `[[ -z "$HISTFILE" ]] && HISTFILE="${userZdotdir}/.zsh_history"\n` +
      `[[ "$HISTFILE" == "$ZDOTDIR/.zsh_history" ]] && HISTFILE="${userZdotdir}/.zsh_history"\n`);

    // .zprofile
    fs.writeFileSync(path.join(zdotdir, ".zprofile"),
      `typeset -g __BROSH_WRAPPER_ZDOTDIR="$ZDOTDIR"\n` +
      `export ZDOTDIR="${userZdotdir}"\n` +
      `[[ -f "${userZdotdir}/.zprofile" ]] && source "${userZdotdir}/.zprofile"\n` +
      `export ZDOTDIR="$__BROSH_WRAPPER_ZDOTDIR"\n` +
      `unset __BROSH_WRAPPER_ZDOTDIR\n` +
      `[[ -z "$HISTFILE" ]] && HISTFILE="${userZdotdir}/.zsh_history"\n` +
      `[[ "$HISTFILE" == "$ZDOTDIR/.zsh_history" ]] && HISTFILE="${userZdotdir}/.zsh_history"\n`);

    // .zshrc
    const zshrcContent = `
# Keep wrapper ZDOTDIR so brosh startup files still run.
typeset -g __BROSH_WRAPPER_ZDOTDIR="$ZDOTDIR"

# Make user config see the real ZDOTDIR.
# Many zsh configs derive HISTFILE from ZDOTDIR.
export ZDOTDIR="${userZdotdir}"
[[ -f "${userZdotdir}/.zshrc" ]] && source "${userZdotdir}/.zshrc"

# Restore wrapper ZDOTDIR for the remainder of startup.
export ZDOTDIR="$__BROSH_WRAPPER_ZDOTDIR"
unset __BROSH_WRAPPER_ZDOTDIR

# If user config left HISTFILE empty or pointing to wrapper temp ZDOTDIR,
# reset it to the user's default history file.
[[ -z "$HISTFILE" ]] && HISTFILE="${userZdotdir}/.zsh_history"
[[ "$HISTFILE" == "$ZDOTDIR/.zsh_history" ]] && HISTFILE="${userZdotdir}/.zsh_history"

# HISTFILE is set in .zshenv (before zsh initializes history).
# Set size defaults here; user's .zshrc can override.
: \${HISTSIZE:=50000}
: \${SAVEHIST:=10000}

# OSC 133 shell integration (command marks for error detection)
# A = prompt start, C = output start, D;exitcode = command finished
# Uses add-zsh-hook so it doesn't interfere with user's hooks
__brosh_cmd_executed=""
__brosh_precmd() {
  local exit_code=$?
  if [[ -n "$__brosh_cmd_executed" ]]; then
    printf '\\e]133;D;%d\\a' "$exit_code"
  fi
  __brosh_cmd_executed=""
  printf '\\e]133;A\\a'
}
__brosh_preexec() {
  __brosh_cmd_executed=1
  printf '\\e]133;C\\a'
}
autoload -Uz add-zsh-hook
add-zsh-hook precmd __brosh_precmd
add-zsh-hook preexec __brosh_preexec
`;
    fs.writeFileSync(path.join(zdotdir, ".zshrc"), zshrcContent);

    // .zlogin
    fs.writeFileSync(path.join(zdotdir, ".zlogin"),
      `typeset -g __BROSH_WRAPPER_ZDOTDIR="$ZDOTDIR"\n` +
      `export ZDOTDIR="${userZdotdir}"\n` +
      `[[ -f "${userZdotdir}/.zlogin" ]] && source "${userZdotdir}/.zlogin"\n` +
      `export ZDOTDIR="$__BROSH_WRAPPER_ZDOTDIR"\n` +
      `unset __BROSH_WRAPPER_ZDOTDIR\n` +
      `[[ -z "$HISTFILE" ]] && HISTFILE="${userZdotdir}/.zsh_history"\n` +
      `[[ "$HISTFILE" == "$ZDOTDIR/.zsh_history" ]] && HISTFILE="${userZdotdir}/.zsh_history"\n` +
      `[[ -s "\$HISTFILE" ]] && fc -R "\$HISTFILE"\n` +
      `export ZDOTDIR="${userZdotdir}"\n`);

    preWarmedZdotdir = zdotdir;
  }

  if ((defaultShell === "bash" || defaultShell === "sh") && !preWarmedBashRc) {
    const homeDir = os.homedir();
    const bashRcContent = `
# Source user's login profile for PATH, aliases, etc.
[ -f "${homeDir}/.bash_profile" ] && source "${homeDir}/.bash_profile" || {
  [ -f "${homeDir}/.bash_login" ] && source "${homeDir}/.bash_login" || {
    [ -f "${homeDir}/.profile" ] && source "${homeDir}/.profile"
  }
}
# Source .bashrc if not already sourced by the profile above
[ -f "${homeDir}/.bashrc" ] && source "${homeDir}/.bashrc"

# Emit OSC 7 (current working directory) on every prompt
# This lets the terminal track cwd changes for status bar badges
__brosh_osc7() {
  printf '\\e]7;file://%s%s\\e\\\\' "$HOSTNAME" "$PWD"
}

# OSC 133 shell integration (command marks for error detection)
# A = prompt start, C = output start, D;exitcode = command finished
__brosh_cmd_executed=""
__brosh_precmd() {
  local __brosh_exit=$?
  if [[ -n "$__brosh_cmd_executed" ]]; then
    printf '\\e]133;D;%d\\a' "$__brosh_exit"
    __brosh_cmd_executed=""
  fi
  printf '\\e]133;A\\a'
}
PROMPT_COMMAND="__brosh_precmd;__brosh_osc7\${PROMPT_COMMAND:+;\\$PROMPT_COMMAND}"

# DEBUG trap for preexec (marks output start when command begins executing)
trap '
  if [[ -z "$__brosh_cmd_executed" && "$BASH_COMMAND" != "__brosh_precmd" && "$BASH_COMMAND" != "__brosh_osc7" ]]; then
    __brosh_cmd_executed=1
    printf '"'"'\\e]133;C\\a'"'"'
  fi
' DEBUG
`;
    const rcPath = path.join(os.tmpdir(), `brosh-bashrc-${process.pid}`);
    fs.writeFileSync(rcPath, bashRcContent);
    preWarmedBashRc = rcPath;
  }
}

/**
 * Pre-warm terminal session resources (locale, RC files, env filtering).
 * Call this early (e.g. while the mode selection modal is visible) so the
 * first createSession() is fast.
 */
export function preWarmSession(options?: { nativeShell?: boolean; setLocaleEnv?: boolean }): void {
  const nativeShell = options?.nativeShell ?? true;
  const setLocaleEnv = options?.setLocaleEnv ?? false;

  // Trigger locale cache (may execSync "defaults read")
  getSystemLocale();

  // Pre-write RC files for the default shell
  if (nativeShell) {
    preWarmRcFiles();
  }

  // Pre-filter env vars
  const filterLc = nativeShell && !setLocaleEnv;
  getFilteredBaseEnv(filterLc);
}

export interface TerminalSessionOptions {
  cols?: number;
  rows?: number;
  shell?: string;
  cwd?: string;
  env?: Record<string, string>;
  startupBanner?: string;
  sandboxController?: SandboxController;
  /** Skip prompt customization and use user's native shell config */
  nativeShell?: boolean;
  /**
   * Also set LC_CTYPE in addition to LANG.
   * When false (default), only LANG is set, matching iTerm2 behavior.
   * When true, also sets LC_CTYPE which may cause issues when SSH'ing
   * to remote servers that don't have the same locales installed
   * (SSH forwards LC_* variables via SendEnv).
   */
  setLocaleEnv?: boolean;
}

export interface ScreenshotResult {
  content: string;
  cursor: {
    x: number;
    y: number;
  };
  dimensions: {
    cols: number;
    rows: number;
  };
}

/**
 * Terminal session that combines node-pty with xterm.js headless
 * for full terminal emulation
 */
export class TerminalSession {
  private ptyProcess!: pty.IPty;
  private terminal!: InstanceType<typeof Terminal>;
  private disposed = false;
  private dataListeners: Array<(data: string) => void> = [];
  private exitListeners: Array<(code: number) => void> = [];
  private resizeListeners: Array<(cols: number, rows: number) => void> = [];

  private rcFile: string | null = null;
  private zdotdir: string | null = null;

  /**
   * Private constructor - use TerminalSession.create() instead
   */
  private constructor() {}

  /**
   * Factory method to create a TerminalSession
   * Use this instead of the constructor to support async sandbox initialization
   */
  static async create(options: TerminalSessionOptions = {}): Promise<TerminalSession> {
    const session = new TerminalSession();
    await session.initialize(options);
    return session;
  }

  /**
   * Set up shell-specific prompt customization
   * Returns args to pass to shell and env modifications
   */
  private setupShellPrompt(
    shellName: string,
    extraEnv?: Record<string, string>,
    startupBanner?: string
  ): { args: string[]; env: Record<string, string> } {
    const env: Record<string, string> = {
      ...extraEnv,
    };
    setEnv(env, 'BROSH', 'TERMINAL_MCP', '1');

    // Escape banner for use in shell scripts
    const escapeBannerForShell = (banner: string) => {
      // Escape single quotes and backslashes for shell
      return banner.replace(/'/g, "'\\''");
    };

    if (shellName === "bash" || shellName === "sh") {
      // Create temp rcfile that sources user's .bashrc then sets our prompt
      const homeDir = os.homedir();
      const bannerCmd = startupBanner ? `printf '%s\\n' '${escapeBannerForShell(startupBanner)}'` : "";
      const bashrcContent = `
# Source user's bashrc if it exists
[ -f "${homeDir}/.bashrc" ] && source "${homeDir}/.bashrc"

# Function to get MCP status for prompt
__brosh_mcp_status() {
  if [ -f /tmp/brosh-mcp-status ]; then
    local __brosh_st=$(cat /tmp/brosh-mcp-status 2>/dev/null)
    if [ "$__brosh_st" = "enabled" ]; then
      printf '\\033[32m(MCP Enabled)\\033[0m'
    else
      printf '\\033[31m(MCP Disabled)\\033[0m'
    fi
  else
    printf '\\033[31m(MCP Disabled)\\033[0m'
  fi
}

# Set brosh prompt and clear PROMPT_COMMAND so prompt managers
# (Starship, bash-it, oh-my-bash, etc.) can't override PS1
PROMPT_COMMAND=""
PS1="\\[\\033[33m\\]${PROMPT_INDICATOR}\\[\\033[0m\\] \$(__brosh_mcp_status)> "
# Print startup banner
${bannerCmd}
`;
      this.rcFile = path.join(os.tmpdir(), `brosh-bashrc-${process.pid}`);
      fs.writeFileSync(this.rcFile, bashrcContent);
      return { args: ["--rcfile", this.rcFile], env };
    }

    if (shellName === "zsh") {
      // Create temp ZDOTDIR with .zshrc that sources user's config then sets prompt
      const homeDir = os.homedir();
      this.zdotdir = path.join(os.tmpdir(), `brosh-zsh-${process.pid}`);
      fs.mkdirSync(this.zdotdir, { recursive: true });

      const bannerCmd = startupBanner ? `printf '%s\\n' '${escapeBannerForShell(startupBanner)}'` : "";
      const zshrcContent = `
# Disable p10k instant prompt before sourcing user config
# (our banner output during init would trigger warnings otherwise)
typeset -g POWERLEVEL9K_INSTANT_PROMPT=off

# Reset ZDOTDIR so nested zsh uses normal config
export ZDOTDIR="${homeDir}"
# Source user's zshrc if it exists
[ -f "${homeDir}/.zshrc" ] && source "${homeDir}/.zshrc"

# Neuter prompt managers that use precmd hooks to override PROMPT.
# We source user config for aliases/PATH/functions, but brosh uses its own prompt.
# Covers: Powerlevel10k, Starship, Pure, Spaceship, Oh My Zsh themes
(( \${+functions[_p9k_precmd]} )) && _p9k_precmd() { }
(( \${+functions[_p9k_preexec]} )) && _p9k_preexec() { }
(( \${+functions[starship_precmd]} )) && starship_precmd() { }
(( \${+functions[starship_preexec]} )) && starship_preexec() { }
(( \${+functions[prompt_pure_precmd]} )) && prompt_pure_precmd() { }
(( \${+functions[spaceship_precmd]} )) && spaceship_precmd() { }

# Clear all precmd hooks except ours to prevent any remaining prompt overrides
precmd_functions=()

# Function to get MCP status for prompt
__brosh_mcp_status() {
  if [[ -f /tmp/brosh-mcp-status ]]; then
    local __brosh_st=$(<"/tmp/brosh-mcp-status" 2>/dev/null)
    if [[ "$__brosh_st" = "enabled" ]]; then
      print -n '%F{green}(MCP Enabled)%f'
    else
      print -n '%F{red}(MCP Disabled)%f'
    fi
  else
    print -n '%F{red}(MCP Disabled)%f'
  fi
}

# Enable prompt substitution for dynamic status
setopt PROMPT_SUBST

# Set brosh prompt with dynamic MCP status
PROMPT='%F{yellow}${PROMPT_INDICATOR}%f $(__brosh_mcp_status)> '
RPROMPT=""
# Print startup banner
${bannerCmd}
`;
      fs.writeFileSync(path.join(this.zdotdir, ".zshrc"), zshrcContent);
      env.ZDOTDIR = this.zdotdir;
      return { args: [], env };
    }

    // PowerShell (pwsh is PowerShell Core, powershell is Windows PowerShell)
    if (
      shellName === "powershell" ||
      shellName === "powershell.exe" ||
      shellName === "pwsh" ||
      shellName === "pwsh.exe"
    ) {
      setEnv(env, 'BROSH_PROMPT', 'TERMINAL_MCP_PROMPT', '1');
      return { args: ["-NoLogo"], env };
    }

    // Windows cmd.exe
    if (shellName === "cmd" || shellName === "cmd.exe") {
      env.PROMPT = `\x1b[33m${PROMPT_INDICATOR}\x1b[0m $P$G`;
      return { args: [], env };
    }

    // For other shells, just set env vars and hope for the best
    env.PS1 = `\x1b[33m${PROMPT_INDICATOR}\x1b[0m $ `;
    return { args: [], env };
  }

  /**
   * Get a list of available UTF-8 locales on the system.
   * Returns the best one to use, preferring the user's existing locale if valid.
   */
  private getAvailableUtf8Locale(): string {
    const isUtf8 = (locale: string) =>
      locale.toLowerCase().includes("utf-8") || locale.toLowerCase().includes("utf8");

    // Check if user already has a UTF-8 locale set
    const userLang = process.env.LANG || "";
    const userLcAll = process.env.LC_ALL || "";

    if (isUtf8(userLcAll)) return userLcAll;
    if (isUtf8(userLang)) return userLang;

    // Try to detect available locales
    try {
      const { execSync } = require("child_process");
      const localeOutput = execSync("locale -a 2>/dev/null", {
        encoding: "utf8",
        timeout: 1000,
      });

      const locales = localeOutput.split("\n").filter((l: string) => isUtf8(l));

      // Prefer C.UTF-8 as it's most portable (available on most Linux systems)
      if (locales.includes("C.UTF-8")) return "C.UTF-8";
      if (locales.includes("C.utf8")) return "C.utf8";

      // Then try POSIX UTF-8 variants
      if (locales.includes("POSIX.UTF-8")) return "POSIX.UTF-8";

      // Then try en_US.UTF-8 variants
      const enUs = locales.find((l: string) => l.startsWith("en_US") && isUtf8(l));
      if (enUs) return enUs;

      // Use any available UTF-8 locale
      if (locales.length > 0) return locales[0];
    } catch {
      // locale command failed, use platform-specific defaults
    }

    // Platform-specific fallbacks
    if (process.platform === "darwin") {
      // macOS always has en_US.UTF-8
      return "en_US.UTF-8";
    }

    // Linux/other: C.UTF-8 is the most portable
    return "C.UTF-8";
  }

  /**
   * Ensure proper UTF-8 locale settings for the terminal.
   * Electron apps launched from Finder on macOS don't inherit shell locale settings,
   * which breaks programs like mosh that require UTF-8.
   */
  private ensureUtf8Locale(env: Record<string, string>): Record<string, string> {
    const result = { ...env };

    const isUtf8 = (locale: string) =>
      locale.toLowerCase().includes("utf-8") || locale.toLowerCase().includes("utf8");

    // Check current locale settings
    const lang = process.env.LANG || "";
    const lcCtype = process.env.LC_CTYPE || "";
    const lcAll = process.env.LC_ALL || "";

    // If already UTF-8, don't change anything
    if (isUtf8(lcAll) || (isUtf8(lang) && isUtf8(lcCtype))) {
      return result;
    }

    // Get a valid UTF-8 locale
    const targetLocale = this.getAvailableUtf8Locale();

    // Set LANG if not UTF-8
    if (!isUtf8(lang)) {
      result.LANG = targetLocale;
    }

    // Set LC_CTYPE specifically for character encoding (most important for mosh)
    if (!isUtf8(lcCtype)) {
      result.LC_CTYPE = targetLocale;
    }

    // Clear LC_ALL if it's set to a non-UTF-8 value (it overrides everything)
    if (lcAll && !isUtf8(lcAll)) {
      result.LC_ALL = "";
    }

    return result;
  }

  /**
   * Initialize the terminal session
   * This is called by the create() factory method
   */
  private async initialize(options: TerminalSessionOptions): Promise<void> {
    const cols = options.cols ?? 120;
    const rows = options.rows ?? 40;
    const shell = options.shell ?? getDefaultShell();

    // Create headless terminal emulator
    this.terminal = new Terminal({
      cols,
      rows,
      scrollback: 1000,
      allowProposedApi: true,
    });

    // Determine shell type and set up custom prompt (unless nativeShell is enabled)
    const shellName = path.basename(shell);
    let args: string[] = [];
    let env: Record<string, string> = { ...options.env };
    console.log(`[session] shell=${shell}, shellName=${shellName}, nativeShell=${options.nativeShell}`);

    if (options.nativeShell) {
      // Use native shell without customization - just set BROSH env var
      // Spawn as login shell so user's profile is sourced (sets up PATH, aliases, etc.)
      setEnv(env, 'BROSH', 'TERMINAL_MCP', '1');
      if (shellName === "bash" || shellName === "sh") {
        // Bash: use --rcfile with a temp file that sources the user's profile,
        // injects OSC 7 (cwd reporting) and OSC 133 (command marks for error detection)
        if (preWarmedBashRc && fs.existsSync(preWarmedBashRc)) {
          // Reuse pre-warmed RC file
          this.rcFile = preWarmedBashRc;
          preWarmedBashRc = null; // consumed — next session will write fresh
        } else {
          const homeDir = os.homedir();
          const bashRcContent = `
# Source user's login profile for PATH, aliases, etc.
[ -f "${homeDir}/.bash_profile" ] && source "${homeDir}/.bash_profile" || {
  [ -f "${homeDir}/.bash_login" ] && source "${homeDir}/.bash_login" || {
    [ -f "${homeDir}/.profile" ] && source "${homeDir}/.profile"
  }
}
# Source .bashrc if not already sourced by the profile above
[ -f "${homeDir}/.bashrc" ] && source "${homeDir}/.bashrc"

# Emit OSC 7 (current working directory) on every prompt
# This lets the terminal track cwd changes for status bar badges
__brosh_osc7() {
  printf '\\e]7;file://%s%s\\e\\\\' "$HOSTNAME" "$PWD"
}

# OSC 133 shell integration (command marks for error detection)
# A = prompt start, C = output start, D;exitcode = command finished
__brosh_cmd_executed=""
__brosh_precmd() {
  local __brosh_exit=$?
  if [[ -n "$__brosh_cmd_executed" ]]; then
    printf '\\e]133;D;%d\\a' "$__brosh_exit"
    __brosh_cmd_executed=""
  fi
  printf '\\e]133;A\\a'
}
PROMPT_COMMAND="__brosh_precmd;__brosh_osc7\${PROMPT_COMMAND:+;\\$PROMPT_COMMAND}"

# DEBUG trap for preexec (marks output start when command begins executing)
trap '
  if [[ -z "$__brosh_cmd_executed" && "$BASH_COMMAND" != "__brosh_precmd" && "$BASH_COMMAND" != "__brosh_osc7" ]]; then
    __brosh_cmd_executed=1
    printf '"'"'\\e]133;C\\a'"'"'
  fi
' DEBUG
`;
          this.rcFile = path.join(os.tmpdir(), `brosh-bashrc-${process.pid}`);
          fs.writeFileSync(this.rcFile, bashRcContent);
        }
        args = ["--rcfile", this.rcFile!];
      } else if (shellName === "zsh") {
        // Zsh: create ZDOTDIR wrapper that sources user's config and adds
        // OSC 133 shell integration hooks (non-destructive via add-zsh-hook)
        if (preWarmedZdotdir && fs.existsSync(preWarmedZdotdir)) {
          // Reuse pre-warmed ZDOTDIR
          this.zdotdir = preWarmedZdotdir;
          preWarmedZdotdir = null; // consumed — next session will write fresh
          console.log(`[session] Reusing pre-warmed ZDOTDIR: ${this.zdotdir}`);
        } else {
          const userZdotdir = process.env.ZDOTDIR || os.homedir();
          this.zdotdir = path.join(os.tmpdir(), `brosh-zsh-${process.pid}`);
          fs.mkdirSync(this.zdotdir, { recursive: true });
          console.log(`[session] Created ZDOTDIR: ${this.zdotdir}, user ZDOTDIR: ${userZdotdir}`);

          // .zshenv - runs for all zsh invocations (earliest rc file)
          fs.writeFileSync(path.join(this.zdotdir, ".zshenv"),
            `typeset -g __BROSH_WRAPPER_ZDOTDIR="$ZDOTDIR"\n` +
            `export ZDOTDIR="${userZdotdir}"\n` +
            `HISTFILE="${userZdotdir}/.zsh_history"\n` +
            `[[ -f "${userZdotdir}/.zshenv" ]] && source "${userZdotdir}/.zshenv"\n` +
            `export ZDOTDIR="$__BROSH_WRAPPER_ZDOTDIR"\n` +
            `unset __BROSH_WRAPPER_ZDOTDIR\n` +
            `[[ -z "$HISTFILE" ]] && HISTFILE="${userZdotdir}/.zsh_history"\n` +
            `[[ "$HISTFILE" == "$ZDOTDIR/.zsh_history" ]] && HISTFILE="${userZdotdir}/.zsh_history"\n`);

          // .zprofile - runs for login shells (before .zshrc)
          fs.writeFileSync(path.join(this.zdotdir, ".zprofile"),
            `typeset -g __BROSH_WRAPPER_ZDOTDIR="$ZDOTDIR"\n` +
            `export ZDOTDIR="${userZdotdir}"\n` +
            `[[ -f "${userZdotdir}/.zprofile" ]] && source "${userZdotdir}/.zprofile"\n` +
            `export ZDOTDIR="$__BROSH_WRAPPER_ZDOTDIR"\n` +
            `unset __BROSH_WRAPPER_ZDOTDIR\n` +
            `[[ -z "$HISTFILE" ]] && HISTFILE="${userZdotdir}/.zsh_history"\n` +
            `[[ "$HISTFILE" == "$ZDOTDIR/.zsh_history" ]] && HISTFILE="${userZdotdir}/.zsh_history"\n`);

          // .zshrc - runs for interactive shells
          const zshrcContent = `
# Keep wrapper ZDOTDIR so brosh startup files still run.
typeset -g __BROSH_WRAPPER_ZDOTDIR="$ZDOTDIR"

# Make user config see the real ZDOTDIR.
# Many zsh configs derive HISTFILE from ZDOTDIR.
export ZDOTDIR="${userZdotdir}"
[[ -f "${userZdotdir}/.zshrc" ]] && source "${userZdotdir}/.zshrc"

# Restore wrapper ZDOTDIR for the remainder of startup.
export ZDOTDIR="$__BROSH_WRAPPER_ZDOTDIR"
unset __BROSH_WRAPPER_ZDOTDIR

# If user config left HISTFILE empty or pointing to wrapper temp ZDOTDIR,
# reset it to the user's default history file.
[[ -z "$HISTFILE" ]] && HISTFILE="${userZdotdir}/.zsh_history"
[[ "$HISTFILE" == "$ZDOTDIR/.zsh_history" ]] && HISTFILE="${userZdotdir}/.zsh_history"

# HISTFILE is set in .zshenv (before zsh initializes history).
# Set size defaults here; user's .zshrc can override.
: \${HISTSIZE:=50000}
: \${SAVEHIST:=10000}

# OSC 133 shell integration (command marks for error detection)
# A = prompt start, C = output start, D;exitcode = command finished
# Uses add-zsh-hook so it doesn't interfere with user's hooks
__brosh_cmd_executed=""
__brosh_precmd() {
  local exit_code=$?
  if [[ -n "$__brosh_cmd_executed" ]]; then
    printf '\\e]133;D;%d\\a' "$exit_code"
  fi
  __brosh_cmd_executed=""
  printf '\\e]133;A\\a'
}
__brosh_preexec() {
  __brosh_cmd_executed=1
  printf '\\e]133;C\\a'
}
autoload -Uz add-zsh-hook
add-zsh-hook precmd __brosh_precmd
add-zsh-hook preexec __brosh_preexec
`;
          fs.writeFileSync(path.join(this.zdotdir, ".zshrc"), zshrcContent);

          // .zlogin - runs for login shells (after .zshrc) — last rc file
          fs.writeFileSync(path.join(this.zdotdir, ".zlogin"),
            `typeset -g __BROSH_WRAPPER_ZDOTDIR="$ZDOTDIR"\n` +
            `export ZDOTDIR="${userZdotdir}"\n` +
            `[[ -f "${userZdotdir}/.zlogin" ]] && source "${userZdotdir}/.zlogin"\n` +
            `export ZDOTDIR="$__BROSH_WRAPPER_ZDOTDIR"\n` +
            `unset __BROSH_WRAPPER_ZDOTDIR\n` +
            `[[ -z "$HISTFILE" ]] && HISTFILE="${userZdotdir}/.zsh_history"\n` +
            `[[ "$HISTFILE" == "$ZDOTDIR/.zsh_history" ]] && HISTFILE="${userZdotdir}/.zsh_history"\n` +
            `[[ -s "\$HISTFILE" ]] && fc -R "\$HISTFILE"\n` +
            // Keep runtime ZDOTDIR on the user's path so prompt hooks/plugins
            // that derive HISTFILE from ZDOTDIR don't switch back to wrapper temp dir.
            `export ZDOTDIR="${userZdotdir}"\n`);
        }

        env.ZDOTDIR = this.zdotdir;
        args = ["--login"];
      }
      // Set LANG for local UTF-8 support (like iTerm2's "Set locale environment
      // variables automatically"). By default we only set LANG, not LC_CTYPE,
      // because SSH's SendEnv forwards LC_* variables and remote servers may not
      // have the same locales installed. The system derives LC_CTYPE from LANG locally.
      const systemLocale = getSystemLocale();
      env.LANG = systemLocale;
      // Optionally set LC_CTYPE too (may cause SSH issues with remote servers)
      if (options.setLocaleEnv) {
        env.LC_CTYPE = systemLocale;
      }
    } else {
      // Set up brosh custom prompt
      const promptSetup = this.setupShellPrompt(shellName, options.env, options.startupBanner);
      args = promptSetup.args;
      env = promptSetup.env;
      // Ensure UTF-8 locale for MCP mode (headless operation)
      env = this.ensureUtf8Locale(env);
    }

    // Determine spawn command - may be wrapped by sandbox
    let spawnCmd = shell;
    let spawnArgs = args;

    if (options.sandboxController?.isActive()) {
      const wrapped = await options.sandboxController.wrapShellCommand(shell, args);
      spawnCmd = wrapped.cmd;
      spawnArgs = wrapped.args;

      if (process.env.DEBUG_SANDBOX) {
        console.error("[sandbox-debug] Spawn command:", spawnCmd);
        console.error("[sandbox-debug] Spawn args:", spawnArgs.join(" "));
        console.error("[sandbox-debug] CWD:", options.cwd ?? process.cwd());
      }
    }

    // Build the final environment for the PTY process
    // By default, filter out LC_* variables from inherited environment to avoid
    // SSH forwarding issues (SSH's SendEnv LC_* forwards these to remote servers
    // that may not have the same locales). We set LANG which is sufficient for
    // local UTF-8 support - the shell derives other locale settings from LANG.
    const filterLcVars = !!(options.nativeShell && !options.setLocaleEnv);
    const baseEnv = getFilteredBaseEnv(filterLcVars);

    // Spawn PTY process
    this.ptyProcess = pty.spawn(spawnCmd, spawnArgs, {
      name: "xterm-256color",
      cols,
      rows,
      cwd: options.cwd ?? process.cwd(),
      env: { ...baseEnv, ...env },
    });

    // Pipe PTY output to terminal emulator and listeners
    this.ptyProcess.onData((data) => {
      if (!this.disposed) {
        this.terminal.write(data);
        // Notify all data listeners
        for (const listener of this.dataListeners) {
          listener(data);
        }
      }
    });

    this.ptyProcess.onExit(({ exitCode }) => {
      this.disposed = true;
      for (const listener of this.exitListeners) {
        listener(exitCode);
      }
    });
  }

  /**
   * Subscribe to PTY output data
   */
  onData(listener: (data: string) => void): void {
    this.dataListeners.push(listener);
  }

  /**
   * Subscribe to PTY exit
   */
  onExit(listener: (code: number) => void): void {
    this.exitListeners.push(listener);
  }

  /**
   * Subscribe to terminal resize events
   */
  onResize(listener: (cols: number, rows: number) => void): void {
    this.resizeListeners.push(listener);
  }

  /**
   * Write data to the terminal (simulates typing)
   */
  write(data: string): void {
    if (this.disposed) {
      throw new Error("Terminal session has been disposed");
    }
    this.ptyProcess.write(data);
  }

  /**
   * Get the current terminal buffer content as plain text
   */
  getContent(): string {
    if (this.disposed) {
      throw new Error("Terminal session has been disposed");
    }

    const buffer = this.terminal.buffer.active;
    const lines: string[] = [];

    // Get all lines from the buffer (including scrollback)
    for (let i = 0; i < buffer.length; i++) {
      const line = buffer.getLine(i);
      if (line) {
        lines.push(line.translateToString(true));
      }
    }

    // Trim trailing empty lines
    while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
      lines.pop();
    }

    return lines.join("\n");
  }

  /**
   * Get only the visible viewport content
   */
  getVisibleContent(): string {
    if (this.disposed) {
      throw new Error("Terminal session has been disposed");
    }

    const buffer = this.terminal.buffer.active;
    const lines: string[] = [];
    const baseY = buffer.baseY;

    for (let i = 0; i < this.terminal.rows; i++) {
      const line = buffer.getLine(baseY + i);
      if (line) {
        lines.push(line.translateToString(true));
      }
    }

    return lines.join("\n");
  }

  /**
   * Take a screenshot of the terminal state
   */
  takeScreenshot(): ScreenshotResult {
    if (this.disposed) {
      throw new Error("Terminal session has been disposed");
    }

    const buffer = this.terminal.buffer.active;

    return {
      content: this.getVisibleContent(),
      cursor: {
        x: buffer.cursorX,
        y: buffer.cursorY,
      },
      dimensions: {
        cols: this.terminal.cols,
        rows: this.terminal.rows,
      },
    };
  }

  /**
   * Clear the terminal screen
   */
  clear(): void {
    if (this.disposed) {
      throw new Error("Terminal session has been disposed");
    }
    this.terminal.clear();
  }

  /**
   * Resize the terminal
   */
  resize(cols: number, rows: number): void {
    if (this.disposed) {
      throw new Error("Terminal session has been disposed");
    }
    this.terminal.resize(cols, rows);
    this.ptyProcess.resize(cols, rows);

    // Notify all resize listeners
    for (const listener of this.resizeListeners) {
      listener(cols, rows);
    }
  }

  /**
   * Check if the session is still active
   */
  isActive(): boolean {
    return !this.disposed;
  }

  /**
   * Get terminal dimensions
   */
  getDimensions(): { cols: number; rows: number } {
    return {
      cols: this.terminal.cols,
      rows: this.terminal.rows,
    };
  }

  /**
   * Get the current foreground process name
   * On macOS/Linux this returns the actual process running in the terminal
   */
  getProcess(): string {
    if (this.disposed) {
      return "shell";
    }
    try {
      // node-pty's process property returns the current foreground process
      return this.ptyProcess.process || "shell";
    } catch {
      return "shell";
    }
  }

  /**
   * Get the current working directory of the foreground process
   * Uses process tree traversal to find the deepest child process
   */
  getCwd(): string | null {
    if (this.disposed) {
      return null;
    }
    try {
      const pid = this.ptyProcess.pid;

      // Validate PID before using in shell command
      if (!pid || typeof pid !== "number" || pid <= 0) {
        return null;
      }

      if (process.platform === "darwin") {
        // macOS: Find the foreground process by traversing the process tree
        // When you run `bash` inside zsh, bash is a child of zsh
        // We need to find the deepest child (the actual foreground process)
        // and get its cwd
        //
        // Use pgrep to find child processes, then get the leaf (deepest child)
        // This handles: zsh -> bash -> python, etc.
        const findLeafPid = (parentPid: number): number => {
          try {
            const children = execSync(`pgrep -P ${parentPid} 2>/dev/null`, {
              encoding: "utf8",
              timeout: 500,
            }).trim();
            if (children) {
              // Take the first child and recurse
              const childPid = parseInt(children.split("\n")[0], 10);
              if (childPid > 0) {
                return findLeafPid(childPid);
              }
            }
          } catch {
            // No children, this is the leaf
          }
          return parentPid;
        };

        const leafPid = findLeafPid(pid);

        // Get cwd of the leaf process
        const output = execSync(
          `lsof -a -p ${leafPid} -d cwd 2>/dev/null | awk 'NR==2 {print $NF}'`,
          {
            encoding: "utf8",
            timeout: 1000,
          }
        ).trim();

        // Validate output looks like a path
        if (output && output.startsWith("/")) {
          return output;
        }
        return null;
      } else if (process.platform === "linux") {
        // Linux: Find the foreground process similarly
        const findLeafPid = (parentPid: number): number => {
          try {
            const childrenPath = `/proc/${parentPid}/task/${parentPid}/children`;
            const children = fs.readFileSync(childrenPath, "utf8").trim();
            if (children) {
              const childPid = parseInt(children.split(" ")[0], 10);
              if (childPid > 0) {
                return findLeafPid(childPid);
              }
            }
          } catch {
            // No children or can't read
          }
          return parentPid;
        };

        const leafPid = findLeafPid(pid);
        return fs.readlinkSync(`/proc/${leafPid}/cwd`);
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Dispose of the terminal session
   */
  dispose(): void {
    if (!this.disposed) {
      this.disposed = true;
      this.ptyProcess.kill();
      this.terminal.dispose();

      // Clean up temp rc files
      if (this.rcFile) {
        try {
          fs.unlinkSync(this.rcFile);
        } catch {
          // Ignore cleanup errors
        }
      }
      if (this.zdotdir) {
        try {
          fs.rmSync(this.zdotdir, { recursive: true });
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  }
}
