import { describe, it, expect } from 'vitest';
import { isCommandNotFound } from '../../../src/main/ai-detection.js';

describe('isCommandNotFound', () => {
  describe('should match "command not found" patterns', () => {
    it('should match bash style: "bash: foo: command not found"', () => {
      expect(isCommandNotFound('bash: foo: command not found')).toBe(true);
      expect(isCommandNotFound('bash: gti: command not found')).toBe(true);
    });

    it('should match zsh style: "zsh: command not found: foo"', () => {
      expect(isCommandNotFound('zsh: command not found: foo')).toBe(true);
      expect(isCommandNotFound('zsh: command not found: gti')).toBe(true);
    });

    it('should match sh style: "sh: foo: not found"', () => {
      expect(isCommandNotFound('sh: foo: not found')).toBe(true);
      expect(isCommandNotFound('sh: 1: gti: not found')).toBe(true);
    });

    it('should match generic "not found" pattern', () => {
      expect(isCommandNotFound('foo: not found')).toBe(true);
      expect(isCommandNotFound('command: not found')).toBe(true);
    });

    it('should match "unknown command" pattern', () => {
      expect(isCommandNotFound('unknown command: foo')).toBe(true);
      expect(isCommandNotFound('Unknown command "gti"')).toBe(true);
    });

    it('should match Windows style: "\'foo\' is not recognized..."', () => {
      expect(isCommandNotFound("'foo' is not recognized as an internal or external command")).toBe(true);
      expect(isCommandNotFound("'gti' is not recognized")).toBe(true);
    });

    it('should match "No such file or directory"', () => {
      expect(isCommandNotFound('bash: ./script.sh: No such file or directory')).toBe(true);
      expect(isCommandNotFound('/usr/bin/foo: No such file or directory')).toBe(true);
    });
  });

  describe('should be case insensitive', () => {
    it('should match regardless of case', () => {
      expect(isCommandNotFound('COMMAND NOT FOUND')).toBe(true);
      expect(isCommandNotFound('Command Not Found')).toBe(true);
      expect(isCommandNotFound('NOT FOUND')).toBe(true);
      expect(isCommandNotFound('Not Recognized')).toBe(true);
    });
  });

  describe('should NOT match other error messages', () => {
    it('should not match permission denied', () => {
      expect(isCommandNotFound('Permission denied')).toBe(false);
      expect(isCommandNotFound('bash: ./script.sh: Permission denied')).toBe(false);
    });

    it('should not match syntax errors', () => {
      expect(isCommandNotFound('Syntax error near unexpected token')).toBe(false);
      expect(isCommandNotFound('bash: syntax error')).toBe(false);
    });

    it('should not match connection errors', () => {
      expect(isCommandNotFound('Connection refused')).toBe(false);
      expect(isCommandNotFound('Connection timed out')).toBe(false);
    });

    it('should not match empty string', () => {
      expect(isCommandNotFound('')).toBe(false);
    });

    it('should not match general error messages', () => {
      expect(isCommandNotFound('Error: something went wrong')).toBe(false);
      expect(isCommandNotFound('Failed to execute')).toBe(false);
      expect(isCommandNotFound('Operation not permitted')).toBe(false);
    });

    it('should not match success messages', () => {
      expect(isCommandNotFound('Command executed successfully')).toBe(false);
      expect(isCommandNotFound('Build completed')).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle multiline stderr', () => {
      const multiline = `some output
bash: foo: command not found
more output`;
      expect(isCommandNotFound(multiline)).toBe(true);
    });

    it('should handle stderr with ANSI codes', () => {
      expect(isCommandNotFound('\x1b[31mcommand not found\x1b[0m')).toBe(true);
    });

    it('should handle stderr with extra whitespace', () => {
      expect(isCommandNotFound('   command not found   ')).toBe(true);
    });
  });

  describe('real-world examples', () => {
    it('should match common real stderr outputs', () => {
      const examples = [
        'bash: gti: command not found',
        'zsh: command not found: nmp',
        '-bash: dcoker: command not found',
        'sh: kubeclt: not found',
        '/bin/sh: 1: foobar: not found',
        "cmd.exe: 'asdf' is not recognized as an internal or external command",
        'fish: Unknown command: xyz',
      ];

      for (const example of examples) {
        expect(isCommandNotFound(example)).toBe(true);
      }
    });
  });
});
