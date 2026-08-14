export class CatAudio {
  constructor() {
    this.context = null;
    this.purrNodes = null;
  }

  enable() {
    if (!this.context) this.context = new AudioContext();
    if (this.context.state === 'suspended') this.context.resume();
  }

  whistle() {
    this.enable();
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(1550, now);
    oscillator.frequency.exponentialRampToValueAtTime(2350, now + .18);
    oscillator.frequency.exponentialRampToValueAtTime(1800, now + .34);
    gain.gain.setValueAtTime(.0001, now);
    gain.gain.exponentialRampToValueAtTime(.10, now + .025);
    gain.gain.exponentialRampToValueAtTime(.0001, now + .42);
    oscillator.connect(gain).connect(this.context.destination);
    oscillator.start(now); oscillator.stop(now + .45);
  }

  chirp() {
    this.enable();
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(680, now);
    oscillator.frequency.exponentialRampToValueAtTime(1100, now + .08);
    oscillator.frequency.exponentialRampToValueAtTime(520, now + .2);
    gain.gain.setValueAtTime(.0001, now);
    gain.gain.exponentialRampToValueAtTime(.045, now + .018);
    gain.gain.exponentialRampToValueAtTime(.0001, now + .25);
    oscillator.connect(gain).connect(this.context.destination);
    oscillator.start(now); oscillator.stop(now + .27);
  }

  setPurring(active, intensity = .6) {
    if (active && !this.purrNodes) {
      this.enable();
      const now = this.context.currentTime;
      const carrier = this.context.createOscillator();
      const tremolo = this.context.createOscillator();
      const tremoloGain = this.context.createGain();
      const filter = this.context.createBiquadFilter();
      const gain = this.context.createGain();
      carrier.type = 'sawtooth'; carrier.frequency.value = 27;
      tremolo.type = 'sine'; tremolo.frequency.value = 24;
      tremoloGain.gain.value = .008;
      filter.type = 'lowpass'; filter.frequency.value = 115;
      gain.gain.setValueAtTime(.0001, now);
      gain.gain.exponentialRampToValueAtTime(.022 * intensity, now + .18);
      tremolo.connect(tremoloGain).connect(gain.gain);
      carrier.connect(filter).connect(gain).connect(this.context.destination);
      carrier.start(); tremolo.start();
      this.purrNodes = { carrier, tremolo, gain };
    } else if (!active && this.purrNodes) {
      const now = this.context.currentTime;
      this.purrNodes.gain.gain.cancelScheduledValues(now);
      this.purrNodes.gain.gain.exponentialRampToValueAtTime(.0001, now + .2);
      this.purrNodes.carrier.stop(now + .23);
      this.purrNodes.tremolo.stop(now + .23);
      this.purrNodes = null;
    }
  }
}
