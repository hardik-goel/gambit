/**
 * The audio engine.
 *
 * Three independent channels — UI, foley, music — each with its own toggle and
 * volume, persisted to the profile. Every sound is synthesised at runtime from
 * oscillators and filtered noise: original by construction, nothing licensed,
 * nothing to download, and a trigger latency bounded by one audio quantum
 * rather than by a network fetch.
 *
 * Music is generated too: short, loopable lounge phrases flavoured per theme.
 * Players who prefer their own records can add local files — those stay on the
 * device as object URLs and are never uploaded.
 */

export type Channel = "ui" | "foley" | "music";

export interface AudioSettings {
  ui: boolean;
  foley: boolean;
  music: boolean;
  uiVolume: number;
  foleyVolume: number;
  musicVolume: number;
}

export const DEFAULT_AUDIO: AudioSettings = {
  ui: true,
  foley: true,
  music: false,
  uiVolume: 0.7,
  foleyVolume: 0.8,
  musicVolume: 0.45
};

const STORAGE_KEY = "gambit.audio";

export function loadAudioSettings(): AudioSettings {
  if (typeof localStorage === "undefined") return { ...DEFAULT_AUDIO };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULT_AUDIO, ...(JSON.parse(raw) as Partial<AudioSettings>) } : { ...DEFAULT_AUDIO };
  } catch {
    return { ...DEFAULT_AUDIO };
  }
}

export function saveAudioSettings(s: AudioSettings): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* private mode — sound simply doesn't persist */
  }
}

/* --------------------------------------------------------------- sfx spec */

interface Voice {
  /** Oscillator or filtered noise. */
  kind: "sine" | "triangle" | "square" | "sawtooth" | "noise";
  freq?: number;
  /** Frequency at the end of the sound; enables the swoosh/tumble glides. */
  to?: number;
  attack?: number;
  decay: number;
  gain: number;
  /** Low-pass cutoff; noise voices need it or they read as static. */
  filter?: number;
  filterTo?: number;
  /** Delay before this voice starts, in seconds. */
  at?: number;
  /** Number of repeats, e.g. dice tumbling. */
  repeat?: number;
  /** Gap between repeats. */
  every?: number;
}

/**
 * The cue table. Names are semantic, not literal — a game asks for "claim" and
 * gets whatever Gambit currently thinks a claim should sound like.
 */
export const CUES: Record<string, { channel: Channel; voices: Voice[] }> = {
  /* — interface — */
  tap:      { channel: "ui", voices: [{ kind: "sine", freq: 620, to: 480, decay: 0.09, gain: 0.16, filter: 2600 }] },
  select:   { channel: "ui", voices: [{ kind: "triangle", freq: 520, to: 340, decay: 0.18, gain: 0.14, filter: 1400 }] },
  swoosh:   { channel: "ui", voices: [{ kind: "noise", decay: 0.26, gain: 0.13, filter: 2400, filterTo: 400 }] },
  open:     { channel: "ui", voices: [{ kind: "triangle", freq: 380, to: 720, decay: 0.22, gain: 0.13, filter: 2200 }] },
  close:    { channel: "ui", voices: [{ kind: "triangle", freq: 700, to: 320, decay: 0.2, gain: 0.12, filter: 1800 }] },
  error:    { channel: "ui", voices: [{ kind: "square", freq: 190, to: 140, decay: 0.22, gain: 0.1, filter: 900 }] },
  nudge:    { channel: "ui", voices: [{ kind: "sine", freq: 880, decay: 0.1, gain: 0.09 }, { kind: "sine", freq: 1180, decay: 0.12, gain: 0.07, at: 0.09 }] },
  start:    { channel: "ui", voices: [{ kind: "sine", freq: 392, decay: 0.5, gain: 0.12 }, { kind: "sine", freq: 587, decay: 0.6, gain: 0.1, at: 0.1 }, { kind: "sine", freq: 784, decay: 0.8, gain: 0.09, at: 0.2 }] },

  /* — table foley — */
  cardSlip: { channel: "foley", voices: [{ kind: "noise", decay: 0.13, gain: 0.16, filter: 5200, filterTo: 900 }] },
  cardDeal: { channel: "foley", voices: [{ kind: "noise", decay: 0.1, gain: 0.14, filter: 6000, filterTo: 1200 }] },
  cardFlip: { channel: "foley", voices: [{ kind: "noise", decay: 0.09, gain: 0.18, filter: 7000, filterTo: 2000 }] },
  chipClack:{ channel: "foley", voices: [{ kind: "noise", decay: 0.06, gain: 0.2, filter: 3400, filterTo: 700 }, { kind: "sine", freq: 240, decay: 0.08, gain: 0.1 }] },
  chipStack:{ channel: "foley", voices: [{ kind: "noise", decay: 0.05, gain: 0.16, filter: 3000, repeat: 3, every: 0.05 }] },
  pieceSet: { channel: "foley", voices: [{ kind: "sine", freq: 180, to: 120, decay: 0.12, gain: 0.2 }, { kind: "noise", decay: 0.05, gain: 0.1, filter: 1800 }] },
  capture:  { channel: "foley", voices: [{ kind: "noise", decay: 0.14, gain: 0.22, filter: 2600, filterTo: 500 }, { kind: "sine", freq: 150, to: 90, decay: 0.2, gain: 0.16 }] },
  diceTumble:{ channel: "foley", voices: [{ kind: "noise", decay: 0.05, gain: 0.15, filter: 2400, repeat: 6, every: 0.055 }, { kind: "noise", decay: 0.12, gain: 0.18, filter: 1600, at: 0.36 }] },
  trainClack:{ channel: "foley", voices: [{ kind: "noise", decay: 0.05, gain: 0.16, filter: 2000, repeat: 2, every: 0.09 }, { kind: "sine", freq: 130, decay: 0.1, gain: 0.12 }] },
  gemClink: { channel: "foley", voices: [{ kind: "sine", freq: 1560, to: 1180, decay: 0.22, gain: 0.11 }, { kind: "sine", freq: 2340, decay: 0.14, gain: 0.06, at: 0.02 }] },
  tileSnap: { channel: "foley", voices: [{ kind: "sine", freq: 300, to: 200, decay: 0.08, gain: 0.16 }, { kind: "noise", decay: 0.04, gain: 0.12, filter: 4000 }] },
  meeple:   { channel: "foley", voices: [{ kind: "sine", freq: 420, to: 300, decay: 0.1, gain: 0.13 }] },
  cubePlace:{ channel: "foley", voices: [{ kind: "sine", freq: 260, to: 200, decay: 0.09, gain: 0.14 }] },
  bagDraw:  { channel: "foley", voices: [{ kind: "noise", decay: 0.3, gain: 0.1, filter: 1400, filterTo: 500 }] },

  /* — hero beats — */
  claim:    { channel: "foley", voices: [{ kind: "triangle", freq: 330, to: 660, decay: 0.3, gain: 0.16, filter: 2600 }, { kind: "sine", freq: 990, decay: 0.4, gain: 0.08, at: 0.12 }] },
  score:    { channel: "ui", voices: [{ kind: "sine", freq: 660, decay: 0.16, gain: 0.11 }, { kind: "sine", freq: 880, decay: 0.22, gain: 0.1, at: 0.09 }] },
  win:      { channel: "ui", voices: [{ kind: "sine", freq: 523, decay: 0.5, gain: 0.13 }, { kind: "sine", freq: 659, decay: 0.5, gain: 0.12, at: 0.12 }, { kind: "sine", freq: 784, decay: 0.6, gain: 0.12, at: 0.24 }, { kind: "sine", freq: 1046, decay: 1.1, gain: 0.12, at: 0.36 }] },
  lose:     { channel: "ui", voices: [{ kind: "sine", freq: 392, decay: 0.5, gain: 0.11 }, { kind: "sine", freq: 311, decay: 0.9, gain: 0.11, at: 0.16 }] },
  outbreak: { channel: "foley", voices: [{ kind: "sawtooth", freq: 120, to: 60, decay: 0.7, gain: 0.14, filter: 700 }] },
  cure:     { channel: "foley", voices: [{ kind: "sine", freq: 700, to: 1400, decay: 0.5, gain: 0.11 }] },
  reveal:   { channel: "foley", voices: [{ kind: "noise", decay: 0.4, gain: 0.1, filter: 800, filterTo: 3000 }] }
};

export type CueId = keyof typeof CUES;

/* -------------------------------------------------------------- the engine */

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private buses: Record<Channel, GainNode> | null = null;
  private noise: AudioBuffer | null = null;
  private settings: AudioSettings;
  private musicNodes: { stop: () => void } | null = null;
  private musicEl: HTMLAudioElement | null = null;
  private duckUntil = 0;

  constructor(settings: AudioSettings = loadAudioSettings()) {
    this.settings = settings;
  }

  get current(): AudioSettings {
    return this.settings;
  }

  /**
   * Browsers only allow audio after a gesture. Call this from the first tap;
   * calling it again is free.
   */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const Ctor =
      typeof window !== "undefined"
        ? window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        : undefined;
    if (!Ctor) return;
    const ctx = new Ctor();
    const mk = (v: number) => {
      const g = ctx.createGain();
      g.gain.value = v;
      g.connect(ctx.destination);
      return g;
    };
    this.ctx = ctx;
    this.buses = {
      ui: mk(this.settings.uiVolume),
      foley: mk(this.settings.foleyVolume),
      music: mk(this.settings.musicVolume)
    };
    // 2 seconds of white noise, reused by every noise voice.
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noise = buf;
    if (this.settings.music) this.startMusic("brushed-jazz");
  }

  update(patch: Partial<AudioSettings>): AudioSettings {
    this.settings = { ...this.settings, ...patch };
    saveAudioSettings(this.settings);
    if (this.buses) {
      this.buses.ui.gain.value = this.settings.ui ? this.settings.uiVolume : 0;
      this.buses.foley.gain.value = this.settings.foley ? this.settings.foleyVolume : 0;
      this.buses.music.gain.value = this.settings.music ? this.settings.musicVolume : 0;
    }
    if (this.musicEl) this.musicEl.volume = this.settings.music ? this.settings.musicVolume : 0;
    if (!this.settings.music) this.stopMusic();
    return this.settings;
  }

  /** Fire a cue. Cheap enough to call on every pointer event. */
  play(cue: string, opts: { pitch?: number; gain?: number } = {}): void {
    const spec = CUES[cue];
    if (!spec || !this.ctx || !this.buses) return;
    if (spec.channel === "ui" && !this.settings.ui) return;
    if (spec.channel === "foley" && !this.settings.foley) return;

    const ctx = this.ctx;
    const bus = this.buses[spec.channel];
    // ±4% pitch jitter so a repeated sound never machine-guns.
    const jitter = opts.pitch ?? 1 + (Math.random() - 0.5) * 0.08;

    for (const v of spec.voices) {
      const repeats = v.repeat ?? 1;
      for (let r = 0; r < repeats; r++) {
        const at = ctx.currentTime + (v.at ?? 0) + r * (v.every ?? 0);
        this.voice(v, at, bus, jitter, opts.gain ?? 1);
      }
    }
  }

  private voice(v: Voice, at: number, bus: GainNode, jitter: number, gainScale: number): void {
    const ctx = this.ctx!;
    const gain = ctx.createGain();
    const attack = v.attack ?? 0.005;
    const peak = Math.max(0.0001, v.gain * gainScale);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(peak, at + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + attack + v.decay);

    let node: AudioNode;
    if (v.kind === "noise") {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      src.start(at);
      src.stop(at + attack + v.decay + 0.02);
      node = src;
    } else {
      const osc = ctx.createOscillator();
      osc.type = v.kind;
      const f = (v.freq ?? 440) * jitter;
      osc.frequency.setValueAtTime(f, at);
      if (v.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, v.to * jitter), at + v.decay);
      osc.start(at);
      osc.stop(at + attack + v.decay + 0.02);
      node = osc;
    }

    if (v.filter) {
      const filt = ctx.createBiquadFilter();
      filt.type = "lowpass";
      filt.frequency.setValueAtTime(v.filter, at);
      if (v.filterTo) filt.frequency.exponentialRampToValueAtTime(Math.max(60, v.filterTo), at + v.decay);
      node.connect(filt);
      filt.connect(gain);
    } else {
      node.connect(gain);
    }
    gain.connect(bus);
  }

  /** Duck the music for a hero beat (−8dB, ~1.2s). */
  duck(ms = 1200): void {
    if (!this.buses || !this.ctx) return;
    const g = this.buses.music;
    const now = this.ctx.currentTime;
    const target = this.settings.musicVolume * 0.4;
    this.duckUntil = Date.now() + ms;
    g.gain.cancelScheduledValues(now);
    g.gain.setTargetAtTime(target, now, 0.08);
    setTimeout(() => {
      if (Date.now() >= this.duckUntil && this.ctx && this.buses) {
        this.buses.music.gain.setTargetAtTime(
          this.settings.music ? this.settings.musicVolume : 0,
          this.ctx.currentTime,
          0.35
        );
      }
    }, ms);
  }

  /* ------------------------------------------------------------- music */

  /**
   * A generated lounge loop. Each flavour is a scale, a tempo and a voicing;
   * the phrase walks a seeded pattern so it never repeats exactly but always
   * sits in the same harmonic world.
   */
  startMusic(flavour: string): void {
    if (!this.ctx || !this.buses || !this.settings.music) return;
    this.stopMusic();
    const ctx = this.ctx;
    const bus = this.buses.music;
    const palette = MUSIC[flavour] ?? MUSIC["brushed-jazz"]!;
    let step = 0;
    let stopped = false;

    const tick = () => {
      if (stopped || !this.settings.music) return;
      const at = ctx.currentTime + 0.05;
      const note = palette.scale[(step * 3 + Math.floor(step / 4)) % palette.scale.length]!;
      const octave = step % 8 === 0 ? 0.5 : 1;

      const osc = ctx.createOscillator();
      osc.type = palette.wave;
      osc.frequency.value = note * octave;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(palette.gain, at + 0.06);
      g.gain.exponentialRampToValueAtTime(0.0001, at + palette.length);
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = palette.cutoff;
      osc.connect(f);
      f.connect(g);
      g.connect(bus);
      osc.start(at);
      osc.stop(at + palette.length + 0.05);

      // brushed percussion on the off-beat
      if (palette.brush && step % 2 === 1) {
        const src = ctx.createBufferSource();
        src.buffer = this.noise;
        src.loop = true;
        const bg = ctx.createGain();
        bg.gain.setValueAtTime(0.0001, at);
        bg.gain.exponentialRampToValueAtTime(0.02, at + 0.02);
        bg.gain.exponentialRampToValueAtTime(0.0001, at + 0.18);
        const bf = ctx.createBiquadFilter();
        bf.type = "bandpass";
        bf.frequency.value = 5200;
        src.connect(bf);
        bf.connect(bg);
        bg.connect(bus);
        src.start(at);
        src.stop(at + 0.2);
      }
      step++;
    };

    const timer = setInterval(tick, palette.beatMs);
    tick();
    this.musicNodes = {
      stop: () => {
        stopped = true;
        clearInterval(timer);
      }
    };
  }

  stopMusic(): void {
    this.musicNodes?.stop();
    this.musicNodes = null;
    if (this.musicEl) {
      this.musicEl.pause();
      this.musicEl = null;
    }
  }

  /**
   * Bring your own music: a local file, played from an object URL. The bytes
   * never leave the device — no upload, no storage, no licensing exposure.
   */
  playLocalTrack(file: File, onEnded?: () => void): void {
    this.stopMusic();
    const el = new Audio(URL.createObjectURL(file));
    el.volume = this.settings.music ? this.settings.musicVolume : 0;
    el.addEventListener("ended", () => {
      URL.revokeObjectURL(el.src);
      onEnded?.();
    });
    void el.play().catch(() => undefined);
    this.musicEl = el;
  }
}

interface MusicPalette {
  scale: number[];
  wave: OscillatorType;
  beatMs: number;
  length: number;
  gain: number;
  cutoff: number;
  brush: boolean;
}

/** Six original flavours, one per shell theme. */
const MUSIC: Record<string, MusicPalette> = {
  "brushed-jazz": { scale: [220, 261.6, 293.7, 349.2, 392, 466.2], wave: "triangle", beatMs: 640, length: 0.9, gain: 0.05, cutoff: 1400, brush: true },
  parlour:        { scale: [261.6, 293.7, 329.6, 392, 440, 523.3], wave: "sine", beatMs: 700, length: 1.1, gain: 0.045, cutoff: 1800, brush: false },
  strings:        { scale: [196, 246.9, 293.7, 329.6, 392, 493.9], wave: "sawtooth", beatMs: 900, length: 1.6, gain: 0.028, cutoff: 900, brush: false },
  smoke:          { scale: [174.6, 207.7, 233.1, 261.6, 311.1, 349.2], wave: "triangle", beatMs: 760, length: 1.2, gain: 0.045, cutoff: 1100, brush: true },
  reverie:        { scale: [233.1, 277.2, 311.1, 369.9, 415.3, 466.2], wave: "sine", beatMs: 820, length: 1.3, gain: 0.045, cutoff: 1600, brush: false },
  nocturne:       { scale: [207.7, 261.6, 311.1, 349.2, 415.3, 523.3], wave: "sine", beatMs: 880, length: 1.5, gain: 0.04, cutoff: 1300, brush: false }
};
