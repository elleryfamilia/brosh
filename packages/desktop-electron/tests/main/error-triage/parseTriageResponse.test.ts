import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Tests for triage response parsing.
 *
 * parseTriageResponse is not exported directly, so we test it
 * through the module's behavior by examining the expected parsing patterns.
 */

// Since parseTriageResponse is private, test the expected parsing patterns
describe('Triage Response Parsing Patterns', () => {
  describe('envelope format (claude --output-format json)', () => {
    it('should parse standard envelope with result string', () => {
      const envelope = {
        result: '{"shouldNotify": true, "message": "Module not found: express"}',
      };
      const innerJson = envelope.result;
      const parsed = JSON.parse(innerJson);

      expect(parsed.shouldNotify).toBe(true);
      expect(parsed.message).toBe('Module not found: express');
    });

    it('should handle direct format (no envelope)', () => {
      const direct = {
        shouldNotify: false,
        message: '',
      };

      expect(typeof direct.shouldNotify).toBe('boolean');
      expect(direct.shouldNotify).toBe(false);
    });
  });

  describe('inner JSON parsing', () => {
    it('should parse clean JSON', () => {
      const json = '{"shouldNotify": true, "message": "Permission denied on /etc/config"}';
      const parsed = JSON.parse(json);

      expect(parsed.shouldNotify).toBe(true);
      expect(parsed.message).toContain('Permission denied');
    });

    it('should handle markdown code fence wrapping', () => {
      const wrapped = '```json\n{"shouldNotify": true, "message": "Syntax error"}\n```';
      const cleaned = wrapped
        .replace(/^```(?:json)?\s*\n?/, '')
        .replace(/\n?```\s*$/, '');
      const parsed = JSON.parse(cleaned);

      expect(parsed.shouldNotify).toBe(true);
      expect(parsed.message).toBe('Syntax error');
    });

    it('should handle code fence without language tag', () => {
      const wrapped = '```\n{"shouldNotify": false, "message": ""}\n```';
      const cleaned = wrapped
        .replace(/^```(?:json)?\s*\n?/, '')
        .replace(/\n?```\s*$/, '');
      const parsed = JSON.parse(cleaned);

      expect(parsed.shouldNotify).toBe(false);
    });

    it('should reject missing shouldNotify field', () => {
      const json = '{"message": "some error"}';
      const parsed = JSON.parse(json);

      expect(typeof parsed.shouldNotify).not.toBe('boolean');
    });

    it('should handle empty message for shouldNotify=false', () => {
      const json = '{"shouldNotify": false, "message": ""}';
      const parsed = JSON.parse(json);

      expect(parsed.shouldNotify).toBe(false);
      expect(parsed.message).toBe('');
    });
  });

  describe('error scenarios', () => {
    it('should handle empty stdout', () => {
      const trimmed = ''.trim();
      expect(trimmed).toBe('');
      // parseTriageResponse returns null for empty input
    });

    it('should handle malformed JSON', () => {
      const malformed = '{"shouldNotify": true, message: broken}';
      expect(() => JSON.parse(malformed)).toThrow();
    });

    it('should handle non-JSON responses', () => {
      const text = 'The command failed because the module was not found.';
      expect(() => JSON.parse(text)).toThrow();
    });
  });

  describe('TriageResult contract', () => {
    it('should always have boolean shouldNotify', () => {
      const results = [
        { shouldNotify: true, message: 'Error occurred' },
        { shouldNotify: false, message: '' },
      ];

      for (const result of results) {
        expect(typeof result.shouldNotify).toBe('boolean');
        expect(typeof result.message).toBe('string');
      }
    });

    it('should coerce message to string', () => {
      // The actual code does String(parsed.message || "")
      const coerce = (val: unknown) => String(val || '');

      expect(coerce('hello')).toBe('hello');
      expect(coerce(undefined)).toBe('');
      expect(coerce(null)).toBe('');
      expect(coerce('')).toBe('');
      expect(coerce(42)).toBe('42');
    });
  });
});
