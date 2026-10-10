/** Web Audio processing for both players:
 *
 *   player A ─ gain ─┐
 *                    ├─ mix ─ preamp ─ 10-band EQ ─ leveller ─ limiter ─ analyser ─ speakers
 *   player B ─ gain ─┘   └─ loudness meter
 *
 * Only usable when audio arrives through the local relay (CORS headers);
 * otherwise the browser would output silence for these elements. */

export const EQ_FREQUENCIES = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
export const EQ_MAX_DB = 12;

export const EQ_PRESETS: Record<string, number[]> = {
  Flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  "Bass boost": [6, 5, 4, 2, 0, 0, 0, 0, 0, 0],
  "Bass reducer": [-6, -5, -4, -2, 0, 0, 0, 0, 0, 0],
  "Treble boost": [0, 0, 0, 0, 0, 1, 2, 4, 5, 6],
  Vocal: [-2, -2, -1, 1, 3, 4, 3, 1, 0, -1],
  Rock: [4, 3, 2, 0, -1, -1, 1, 2, 3, 4],
  "Hip-hop": [5, 4, 2, 1, -1, -1, 1, 1, 2, 3],
  Electronic: [4, 3, 1, 0, -2, 1, 0, 1, 3, 4],
  Acoustic: [3, 3, 2, 1, 1, 1, 2, 2, 2, 1],
  "Late night": [3, 2, 1, 0, -1, 0, 1, 1, 0, -1],
};

/** Loudness the leveller aims for (average RMS of audible passages). Close
 * to where streaming services normalise, with headroom for boosts. */
const LEVEL_TARGET_DB = -16;
const LEVEL_MAX_ADJUST_DB = 10;
/** Quieter than this counts as silence and is ignored when measuring. */
const LEVEL_GATE_DB = -50;
const LEVEL_TICK_MS = 100;

function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

export class AudioGraph {
  readonly context: AudioContext;
  /** Post-EQ tap for the visualizer. */
  readonly analyser: AnalyserNode;
  private readonly meter: AnalyserNode;
  private readonly meterBuffer: Float32Array<ArrayBuffer>;
  private readonly players = new Map<HTMLMediaElement, GainNode>();
  private readonly filters: BiquadFilterNode[];
  private readonly preamp: GainNode;
  private readonly leveller: GainNode;
  private levelTimer: number | null = null;
  private loudnessPower = 0;
  private loudnessFrames = 0;

  constructor(elements: HTMLMediaElement[]) {
    const ctx = new AudioContext();
    this.context = ctx;

    const mix = ctx.createGain();
    for (const el of elements) {
      el.crossOrigin = "anonymous";
      el.volume = 1; // level is controlled by this player's gain node instead
      const source = ctx.createMediaElementSource(el);
      const gain = ctx.createGain();
      source.connect(gain).connect(mix);
      this.players.set(el, gain);
    }

    this.meter = ctx.createAnalyser();
    this.meter.fftSize = 2048;
    this.meterBuffer = new Float32Array(this.meter.fftSize);
    mix.connect(this.meter);

    this.filters = EQ_FREQUENCIES.map((frequency, i) => {
      const filter = ctx.createBiquadFilter();
      filter.type = i === 0 ? "lowshelf" : i === EQ_FREQUENCIES.length - 1 ? "highshelf" : "peaking";
      filter.frequency.value = frequency;
      filter.Q.value = 1.1;
      filter.gain.value = 0;
      return filter;
    });

    this.preamp = ctx.createGain();
    this.leveller = ctx.createGain();

    // Brick-wall-ish limiter so EQ boosts and levelling can't clip.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -1.5;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 4096;
    this.analyser.smoothingTimeConstant = 0.8;

    let node: AudioNode = mix.connect(this.preamp);
    for (const filter of this.filters) node = node.connect(filter);
    node.connect(this.leveller).connect(limiter).connect(this.analyser).connect(ctx.destination);
  }

  /** Browsers start audio contexts suspended until the user interacts. */
  resume(): void {
    if (this.context.state !== "running") this.context.resume().catch(() => {});
  }

  get isRunning(): boolean {
    return this.context.state === "running";
  }

  setLevel(el: HTMLMediaElement, value: number): void {
    const gain = this.players.get(el);
    if (gain) gain.gain.value = value;
  }

  getLevel(el: HTMLMediaElement): number {
    return this.players.get(el)?.gain.value ?? 1;
  }

  /** `preampDb` applies only while the EQ is on, like a classic EQ's
   * preamp slider. */
  setEq(enabled: boolean, gains: number[], preampDb = 0): void {
    const now = this.context.currentTime;
    const preamp = enabled ? Math.max(-EQ_MAX_DB, Math.min(EQ_MAX_DB, preampDb)) : 0;
    this.preamp.gain.setTargetAtTime(dbToGain(preamp), now, 0.05);
    this.filters.forEach((filter, i) => {
      const db = enabled ? Math.max(-EQ_MAX_DB, Math.min(EQ_MAX_DB, gains[i] ?? 0)) : 0;
      filter.gain.setTargetAtTime(db, now, 0.05);
    });
  }

  setLevelling(enabled: boolean): void {
    if (enabled && this.levelTimer === null) {
      this.levelTimer = window.setInterval(() => this.measure(), LEVEL_TICK_MS);
    } else if (!enabled && this.levelTimer !== null) {
      window.clearInterval(this.levelTimer);
      this.levelTimer = null;
      this.leveller.gain.setTargetAtTime(1, this.context.currentTime, 0.3);
    }
  }

  /** Call when a new track starts: its loudness is measured from scratch
   * (the current gain is kept until the new measurement settles). */
  resetLoudness(): void {
    this.loudnessPower = 0;
    this.loudnessFrames = 0;
  }

  /** Running, silence-gated loudness of the current track, nudging the
   * leveller toward the target: quick at first, then slowly, so it evens
   * out tracks without pumping within a song. */
  private measure(): void {
    this.meter.getFloatTimeDomainData(this.meterBuffer);
    let sum = 0;
    for (const x of this.meterBuffer) sum += x * x;
    const power = sum / this.meterBuffer.length;
    if (power <= 0 || 10 * Math.log10(power) < LEVEL_GATE_DB) return;

    this.loudnessPower += power;
    this.loudnessFrames++;
    if (this.loudnessFrames < 10) return; // ~1s of audible audio first

    const loudnessDb = 10 * Math.log10(this.loudnessPower / this.loudnessFrames);
    const adjustDb = Math.max(-LEVEL_MAX_ADJUST_DB, Math.min(LEVEL_MAX_ADJUST_DB, LEVEL_TARGET_DB - loudnessDb));
    const settle = this.loudnessFrames < 50 ? 0.8 : 3;
    this.leveller.gain.setTargetAtTime(dbToGain(adjustDb), this.context.currentTime, settle);
  }

  close(): void {
    this.setLevelling(false);
    this.context.close().catch(() => {});
  }
}
