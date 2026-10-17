/** Small view pieces shared by the options page and the popup. */
import { getFileType } from '../lib/filetypes.js';
import { describeCondition, FIELDS } from '../lib/patterns.js';
import { h, icon } from './dom.js';
import { FIELD_ICONS } from './icons.js';

export function conditionChip(condition) {
  const text =
    condition.field === 'filetype'
      ? condition.pattern
          .split(', ')
          .map((id) => getFileType(id)?.label ?? id)
          .join(', ')
      : condition.pattern;
  return h(
    'span',
    {
      class: 'chip',
      dataset: { field: condition.field },
      title: `${FIELDS[condition.field]?.label ?? ''}: ${describeCondition(condition)}`,
    },
    icon(FIELD_ICONS[condition.field] ?? 'file', 13),
    text,
  );
}

/** Renders `Downloads / A / {year}` with variables highlighted. */
export function destinationChip(destination, { root = 'Downloads' } = {}) {
  const parts = [h('span', { class: 'root' }, root)];
  for (const segment of String(destination ?? '')
    .split('/')
    .filter(Boolean)) {
    parts.push(h('span', { class: 'sep' }, '/'));
    const pieces = segment.split(/(\{[a-z]+\})/).filter(Boolean);
    parts.push(
      h(
        'span',
        {},
        pieces.map((piece) => (piece.startsWith('{') ? h('span', { class: 'var' }, piece) : piece)),
      ),
    );
  }
  return h(
    'span',
    { class: 'chip chip-dest', title: `Saved to Downloads/${destination ?? ''}` },
    icon('folder', 13),
    parts,
  );
}

export function flow(rule) {
  const conditions = rule.conditions.flatMap((condition, i) => [
    i > 0 ? h('span', { class: 'and' }, '&') : null,
    conditionChip(condition),
  ]);
  return h(
    'div',
    { class: 'flow' },
    conditions,
    h('span', { class: 'flow-arrow' }, icon('arrowRight', 15)),
    destinationChip(rule.destination),
  );
}
