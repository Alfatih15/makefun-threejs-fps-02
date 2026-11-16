// Synthesised sound effects: no audio assets, everything is an
// oscillator or a filtered noise burst through one AudioContext, created
// lazily on the first user gesture so autoplay rules never block it.
export function createAudio() {
  let ctx = null;
  let noiseBuffer = null;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;
    ctx = new AudioContext();
    const length = Math.floor(ctx.sampleRate * 0.25);
    noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    return ctx;
  }

  function noise(duration, filterFreq, gainValue, type = 'lowpass') {
    const c = ensure();
    if (!c) return;
    const source = c.createBufferSource();
    source.buffer = noiseBuffer;
    const filter = c.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const gain = c.createGain();
    gain.gain.setValueAtTime(gainValue, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);
    source.connect(filter).connect(gain).connect(c.destination);
    source.start();
    source.stop(c.currentTime + duration);
  }

  function tone(freq, duration, gainValue, type = 'square', slideTo = null) {
    const c = ensure();
    if (!c) return;
    const osc = c.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, c.currentTime);
    if (slideTo !== null) osc.frequency.exponentialRampToValueAtTime(slideTo, c.currentTime + duration);
    const gain = c.createGain();
    gain.gain.setValueAtTime(gainValue, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);
    osc.connect(gain).connect(c.destination);
    osc.start();
    osc.stop(c.currentTime + duration);
  }

  return {
    unlock() {
      ensure();
    },
    shot(kind) {
      if (kind === 'sniper') {
        noise(0.28, 900, 0.5);
        tone(160, 0.18, 0.25, 'sawtooth', 50);
      } else if (kind === 'smg') {
        noise(0.09, 1600, 0.3);
        tone(220, 0.06, 0.12, 'square', 90);
      } else if (kind === 'pistol') {
        noise(0.12, 1300, 0.35);
        tone(190, 0.08, 0.14, 'square', 70);
      } else {
        noise(0.14, 1100, 0.42);
        tone(150, 0.1, 0.18, 'sawtooth', 55);
      }
    },
    dryFire() {
      tone(1400, 0.04, 0.12, 'square');
    },
    reload() {
      tone(900, 0.05, 0.1, 'square');
      setTimeout(() => tone(620, 0.05, 0.1, 'square'), 160);
    },
    hit() {
      tone(1250, 0.05, 0.16, 'sine');
    },
    kill() {
      tone(1250, 0.05, 0.16, 'sine');
      setTimeout(() => tone(1650, 0.07, 0.16, 'sine'), 70);
    },
    hurt() {
      noise(0.15, 500, 0.3);
      tone(110, 0.15, 0.2, 'sawtooth', 60);
    },
    plantTick() {
      tone(880, 0.06, 0.14, 'sine');
    },
    plantDone() {
      tone(880, 0.09, 0.16, 'sine');
      setTimeout(() => tone(1320, 0.14, 0.16, 'sine'), 110);
    },
    explode() {
      noise(0.9, 320, 0.6);
      tone(70, 0.8, 0.4, 'sine', 28);
    },
    roundWin() {
      [523, 659, 784].forEach((freq, i) => setTimeout(() => tone(freq, 0.16, 0.14, 'triangle'), i * 120));
    },
    roundLose() {
      [392, 330, 262].forEach((freq, i) => setTimeout(() => tone(freq, 0.18, 0.14, 'triangle'), i * 130));
    },
    buy() {
      tone(980, 0.06, 0.12, 'sine');
      setTimeout(() => tone(1240, 0.08, 0.12, 'sine'), 60);
    },
    click() {
      tone(700, 0.04, 0.1, 'sine');
    },
  };
}
