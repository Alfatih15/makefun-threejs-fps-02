// Small shared helpers: a seeded RNG so bot behaviour and captures are
// reproducible, plus the arithmetic the game leans on everywhere.
export function mulberry32(initial) {
  let a = initial | 0;
  return function random() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function clamp(value, low, high) {
  return value < low ? low : value > high ? high : value;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function range(rng, low, high) {
  return low + rng() * (high - low);
}

export function pick(rng, list) {
  return list[Math.floor(rng() * list.length) % list.length];
}

// Shortest signed turn from `from` to `to`, in radians.
export function angleDelta(from, to) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function formatClock(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export function formatMoney(amount) {
  return `$${amount.toLocaleString('en-US')}`;
}
