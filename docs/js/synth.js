// Touch synth: the figure plays when touched, and what it plays is fed back into the same
// analyser that animates it, so image and sound drive each other (a two-way loop).
//
// Safety: everything goes through a compressor with a hard ceiling; the loop gain into the
// analyser is capped; the microphone is never routed to the speaker. Acoustic pickup of the
// phone's own speaker by its mic is normal and harmless here because only the analysis hears it.

const PENTATONIC = [0, 2, 4, 7, 9];

export class Synth {
  constructor(audio) {
    this.audio = audio;
    this.enabled = true;
    this.out = null;
    this.lastNote = 0;
    this.lastDegree = -1;
  }

  ensure() {
    const ctx = this.audio.ctx;
    if (!ctx || this.out) return !!this.out;
    this.bus = ctx.createGain();
    this.bus.gain.value = 0.6;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -18;
    this.comp.knee.value = 12;
    this.comp.ratio.value = 12;
    this.comp.attack.value = 0.003;
    this.comp.release.value = 0.15;
    this.ceiling = ctx.createGain();
    this.ceiling.gain.value = 0.5;               // hard cap on what leaves the synth
    this.send = ctx.createGain();
    this.send.gain.value = 0.9;                  // feedback into the analyser (the visual loop)
    this.bus.connect(this.comp);
    this.comp.connect(this.ceiling);
    this.ceiling.connect(ctx.destination);       // audible
    this.ceiling.connect(this.send);
    this.send.connect(this.audio.analyser);      // and analysed -> deforms the figure
    this.out = this.bus;
    return true;
  }

  setFeedback(on) { if (this.send) this.send.gain.value = on ? 0.9 : 0; }

  // x,y in 0..1 over the figure's touch area; speed 0..1
  play(x, y, speed = 0.5) {
    if (!this.enabled || !this.ensure()) return;
    const ctx = this.audio.ctx;
    const now = ctx.currentTime;
    if (now - this.lastNote < 0.06) return;      // rate limit while dragging
    const degree = Math.min(9, Math.floor(clampNum(x, 0, 0.999) * 10));
    if (degree === this.lastDegree && now - this.lastNote < 0.25) return;
    this.lastDegree = degree; this.lastNote = now;

    const oct = Math.floor(degree / 5);
    const semitone = PENTATONIC[degree % 5] + 12 * oct;
    const f = 110 * 2 ** (semitone / 12);        // from A2
    const bright = 1 + (1 - clampNum(y, 0, 1)) * 5; // higher on screen -> brighter timbre
    const vel = 0.25 + clampNum(speed, 0, 1) * 0.75;

    const car = ctx.createOscillator(), mod = ctx.createOscillator();
    const modGain = ctx.createGain(), amp = ctx.createGain();
    car.type = 'sine'; car.frequency.value = f;
    mod.type = 'sine'; mod.frequency.value = f * 2;
    modGain.gain.setValueAtTime(f * bright, now);
    modGain.gain.exponentialRampToValueAtTime(1, now + 0.5);
    amp.gain.setValueAtTime(0.0001, now);
    amp.gain.exponentialRampToValueAtTime(0.5 * vel, now + 0.008);
    amp.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
    mod.connect(modGain); modGain.connect(car.frequency);
    car.connect(amp); amp.connect(this.out);
    car.start(now); mod.start(now);
    car.stop(now + 1); mod.stop(now + 1);
  }
}

function clampNum(v, a, b) { return Math.min(b, Math.max(a, v)); }
