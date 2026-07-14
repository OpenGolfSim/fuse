export class AudioPlayer {
  private ctx: AudioContext;
  private buffers = new Map<string, AudioBuffer>();

  constructor() {
    // webkitAudioContext fallback only matters for iOS < 14.5, but it's cheap
    const Ctx =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx();
  }

  /**
   * Call this once from a real user gesture handler (pointerdown / touchend / click).
   * iOS creates AudioContexts in the "suspended" state and only allows resuming
   * them synchronously inside a gesture.
   */
  unlock(): Promise<void> {
    if (this.ctx.state === 'suspended') {
      return this.ctx.resume();
    }
    return Promise.resolve();
  }

  /**
   * Fetches and decodes the clip up front. Unlike HTMLAudioElement loading,
   * this works on iOS without a user gesture and resolves reliably.
   */
  async load(clipUri: string): Promise<void> {
    if (this.buffers.has(clipUri)) return;

    const res = await fetch(clipUri);
    if (!res.ok) {
      throw new Error(`Failed to fetch audio clip: ${clipUri} (${res.status})`);
    }
    const data = await res.arrayBuffer();
    const buffer = await this.decode(data);
    this.buffers.set(clipUri, buffer);
  }

  async loadAll(clipUris: string[]): Promise<void> {
    await Promise.all(clipUris.map((uri) => this.load(uri)));
  }

  play(clipUri: string, volume = 1, playbackRate = 1): void {
    const buffer = this.buffers.get(clipUri);
    if (!buffer) return;

    // Best-effort resume in case unlock() wasn't called; this only succeeds
    // if we're currently inside a user gesture.
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = playbackRate;

    const gain = this.ctx.createGain();
    gain.gain.value = volume;

    source.connect(gain);
    gain.connect(this.ctx.destination);
    source.start();
    // AudioBufferSourceNodes are one-shot and garbage-collected after ending;
    // no cleanup needed for short SFX.
  }

  /** Use the callback form of decodeAudioData: the promise form is missing on older Safari. */
  private decode(data: ArrayBuffer): Promise<AudioBuffer> {
    return new Promise((resolve, reject) => {
      this.ctx.decodeAudioData(data, resolve, (err) => reject(err ?? new Error('decodeAudioData failed')));
    });
  }
}