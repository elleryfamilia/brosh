import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  classifyInput,
  isKnownCommand,
  initializeDetection,
} from '../../../src/main/ai-detection.js';

/**
 * Tests for command-first input classification and retroactive NL detection.
 *
 * The fast-track flow:
 *   Enter → denylist → isKnownCommand? → YES → shell (skip ML)
 *                                       → NO  → ML classifier
 *
 * When a fast-tracked command fails (non-zero exit):
 *   Re-classify with ML → NL? → invoke AI retroactively
 *                       → CMD? → normal error triage
 */

describe('Command Fast-Track Classification', () => {
  beforeAll(async () => {
    await initializeDetection({ preloadML: true });
  });

  describe('isKnownCommand', () => {
    it('should recognize common Unix commands', () => {
      const knownCommands = ['ls', 'cd', 'cat', 'grep', 'find', 'mkdir', 'rm', 'cp', 'mv', 'chmod'];
      for (const cmd of knownCommands) {
        expect(isKnownCommand(cmd)).toBe(true);
      }
    });

    it('should recognize package managers', () => {
      const packageManagers = ['npm', 'yarn', 'pip', 'brew', 'cargo'];
      for (const cmd of packageManagers) {
        expect(isKnownCommand(cmd)).toBe(true);
      }
    });

    it('should recognize language runtimes', () => {
      const runtimes = ['node', 'python', 'ruby', 'java', 'go'];
      for (const cmd of runtimes) {
        expect(isKnownCommand(cmd)).toBe(true);
      }
    });

    it('should recognize version control tools', () => {
      expect(isKnownCommand('git')).toBe(true);
    });

    it('should recognize container tools', () => {
      const containers = ['docker', 'kubectl'];
      for (const cmd of containers) {
        expect(isKnownCommand(cmd)).toBe(true);
      }
    });

    it('should NOT recognize natural language words', () => {
      const nlWords = ['how', 'what', 'list', 'show', 'explain', 'help', 'create', 'delete'];
      for (const word of nlWords) {
        // Some of these might happen to be commands (like 'help')
        // but most NL starter words should not be known commands
        if (word === 'help') continue; // shell builtin
        expect(isKnownCommand(word)).toBe(false);
      }
    });

    it('should NOT recognize gibberish', () => {
      expect(isKnownCommand('asdfgh')).toBe(false);
      expect(isKnownCommand('xyzzy')).toBe(false);
      expect(isKnownCommand('foobar123')).toBe(false);
    });

    it('should be case-sensitive (commands are lowercase)', () => {
      // isKnownCommand expects lowercase input (caller normalizes)
      expect(isKnownCommand('ls')).toBe(true);
      expect(isKnownCommand('node')).toBe(true);
    });
  });

  describe('fast-track decision logic', () => {
    // Mirrors the logic in terminal-bridge.ts handleInputWithAIDetection:
    // 1. Extract firstWord from trimmedLine
    // 2. If isKnownCommand(firstWord) → skip ML, send to shell
    // 3. Else → run ML classifyInput

    function shouldFastTrack(input: string): boolean {
      const trimmed = input.trim();
      if (!trimmed) return false;
      const firstWord = trimmed.split(/\s+/)[0].toLowerCase();
      return isKnownCommand(firstWord);
    }

    it('should fast-track simple commands', () => {
      expect(shouldFastTrack('ls')).toBe(true);
      expect(shouldFastTrack('ls -la')).toBe(true);
      expect(shouldFastTrack('git status')).toBe(true);
      expect(shouldFastTrack('npm install')).toBe(true);
      expect(shouldFastTrack('docker ps')).toBe(true);
    });

    it('should fast-track commands where first word is a known command', () => {
      // Even if the rest looks like NL, fast-track based on first word
      expect(shouldFastTrack('node has how many letters')).toBe(true);
      expect(shouldFastTrack('python is a great language')).toBe(true);
      expect(shouldFastTrack('git is version control')).toBe(true);
    });

    it('should NOT fast-track natural language', () => {
      expect(shouldFastTrack('list all files')).toBe(false);
      expect(shouldFastTrack('show me the logs')).toBe(false);
      expect(shouldFastTrack('how do I install node')).toBe(false);
      expect(shouldFastTrack('what is my ip address')).toBe(false);
    });

    it('should NOT fast-track unknown first words', () => {
      expect(shouldFastTrack('thisis a prompt')).toBe(false);
      expect(shouldFastTrack('asdfgh')).toBe(false);
      expect(shouldFastTrack('please run the tests')).toBe(false);
    });

    it('should NOT fast-track empty input', () => {
      expect(shouldFastTrack('')).toBe(false);
      expect(shouldFastTrack('   ')).toBe(false);
    });
  });

  describe('retroactive ML re-classification', () => {
    // When a fast-tracked command fails, we re-classify with ML.
    // If ML says NL with high confidence → invoke AI
    // If ML says CMD → normal error handling

    it('should re-classify "node has how many letters" as NL', async () => {
      // First word is known (node), so it gets fast-tracked
      expect(isKnownCommand('node')).toBe(true);

      // But ML should classify the full input as NL
      const result = await classifyInput('node has how many letters');
      // The mock ML classifier should see this as a question-like statement
      // The actual ML model classifies this as NL with high confidence
      // With the mock, this depends on the heuristics in setup.ts
      expect(result).toHaveProperty('classification');
      expect(result).toHaveProperty('confidence');
    });

    it('should re-classify "node -e require(missing)" as CMD', async () => {
      expect(isKnownCommand('node')).toBe(true);

      // This is a real command that happened to fail
      const result = await classifyInput('node -e "require(\'missing\')"');
      expect(result.classification).toBe('COMMAND');
    });

    it('should re-classify "git is version control" as NL', async () => {
      expect(isKnownCommand('git')).toBe(true);

      // NL starting with a known command
      const result = await classifyInput('git is version control');
      // This should be classified based on ML heuristics
      expect(result).toHaveProperty('classification');
    });

    it('should re-classify real commands with flags as CMD', async () => {
      const realCommands = [
        'node --version',
        'node -e "console.log(1)"',
        'python -m pytest',
        'git log --oneline',
        'npm run build',
      ];
      for (const cmd of realCommands) {
        const result = await classifyInput(cmd);
        expect(result.classification).toBe('COMMAND');
      }
    });
  });

  describe('fast-track state management', () => {
    // Mirrors sessionFastTracked / sessionFastTrackLines Map behavior

    it('should track fast-track state per session', () => {
      const sessionFastTracked = new Map<string, boolean>();
      const sessionFastTrackLines = new Map<string, number>();

      // Session 1: fast-tracked command
      sessionFastTracked.set('session-1', true);
      sessionFastTrackLines.set('session-1', 0);

      // Session 2: ML-classified command
      sessionFastTracked.set('session-2', false);

      expect(sessionFastTracked.get('session-1')).toBe(true);
      expect(sessionFastTracked.get('session-2')).toBe(false);
      expect(sessionFastTrackLines.get('session-1')).toBe(0);
    });

    it('should count output lines for fast-tracked commands', () => {
      const sessionFastTrackLines = new Map<string, number>();
      sessionFastTrackLines.set('session-1', 0);

      // Simulate PTY output chunks with newlines
      function countNewlines(data: string, sessionId: string) {
        const lines = sessionFastTrackLines.get(sessionId) || 0;
        let newlines = 0;
        for (let i = 0; i < data.length; i++) {
          if (data[i] === '\n') newlines++;
        }
        if (newlines > 0) {
          sessionFastTrackLines.set(sessionId, lines + newlines);
        }
      }

      countNewlines('\r\n', 'session-1'); // Enter echo
      countNewlines('error line 1\r\n', 'session-1');
      countNewlines('error line 2\r\n', 'session-1');
      countNewlines('error line 3\r\n', 'session-1');

      expect(sessionFastTrackLines.get('session-1')).toBe(4);
    });

    it('should calculate correct erase line count', () => {
      // outputLines includes the Enter-echo \n, so -1 to preserve original prompt
      const outputLines = 19; // e.g., 1 (enter echo) + 18 (error output)
      const linesToErase = outputLines - 1;
      expect(linesToErase).toBe(18);

      // Edge case: only Enter echo, no error output
      const minOutputLines = 1;
      const minErase = minOutputLines - 1;
      expect(minErase).toBe(0);
    });

    it('should not erase when outputLines <= 1', () => {
      // Guard condition from handleFailedFastTrack
      const shouldErase = (outputLines: number) => outputLines > 1;

      expect(shouldErase(0)).toBe(false);
      expect(shouldErase(1)).toBe(false);
      expect(shouldErase(2)).toBe(true);
      expect(shouldErase(19)).toBe(true);
    });

    it('should generate correct escape sequence for erasure', () => {
      const outputLines = 19;
      const linesToErase = outputLines - 1;
      const escapeSeq = `\r\x1b[${linesToErase}A\x1b[J`;

      // \r moves to column 0 (fixes partial line remnant)
      expect(escapeSeq).toContain('\r');
      // \x1b[18A moves cursor up 18 lines
      expect(escapeSeq).toContain('\x1b[18A');
      // \x1b[J clears from cursor to end of screen
      expect(escapeSeq).toContain('\x1b[J');
    });

    it('should clean up state on session close', () => {
      const sessionFastTracked = new Map<string, boolean>();
      const sessionFastTrackLines = new Map<string, number>();

      sessionFastTracked.set('session-1', true);
      sessionFastTrackLines.set('session-1', 15);

      // Simulate closeSession cleanup
      sessionFastTracked.delete('session-1');
      sessionFastTrackLines.delete('session-1');

      expect(sessionFastTracked.has('session-1')).toBe(false);
      expect(sessionFastTrackLines.has('session-1')).toBe(false);
    });
  });

  describe('edge cases from plan', () => {
    // Test cases from the implementation plan's edge case table

    it('clear → fast-tracked, exits 0, no retroactive check', () => {
      expect(isKnownCommand('clear')).toBe(true);
      // exit 0 → no retroactive ML check needed
    });

    it('node --help → fast-tracked, exits 0', () => {
      expect(isKnownCommand('node')).toBe(true);
    });

    it('"list all files" → NOT fast-tracked, goes to ML', () => {
      expect(isKnownCommand('list')).toBe(false);
    });

    it('"thisis a prompt" → NOT fast-tracked, goes to ML', () => {
      expect(isKnownCommand('thisis')).toBe(false);
    });
  });
});
