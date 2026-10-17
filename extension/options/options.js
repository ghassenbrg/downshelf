import { starterRules } from '../lib/defaults.js';
import { registrableDomain } from '../lib/destination.js';
import { describeCondition } from '../lib/patterns.js';
import {
  createContext,
  createRule,
  describeRule,
  exportRules,
  findShadowed,
  importRules,
  insertionIndex,
  parseShorthand,
  route,
  ruleTitle,
  SOURCE_LABELS,
  sortBySpecificity,
} from '../lib/rules.js';
import {
  clearActivity,
  loadActivity,
  loadState,
  onStateChange,
  saveRules,
  saveSettings,
} from '../lib/storage.js';
import { fill, h, icon, plural, timeAgo } from '../shared/dom.js';
import { logoSvg } from '../shared/icons.js';
import { conditionChip, destinationChip, flow } from '../shared/views.js';
import { openEditor } from './editor.js';

const $ = (id) => document.getElementById(id);

const state = {
  settings: null,
  rules: [],
  stats: {},
  activity: [],
  test: null, // last tester result
};

// ---------------------------------------------------------------------------
// Persistence helpers

async function commitRules(rules, { focusId } = {}) {
  state.rules = rules;
  runTest(); // re-renders the list with fresh test highlights
  if (focusId) document.querySelector(`[data-id="${focusId}"] .handle`)?.focus();
  await saveRules(rules);
}

function indexOf(id) {
  return state.rules.findIndex((r) => r.id === id);
}

// ---------------------------------------------------------------------------
// Toasts and confirm

function toast(message, action) {
  const box = $('toasts');
  const el = h(
    'div',
    { class: 'toast' },
    h('span', { class: 'msg' }, message),
    action
      ? h(
          'button',
          {
            type: 'button',
            class: 'btn btn-sm',
            onClick: () => {
              action.run();
              el.remove();
            },
          },
          action.label,
        )
      : null,
  );
  box.append(el);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => el.remove(), action ? 7000 : 3800);
}

function confirmDialog({ title, body, confirm, danger = false, extra }) {
  const dialog = $('confirm');
  return new Promise((resolve) => {
    const done = (value) => {
      dialog.close();
      resolve(value);
    };
    dialog.replaceChildren(
      h(
        'form',
        { method: 'dialog', class: 'confirm-form' },
        h('h2', {}, title),
        h('p', { class: 'muted' }, body),
        h(
          'div',
          { class: 'btn-row end' },
          h('button', { type: 'button', class: 'btn', onClick: () => done(null) }, 'Cancel'),
          extra
            ? h(
                'button',
                { type: 'button', class: 'btn', onClick: () => done(extra.value) },
                extra.label,
              )
            : null,
          h(
            'button',
            {
              type: 'button',
              class: danger ? 'btn btn-primary danger-fill' : 'btn btn-primary',
              onClick: () => done(confirm.value ?? true),
            },
            confirm.label,
          ),
        ),
      ),
    );
    dialog.oncancel = () => resolve(null);
    dialog.showModal();
    dialog.querySelector('.btn-primary').focus();
  });
}

// ---------------------------------------------------------------------------
// Rule actions

function addRule(rule, { quiet = false } = {}) {
  const index = insertionIndex(state.rules, rule);
  const rules = [...state.rules];
  rules.splice(index, 0, rule);
  commitRules(rules);
  flash(rule.id);
  if (quiet) return;
  const below = state.rules[index + 1];
  if (index < state.rules.length - 1 && below) {
    toast(`Added at #${index + 1}, above “${ruleTitle(below)}”, so it takes priority.`);
  } else {
    toast(`Rule added: ${ruleTitle(rule)}`);
  }
}

function updateRule(id, patch) {
  commitRules(state.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  flash(id);
  const shadowedBy = findShadowed(state.rules).get(id);
  if (shadowedBy) {
    const blocker = state.rules.find((r) => r.id === shadowedBy);
    toast(`“${ruleTitle(blocker)}” above catches these files first.`, {
      label: 'Move above it',
      run: () => moveAbove(id, shadowedBy),
    });
  }
}

function deleteRule(id) {
  const before = state.rules;
  const rule = before.find((r) => r.id === id);
  commitRules(before.filter((r) => r.id !== id));
  toast(`Deleted “${ruleTitle(rule)}”`, { label: 'Undo', run: () => commitRules(before) });
}

function duplicateRule(id) {
  const index = indexOf(id);
  const copy = { ...structuredClone(state.rules[index]), id: createRule().id };
  if (copy.name) copy.name = `${copy.name} (copy)`;
  const rules = [...state.rules];
  rules.splice(index + 1, 0, copy);
  commitRules(rules);
  flash(copy.id);
  openRuleEditor(copy);
}

function move(id, delta) {
  const from = indexOf(id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= state.rules.length) return;
  const rules = [...state.rules];
  const [rule] = rules.splice(from, 1);
  rules.splice(to, 0, rule);
  commitRules(rules, { focusId: id });
}

function moveAbove(id, targetId) {
  const rules = state.rules.filter((r) => r.id !== id);
  const rule = state.rules.find((r) => r.id === id);
  rules.splice(
    rules.findIndex((r) => r.id === targetId),
    0,
    rule,
  );
  commitRules(rules);
  flash(id);
}

function flash(id) {
  requestAnimationFrame(() => {
    const el = document.querySelector(`.rule[data-id="${id}"]`);
    if (!el) return;
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
}

function openRuleEditor(rule, draft) {
  openEditor({
    dialog: $('editor'),
    rule,
    draft,
    onSave: (data) => {
      if (rule) updateRule(rule.id, data);
      else addRule(createRule(data));
    },
    onDelete: rule ? () => deleteRule(rule.id) : null,
  });
}

// ---------------------------------------------------------------------------
// Rule list

function ruleMeta(rule) {
  const stat = state.stats[rule.id];
  if (!stat?.count) return h('span', { class: 'rule-meta' }, 'Not used yet');
  return h(
    'span',
    { class: 'rule-meta', title: new Date(stat.last).toLocaleString() },
    `${plural(stat.count, 'file')} · ${timeAgo(stat.last)}`,
  );
}

function ruleItem(rule, index, shadowed) {
  const blockerId = shadowed.get(rule.id);
  const blocker = blockerId ? state.rules.find((r) => r.id === blockerId) : null;
  const title = ruleTitle(rule);
  const testEval = state.test?.evaluations.find((e) => e.rule.id === rule.id);
  const isWinner = state.test?.rule?.id === rule.id;

  const handle = h(
    'button',
    {
      type: 'button',
      class: 'handle',
      title: 'Drag to reorder (or use ↑ ↓)',
      'aria-label': `Move “${title}”, priority ${index + 1} of ${state.rules.length}. Use arrow keys.`,
      onKeydown: (e) => {
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          move(rule.id, -1);
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          move(rule.id, 1);
        }
      },
      onPointerdown: () => {
        item.draggable = true;
      },
      onPointerup: () => {
        item.draggable = false;
      },
    },
    icon('grip', 16),
  );

  const toggle = h(
    'label',
    { class: 'switch', title: rule.enabled ? 'Turn off' : 'Turn on' },
    h('input', {
      type: 'checkbox',
      role: 'switch',
      checked: rule.enabled,
      'aria-label': `${title} enabled`,
      onChange: (e) => updateRule(rule.id, { enabled: e.target.checked }),
    }),
    h('span', { class: 'track' }),
  );

  const actions = h(
    'div',
    { class: 'rule-actions' },
    h(
      'button',
      {
        type: 'button',
        class: 'icon-btn',
        title: 'Edit',
        'aria-label': `Edit ${title}`,
        onClick: () => openRuleEditor(rule),
      },
      icon('pencil', 15),
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'icon-btn',
        title: 'Duplicate',
        'aria-label': `Duplicate ${title}`,
        onClick: () => duplicateRule(rule.id),
      },
      icon('copy', 15),
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'icon-btn danger',
        title: 'Delete',
        'aria-label': `Delete ${title}`,
        onClick: () => deleteRule(rule.id),
      },
      icon('trash', 15),
    ),
  );

  const badges = [];
  if (isWinner) badges.push(h('span', { class: 'badge badge-match' }, icon('check', 12), 'Match'));
  else if (testEval?.matched) badges.push(h('span', { class: 'badge' }, 'Also matches'));

  const warning = blocker
    ? h(
        'div',
        { class: 'rule-warning' },
        icon('alert', 14),
        h(
          'span',
          {},
          'Never used: ',
          h('strong', {}, `“${ruleTitle(blocker)}”`),
          ' above catches these files first.',
        ),
        h(
          'button',
          { type: 'button', class: 'link-btn', onClick: () => moveAbove(rule.id, blocker.id) },
          'Move above it',
        ),
      )
    : null;

  const item = h(
    'li',
    {
      class: [
        'rule',
        'card',
        rule.enabled ? '' : 'is-off',
        blocker ? 'is-shadowed' : '',
        isWinner ? 'is-match' : '',
        testEval?.matched && !isWinner ? 'is-also' : '',
      ]
        .filter(Boolean)
        .join(' '),
      dataset: { id: rule.id },
      onDragstart: (e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', rule.id);
        requestAnimationFrame(() => item.classList.add('dragging'));
      },
      onDragend: () => {
        item.draggable = false;
        item.classList.remove('dragging');
        const order = [...$('rule-list').children].map((li) => li.dataset.id);
        const changed = order.some((id, i) => id !== state.rules[i]?.id);
        if (changed) {
          const byId = new Map(state.rules.map((r) => [r.id, r]));
          commitRules(order.map((id) => byId.get(id)));
          flash(rule.id);
        }
      },
    },
    h('div', { class: 'rule-rail' }, handle, h('span', { class: 'rank' }, String(index + 1))),
    h(
      'div',
      {
        class: 'rule-body',
        onClick: (e) => {
          if (!e.target.closest('button, a, input, label')) openRuleEditor(rule);
        },
      },
      h(
        'div',
        { class: 'rule-head' },
        h('span', { class: 'rule-title' }, title),
        badges,
        ruleMeta(rule),
      ),
      flow(rule),
      h('p', { class: 'rule-desc' }, `When ${describeRule(rule)}`),
      warning,
    ),
    h('div', { class: 'rule-side' }, toggle, actions),
  );
  return item;
}

function renderRules() {
  const list = $('rule-list');
  const shadowed = findShadowed(state.rules);
  fill(list, ...state.rules.map((rule, i) => ruleItem(rule, i, shadowed)));

  $('sort-btn').hidden = state.rules.length < 2;

  if (state.rules.length === 0) {
    fill(
      list,
      h(
        'li',
        { class: 'empty card' },
        h('div', { class: 'empty-icon' }, icon('sparkles', 22)),
        h('h3', {}, 'No rules yet'),
        h(
          'p',
          { class: 'muted' },
          'Rules tell Downshelf which folder each download belongs in. Try quick add above, or:',
        ),
        h(
          'div',
          { class: 'btn-row center' },
          h(
            'button',
            { type: 'button', class: 'btn btn-primary', onClick: () => openRuleEditor() },
            icon('plus', 14),
            'Create a rule',
          ),
          h(
            'button',
            { type: 'button', class: 'btn', onClick: () => commitRules(starterRules()) },
            'Add starter rules',
          ),
        ),
      ),
    );
  }

  const fallbackMatch = state.test && !state.test.rule;
  $('fallback').className = `fallback${fallbackMatch ? ' is-match' : ''}`;
  fill(
    $('fallback'),
    icon('inbox', 16),
    h('span', {}, 'Everything else stays in ', h('strong', {}, 'Downloads'), ' as usual.'),
    fallbackMatch ? h('span', { class: 'badge badge-match' }, icon('check', 12), 'Match') : null,
  );
}

// Live reordering while dragging.
function setupDragAndDrop() {
  const list = $('rule-list');
  list.addEventListener('dragover', (e) => {
    const dragging = list.querySelector('.dragging');
    if (!dragging) return;
    e.preventDefault();
    const siblings = [...list.querySelectorAll('.rule:not(.dragging)')];
    const next = siblings.find((el) => {
      const box = el.getBoundingClientRect();
      return e.clientY < box.top + box.height / 2;
    });
    if (next) {
      if (dragging.nextElementSibling !== next) list.insertBefore(dragging, next);
    } else if (list.lastElementChild !== dragging) {
      list.append(dragging);
    }
    [...list.children].forEach((li, i) => {
      const rank = li.querySelector('.rank');
      if (rank) rank.textContent = String(i + 1);
    });
  });
  list.addEventListener('drop', (e) => e.preventDefault());
}

// ---------------------------------------------------------------------------
// Quick add

function renderQuickPreview() {
  const value = $('quick-input').value;
  const box = $('quick-preview');
  const submit = $('quick-submit');
  if (!value.trim()) {
    fill(box);
    box.hidden = true;
    submit.disabled = true;
    return;
  }
  box.hidden = false;
  const hasArrow = /→|->|=>/.test(value);
  const text = hasArrow ? value : `${value} → Downloads`;
  const { rule, error } = parseShorthand(text);
  submit.disabled = Boolean(error);
  if (!hasArrow) {
    fill(
      box,
      rule?.conditions.length
        ? h('div', { class: 'flow' }, rule.conditions.map(conditionChip))
        : null,
      h('span', { class: 'hint' }, 'Now type ', h('kbd', {}, '->'), ' and a folder name.'),
    );
    submit.disabled = true;
    return;
  }
  fill(
    box,
    rule?.conditions.length ? flow(rule) : null,
    error
      ? h('span', { class: 'hint error' }, error)
      : h('span', { class: 'hint' }, `When ${describeRule(rule)} · press Enter to add`),
  );
}

function setupQuickAdd() {
  const input = $('quick-input');
  input.addEventListener('input', renderQuickPreview);
  $('quick-add').addEventListener('submit', (e) => {
    e.preventDefault();
    const { rule, error } = parseShorthand(input.value);
    if (error || !rule) {
      renderQuickPreview();
      return;
    }
    addRule(rule);
    input.value = '';
    renderQuickPreview();
  });
  renderQuickPreview();
}

// ---------------------------------------------------------------------------
// Tester

function runTest() {
  const url = $('test-url').value.trim();
  const filename = $('test-name').value.trim();
  const referrer = $('test-page').value.trim();
  const box = $('test-result');

  if (!url && !filename && !referrer) {
    state.test = null;
    fill(box);
    renderRules();
    return;
  }

  const ctx = createContext({ url, filename, referrer });
  if (!filename)
    $('test-name').placeholder = ctx.filename !== 'download' ? ctx.filename : 'report.pdf';
  const result = route(state.rules, ctx);
  state.test = result;
  renderRules();

  const others = result.evaluations.filter((e) => e.matched && e.rule !== result.rule);
  // A turned-off rule that would have won is worth pointing out.
  const disabledMatch = result.evaluations.find(
    (e) =>
      e.skipped &&
      (result.index === -1 || e.index < result.index) &&
      route([{ ...e.rule, enabled: true }], ctx).rule,
  );

  if (!state.settings.enabled) {
    fill(
      box,
      h(
        'div',
        { class: 'result result-paused' },
        icon('pause', 16),
        h('span', {}, 'Sorting is paused, so this would stay in Downloads.'),
      ),
    );
    return;
  }

  if (!result.rule) {
    const domain = registrableDomain(ctx.sources[0]?.host ?? '');
    fill(
      box,
      h(
        'div',
        { class: 'result result-none' },
        h('div', { class: 'result-title' }, icon('inbox', 16), 'Stays in Downloads'),
        destinationChip(ctx.filename),
        h('p', { class: 'muted' }, 'No rule matches this download.'),
        disabledMatch
          ? h(
              'p',
              { class: 'muted' },
              `“${ruleTitle(disabledMatch.rule)}” would match, but it’s turned off.`,
            )
          : null,
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn-sm',
            onClick: () =>
              openRuleEditor(null, {
                conditions: [
                  domain
                    ? { field: 'site', pattern: `*.${domain}` }
                    : { field: 'filename', pattern: ctx.filename },
                ],
              }),
          },
          icon('plus', 14),
          domain ? `Create a rule for ${domain}` : 'Create a rule for this file',
        ),
      ),
    );
    return;
  }

  const winner = result.evaluations.find((e) => e.rule === result.rule);
  const reasons = result.rule.conditions.map((condition, i) => {
    const source = winner.conditions[i].source;
    return h(
      'li',
      {},
      icon('check', 13),
      h(
        'span',
        {},
        describeCondition(condition),
        source ? h('span', { class: 'muted' }, ` — via the ${SOURCE_LABELS[source.role]}`) : null,
      ),
    );
  });

  fill(
    box,
    h(
      'div',
      { class: 'result result-match' },
      h('div', { class: 'result-title' }, icon('check', 16), 'Goes to'),
      destinationChip(result.path),
      h(
        'p',
        { class: 'result-rule' },
        'Rule ',
        h('strong', {}, `#${result.index + 1} ${ruleTitle(result.rule)}`),
      ),
      h('ul', { class: 'reasons' }, reasons),
      disabledMatch
        ? h(
            'p',
            { class: 'muted small' },
            `“${ruleTitle(disabledMatch.rule)}” would come first, but it’s turned off.`,
          )
        : null,
      others.length
        ? h(
            'p',
            { class: 'muted small' },
            `Also matches ${others.map((o) => `#${o.index + 1} ${ruleTitle(o.rule)}`).join(', ')} — lower in the list, so not used.`,
          )
        : null,
    ),
  );
}

function setupTester() {
  for (const id of ['test-url', 'test-name', 'test-page']) {
    $(id).addEventListener('input', runTest);
  }
}

// ---------------------------------------------------------------------------
// Activity, settings, banners

function renderActivity() {
  const list = $('activity');
  $('clear-activity').hidden = state.activity.length === 0;
  if (state.activity.length === 0) {
    fill(
      list,
      h(
        'li',
        { class: 'activity-empty muted' },
        'Nothing sorted yet. Downloads that match a rule will show up here.',
      ),
    );
    return;
  }
  fill(
    list,
    ...state.activity
      .slice(0, 8)
      .map((entry) =>
        h(
          'li',
          { class: 'activity-item' },
          h(
            'div',
            { class: 'activity-file', title: entry.filename },
            icon('file', 13),
            h('span', {}, entry.filename),
          ),
          h(
            'div',
            { class: 'activity-meta' },
            destinationChip(entry.folder),
            h('span', { class: 'muted small' }, `${entry.ruleTitle} · ${timeAgo(entry.at)}`),
          ),
        ),
      ),
  );
}

function renderSettings() {
  const { enabled, conflictAction } = state.settings;
  $('master-toggle').checked = enabled;
  $('master-label').textContent = enabled ? 'Sorting on' : 'Paused';
  document.body.classList.toggle('is-paused', !enabled);
  $('conflict').value = conflictAction;
  renderBanners();
}

function renderBanners() {
  const banners = [];
  if (!state.settings.enabled) {
    banners.push(
      h(
        'div',
        { class: 'banner banner-warn' },
        icon('pause', 16),
        h('span', {}, 'Sorting is paused. New downloads go straight to your Downloads folder.'),
        h(
          'button',
          { type: 'button', class: 'btn btn-sm', onClick: () => setEnabled(true) },
          'Resume',
        ),
      ),
    );
  }
  if (!state.settings.welcomeDismissed) {
    banners.push(
      h(
        'div',
        { class: 'banner banner-welcome' },
        icon('sparkles', 18),
        h(
          'div',
          {},
          h('strong', {}, 'Welcome to Downshelf!'),
          h(
            'p',
            {},
            'We added a few starter rules that sort files by type. Edit or delete them, add your own, and use “Test a download” to check where a file would go. Folders are created inside your Downloads folder.',
          ),
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'icon-btn',
            'aria-label': 'Dismiss',
            onClick: () => saveSettings({ welcomeDismissed: true }),
          },
          icon('x', 16),
        ),
      ),
    );
  }
  fill($('banners'), ...banners);
}

async function setEnabled(enabled) {
  state.settings = await saveSettings({ enabled });
  renderSettings();
  runTest();
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function setupSettings() {
  $('master-toggle').addEventListener('change', (e) => setEnabled(e.target.checked));
  $('conflict').addEventListener('change', async (e) => {
    state.settings = await saveSettings({ conflictAction: e.target.value });
    toast('Saved');
  });

  $('export-btn').addEventListener('click', () => {
    const date = new Date().toISOString().slice(0, 10);
    download(
      `downshelf-rules-${date}.json`,
      `${JSON.stringify(exportRules(state.rules), null, 2)}\n`,
      'application/json',
    );
    toast(`Exported ${plural(state.rules.length, 'rule')}`);
  });

  $('import-btn').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const { rules, errors } = importRules(await file.text());
    if (rules.length === 0) {
      await confirmDialog({
        title: 'Nothing to import',
        body: errors.slice(0, 4).join('\n') || 'No rules were found in that file.',
        confirm: { label: 'OK' },
      });
      return;
    }
    const skipped = errors.length
      ? ` ${plural(errors.length, 'entry', 'entries')} couldn’t be read and will be skipped.`
      : '';
    const choice =
      state.rules.length === 0
        ? 'replace'
        : await confirmDialog({
            title: `Import ${plural(rules.length, 'rule')}?`,
            body: `Add them below your current rules, or replace your ${plural(state.rules.length, 'rule')}.${skipped}`,
            confirm: { label: 'Add to my rules', value: 'append' },
            extra: { label: 'Replace all', value: 'replace' },
          });
    if (!choice) return;
    const before = state.rules;
    await commitRules(choice === 'replace' ? rules : [...state.rules, ...rules]);
    toast(`Imported ${plural(rules.length, 'rule')}`, {
      label: 'Undo',
      run: () => commitRules(before),
    });
  });

  $('reset-btn').addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Reset to starter rules?',
      body: 'This replaces all your rules with the starter set. You can undo right after.',
      confirm: { label: 'Reset rules' },
      danger: true,
    });
    if (!ok) return;
    const before = state.rules;
    await commitRules(starterRules());
    toast('Rules reset', { label: 'Undo', run: () => commitRules(before) });
  });

  $('clear-activity').addEventListener('click', async () => {
    await clearActivity();
  });

  $('sort-btn').addEventListener('click', async () => {
    const before = state.rules;
    const sorted = sortBySpecificity(state.rules);
    if (sorted.every((r, i) => r === before[i])) {
      toast('Already sorted — most specific rules are on top.');
      return;
    }
    await commitRules(sorted);
    toast('Sorted: most specific rules first', { label: 'Undo', run: () => commitRules(before) });
  });

  $('new-rule-btn').addEventListener('click', () => openRuleEditor());
}

// ---------------------------------------------------------------------------
// Boot

function openFromUrl() {
  const params = new URLSearchParams(location.search);
  const site = params.get('site');
  if (site) {
    history.replaceState(null, '', location.pathname);
    openRuleEditor(null, { conditions: [{ field: 'site', pattern: site }] });
  } else if (params.has('new')) {
    history.replaceState(null, '', location.pathname);
    openRuleEditor();
  }
}

async function init() {
  $('logo').innerHTML = logoSvg(34);
  $('tester-icon').append(icon('flask', 16));
  $('activity-icon').append(icon('clock', 16));
  $('settings-icon').append(icon('settings', 16));
  $('help-icon').append(icon('help', 16));
  $('quick-icon').append(icon('zap', 15));
  $('new-rule-btn').prepend(icon('plus', 15));
  $('sort-btn').prepend(icon('sort', 14));
  $('export-btn').prepend(icon('download', 14));
  $('import-btn').prepend(icon('upload', 14));

  const loaded = await loadState();
  Object.assign(state, loaded);
  state.activity = await loadActivity();

  renderSettings();
  renderRules();
  renderActivity();
  setupDragAndDrop();
  setupQuickAdd();
  setupTester();
  setupSettings();
  openFromUrl();

  onStateChange(async (changes) => {
    if (changes.rules) {
      const next = changes.rules.newValue ?? [];
      if (JSON.stringify(next) !== JSON.stringify(state.rules)) {
        state.rules = next;
        runTest();
      }
    }
    if (changes.settings) {
      state.settings = (await loadState()).settings;
      renderSettings();
    }
    if (changes.stats) {
      state.stats = changes.stats.newValue ?? {};
      renderRules();
    }
    if (changes.activity) {
      state.activity = changes.activity.newValue ?? [];
      renderActivity();
    }
  });
}

init();
