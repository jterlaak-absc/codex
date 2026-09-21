const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const teams = require('../teams.js');
const NOW = Date.UTC(2026, 8, 14, 12, 0);
const URL_VALUE = 'https://example.environment.api.powerplatform.com/powerautomate/automations/direct/cu/20/workflows/test/triggers/manual/paths/invoke?sig=TEST_ONLY';
const ticket = (id = '02.967.702', extra = {}) => ({ id, customer: 'Voorbeeld BV', subject: 'Support',
  assignee: '', deadlineMs: NOW + 15 * 60000, deadlineRaw: '14-09-2026 14:15', lastSeen: NOW, ...extra });

function fixture({ tickets = [ticket()], config = {}, initial = {}, fetcher, timeoutMs, remaining } = {}) {
  let time = NOW;
  let serial = 0;
  const data = { teamsSettings: { enabled: true, webhookUrl: URL_VALUE, timing: 'immediate', singleSender: true, ...config },
    knownTickets: Object.fromEntries(tickets.map(t => [t.id, t])),
    teamsObservation: { at: NOW, ids: tickets.map(t => t.id) }, settings: { warnMinutes: [30, 15, 5] }, ...initial };
  const calls = [], logs = [];
  const storage = {
    async get(keys) { return structuredClone(Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(k => k in data).map(k => [k, data[k]]))); },
    async set(patch) { Object.assign(data, structuredClone(patch)); }
  };
  const permissions = { contains: async () => true };
  const deps = { storage, permissions, getAlertSettings: async () => structuredClone(data.settings),
    buildUrl: t => t.href || 'https://servicenext.absc.nl/docs/PortalSN.aspx', now: () => time,
    uuid: () => `event-${++serial}`, logger: { log: (...a) => logs.push(a), warn: (...a) => logs.push(a) },
    fetcher: async (...args) => { calls.push(args); return fetcher ? fetcher(...args) : { ok: true, status: 202 }; }, timeoutMs, remaining };
  return { data, calls, logs, storage, permissions, dispatcher: teams.createDispatcher(deps),
    restart: () => teams.createDispatcher(deps), advance: ms => { time += ms; } };
}

test('fresh detected request becomes one claim card; existing ticket and alert state stay untouched', async () => {
  const f = fixture();
  const before = structuredClone({ knownTickets: f.data.knownTickets, settings: f.data.settings });
  await f.dispatcher.run();
  assert.equal(f.calls.length, 1);
  const [url, options] = f.calls[0];
  assert.equal(url, URL_VALUE);
  const body = JSON.parse(options.body);
  assert.equal(body.type, 'message');
  assert.equal(body.attachments.length, 1);
  const card = body.attachments[0].content;
  const row = card.body[0];
  assert.deepEqual(card.msteams, { width: 'Full' });
  assert.equal(row.type, 'ColumnSet');
  assert.equal(row.columns[0].width, 'stretch');
  const fields = row.columns[0].items[0].columns;
  assert.deepEqual(fields.map(column => column.width), ['96px', 'stretch', '138px']);
  assert.equal(fields[0].items[0].text, ticket().id);
  assert.equal(fields[1].items[0].text, '| Voorbeeld BV');
  assert.equal(fields[2].items[0].text, '| 14-09-2026 14:15');
  assert.ok(fields.every(column => column.items[0].weight === 'Bolder'));
  assert.ok(fields.every(column => !('size' in column.items[0])));
  assert.equal(row.columns[1].width, 'auto');
  assert.equal(row.columns[1].items[0].type, 'ActionSet');
  assert.equal(card.actions.length, 0);
  const claim = row.columns[1].items[0].actions[0];
  assert.equal(claim.title, 'Pak op');
  assert.deepEqual(claim.data, { action: 'claim', ticketId: ticket().id, eventId: 'event-1', isTest: false });
  assert.equal(card.body.length, 2);
  assert.equal(card.body[1].isVisible, false);
  assert.equal(options.credentials, 'omit');
  assert.equal(options.redirect, 'error');
  assert.equal(f.data.teamsDispatch[ticket().id].status, 'accepted');
  assert.deepEqual({ knownTickets: f.data.knownTickets, settings: f.data.settings }, before);
});

test('repeated scans, overlapping alarm calls and worker restart do not repost accepted requests', async () => {
  const f = fixture();
  await Promise.all(Array.from({ length: 12 }, () => f.dispatcher.run()));
  await f.dispatcher.observe([ticket()]);
  await f.dispatcher.run();
  await f.restart().run();
  assert.equal(f.calls.length, 1);
});

test('disabled distribution performs no network action', async () => {
  const f = fixture({ config: { enabled: false } });
  await f.dispatcher.run();
  assert.equal(f.calls.length, 0);
});

test('missing timing or sender choice cannot silently choose requirements', async () => {
  for (const config of [{ timing: '' }, { singleSender: false }]) {
    const f = fixture({ config });
    await f.dispatcher.run();
    assert.equal(f.calls.length, 0);
    assert.ok(f.data.teamsIssue);
  }
});

test('assigned, stale, missing and invalid requests are excluded', async () => {
  for (const t of [ticket('x', { assignee: 'Maya' }), ticket('x', { lastSeen: NOW - 61000 }),
    ticket('x', { deadlineMs: null }), ticket('x', { deadlineMs: NaN }), ticket('')]) {
    const f = fixture({ tickets: [t] });
    await f.dispatcher.run();
    assert.equal(f.calls.length, 0);
  }
  const f = fixture();
  await f.dispatcher.observe([]); // knownTickets still retains this ticket for 90 seconds.
  await f.dispatcher.run();
  assert.equal(f.calls.length, 0);
});

test('an alarm cannot send from an old wallboard snapshot', async () => {
  const f = fixture();
  f.advance(61000);
  await f.dispatcher.run();
  assert.equal(f.calls.length, 0);
});

test('warning timing reuses configured thresholds and includes overdue requests', async () => {
  const f = fixture({ tickets: [ticket('future', { deadlineMs: NOW + 40 * 60000 }), ticket('late', { deadlineMs: NOW - 60000 })], config: { timing: 'warning' } });
  await f.dispatcher.run();
  await f.dispatcher.run();
  assert.equal(f.calls.length, 1);
  assert.ok(f.data.teamsDispatch.late);
  f.data.settings.warnMinutes = [60];
  await f.dispatcher.run();
  assert.equal(f.calls.length, 2);
});

test('one request per run, earliest existing deadline first', async () => {
  const f = fixture({ tickets: [ticket('later', { deadlineMs: NOW + 600000 }), ticket('first', { deadlineMs: NOW + 300000 })] });
  await f.dispatcher.run();
  assert.equal(f.calls.length, 1);
  assert.ok(f.data.teamsDispatch.first);
  await f.dispatcher.run();
  assert.equal(f.calls.length, 2);
});

test('a failed durable intent prevents a POST', async () => {
  const f = fixture();
  f.storage.set = async () => { throw new Error('storage unavailable'); };
  await assert.rejects(f.dispatcher.run());
  assert.equal(f.calls.length, 0);
});

test('a crash after sending cannot cause an automatic duplicate', async () => {
  const f = fixture({ initial: { teamsDispatch: { [ticket().id]: { status: 'sending', eventId: 'old', at: NOW } } } });
  await f.dispatcher.run();
  assert.equal(f.calls.length, 0);
  assert.equal(f.data.teamsDispatch[ticket().id].status, 'uncertain');
});

test('network failure is uncertain and no secret is persisted or logged', async () => {
  const f = fixture({ fetcher: () => { throw new Error(URL_VALUE); } });
  await f.dispatcher.run();
  await f.restart().run();
  assert.equal(f.calls.length, 1);
  assert.equal(f.data.teamsDispatch[ticket().id].status, 'uncertain');
  assert.ok(!JSON.stringify([f.logs, f.data.teamsDispatch, f.data.teamsIssue]).includes('TEST_ONLY'));
});

test('timeouts are aborted and require a manual delivery check', async () => {
  const f = fixture({ timeoutMs: 5, fetcher: (url, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))) });
  await f.dispatcher.run();
  assert.equal(f.calls.length, 1);
  assert.equal(f.data.teamsDispatch[ticket().id].status, 'uncertain');
});

test('HTTP failures never become success and are not retried by scans', async () => {
  for (const code of [400, 401, 403, 404, 408, 429, 500, 503]) {
    const f = fixture({ fetcher: async () => ({ ok: false, status: code }) });
    await f.dispatcher.run();
    await f.dispatcher.run();
    assert.equal(f.calls.length, 1);
    assert.notEqual(f.data.teamsDispatch[ticket().id].status, 'accepted');
  }
});

test('explicit manual retry after checking Teams reuses ticket and creates a new event', async () => {
  let attempt = 0;
  const f = fixture({ fetcher: async () => ({ ok: ++attempt > 1, status: attempt > 1 ? 202 : 503 }) });
  await f.dispatcher.run();
  const firstEvent = f.data.teamsDispatch[ticket().id].eventId;
  await f.dispatcher.retry(ticket().id);
  assert.equal(f.calls.length, 2);
  assert.equal(f.data.teamsDispatch[ticket().id].status, 'accepted');
  assert.notEqual(f.data.teamsDispatch[ticket().id].eventId, firstEvent);
  await assert.rejects(f.dispatcher.retry(ticket().id));
});

test('manual retry is blocked after the request disappears or gets assigned', async () => {
  const f = fixture({ fetcher: async () => ({ ok: false, status: 503 }) });
  await f.dispatcher.run();
  f.data.knownTickets[ticket().id].assignee = 'Edin';
  await assert.rejects(f.dispatcher.retry(ticket().id));
  assert.equal(f.calls.length, 1);
});

test('missing host permission blocks delivery', async () => {
  const f = fixture();
  f.permissions.contains = async () => false;
  await f.dispatcher.run();
  assert.equal(f.calls.length, 0);
  assert.match(f.data.teamsIssue, /toegang/);
});

test('pause while preparing the request prevents the POST', async () => {
  const f = fixture();
  const save = f.storage.set;
  f.storage.set = async patch => { await save(patch); if (patch.teamsDispatch) f.data.teamsSettings.enabled = false; };
  await f.dispatcher.run();
  assert.equal(f.calls.length, 0);
  assert.deepEqual(f.data.teamsDispatch, {});
});

test('changing webhook destination does not automatically replay prior requests', async () => {
  const f = fixture();
  await f.dispatcher.run();
  f.data.teamsSettings.webhookUrl = URL_VALUE.replace('/test/', '/second/');
  await f.dispatcher.run();
  assert.equal(f.calls.length, 1);
});

test('a ticket assigned while preparing the POST is no longer offered', async () => {
  const f = fixture();
  const save = f.storage.set;
  f.storage.set = async patch => {
    await save(patch);
    if (patch.teamsDispatch) f.data.knownTickets[ticket().id].assignee = 'Maya';
  };
  await f.dispatcher.run();
  assert.equal(f.calls.length, 0);
  assert.deepEqual(f.data.teamsDispatch, {});
});

test('test button sends only synthetic data, works while auto-send is off, and does not alter deduplication', async () => {
  const f = fixture({ config: { enabled: false, timing: '' } });
  await f.dispatcher.test();
  assert.equal(f.calls.length, 1);
  const body = JSON.parse(f.calls[0][1].body);
  assert.equal(body.attachments[0].content.body[0].columns[1].items[0].actions[0].data.isTest, true);
  assert.ok(!f.calls[0][1].body.includes(ticket().id));
  assert.equal(f.data.teamsDispatch, undefined);
});

test('endpoint validation permits Microsoft workflow hosts and refuses lookalikes and credentials', () => {
  assert.equal(teams.endpoint(URL_VALUE).origin, 'https://example.environment.api.powerplatform.com/*');
  assert.ok(teams.endpoint('https://prod.westeurope.logic.azure.com/workflows/test/triggers/manual/paths/invoke?sig=test'));
  for (const url of ['http://example.environment.api.powerplatform.com/workflows/x/invoke',
    'https://example.environment.api.powerplatform.com.evil.test/workflows/x/invoke',
    'https://user:password@example.environment.api.powerplatform.com/workflows/x/invoke',
    'https://example.environment.api.powerplatform.com:444/workflows/x/invoke',
    'https://example.webhook.office.com/workflows/x/invoke', 'javascript:alert(1)', '']) {
    assert.throws(() => teams.endpoint(url));
  }
});

test('portal fallback is hidden while direct request links remain available', () => {
  const fallback = teams.makePayload(ticket(), 'https://servicenext.absc.nl/docs/PortalSN.aspx', 'event');
  assert.equal(fallback.attachments[0].content.body[0].columns[0].selectAction, undefined);
  const directUrl = 'https://servicenext.absc.nl/docs/WflRequest.aspx?ID=123';
  for (const extra of [{ href: directUrl }, { guid: '123' }]) {
    const direct = teams.makePayload(ticket('x', extra), directUrl, 'event');
    assert.equal(direct.attachments[0].content.body[0].columns[0].selectAction.url, directUrl);
  }
});

test('wallboard content cannot inject extra actions and unsafe links are omitted', () => {
  const payload = teams.makePayload(ticket('x', { customer: '[click](https://evil.test)', subject: '<script>alert(1)</script>' }), 'javascript:alert(1)', 'event');
  const card = payload.attachments[0].content;
  assert.equal(card.actions.length, 0);
  assert.equal(card.body[0].columns[1].items[0].actions.length, 1);
  assert.ok(card.body[0].columns[0].items[0].columns[1].items[0].text.includes('\\[click\\]'));
  assert.ok(card.body[1].facts[1].value.startsWith('\\[click\\]'));
  assert.equal(card.body[0].columns[0].selectAction, undefined);
  assert.ok(JSON.stringify(teams.makePayload(ticket('x', { subject: 'x'.repeat(100000) }), '', 'event')).length < 3000);
});

test('warning timing can use business time instead of calendar time', async () => {
  const f = fixture({ tickets: [ticket('work', { deadlineMs: NOW + 5 * 60 * 60000 })],
    config: { timing: 'warning' }, remaining: () => 10 * 60000 });
  await f.dispatcher.run();
  assert.equal(f.calls.length, 1);
});

test('background still emits new/warning/breach alerts when Teams observation storage fails', async () => {
  const notifications = [];
  const data = { settings: { soundEnabled: false }, knownTickets: {}, seeded: true };
  const event = { addListener() {} };
  const chrome = {
    storage: { local: {
      async get(keys) { return structuredClone(Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(k => k in data).map(k => [k, data[k]]))); },
      async set(patch) { if (patch.teamsObservation) throw new Error('Teams storage failed'); Object.assign(data, structuredClone(patch)); }
    } }, permissions: {},
    runtime: { onInstalled: event, onStartup: event, onMessage: event, getURL: s => 'chrome-extension://test/' + s },
    alarms: { create() {}, onAlarm: event },
    notifications: { create: (id, payload) => notifications.push({ id, payload }), clear() {}, onClicked: event, onButtonClicked: event, onClosed: event },
    action: { async setBadgeText() {}, async setBadgeBackgroundColor() {}, async setTitle() {} }
  };
  const context = vm.createContext({ chrome, console: { warn() {}, log() {} }, URL, AbortController, setTimeout, clearTimeout });
  context.importScripts = file => vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8'), context);
  context.incoming = [ticket('warning', { deadlineMs: Date.now() + 10 * 60000 }), ticket('breach', { deadlineMs: Date.now() - 60000 })];
  await vm.runInContext('processTicketData(incoming)', context);
  assert.ok(notifications.some(n => n.id === 'rra:new:warning'));
  assert.ok(notifications.some(n => n.id.startsWith('rra:warn:warning:')));
  assert.ok(notifications.some(n => n.id === 'rra:breach:breach'));
  assert.equal(data.knownTickets.breach.alerted.breach, true);
});
