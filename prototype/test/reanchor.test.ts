import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { reanchor } from '../src/shared/reanchor.ts';
import { parseMarked, scenarios } from './reanchor-scenarios.ts';

describe('re-anchoring scenarios', () => {
  for (const scenario of scenarios) {
    it(scenario.name, () => {
      const original = parseMarked(scenario.original);
      assert.ok(original.range, 'original must mark the commented lines with >>');
      const current = scenario.current === null ? null : parseMarked(scenario.current);
      const result = reanchor(original.text, original.range, current?.text ?? null, scenario.options);

      const allowed = Array.isArray(scenario.state) ? scenario.state : [scenario.state];
      assert.ok(allowed.includes(result.state), `expected ${allowed.join(' or ')}, got ${result.state}: ${result.reason}`);

      const expected = current?.range ?? null;
      if (result.state === 'outdated') {
        assert.deepEqual(result.replacement, expected, 'replacement region');
        if (scenario.insertAfter !== undefined) assert.equal(result.insertAfter, scenario.insertAfter, 'insertAfter');
      } else {
        assert.deepEqual(result.range, expected, 'placed range');
      }
    });
  }
});
