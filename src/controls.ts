import EventEmitter from 'eventemitter3';
import { type AimKeys } from './camera';
import { app } from '@/index';
import { OGSKeyCommands } from './app';

interface CourseKeyboardControlEvents {
  testShot: (shot: OpenGolfSim.Shot) => void;
  toggleStats: () => void;
  mulligan: () => void;
  fullscreen: () => void;
  aim: (aimKeys: AimKeys) => void;
}

const MODIFIER_KEYS = new Set(['Meta', 'Control', 'Alt', 'Shift']);
const AIM_CODES = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);

export class CourseKeyboardControls extends EventEmitter<CourseKeyboardControlEvents> {
  #testShots: boolean;
  aimKeys: AimKeys;
  #lastTap = 0;

  constructor(options = { testShots: false }) {
    super();
    this.#testShots = options.testShots;
    this.aimKeys = { left: false, right: false, forward: false, backward: false };    

    window.addEventListener('keydown', this.#keyHandler.bind(this), true); // true = capture phase
    window.addEventListener('keyup',   this.#keyHandler.bind(this), true);
    // Reset aim state when the window loses focus (Cmd+Tab, etc.)
    window.addEventListener('blur', this.#resetAimKeys.bind(this));

    document.addEventListener('touchend', this.#touchEnd.bind(this));

    app.on('command', (key, state) => {
      console.log('COMMAND', key, state);

      if (key.ogs_code === OGSKeyCommands.AimLeft) {
        this.aimKeys.left = state === 'down';
        this.emit('aim', this.aimKeys);
      } else if (key.ogs_code === OGSKeyCommands.AimRight) {
        this.aimKeys.right = state === 'down';
        this.emit('aim', this.aimKeys);
      } else if (key.ogs_code === OGSKeyCommands.DistanceIncrease) {
        this.aimKeys.forward = state === 'down';
        this.emit('aim', this.aimKeys);
      } else if (key.ogs_code === OGSKeyCommands.DistanceDecrease) {
        this.aimKeys.backward = state === 'down';
        this.emit('aim', this.aimKeys);
      }

    });
  }

  #touchEnd(event: TouchEvent) {
    const currentTime = new Date().getTime();
    const tapLength = currentTime - this.#lastTap;
    // Check if the delay between taps matches a double tap (e.g., under 300ms)
    if (tapLength < 300 && tapLength > 0) {
      event.preventDefault(); // Prevents the default browser zoom behavior
      const range = (min: number, max: number) => (Math.floor(Math.random() * (max - min + 1)) + min);
      this.emit('testShot', {
        ballSpeed: range(90, 120),
        verticalLaunchAngle: range(14, 20),
        horizontalLaunchAngle: range(-2, 2),
        spinSpeed: range(2000, 6000),
        spinAxis: range(2, 2),
      });
    }
    this.#lastTap = currentTime;
  }
  
  #keyHandler(event: KeyboardEvent) {
    const pressed = event.type === 'keydown';
    let handled = false;
    if (pressed) {
      switch (event.code) {
        case 'KeyS':
          this.emit('toggleStats');
          handled = true;
          break;
        case 'KeyM':
          this.emit('mulligan');
          handled = true;
          break;
        case 'KeyF':
          this.emit('fullscreen');
          if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen();
          } else {
            document.exitFullscreen();
          }
          handled = true;
          break;
      }
    }

    if (this.#testShots && pressed) {
      if (!event.metaKey && !event.ctrlKey && !event.altKey) {
        handled = this.#handleTestShotKeys(event.code);
      }
    }

    // handled = this.#handleAimKeys(event.code, pressed);
    // Don't set aim keys while a modifier is held — the keyup won't arrive.
    if (!event.metaKey && !event.ctrlKey && !event.altKey) {
      if (AIM_CODES.has(event.code)) {
        handled = this.#handleAimKeys(event.code, pressed);
      }
    } else if (AIM_CODES.has(event.code)) {
      // Arrow + modifier (e.g. Cmd+Right for word-jump): treat as unhandled
      // and make sure the key isn't stuck true from a previous press.
      this.#resetAimKeys();
    }

    
    if (handled) {
      event.preventDefault();
    }
  }

  #handleAimKeys(code: string, pressed: boolean) {
    switch (code) {
      case 'ArrowLeft': 
        this.aimKeys.left = pressed;
        break;
      case 'ArrowRight':
        this.aimKeys.right = pressed;
        break;
      case 'ArrowUp':
        this.aimKeys.forward = pressed;
        break;
      case 'ArrowDown': 
        this.aimKeys.backward = pressed;
        break;
      // unhandled
      default: return false;
    }
    this.emit('aim', this.aimKeys);
    // handled
    return true;
  }

  #handleTestShotKeys(code: string) {
    switch (code) {
      case 'Space':
        const range = (min: number, max: number) => (Math.floor(Math.random() * (max - min + 1)) + min);
        this.emit('testShot', {
          ballSpeed: range(90, 140),
          verticalLaunchAngle: range(14, 20),
          horizontalLaunchAngle: range(-2, 2),
          spinSpeed: range(2000, 6000),
          spinAxis: range(-12, 12),
        });
        break;
      case 'Digit1':
      case 'Numpad1':
        // this.emit('testShot', { ballSpeed: 150, verticalLaunchAngle: 11, horizontalLaunchAngle: 0, spinSpeed: 2000, spinAxis: 0 });
        this.emit('testShot', { ballSpeed: 136, verticalLaunchAngle: 14, horizontalLaunchAngle: -1, spinSpeed: 4699, spinAxis: 7 });
        break;
      case 'Digit2':
      case 'Numpad2':
        this.emit('testShot', { ballSpeed: 120, verticalLaunchAngle: 15, horizontalLaunchAngle: 0, spinSpeed: 3200, spinAxis: 0 });
        break;
      case 'Digit3':
      case 'Numpad3':
        this.emit('testShot', { ballSpeed: 108, verticalLaunchAngle: 22, horizontalLaunchAngle: -1, spinSpeed: 5000, spinAxis: 8 });
        break;
      case 'Digit4':
      case 'Numpad4':
        this.emit('testShot', { ballSpeed: 80, verticalLaunchAngle: 25, horizontalLaunchAngle: 0, spinSpeed: 7500, spinAxis: 0 });
        break;
      case 'Digit5':
      case 'Numpad5':
        this.emit('testShot', { ballSpeed: 60, verticalLaunchAngle: 28, horizontalLaunchAngle: 0, spinSpeed: 7000, spinAxis: 0 });
        break;
      case 'Digit6': 
      case 'Numpad6':
        this.emit('testShot', { ballSpeed: 40, verticalLaunchAngle: 28, horizontalLaunchAngle: 0, spinSpeed: 6000, spinAxis: 0 });
        break;
      case 'Digit7':
      case 'Numpad7':
        this.emit('testShot', { ballSpeed: 30, verticalLaunchAngle: 35, horizontalLaunchAngle: 0, spinSpeed: 6000, spinAxis: 0 });
        break;
      case 'Digit8':
      case 'Numpad8':
        this.emit('testShot', { ballSpeed: 20, verticalLaunchAngle: 40, horizontalLaunchAngle: 0, spinSpeed: 4000, spinAxis: 0 });
        break;
      case 'Digit9':
      case 'Numpad9':
        // this.emit('testShot', { ballSpeed: 4.0265, verticalLaunchAngle: 0, horizontalLaunchAngle: 0, spinSpeed: 0, spinAxis: 0 });
        this.emit('testShot', { ballSpeed: 8, verticalLaunchAngle: 0, horizontalLaunchAngle: 0, spinSpeed: 0, spinAxis: 0 });
        break;
      // unhandled
      default: return false;
    }
    // handled
    return true;
  }

  #resetAimKeys() {
    const wasActive = Object.values(this.aimKeys).some(Boolean);
    this.aimKeys = { left: false, right: false, forward: false, backward: false };
    if (wasActive) {
      this.emit('aim', this.aimKeys);
    }
  }

  update(dt: number) {}
}