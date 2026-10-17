import { registrableDomain } from '../lib/destination.js';
import { testCondition } from '../lib/patterns.js';
import { createContext, ruleTitle } from '../lib/rules.js';
import { loadActivity, loadState, saveSettings } from '../lib/storage.js';
import { fill, h, icon, plural, timeAgo } from '../shared/dom.js';
import { logoSvg } from '../shared/icons.js';
import { destinationChip, flow } from '../shared/views.js';

const $ = (id) => document.getElementById(id);

function openOptions(query = '') {
  chrome.tabs.create({ url: chrome.runtime.getURL(`options/options.html${query}`) });
  window.close();
}

/** Enabled rules whose website/URL conditions all match the page (file conditions ignored). */
function rulesForPage(rules, url) {
  const ctx = createContext({ url, referrer: url });
  return rules.filter((rule) => {
    if (!rule.enabled) return false;
    const siteConditions = rule.conditions.filter((c) => c.field === 'site' || c.field === 'url');
    return siteConditions.length > 0 && siteConditions.every((c) => testCondition(c, ctx).ok);
  });
}

async function currentPage() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = new URL(tab?.url ?? '');
    return /^https?:$/.test(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

function renderStatus(enabled) {
  $('toggle').checked = enabled;
  $('status').textContent = enabled ? 'Sorting on' : 'Paused — downloads aren’t sorted';
  document.body.classList.toggle('is-paused', !enabled);
}

function renderSite(page, rules) {
  if (!page) return;
  const host = page.hostname.replace(/^www\./, '');
  const domain = registrableDomain(host);
  const matching = rulesForPage(rules, page.href);
  const box = $('site');
  box.hidden = false;
  fill(
    box,
    h('h2', { class: 'block-title' }, 'On ', h('span', { class: 'host' }, host)),
    matching.length
      ? h(
          'ul',
          { class: 'site-rules' },
          matching
            .slice(0, 3)
            .map((rule) =>
              h('li', {}, h('span', { class: 'site-rule-title' }, ruleTitle(rule)), flow(rule)),
            ),
        )
      : h(
          'p',
          { class: 'muted' },
          'No site rules yet — downloads here are sorted by your other rules.',
        ),
    matching.length > 3 ? h('p', { class: 'muted small' }, `+${matching.length - 3} more`) : null,
    h(
      'button',
      {
        type: 'button',
        class: 'btn btn-sm add-site',
        onClick: () => openOptions(`?site=${encodeURIComponent(`*.${domain}`)}`),
      },
      icon('plus', 14),
      `New rule for ${domain}`,
    ),
  );
}

function renderActivity(activity) {
  const list = $('activity');
  if (activity.length === 0) {
    fill(list, h('li', { class: 'muted empty' }, 'Nothing sorted yet.'));
    return;
  }
  fill(
    list,
    activity
      .slice(0, 5)
      .map((entry) =>
        h(
          'li',
          { class: 'activity-item', title: `${entry.filename} — rule “${entry.ruleTitle}”` },
          h(
            'div',
            { class: 'activity-row' },
            icon('file', 13),
            h('span', { class: 'name' }, entry.filename),
            h('span', { class: 'when' }, timeAgo(entry.at)),
          ),
          destinationChip(entry.folder),
        ),
      ),
  );
}

async function init() {
  $('logo').innerHTML = logoSvg(30);
  $('open-options').prepend(icon('settings', 14));
  $('open-options').addEventListener('click', () => openOptions());

  const [{ settings, rules }, activity, page] = await Promise.all([
    loadState(),
    loadActivity(),
    currentPage(),
  ]);

  renderStatus(settings.enabled);
  $('toggle').addEventListener('change', async (e) => {
    const next = await saveSettings({ enabled: e.target.checked });
    renderStatus(next.enabled);
  });

  const active = rules.filter((r) => r.enabled).length;
  $('summary').textContent = `${plural(active, 'rule')} active`;
  renderSite(page, rules);
  renderActivity(activity);
}

init();
