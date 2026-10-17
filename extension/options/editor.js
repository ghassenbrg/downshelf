/** The "New rule" / "Edit rule" dialog. */
import { RULE_TEMPLATES } from '../lib/defaults.js';
import {
  joinPath,
  resolveDestination,
  VARIABLES,
  validateDestination,
} from '../lib/destination.js';
import { FILE_TYPES, getFileType } from '../lib/filetypes.js';
import {
  describeCondition,
  detectField,
  FIELD_IDS,
  FIELDS,
  normalizeCondition,
  splitAlternatives,
  validateCondition,
} from '../lib/patterns.js';
import { createContext, parseShorthand, ruleTitle } from '../lib/rules.js';
import { h, icon } from '../shared/dom.js';
import { FIELD_ICONS } from '../shared/icons.js';
import { destinationChip } from '../shared/views.js';

/** A plausible download for previewing a rule. */
function sampleDownload(conditions) {
  let host = 'example.com';
  let path = '/files';
  let filename = 'report.pdf';
  const fill = (text, word) => text.replace(/\*/g, word).replace(/\?/g, '1');
  for (const { field, pattern } of conditions) {
    const [first] = splitAlternatives(pattern);
    if (!first) continue;
    if (field === 'site' && first !== '*') host = fill(first.replace(/^\*\./, ''), 'www');
    if (field === 'url') {
      const text = first.replace(/^[a-z*]+:\/\//i, '');
      const slash = text.indexOf('/');
      const urlHost = slash === -1 ? text : text.slice(0, slash);
      if (urlHost && urlHost !== '*') host = fill(urlHost.replace(/^\*\./, ''), 'www');
      if (slash !== -1) path = fill(text.slice(slash), 'files').replace(/\/+$/, '');
    }
    if (field === 'filename' && first !== '*') {
      filename = fill(first, first.startsWith('*') ? 'report' : '2026');
      if (!filename.includes('.')) filename += '.pdf';
    }
    if (field === 'filetype') {
      const ext = getFileType(first)?.extensions[0];
      if (ext) filename = `file.${ext}`;
    }
  }
  return {
    host,
    filename,
    ctx: createContext({ url: `https://${host}${path}/${filename}`, filename }),
  };
}

export function openEditor({ dialog, rule = null, draft = null, onSave, onDelete }) {
  const isNew = !rule;
  const base = rule ?? draft ?? {};
  const model = {
    name: base.name ?? '',
    destination: base.destination ?? '',
    conditions: (base.conditions?.length ? base.conditions : [{ field: 'site', pattern: '' }]).map(
      (c) => ({ field: c.field, pattern: c.pattern, fieldTouched: !isNew || Boolean(c.pattern) }),
    ),
  };
  let showErrors = false;
  let destTouched = false;
  let dirty = false;

  const nameInput = h('input', {
    id: 'ed-name',
    class: 'input',
    value: model.name,
    maxlength: 80,
    onInput: (e) => {
      model.name = e.target.value;
      dirty = true;
    },
  });
  const condList = h('div', { class: 'cond-list' });
  const destInput = h('input', {
    id: 'ed-dest',
    class: 'input mono dest-input',
    value: model.destination,
    placeholder: 'Development/GitHub',
    spellcheck: 'false',
    onInput: (e) => {
      model.destination = e.target.value;
      dirty = true;
      refresh();
    },
    onBlur: () => {
      destTouched = true;
      refresh();
    },
  });
  const destHint = h('p', { class: 'hint', id: 'ed-dest-hint' });
  const preview = h('div', { class: 'preview', 'aria-live': 'polite' });

  function insertVariable(name) {
    const token = `{${name}}`;
    const { selectionStart: start, selectionEnd: end, value } = destInput;
    const at = start ?? value.length;
    const needsSlash = at > 0 && value[at - 1] !== '/' && !value.slice(0, at).endsWith('}');
    const insert = needsSlash && at === value.length ? `/${token}` : token;
    destInput.setRangeText(insert, at, end ?? at, 'end');
    destInput.dispatchEvent(new Event('input'));
    destInput.focus();
  }

  const varChips = h(
    'div',
    { class: 'var-row' },
    h('span', { class: 'var-label' }, 'Insert:'),
    Object.entries(VARIABLES).map(([name, v]) =>
      h(
        'button',
        {
          type: 'button',
          class: 'var-chip',
          title: `${v.help} — e.g. ${v.example}`,
          onClick: () => insertVariable(name),
        },
        `{${name}}`,
      ),
    ),
  );

  // -- Conditions --------------------------------------------------------

  function conditionRow(cond, index) {
    const hint = h('p', { class: 'hint' });
    const select = h(
      'select',
      {
        class: 'select field-select',
        'aria-label': `Condition ${index + 1}: what to match`,
        onChange: (e) => {
          const next = e.target.value;
          const wasType = cond.field === 'filetype';
          cond.field = next;
          cond.fieldTouched = true;
          if (wasType !== (next === 'filetype')) cond.pattern = '';
          dirty = true;
          renderConditions(index);
        },
      },
      FIELD_IDS.map((id) =>
        h('option', { value: id, selected: id === cond.field }, FIELDS[id].label),
      ),
    );

    let input;
    if (cond.field === 'filetype') {
      const selected = new Set(splitAlternatives(cond.pattern));
      input = h(
        'div',
        { class: 'type-grid', role: 'group', 'aria-label': 'File types' },
        FILE_TYPES.map((type) =>
          h(
            'button',
            {
              type: 'button',
              class: 'type-chip',
              'aria-pressed': String(selected.has(type.id)),
              title: type.extensions.map((x) => `.${x}`).join(' '),
              onClick: (e) => {
                if (selected.has(type.id)) selected.delete(type.id);
                else selected.add(type.id);
                e.currentTarget.setAttribute('aria-pressed', String(selected.has(type.id)));
                cond.pattern = FILE_TYPES.filter((t) => selected.has(t.id))
                  .map((t) => t.id)
                  .join(', ');
                cond.touched = true;
                dirty = true;
                refresh();
              },
            },
            type.label,
          ),
        ),
      );
    } else {
      input = h('input', {
        class: 'input mono',
        value: cond.pattern,
        placeholder: FIELDS[cond.field].placeholder,
        spellcheck: 'false',
        'aria-label': `Condition ${index + 1}: pattern`,
        onInput: (e) => {
          cond.pattern = e.target.value;
          dirty = true;
          if (!cond.fieldTouched && cond.pattern.trim()) {
            const guess = detectField(cond.pattern).field;
            if (guess !== cond.field && guess !== 'filetype') {
              cond.field = guess;
              select.value = guess;
              row.dataset.field = guess;
              row.querySelector('.field-icon').replaceChildren(icon(FIELD_ICONS[guess], 15));
              e.target.placeholder = FIELDS[guess].placeholder;
            }
          }
          refresh();
        },
        onBlur: () => {
          cond.touched = true;
          refresh();
        },
      });
    }

    const remove =
      model.conditions.length > 1
        ? h(
            'button',
            {
              type: 'button',
              class: 'icon-btn danger',
              title: 'Remove condition',
              'aria-label': 'Remove condition',
              onClick: () => {
                model.conditions.splice(index, 1);
                dirty = true;
                renderConditions(Math.max(0, index - 1));
              },
            },
            icon('x', 15),
          )
        : null;

    const row = h(
      'div',
      { class: 'cond', dataset: { field: cond.field } },
      h(
        'div',
        { class: 'cond-top' },
        h('span', { class: 'field-icon' }, icon(FIELD_ICONS[cond.field], 15)),
        select,
        remove,
      ),
      input,
      hint,
    );
    cond.hint = hint;
    cond.input = input;
    return row;
  }

  function renderConditions(focusIndex) {
    condList.replaceChildren(
      ...model.conditions
        .flatMap((cond, i) => [
          i > 0 ? h('div', { class: 'and-sep' }, h('span', {}, 'and')) : null,
          conditionRow(cond, i),
        ])
        .filter(Boolean),
    );
    if (focusIndex !== undefined) {
      const target = model.conditions[focusIndex]?.input;
      (target?.matches?.('input') ? target : target?.querySelector('button'))?.focus();
    }
    refresh();
  }

  const addCondition = h(
    'button',
    {
      type: 'button',
      class: 'btn btn-ghost btn-sm add-cond',
      onClick: () => {
        model.conditions.push({ field: 'filename', pattern: '', fieldTouched: false });
        renderConditions(model.conditions.length - 1);
      },
    },
    icon('plus', 14),
    'Add condition',
  );

  // -- Live feedback -----------------------------------------------------

  function currentRule() {
    return {
      name: model.name.trim(),
      conditions: model.conditions.map((c) => normalizeCondition(c)),
      destination: validateDestination(model.destination).value,
    };
  }

  /** Like validateDestination, but an empty box is an error: it's almost always a mistake. */
  function checkDestination() {
    const result = validateDestination(model.destination);
    if (!result.error && model.destination.trim() === '') {
      return {
        ...result,
        error: 'Choose a folder. To keep these files at the top level, type “Downloads”.',
      };
    }
    return result;
  }

  function refresh() {
    let valid = true;
    for (const cond of model.conditions) {
      const error = validateCondition(cond);
      if (error) valid = false;
      const show = error && (showErrors || cond.touched);
      cond.hint.className = show ? 'hint error' : 'hint';
      cond.hint.textContent = show
        ? error
        : cond.pattern.trim() && !error
          ? `Matches ${describeCondition(cond)}`
          : FIELDS[cond.field].help;
      cond.input.setAttribute?.('aria-invalid', show ? 'true' : 'false');
    }

    const dest = checkDestination();
    if (dest.error) valid = false;
    const showDestError = dest.error && (showErrors || destTouched);
    destHint.className = showDestError ? 'hint error' : dest.notice ? 'hint notice' : 'hint';
    destHint.textContent = showDestError
      ? dest.error
      : (dest.notice ??
        (model.destination.trim()
          ? 'Missing folders are created automatically.'
          : 'A folder inside Downloads, like Development/GitHub.'));
    destInput.setAttribute('aria-invalid', showDestError ? 'true' : 'false');

    const rule = currentRule();
    nameInput.placeholder = ruleTitle({ conditions: rule.conditions }) || 'e.g. GitHub releases';

    if (!valid) {
      preview.replaceChildren(
        h(
          'span',
          { class: 'preview-empty' },
          'Fill in the fields above to see where files will go.',
        ),
      );
      return;
    }
    const sample = sampleDownload(rule.conditions);
    const folder = resolveDestination(rule.destination, sample.ctx, sample.ctx.sources[0]);
    preview.replaceChildren(
      h('div', { class: 'preview-label' }, 'Example'),
      h(
        'div',
        { class: 'preview-line' },
        h('span', { class: 'preview-file' }, icon('file', 13), sample.filename),
        h('span', { class: 'muted' }, 'from'),
        h('span', { class: 'mono' }, sample.host),
      ),
      h(
        'div',
        { class: 'preview-line' },
        icon('arrowRight', 14),
        destinationChip(joinPath(folder, sample.filename)),
      ),
    );
  }

  // -- Templates (new rules only) ----------------------------------------

  const templates =
    isNew && !draft
      ? h(
          'div',
          { class: 'templates' },
          h('span', { class: 'var-label' }, 'Start from an example:'),
          RULE_TEMPLATES.map((t) =>
            h(
              'button',
              {
                type: 'button',
                class: 'template-chip',
                title: t.line,
                onClick: () => {
                  const { rule: r } = parseShorthand(t.line);
                  model.conditions = r.conditions.map((c) => ({ ...c, fieldTouched: true }));
                  model.destination = r.destination;
                  destInput.value = r.destination;
                  dirty = true;
                  renderConditions(0);
                  model.conditions[0].input.select?.();
                },
              },
              t.label,
            ),
          ),
        )
      : null;

  // -- Save / close ------------------------------------------------------

  function save() {
    const rule = currentRule();
    const invalid = model.conditions.some((c) => validateCondition(c)) || checkDestination().error;
    if (invalid) {
      showErrors = true;
      refresh();
      const bad = dialog.querySelector('[aria-invalid="true"]');
      bad?.focus();
      return;
    }
    dialog.close();
    onSave(rule);
  }

  const form = h(
    'form',
    {
      method: 'dialog',
      class: 'editor-form',
      novalidate: true,
      onSubmit: (e) => {
        e.preventDefault();
        save();
      },
      onKeydown: (e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          save();
        }
      },
    },
    h(
      'header',
      { class: 'editor-head' },
      h('h2', { id: 'editor-title' }, isNew ? 'New rule' : 'Edit rule'),
      h(
        'button',
        {
          type: 'button',
          class: 'icon-btn',
          'aria-label': 'Close',
          onClick: () => dialog.close(),
        },
        icon('x', 18),
      ),
    ),
    h(
      'div',
      { class: 'editor-body' },
      templates,
      h(
        'section',
        { class: 'editor-section' },
        h(
          'h3',
          { class: 'step' },
          h('span', { class: 'step-num' }, '1'),
          'When a download matches',
        ),
        condList,
        addCondition,
      ),
      h(
        'section',
        { class: 'editor-section' },
        h('h3', { class: 'step' }, h('span', { class: 'step-num' }, '2'), 'Save it in'),
        h(
          'div',
          { class: 'dest-field' },
          h('span', { class: 'dest-prefix' }, icon('folder', 14), 'Downloads /'),
          destInput,
        ),
        destHint,
        varChips,
      ),
      preview,
      h(
        'section',
        { class: 'editor-section' },
        h(
          'label',
          { class: 'label', for: 'ed-name' },
          'Name ',
          h('span', { class: 'muted' }, '(optional)'),
        ),
        nameInput,
      ),
    ),
    h(
      'footer',
      { class: 'editor-foot' },
      !isNew && onDelete
        ? h(
            'button',
            {
              type: 'button',
              class: 'btn btn-ghost btn-danger',
              onClick: () => {
                dialog.close();
                onDelete();
              },
            },
            icon('trash', 14),
            'Delete',
          )
        : null,
      h(
        'span',
        { class: 'foot-hint' },
        h('kbd', {}, navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'),
        ' ',
        h('kbd', {}, '↵'),
        ' to save',
      ),
      h('button', { type: 'button', class: 'btn', onClick: () => dialog.close() }, 'Cancel'),
      h('button', { type: 'submit', class: 'btn btn-primary' }, isNew ? 'Add rule' : 'Save'),
    ),
  );

  dialog.replaceChildren(form);
  dialog.onclick = (e) => {
    if (e.target === dialog && !dirty) dialog.close();
  };
  renderConditions();
  dialog.showModal();
  const firstEmpty = model.conditions.find((c) => !c.pattern)?.input;
  if (firstEmpty?.focus) firstEmpty.focus();
  else if (!model.destination) destInput.focus();
  else model.conditions[0].input.focus?.();
}
