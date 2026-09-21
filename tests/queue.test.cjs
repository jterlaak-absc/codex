const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture() {
  const data = { settings: { soundEnabled: false, alertOnNew: false }, knownTickets: {}, seeded: true };
  const notifications = [], cleared = [];
  const event = { addListener() {} };
  const chrome = {
    storage: { local: {
      async get(keys) { return structuredClone(Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(k => k in data).map(k => [k, data[k]]))); },
      async set(patch) { Object.assign(data, structuredClone(patch)); }
    } }, permissions: {},
    runtime: { onInstalled: event, onStartup: event, onMessage: event, getURL: s => 'chrome-extension://test/' + s },
    alarms: { create() {}, onAlarm: event },
    notifications: { create: (id, payload) => notifications.push({ id, payload }), clear: id => cleared.push(id), onClicked: event, onButtonClicked: event, onClosed: event },
    action: { async setBadgeText(text) { data.badge = text.text; }, async setBadgeBackgroundColor() {}, async setTitle() {} }
  };
  const context = vm.createContext({ chrome, console: { warn() {}, log() {} }, URL, AbortController, setTimeout, clearTimeout });
  context.importScripts = file => vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8'), context);
  return { data, notifications, cleared,
    scan: tickets => context.processTicketData(tickets),
    check: () => context.checkDeadlines() };
}
const ticket = id => ({ id, customer: 'Customer', deadlineMs: Date.now() + 86400000 });

test('a removed request disappears on the first valid scan, also when the board becomes empty', async () => {
  const f = fixture();
  await f.scan([ticket('A'), ticket('B')]);
  await f.scan([ticket('B')]);
  assert.deepEqual(Object.keys(f.data.knownTickets), ['B']);
  assert.ok(f.cleared.includes('rra:new:A'));
  await f.scan([]);
  assert.deepEqual(Object.keys(f.data.knownTickets), []);
  assert.deepEqual(f.data.teamsObservation.ids, []);
  assert.equal(f.data.badge, '');
});

test('overlapping scan and deadline checks cannot restore removed requests', async () => {
  const f = fixture();
  await f.scan([ticket('A')]);
  await Promise.all([f.check(), f.scan([]), f.check()]);
  assert.deepEqual(Object.keys(f.data.knownTickets), []);
});

test('an outdated request no longer triggers alerts or an urgent badge', async () => {
  const f = fixture();
  f.data.knownTickets.A = { ...ticket('A'), deadlineMs: Date.now() - 60000, lastSeen: Date.now() - 61000 };
  await f.check();
  assert.equal(f.notifications.length, 0);
  assert.equal(f.data.badge, '');
});
