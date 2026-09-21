/**
 * Rapid Response Alerter - offscreen audio.
 *
 * Windows toast notifications are easy to miss on a second monitor, so each
 * alert gets a distinct tone. Tones are synthesised with the Web Audio API,
 * which keeps the extension free of binary audio assets.
 */

const PATTERNS = {
  // [frequency Hz, start offset s, duration s]
  new: [[880, 0, 0.09], [1175, 0.12, 0.09]],
  warn: [[740, 0, 0.1], [740, 0.16, 0.1], [988, 0.32, 0.14]],
  urgent: [[988, 0, 0.1], [988, 0.15, 0.1], [988, 0.3, 0.1], [1319, 0.45, 0.2]],
  breach: [[622, 0, 0.18], [523, 0.22, 0.18], [440, 0.44, 0.3], [440, 0.8, 0.35]]
};

let ctx = null;

function play(kind, volume = 0.7) {
  const pattern = PATTERNS[kind] || PATTERNS.warn;
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") ctx.resume();

  const now = ctx.currentTime;

  for (const [freq, offset, duration] of pattern) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "triangle";
    osc.frequency.setValueAtTime(freq, now + offset);

    // Short attack/release avoids the click you get from hard gate changes.
    gain.gain.setValueAtTime(0.0001, now + offset);
    gain.gain.exponentialRampToValueAtTime(Math.max(volume, 0.01), now + offset + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + duration);

    osc.connect(gain).connect(ctx.destination);
    osc.start(now + offset);
    osc.stop(now + offset + duration + 0.05);
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.target !== "offscreen") return;
  if (message.type === "PLAY") {
    try {
      play(message.kind, message.volume);
    } catch (e) {
      console.warn("Alert tone failed:", e);
    }
  }
});
