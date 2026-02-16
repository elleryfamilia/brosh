import { describe, it, expect, beforeAll } from 'vitest';
import {
  initializeDetection,
  isKnownCommand,
  findTypoSuggestion,
} from '../../../src/main/ai-detection.js';

describe('initializeDetection', () => {
  it('should initialize without error', async () => {
    await expect(initializeDetection()).resolves.not.toThrow();
  });

  it('should be idempotent (can be called multiple times)', async () => {
    await initializeDetection();
    await initializeDetection();
    // Should not throw
  });
});

describe('isKnownCommand', () => {
  beforeAll(async () => {
    await initializeDetection();
  });

  describe('should return true for known commands', () => {
    const knownCommands = [
      'ls', 'cd', 'pwd', 'echo', 'cat', 'grep', 'find',
      'git', 'npm', 'docker', 'node', 'python',
      'vim', 'nano', 'ssh', 'curl', 'wget',
    ];

    for (const cmd of knownCommands) {
      it(`should return true for "${cmd}"`, () => {
        expect(isKnownCommand(cmd)).toBe(true);
      });
    }
  });

  describe('should discover commands via PATH fallback', () => {
    it('should find commands that exist in PATH even if not in initial cache', () => {
      // 'newcmd' and 'latestool' are mocked to exist in PATH
      // but weren't in the initial compgen output
      // The PATH fallback should find them
      expect(isKnownCommand('newcmd')).toBe(true);
      expect(isKnownCommand('latestool')).toBe(true);
    });

    it('should cache discovered commands for future lookups', () => {
      // First call discovers via PATH, second call uses cache
      expect(isKnownCommand('newcmd')).toBe(true);
      expect(isKnownCommand('newcmd')).toBe(true); // Should be fast (cached)
    });
  });

  describe('should return true for shell builtins', () => {
    const builtins = [
      'cd', 'echo', 'exit', 'export', 'alias', 'source', 'pwd',
      'pushd', 'popd', 'set', 'unset', 'readonly', 'declare',
      'local', 'return', 'break', 'continue', 'eval', 'exec',
      'trap', 'wait', 'kill', 'jobs', 'fg', 'bg', 'test',
      '[', '[[', 'true', 'false', 'read', 'printf',
    ];

    for (const cmd of builtins) {
      it(`should return true for builtin "${cmd}"`, () => {
        expect(isKnownCommand(cmd)).toBe(true);
      });
    }
  });

  describe('should return true for path-like commands', () => {
    it('should return true for relative paths', () => {
      expect(isKnownCommand('./script.sh')).toBe(true);
      expect(isKnownCommand('./bin/tool')).toBe(true);
    });

    it('should return true for absolute paths', () => {
      expect(isKnownCommand('/usr/bin/python')).toBe(true);
      expect(isKnownCommand('/bin/bash')).toBe(true);
    });

    it('should return true for home-relative paths', () => {
      expect(isKnownCommand('~/bin/tool')).toBe(true);
      expect(isKnownCommand('~/.local/bin/cmd')).toBe(true);
    });
  });

  describe('should return false for unknown commands', () => {
    it('should return false for random strings', () => {
      expect(isKnownCommand('foobar')).toBe(false);
      expect(isKnownCommand('asdfgh')).toBe(false);
      expect(isKnownCommand('xyz123')).toBe(false);
    });

    it('should return false for natural language words', () => {
      expect(isKnownCommand('hello')).toBe(false);
      expect(isKnownCommand('please')).toBe(false);
      expect(isKnownCommand('how')).toBe(false);
    });
  });

  describe('should return true for shell functions', () => {
    // These are mock functions defined in tests/setup.ts
    const shellFunctions = [
      'p10k',    // Powerlevel10k
      'nvm',     // Node version manager
      'pyenv',   // Python version manager
      'rbenv',   // Ruby version manager
      'direnv',  // Directory-specific env vars
      'z',       // Zoxide
    ];

    for (const func of shellFunctions) {
      it(`should return true for shell function "${func}"`, () => {
        expect(isKnownCommand(func)).toBe(true);
      });
    }
  });

  describe('should filter out internal/private functions', () => {
    // Functions starting with _ or - should be filtered out during initialization
    const privateFunctions = [
      '_p10k_worker_start',
      '_nvm_auto',
      '-my-hidden-func',
    ];

    for (const func of privateFunctions) {
      it(`should return false for internal function "${func}"`, () => {
        expect(isKnownCommand(func)).toBe(false);
      });
    }
  });
});

describe('findTypoSuggestion', () => {
  describe('should find close matches', () => {
    it('should find match within maxDistance', () => {
      const candidates = ['git', 'npm', 'docker', 'kubectl'];
      expect(findTypoSuggestion('gti', candidates, 2)).toBe('git');
      expect(findTypoSuggestion('dcoker', candidates, 2)).toBe('docker');
    });

    it('should work with Set input', () => {
      const candidates = new Set(['git', 'npm', 'docker']);
      expect(findTypoSuggestion('gti', candidates, 2)).toBe('git');
    });

    it('should return closest match', () => {
      const candidates = ['cat', 'bat', 'hat', 'mat'];
      // 'cet' is distance 1 from 'cat', distance 2 from others
      expect(findTypoSuggestion('cet', candidates, 2)).toBe('cat');
    });

    it('should prefer transpositions over substitutions', () => {
      // 'nmp' is distance 1 from 'cmp' (substitution n→c)
      // 'nmp' is distance 2 from 'npm' (transposition)
      // But 'nmp' has same letters as 'npm', so should prefer npm
      const candidates = ['cmp', 'npm', 'nap', 'amp'];
      expect(findTypoSuggestion('nmp', candidates, 2)).toBe('npm');
    });

    it('should prefer same-first-letter when distances are equal', () => {
      // Both 'git' and 'hit' are distance 1 from 'gat' (single substitution)
      // But 'git' starts with 'g' like 'gat', so should prefer 'git'
      const candidates = ['hit', 'git', 'bit'];
      expect(findTypoSuggestion('gat', candidates, 2)).toBe('git');
    });

    it('should still find matches even if suggestion is shorter', () => {
      // findTypoSuggestion itself doesn't reject shorter matches
      // That validation happens in detectTypos
      const candidates = ['la', 'ls', 'rm'];
      // 'eza' → 'la' has distance 2, which is within threshold
      expect(findTypoSuggestion('eza', candidates, 2)).toBe('la');
    });
  });

  describe('should return null when no match', () => {
    it('should return null when distance exceeds maxDistance', () => {
      const candidates = ['git', 'npm', 'docker'];
      expect(findTypoSuggestion('xyz', candidates, 2)).toBeNull();
      expect(findTypoSuggestion('foobar', candidates, 2)).toBeNull();
    });

    it('should return null for exact matches (distance 0)', () => {
      const candidates = ['git', 'npm', 'docker'];
      // Exact match has distance 0, which is not > 0
      expect(findTypoSuggestion('git', candidates, 2)).toBeNull();
    });

    it('should skip candidates with very different lengths', () => {
      // The length check in findTypoSuggestion skips if length diff > maxDistance
      // 'abc' (3) vs 'a' (1) = diff of 2, which equals maxDistance so it's NOT skipped
      // 'abc' (3) vs 'superlongcommand' (16) = diff of 13, which is > maxDistance so it IS skipped
      const candidates = ['a', 'superlongcommand'];
      // 'abc' can still match 'a' because length diff is exactly 2 (not > 2)
      // and edit distance from 'abc' to 'a' is 2 (delete b, delete c)
      const result = findTypoSuggestion('abc', candidates, 2);
      expect(result).toBe('a'); // 'a' matches because distance is 2
    });
  });

  describe('should handle edge cases', () => {
    it('should handle empty candidates array', () => {
      expect(findTypoSuggestion('git', [], 2)).toBeNull();
    });

    it('should handle empty candidates Set', () => {
      expect(findTypoSuggestion('git', new Set(), 2)).toBeNull();
    });

    it('should be case insensitive', () => {
      const candidates = ['Git', 'NPM', 'Docker'];
      expect(findTypoSuggestion('gti', candidates, 2)).toBe('Git');
      expect(findTypoSuggestion('GTI', candidates, 2)).toBe('Git');
    });

    it('should use default maxDistance of 2', () => {
      const candidates = ['git', 'npm'];
      expect(findTypoSuggestion('gti', candidates)).toBe('git');
    });
  });
});
