/**
 * Beep sounds for barcode scanner feedback.
 * Uses Web Audio API — no library, works in all modern browsers.
 *
 * success  → short high-pitch beep  (return recorded ✓)
 * error    → two low-pitch beeps    (not found ✗)
 * warning  → medium single beep     (already processed)
 */

function beep(frequency: number, duration: number, volume = 0.4) {
  if (typeof window === 'undefined') return;
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.type = 'sine';
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);

    osc.onended = () => ctx.close();
  } catch {
    // Audio not supported — silently ignore
  }
}

export function beepSuccess() {
  beep(1200, 0.12); // short sharp high beep
}

export function beepError() {
  beep(300, 0.15);
  setTimeout(() => beep(280, 0.2), 180); // two low beeps
}

export function beepWarning() {
  beep(600, 0.15); // medium beep
}
