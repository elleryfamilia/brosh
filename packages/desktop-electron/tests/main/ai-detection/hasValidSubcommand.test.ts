import { describe, it, expect } from 'vitest';
import {
  hasValidSubcommand,
  commandHasSubcommands,
  getSubcommands,
} from '../../../src/main/ai-detection.js';

describe('hasValidSubcommand', () => {
  describe('git subcommands', () => {
    const validGitSubcommands = [
      'add', 'bisect', 'branch', 'checkout', 'cherry-pick', 'clone', 'commit',
      'diff', 'fetch', 'grep', 'init', 'log', 'merge', 'mv', 'pull', 'push',
      'rebase', 'remote', 'reset', 'restore', 'revert', 'rm', 'show', 'stash',
      'status', 'switch', 'tag', 'worktree',
    ];

    for (const sub of validGitSubcommands) {
      it(`should return true for "git ${sub}"`, () => {
        expect(hasValidSubcommand('git', sub)).toBe(true);
      });
    }

    it('should be case insensitive', () => {
      expect(hasValidSubcommand('git', 'STATUS')).toBe(true);
      expect(hasValidSubcommand('GIT', 'status')).toBe(true);
      expect(hasValidSubcommand('Git', 'Commit')).toBe(true);
    });

    it('should return false for invalid git subcommands', () => {
      expect(hasValidSubcommand('git', 'foo')).toBe(false);
      expect(hasValidSubcommand('git', 'how')).toBe(false);
      expect(hasValidSubcommand('git', 'please')).toBe(false);
      expect(hasValidSubcommand('git', 'help')).toBe(false); // Not in the registry
    });
  });

  describe('npm subcommands', () => {
    const validNpmSubcommands = [
      'install', 'uninstall', 'update', 'publish', 'run', 'test', 'start',
      'init', 'search', 'view', 'audit', 'cache', 'config',
    ];

    for (const sub of validNpmSubcommands) {
      it(`should return true for "npm ${sub}"`, () => {
        expect(hasValidSubcommand('npm', sub)).toBe(true);
      });
    }

    it('should return false for invalid npm subcommands', () => {
      expect(hasValidSubcommand('npm', 'foo')).toBe(false);
      expect(hasValidSubcommand('npm', 'please')).toBe(false);
      expect(hasValidSubcommand('npm', 'is')).toBe(false);
    });
  });

  describe('docker subcommands', () => {
    const validDockerSubcommands = [
      'run', 'build', 'push', 'pull', 'images', 'ps', 'exec', 'logs',
      'stop', 'start', 'restart', 'rm', 'rmi', 'network', 'volume',
    ];

    for (const sub of validDockerSubcommands) {
      it(`should return true for "docker ${sub}"`, () => {
        expect(hasValidSubcommand('docker', sub)).toBe(true);
      });
    }

    it('should return false for invalid docker subcommands', () => {
      expect(hasValidSubcommand('docker', 'foo')).toBe(false);
      expect(hasValidSubcommand('docker', 'what')).toBe(false);
    });
  });

  describe('kubectl subcommands', () => {
    const validKubectlSubcommands = [
      'get', 'describe', 'create', 'apply', 'delete', 'logs', 'exec',
      'port-forward', 'config', 'cluster-info',
    ];

    for (const sub of validKubectlSubcommands) {
      it(`should return true for "kubectl ${sub}"`, () => {
        expect(hasValidSubcommand('kubectl', sub)).toBe(true);
      });
    }
  });

  describe('brew subcommands', () => {
    const validBrewSubcommands = [
      'install', 'uninstall', 'update', 'upgrade', 'search', 'info',
      'list', 'cleanup', 'doctor', 'services',
    ];

    for (const sub of validBrewSubcommands) {
      it(`should return true for "brew ${sub}"`, () => {
        expect(hasValidSubcommand('brew', sub)).toBe(true);
      });
    }
  });

  describe('yarn subcommands', () => {
    // Only include subcommands that are actually in the registry
    const validYarnSubcommands = [
      'add', 'remove', 'install', 'upgrade', 'init', 'run',
      'cache', 'config', // 'test' and 'build' are npm scripts, not yarn subcommands
    ];

    for (const sub of validYarnSubcommands) {
      it(`should return true for "yarn ${sub}"`, () => {
        expect(hasValidSubcommand('yarn', sub)).toBe(true);
      });
    }

    it('should return false for npm script aliases not in registry', () => {
      // 'test' and 'build' are common npm scripts but not yarn subcommands
      expect(hasValidSubcommand('yarn', 'test')).toBe(false);
      expect(hasValidSubcommand('yarn', 'build')).toBe(false);
    });
  });

  describe('cargo subcommands', () => {
    const validCargoSubcommands = [
      'build', 'run', 'test', 'check', 'clean', 'doc', 'new', 'init',
      'publish', 'install', 'uninstall',
    ];

    for (const sub of validCargoSubcommands) {
      it(`should return true for "cargo ${sub}"`, () => {
        expect(hasValidSubcommand('cargo', sub)).toBe(true);
      });
    }
  });

  describe('gh subcommands', () => {
    const validGhSubcommands = [
      'repo', 'issue', 'pr', 'release', 'workflow', 'run', 'gist',
      'auth', 'config', 'api',
    ];

    for (const sub of validGhSubcommands) {
      it(`should return true for "gh ${sub}"`, () => {
        expect(hasValidSubcommand('gh', sub)).toBe(true);
      });
    }
  });

  describe('pnpm subcommands', () => {
    // Only include subcommands that are actually in the registry
    const validPnpmSubcommands = [
      'add', 'install', 'remove', 'update', 'run', 'test',
      'exec', 'dlx', 'store', // 'build' is not in registry
    ];

    for (const sub of validPnpmSubcommands) {
      it(`should return true for "pnpm ${sub}"`, () => {
        expect(hasValidSubcommand('pnpm', sub)).toBe(true);
      });
    }

    it('should return false for npm script aliases not in registry', () => {
      expect(hasValidSubcommand('pnpm', 'build')).toBe(false);
    });
  });

  describe('unregistered commands', () => {
    it('should return false for commands not in registry', () => {
      expect(hasValidSubcommand('ls', 'anything')).toBe(false);
      expect(hasValidSubcommand('cat', 'file')).toBe(false);
      expect(hasValidSubcommand('grep', 'pattern')).toBe(false);
      expect(hasValidSubcommand('unknown', 'command')).toBe(false);
    });
  });
});

describe('commandHasSubcommands', () => {
  it('should return true for registered commands', () => {
    expect(commandHasSubcommands('git')).toBe(true);
    expect(commandHasSubcommands('npm')).toBe(true);
    expect(commandHasSubcommands('docker')).toBe(true);
    expect(commandHasSubcommands('kubectl')).toBe(true);
    expect(commandHasSubcommands('brew')).toBe(true);
    expect(commandHasSubcommands('yarn')).toBe(true);
    expect(commandHasSubcommands('cargo')).toBe(true);
    expect(commandHasSubcommands('gh')).toBe(true);
    expect(commandHasSubcommands('pnpm')).toBe(true);
  });

  it('should be case insensitive', () => {
    expect(commandHasSubcommands('GIT')).toBe(true);
    expect(commandHasSubcommands('Git')).toBe(true);
    expect(commandHasSubcommands('NPM')).toBe(true);
  });

  it('should return false for unregistered commands', () => {
    expect(commandHasSubcommands('ls')).toBe(false);
    expect(commandHasSubcommands('cat')).toBe(false);
    expect(commandHasSubcommands('grep')).toBe(false);
    expect(commandHasSubcommands('unknown')).toBe(false);
  });
});

describe('getSubcommands', () => {
  it('should return Set for registered commands', () => {
    const gitSubs = getSubcommands('git');
    expect(gitSubs).toBeInstanceOf(Set);
    expect(gitSubs?.has('status')).toBe(true);
    expect(gitSubs?.has('commit')).toBe(true);
  });

  it('should be case insensitive', () => {
    expect(getSubcommands('GIT')).toBeInstanceOf(Set);
    expect(getSubcommands('Git')).toBeInstanceOf(Set);
  });

  it('should return undefined for unregistered commands', () => {
    expect(getSubcommands('ls')).toBeUndefined();
    expect(getSubcommands('unknown')).toBeUndefined();
  });
});
