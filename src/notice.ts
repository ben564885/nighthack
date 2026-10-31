import type { HubState } from './types.js';

const pairs = (links: HubState['links']) => links.map(([a, b]) => `${a}-${b}`).join(', ');

/**
 * the text that matches what the notch shows right now. one text per popup, lowercase,
 * same words as the notch. returns null when there is nothing to say.
 */
export function noticeText(s: HubState): string | null {
  if (s.staged || s.phase === 'fault') {
    return s.findings
      .slice(0, 2)
      .map((f) => `${f.message}. ${f.fix}.`)
      .join(' ') || null;
  }
  if (s.phase === 'cut') {
    return `power cut: ${s.cutReason ?? 'unknown'}. the board is off. run a wiring check before turning it back on.`;
  }
  if (s.phase === 'pass') return `all clear. wiring matches ${s.project ?? 'the plan'}. safe to power on.`;
  if (s.phase === 'powered') return s.telemetry.sensed === false ? 'power is on. no current sensor, so nothing cuts it on overload.' : 'power is on.';
  if (s.phase === 'idle') {
    if (s.test) {
      if (s.test.danger) return `${s.test.danger}`.toLowerCase();
      if (s.test.ok) return `test passed: the board matches the diagram${s.project ? ` for ${s.project}` : ''}.`;
      const first = s.test.steps[0];
      const more = s.test.steps.length > 1 ? ` (${s.test.steps.length - 1} more step${s.test.steps.length > 2 ? 's' : ''})` : '';
      return first ? `${first.text}${more}`.toLowerCase() : null;
    }
    if (s.project) {
      const wired = s.plan.links.filter(([a, b]) => s.links.some(([x, y]) => (x === a && y === b) || (x === b && y === a))).length;
      return `project ${s.project}: ${wired} of ${s.plan.links.length} links wired.`;
    }
    return s.links.length ? `${s.links.length} connection${s.links.length === 1 ? '' : 's'} on the board: ${pairs(s.links)}.` : 'no connections on the board.';
  }
  return null;
}
