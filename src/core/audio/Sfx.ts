export type SoundName = 'break' | 'place' | 'explosion' | 'click' | 'fuse';

/**
 * Tiny synthesised sound effects (no audio files). The AudioContext is created
 * lazily on the first sound after a user gesture, as browsers require.
 */
export class Sfx {
  volume = 0.6;
  private context: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  private failed = false;

  play(name: SoundName): void {
    if (this.volume <= 0 || this.failed) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    switch (name) {
      case 'break':
        this.noiseBurst(ctx, 0.12, 900, 0.5);
        break;
      case 'place':
        this.tone(ctx, 190, 110, 0.08, 0.5, 'square');
        break;
      case 'click':
        this.tone(ctx, 660, 520, 0.05, 0.25, 'triangle');
        break;
      case 'fuse':
        this.noiseBurst(ctx, 0.5, 4200, 0.18);
        break;
      case 'explosion':
        this.noiseBurst(ctx, 0.9, 380, 1);
        this.tone(ctx, 110, 28, 0.7, 0.9, 'sine');
        break;
    }
  }

  dispose(): void {
    void this.context?.close().catch(() => undefined);
    this.context = null;
  }

  private ensureContext(): AudioContext | null {
    if (!this.context) {
      try {
        this.context = new AudioContext();
      } catch {
        this.failed = true;
        return null;
      }
    }
    if (this.context.state === 'suspended') void this.context.resume().catch(() => undefined);
    return this.context;
  }

  private envelope(ctx: AudioContext, duration: number, gain: number): GainNode {
    const node = ctx.createGain();
    const now = ctx.currentTime;
    node.gain.setValueAtTime(Math.max(0.0001, gain * this.volume * 0.5), now);
    node.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    node.connect(ctx.destination);
    return node;
  }

  private tone(
    ctx: AudioContext,
    from: number,
    to: number,
    duration: number,
    gain: number,
    type: OscillatorType,
  ): void {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), ctx.currentTime + duration);
    osc.connect(this.envelope(ctx, duration, gain));
    osc.start();
    osc.stop(ctx.currentTime + duration + 0.02);
  }

  private noiseBurst(ctx: AudioContext, duration: number, cutoff: number, gain: number): void {
    if (!this.noise) {
      const length = ctx.sampleRate;
      this.noise = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    }
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    source.connect(filter);
    filter.connect(this.envelope(ctx, duration, gain));
    source.start(0, Math.random() * 0.5, duration + 0.02);
  }
}
