const test = require('node:test');
const assert = require('node:assert/strict');
const work = require('../work-hours.js');
const at = (year, month, day, hour, minute = 0) => new Date(year, month - 1, day, hour, minute).getTime();
const settings = { workStart: '08:30', workEnd: '17:00' };

test('counts only the next working morning after closing time', () => {
  assert.equal(work.remaining(at(2026, 9, 15, 10, 10), at(2026, 9, 14, 17, 6), settings), 100 * 60000);
});

test('skips a complete weekend', () => {
  const deadline = at(2026, 9, 21, 9, 0); // Monday
  assert.equal(work.remaining(deadline, at(2026, 9, 18, 16, 30), settings), 60 * 60000);
  assert.equal(work.remaining(deadline, at(2026, 9, 19, 12, 0), settings), 30 * 60000);
});

test('countdown is frozen outside working hours', () => {
  const deadline = at(2026, 9, 15, 9, 0);
  assert.equal(work.remaining(deadline, at(2026, 9, 14, 17, 1), settings), 30 * 60000);
  assert.equal(work.remaining(deadline, at(2026, 9, 15, 7, 0), settings), 30 * 60000);
});

test('past deadlines remain negative while no business time passes', () => {
  const deadline = at(2026, 9, 18, 17, 0);
  assert.ok(work.remaining(deadline, at(2026, 9, 19, 12, 0), settings) < 0);
});

test('invalid or reversed hours safely use the defaults', () => {
  assert.equal(work.normalize({ workStart: '18:00', workEnd: '09:00' }).workStart, '08:30');
  assert.equal(work.remaining(at(2026, 9, 14, 10), at(2026, 9, 14, 9), { workStart: 'x', workEnd: 'x' }), 60 * 60000);
});
