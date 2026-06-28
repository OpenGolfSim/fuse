export class AudioPlayer {
  sounds: Map<string, HTMLAudioElement>;

  constructor() {
    this.sounds = new Map();
  }

  load(clipUri: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const sound = new Audio(clipUri);
      sound.addEventListener('error', (error) => {
        reject(error);
      });
      sound.addEventListener('canplaythrough', () => {
        resolve();
      });
      this.sounds.set(clipUri, sound);
    });
  }

  play(clipUri: string, volume = 1) {
    const sound = this.sounds.get(clipUri);
    if (!sound) return;
    sound.volume = volume;
    sound.play();
  }
}