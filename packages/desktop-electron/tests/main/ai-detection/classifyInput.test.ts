import { describe, it, expect, beforeAll } from 'vitest';
import {
  classifyInput,
  initializeDetection,
  type ClassificationResult,
} from '../../../src/main/ai-detection.js';
import { VALID_COMMANDS } from './fixtures/commands.js';
import { NATURAL_LANGUAGE } from './fixtures/natural-language.js';

describe('classifyInput', () => {
  beforeAll(async () => {
    await initializeDetection({ preloadML: true });
  });

  describe('COMMAND classification', () => {
    it('should classify empty input as COMMAND (shell handles it)', async () => {
      const result = await classifyInput('');
      expect(result.classification).toBe('COMMAND');
      expect(result.confidence).toBe(1.0);
    });

    it('should classify single word commands', async () => {
      for (const cmd of VALID_COMMANDS.singleWord) {
        const result = await classifyInput(cmd);
        expect(result.classification).toBe('COMMAND');
      }
    });

    it('should classify shell builtins', async () => {
      // Shell builtins that are commonly used
      const builtins = ['cd', 'echo', 'exit', 'export', 'alias', 'source', 'pwd'];
      for (const cmd of builtins) {
        const result = await classifyInput(cmd);
        expect(result.classification).toBe('COMMAND');
      }
    });

    it('should classify git commands', async () => {
      for (const cmd of VALID_COMMANDS.git) {
        const result = await classifyInput(cmd);
        expect(result.classification).toBe('COMMAND');
      }
    });

    it('should classify npm commands', async () => {
      for (const cmd of VALID_COMMANDS.npm) {
        const result = await classifyInput(cmd);
        expect(result.classification).toBe('COMMAND');
      }
    });

    it('should classify docker commands', async () => {
      for (const cmd of VALID_COMMANDS.docker) {
        const result = await classifyInput(cmd);
        expect(result.classification).toBe('COMMAND');
      }
    });

    it('should classify commands with flags', async () => {
      for (const cmd of VALID_COMMANDS.withFlags) {
        const result = await classifyInput(cmd);
        expect(result.classification).toBe('COMMAND');
      }
    });

    it('should classify commands with paths', async () => {
      for (const cmd of VALID_COMMANDS.withPaths) {
        const result = await classifyInput(cmd);
        expect(result.classification).toBe('COMMAND');
      }
    });

    it('should classify pipelines as commands', async () => {
      for (const cmd of VALID_COMMANDS.pipelines) {
        const result = await classifyInput(cmd);
        expect(result.classification).toBe('COMMAND');
      }
    });

    it('should classify path-based commands', async () => {
      expect((await classifyInput('./script.sh')).classification).toBe('COMMAND');
      expect((await classifyInput('/usr/bin/foo')).classification).toBe('COMMAND');
      expect((await classifyInput('~/bin/tool')).classification).toBe('COMMAND');
    });
  });

  describe('NATURAL_LANGUAGE classification', () => {
    it('should classify questions', async () => {
      for (const input of NATURAL_LANGUAGE.questions) {
        const result = await classifyInput(input);
        expect(result.classification).toBe('NATURAL_LANGUAGE');
      }
    });

    it('should classify first-person statements', async () => {
      for (const input of NATURAL_LANGUAGE.firstPerson) {
        const result = await classifyInput(input);
        expect(result.classification).toBe('NATURAL_LANGUAGE');
      }
    });
  });

  describe('edge cases', () => {
    it('should handle whitespace-only input', async () => {
      const result = await classifyInput('   ');
      expect(result.classification).toBe('COMMAND');
    });

    it('should handle input with leading/trailing whitespace', async () => {
      const result = await classifyInput('  ls -la  ');
      expect(result.classification).toBe('COMMAND');
    });

    it('should classify inputs ending with ? as NL', async () => {
      const result = await classifyInput('how do I list files?');
      expect(result.classification).toBe('NATURAL_LANGUAGE');
    });
  });

  describe('classification result structure', () => {
    it('should return proper ClassificationResult structure', async () => {
      const result = await classifyInput('ls -la');
      expect(result).toHaveProperty('classification');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('tier');
      expect(result).toHaveProperty('reason');
      expect(typeof result.confidence).toBe('number');
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });
  });
});
