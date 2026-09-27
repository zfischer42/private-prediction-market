// The app's one flagship "brand moment": a small gold burst plus a tap of
// haptic feedback, used for exactly two events - placing a bet, and finding
// out a bet won. Kept to those two on purpose (see DESIGN.md) so it stays a
// signature rather than becoming wallpaper.
import confetti from 'canvas-confetti';

const GOLD = ['#f2b90b', '#f7d585', '#b45309'];

function reducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  );
}

// A short buzz - ignored on browsers/devices without the Vibration API
// (iOS Safari has none), so this is a bonus, never a dependency.
function buzz(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Some browsers throw when called outside a user gesture; a missed
    // buzz isn't worth surfacing.
  }
}

// A quick, low burst from the bottom of the screen - placing a bet.
export function celebrateBet() {
  buzz(15);
  if (reducedMotion()) return;
  void confetti({
    particleCount: 28,
    spread: 55,
    startVelocity: 32,
    origin: { x: 0.5, y: 0.92 },
    colors: GOLD,
    ticks: 160,
    scalar: 0.85,
  });
}

// A bigger, two-burst celebration - a bet resolved in your favor.
export function celebrateWin() {
  buzz([20, 60, 20]);
  if (reducedMotion()) return;
  const shared = { colors: GOLD, ticks: 220 };
  void confetti({ ...shared, particleCount: 70, spread: 70, startVelocity: 45, origin: { x: 0.3, y: 0.7 } });
  void confetti({ ...shared, particleCount: 70, spread: 70, startVelocity: 45, origin: { x: 0.7, y: 0.7 } });
}
