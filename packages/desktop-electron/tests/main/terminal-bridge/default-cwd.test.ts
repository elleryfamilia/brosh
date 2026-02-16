import { describe, it, expect, vi } from 'vitest';
import * as os from 'os';

/**
 * Tests for default cwd behavior in terminal sessions.
 *
 * When creating a new terminal session, if no cwd is specified,
 * the session should start in the user's home directory.
 */

describe('Default CWD Behavior', () => {
  describe('cwd fallback logic', () => {
    // This tests the logic pattern used in terminal-bridge.ts:
    // const cwd = options?.cwd ?? os.homedir();

    it('should return provided cwd when specified', () => {
      const options = { cwd: '/custom/path' };
      const cwd = options?.cwd ?? os.homedir();
      expect(cwd).toBe('/custom/path');
    });

    it('should return home directory when cwd is undefined', () => {
      const options: { cwd?: string } = { cwd: undefined };
      const cwd = options?.cwd ?? os.homedir();
      expect(cwd).toBe(os.homedir());
    });

    it('should return home directory when options is undefined', () => {
      const options: { cwd?: string } | undefined = undefined;
      const cwd = options?.cwd ?? os.homedir();
      expect(cwd).toBe(os.homedir());
    });

    it('should return home directory when options is empty object', () => {
      const options: { cwd?: string } = {};
      const cwd = options?.cwd ?? os.homedir();
      expect(cwd).toBe(os.homedir());
    });

    it('should preserve empty string cwd if explicitly set', () => {
      // Empty string is falsy but is still a valid value with ??
      const options = { cwd: '' };
      const cwd = options?.cwd ?? os.homedir();
      // Note: ?? only falls back on null/undefined, not empty string
      expect(cwd).toBe('');
    });

    it('should handle null cwd by falling back to home', () => {
      const options = { cwd: null as unknown as string };
      const cwd = options?.cwd ?? os.homedir();
      expect(cwd).toBe(os.homedir());
    });
  });

  describe('os.homedir()', () => {
    it('should return a non-empty string', () => {
      const home = os.homedir();
      expect(home).toBeTruthy();
      expect(typeof home).toBe('string');
      expect(home.length).toBeGreaterThan(0);
    });

    it('should return an absolute path', () => {
      const home = os.homedir();
      // On Unix systems, absolute paths start with /
      // On Windows, they start with a drive letter like C:\
      expect(home.startsWith('/') || /^[A-Z]:\\/i.test(home)).toBe(true);
    });
  });
});
