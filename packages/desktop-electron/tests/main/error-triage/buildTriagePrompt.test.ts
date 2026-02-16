import { describe, it, expect } from 'vitest';
import { buildTriagePrompt } from '../../../src/main/error-triage.js';

/**
 * Tests for the error triage prompt builder.
 *
 * buildTriagePrompt creates the prompt sent to Claude for error triage,
 * including command text, exit code, and recent terminal output.
 */

describe('buildTriagePrompt', () => {
  describe('prompt structure', () => {
    it('should include command, exit code, and output', () => {
      const prompt = buildTriagePrompt('npm run build', 1, 'Error: Module not found');

      expect(prompt).toContain('npm run build');
      expect(prompt).toContain('Exit code: 1');
      expect(prompt).toContain('Error: Module not found');
    });

    it('should include JSON response format instructions', () => {
      const prompt = buildTriagePrompt('ls /nonexistent', 2, 'No such file');

      expect(prompt).toContain('shouldNotify');
      expect(prompt).toContain('message');
      expect(prompt).toContain('JSON');
    });

    it('should include guidance for shouldNotify=true cases', () => {
      const prompt = buildTriagePrompt('node app.js', 1, 'crash');

      expect(prompt).toContain('Module/package not found');
      expect(prompt).toContain('Permission denied');
      expect(prompt).toContain('Syntax errors');
    });

    it('should include guidance for shouldNotify=false cases', () => {
      const prompt = buildTriagePrompt('grep pattern file', 1, '');

      expect(prompt).toContain('grep');
      expect(prompt).toContain('Ctrl+C');
    });
  });

  describe('command handling', () => {
    it('should handle null command', () => {
      const prompt = buildTriagePrompt(null, 1, 'some error');

      expect(prompt).toContain('Command: unknown');
    });

    it('should handle empty string command', () => {
      const prompt = buildTriagePrompt('', 1, 'some error');

      // Empty string is falsy, should fall back to "unknown"
      expect(prompt).toContain('Command: unknown');
    });

    it('should include the actual command when provided', () => {
      const prompt = buildTriagePrompt('python -m pytest tests/', 1, 'FAILED');

      expect(prompt).toContain('Command: python -m pytest tests/');
    });
  });

  describe('exit code handling', () => {
    it('should include various exit codes', () => {
      expect(buildTriagePrompt('cmd', 1, 'err')).toContain('Exit code: 1');
      expect(buildTriagePrompt('cmd', 2, 'err')).toContain('Exit code: 2');
      expect(buildTriagePrompt('cmd', 127, 'err')).toContain('Exit code: 127');
      expect(buildTriagePrompt('cmd', 139, 'err')).toContain('Exit code: 139');
    });
  });

  describe('output handling', () => {
    it('should trim whitespace from output', () => {
      const prompt = buildTriagePrompt('cmd', 1, '  \n  error message  \n  ');

      // The output should be trimmed
      expect(prompt).toContain('error message');
      // Should be wrapped in code fences
      expect(prompt).toContain('```');
    });

    it('should handle empty output', () => {
      const prompt = buildTriagePrompt('cmd', 1, '');

      expect(prompt).toContain('Exit code: 1');
      // Should still have code fence structure even if empty
      expect(prompt).toContain('```');
    });

    it('should handle multi-line output', () => {
      const output = [
        'Error: Cannot find module "express"',
        '    at Function._resolveFilename (node:internal/modules/cjs/loader:1405:15)',
        '    at Function._load (node:internal/modules/cjs/loader:1215:37)',
      ].join('\n');

      const prompt = buildTriagePrompt('node server.js', 1, output);

      expect(prompt).toContain('Cannot find module');
      expect(prompt).toContain('_resolveFilename');
    });

    it('should preserve output with special characters', () => {
      const output = 'Error: Expected "}" but found "<EOF>"';
      const prompt = buildTriagePrompt('node -e "{"', 1, output);

      expect(prompt).toContain('Expected');
    });
  });

  describe('default behavior guidance', () => {
    it('should default to shouldNotify=true', () => {
      const prompt = buildTriagePrompt('cmd', 1, 'error');

      expect(prompt).toContain('DEFAULT: shouldNotify=true');
    });

    it('should mention that most non-zero exit codes indicate real problems', () => {
      const prompt = buildTriagePrompt('cmd', 1, 'error');

      expect(prompt).toContain('real problems');
    });

    it('should advise notifying when in doubt', () => {
      const prompt = buildTriagePrompt('cmd', 1, 'error');

      expect(prompt).toContain('When in doubt, notify');
    });
  });
});
