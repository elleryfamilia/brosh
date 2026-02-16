import { describe, it, expect } from 'vitest';
import { checkOverridePrefix } from '../../../src/main/ai-detection.js';

describe('checkOverridePrefix', () => {
  describe('COMMAND override (!)', () => {
    it('should detect ! prefix and return COMMAND override', () => {
      const result = checkOverridePrefix('!ls -la');
      expect(result.override).toBe('COMMAND');
      expect(result.cleanedInput).toBe('ls -la');
    });

    it('should strip ! from various commands', () => {
      expect(checkOverridePrefix('!git status')).toEqual({
        override: 'COMMAND',
        cleanedInput: 'git status',
      });

      expect(checkOverridePrefix('!npm install')).toEqual({
        override: 'COMMAND',
        cleanedInput: 'npm install',
      });

      expect(checkOverridePrefix('!echo hello')).toEqual({
        override: 'COMMAND',
        cleanedInput: 'echo hello',
      });
    });

    it('should handle single character after !', () => {
      const result = checkOverridePrefix('!a');
      expect(result.override).toBe('COMMAND');
      expect(result.cleanedInput).toBe('a');
    });

    it('should handle ! at start with spaces after', () => {
      const result = checkOverridePrefix('! ls -la');
      expect(result.override).toBe('COMMAND');
      expect(result.cleanedInput).toBe(' ls -la');
    });
  });

  describe('NATURAL_LANGUAGE override (?)', () => {
    it('should detect ? prefix and return NATURAL_LANGUAGE override', () => {
      const result = checkOverridePrefix('?how do I list files');
      expect(result.override).toBe('NATURAL_LANGUAGE');
      expect(result.cleanedInput).toBe('how do I list files');
    });

    it('should strip ? from various queries', () => {
      expect(checkOverridePrefix('?what is git')).toEqual({
        override: 'NATURAL_LANGUAGE',
        cleanedInput: 'what is git',
      });

      expect(checkOverridePrefix('?help me with docker')).toEqual({
        override: 'NATURAL_LANGUAGE',
        cleanedInput: 'help me with docker',
      });

      expect(checkOverridePrefix('?explain this code')).toEqual({
        override: 'NATURAL_LANGUAGE',
        cleanedInput: 'explain this code',
      });
    });

    it('should handle single character after ?', () => {
      const result = checkOverridePrefix('?a');
      expect(result.override).toBe('NATURAL_LANGUAGE');
      expect(result.cleanedInput).toBe('a');
    });
  });

  describe('no override (null)', () => {
    it('should return null override for regular commands', () => {
      const result = checkOverridePrefix('ls -la');
      expect(result.override).toBeNull();
      expect(result.cleanedInput).toBe('ls -la');
    });

    it('should return null override for regular NL', () => {
      const result = checkOverridePrefix('how do I list files');
      expect(result.override).toBeNull();
      expect(result.cleanedInput).toBe('how do I list files');
    });

    it('should return null for just ! (no content after)', () => {
      const result = checkOverridePrefix('!');
      expect(result.override).toBeNull();
      expect(result.cleanedInput).toBe('!');
    });

    it('should return null for just ? (no content after)', () => {
      const result = checkOverridePrefix('?');
      expect(result.override).toBeNull();
      expect(result.cleanedInput).toBe('?');
    });

    it('should not treat ! in middle as override', () => {
      const result = checkOverridePrefix('echo hello!');
      expect(result.override).toBeNull();
      expect(result.cleanedInput).toBe('echo hello!');
    });

    it('should not treat ? at end as override', () => {
      const result = checkOverridePrefix('what is this?');
      expect(result.override).toBeNull();
      expect(result.cleanedInput).toBe('what is this?');
    });
  });

  describe('whitespace handling', () => {
    it('should trim input before checking prefix', () => {
      const result = checkOverridePrefix('  !ls -la  ');
      expect(result.override).toBe('COMMAND');
      expect(result.cleanedInput).toBe('ls -la');
    });

    it('should trim input for ? prefix', () => {
      const result = checkOverridePrefix('  ?how do I  ');
      expect(result.override).toBe('NATURAL_LANGUAGE');
      expect(result.cleanedInput).toBe('how do I');
    });

    it('should handle whitespace-only input', () => {
      const result = checkOverridePrefix('   ');
      expect(result.override).toBeNull();
      expect(result.cleanedInput).toBe('');
    });

    it('should handle empty input', () => {
      const result = checkOverridePrefix('');
      expect(result.override).toBeNull();
      expect(result.cleanedInput).toBe('');
    });
  });

  describe('edge cases', () => {
    it('should handle multiple ! at start', () => {
      const result = checkOverridePrefix('!!ls');
      expect(result.override).toBe('COMMAND');
      expect(result.cleanedInput).toBe('!ls');
    });

    it('should handle multiple ? at start', () => {
      const result = checkOverridePrefix('??what');
      expect(result.override).toBe('NATURAL_LANGUAGE');
      expect(result.cleanedInput).toBe('?what');
    });

    it('should handle !? combination', () => {
      const result = checkOverridePrefix('!?test');
      expect(result.override).toBe('COMMAND');
      expect(result.cleanedInput).toBe('?test');
    });

    it('should handle ?! combination', () => {
      const result = checkOverridePrefix('?!test');
      expect(result.override).toBe('NATURAL_LANGUAGE');
      expect(result.cleanedInput).toBe('!test');
    });
  });
});
