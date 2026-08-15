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
// Touch gesture tuning
const AIM_DEADZONE_PX = 20;      // horizontal movement before aim engages
const SWIPE_START_PX = 30;       // downward movement before a shot swipe engages
const SWIPE_UP_MIN_PX = 40;      // minimum up-phase length to count as a shot
const MAX_HLA_DEG = 20;          // clamp for swipe-derived horizontal launch angle
const SPEED_PER_PX_S = 0.05;     // px/s of up-swipe velocity -> mph ballSpeed

export class CourseKeyboardControls extends EventEmitter<CourseKeyboardControlEvents> {
  #testShots: boolean;
  aimKeys: AimKeys;
  #gesture: {
    id: number;
    startX: number; startY: number;
    mode: 'pending' | 'aim' | 'swipe';
    apexX: number; apexY: number; apexTime: number; // lowest point of down-phase
    lastX: number; lastY: number;
  } | null = null;
  #swipeShots: boolean;

  constructor(options: { testShots?: boolean; swipeShots?: boolean } = {}) {
    super();
    this.#testShots = options.testShots ?? false;
    this.#swipeShots = options.swipeShots ?? false;
    this.aimKeys = { left: false, right: false, forward: false, backward: false };    

    window.addEventListener('keydown', this.#keyHandler.bind(this), true); // true = capture phase
    window.addEventListener('keyup',   this.#keyHandler.bind(this), true);
    // // Reset aim state when the window loses focus (Cmd+Tab, etc.)
    // window.addEventListener('blur', this.#resetAimKeys.bind(this));
    // Reset aim/gesture state when the window loses focus (Cmd+Tab, etc.)
    window.addEventListener('blur', () => { this.#gestureCancel(); this.#resetAimKeys(); });

    // document.addEventListener('touchend', this.#touchEnd.bind(this));
    // document.addEventListener('touchstart', this.#touchStart.bind(this), { passive: false });
    // document.addEventListener('touchmove', this.#touchMove.bind(this), { passive: false });
    // document.addEventListener('touchend', this.#touchEnd.bind(this));
    // document.addEventListener('touchcancel', this.#touchCancel.bind(this));
    // Pointer events unify mouse + touch
    document.addEventListener('pointerdown', this.#pointerDown.bind(this));
    document.addEventListener('pointermove', this.#pointerMove.bind(this));
    document.addEventListener('pointerup', this.#pointerUp.bind(this));
    document.addEventListener('pointercancel', this.#gestureCancel.bind(this));
    // preventDefault on pointermove doesn't stop touch scrolling; this shim does.
    document.addEventListener('touchmove', (e) => {
      if (this.#gesture && this.#gesture.mode !== 'pending') e.preventDefault();
    }, { passive: false });

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

  // #touchEnd(event: TouchEvent) {
  //   const currentTime = new Date().getTime();
  //   const tapLength = currentTime - this.#lastTap;
  //   // Check if the delay between taps matches a double tap (e.g., under 300ms)
  //   if (tapLength < 300 && tapLength > 0) {
  //     event.preventDefault(); // Prevents the default browser zoom behavior
  //     const range = (min: number, max: number) => (Math.floor(Math.random() * (max - min + 1)) + min);
  //     this.emit('testShot', {
  //       ballSpeed: range(90, 120),
  //       verticalLaunchAngle: range(14, 20),
  //       horizontalLaunchAngle: range(-2, 2),
  //       spinSpeed: range(2000, 6000),
  //       spinAxis: range(2, 2),
  //     });
  //   }
  //   this.#lastTap = currentTime;
  // }
  
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
        this.emit('testShot', { ballSpeed: 150, verticalLaunchAngle: 13, horizontalLaunchAngle: 0, spinSpeed: 2500, spinAxis: 0 });
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
        this.emit('testShot', { ballSpeed: 82, verticalLaunchAngle: 34, horizontalLaunchAngle: 0.013, spinSpeed: 8500, spinAxis: 0 });
        break;
      case 'Digit5':
      case 'Numpad5':
        this.emit('testShot', { ballSpeed: 70, verticalLaunchAngle: 28, horizontalLaunchAngle: 0, spinSpeed: 9000, spinAxis: 0 });
        break;
      case 'Digit6': 
      case 'Numpad6':
        this.emit('testShot', { ballSpeed: 40, verticalLaunchAngle: 28, horizontalLaunchAngle: -2, spinSpeed: 6000, spinAxis: -1.2 });
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

  #pointerDown(event: PointerEvent) {
    if (!event.isPrimary) { this.#gestureCancel(); return; } // ignore multi-touch
    if (event.pointerType === 'mouse' && event.button !== 0) return; // left button only
    this.#gesture = {
      id: event.pointerId,
      startX: event.clientX, startY: event.clientY,

      mode: 'pending',
      apexX: event.clientX, apexY: event.clientY, apexTime: performance.now(),
      lastX: event.clientX, lastY: event.clientY,
      // apexX: t.clientX, apexY: t.clientY, apexTime: performance.now(),
      // lastX: t.clientX, lastY: t.clientY,
    };
  }

  // #touchMove(event: TouchEvent) {
  //   const g = this.#touch;
  //   if (!g) return;
  //   const t = Array.from(event.touches).find(t => t.identifier === g.id);
  //   if (!t) return;
  //   const dx = t.clientX - g.startX;
  //   const dy = t.clientY - g.startY; // screen y grows downward
  #pointerMove(event: PointerEvent) {
    const g = this.#gesture;
    if (!g || event.pointerId !== g.id) return;
    const dx = event.clientX - g.startX;
    const dy = event.clientY - g.startY; // screen y grows downward

    if (g.mode === 'pending') {
      if (this.#swipeShots && dy > SWIPE_START_PX && dy > Math.abs(dx)) {
        g.mode = 'swipe';
      } else if (Math.abs(dx) > AIM_DEADZONE_PX && Math.abs(dx) > Math.abs(dy)) {
        g.mode = 'aim';
      }
    }

    if (g.mode === 'aim') {
      // event.preventDefault(); // stop scroll while aiming
      this.#setAimDrag(dx > AIM_DEADZONE_PX ? 1 : dx < -AIM_DEADZONE_PX ? -1 : 0);
    } else if (g.mode === 'swipe') {
      // event.preventDefault();
      // Track the lowest point reached (apex of the down-phase)
      if (event.clientY >= g.apexY) {
        g.apexX = event.clientX;
        g.apexY = event.clientY;

        g.apexTime = performance.now();
      }
    }
    g.lastX = event.clientX;
    g.lastY = event.clientY;

  }

  #pointerUp(event: PointerEvent) {
    const g = this.#gesture;
    if (g && event.pointerId !== g.id) return;
    this.#gesture = null;
    if (!g) return;

    if (g.mode === 'aim') {
      this.#setAimDrag(0);
      return;
    }

    if (g.mode === 'swipe') {
      const upDx = g.lastX - g.apexX;
      const upDy = g.apexY - g.lastY; // positive = upward
      if (upDy > SWIPE_UP_MIN_PX) {
        // event.preventDefault();
        // Angle of up-phase off vertical: right of vertical = positive HLA
        const hla = Math.max(-MAX_HLA_DEG, Math.min(MAX_HLA_DEG,
          Math.atan2(upDx, upDy) * (180 / Math.PI)));
        const upDist = Math.hypot(upDx, upDy);
        const upDurS = Math.max((performance.now() - g.apexTime) / 1000, 0.05);
        const velocity = upDist / upDurS; // px/s
        // TODO: scale by distance-to-target so short shots are easier near the pin
        const ballSpeed = Math.min(160, Math.max(10, velocity * SPEED_PER_PX_S));
        this.emit('testShot', {
          ballSpeed,
          verticalLaunchAngle: 18,
          horizontalLaunchAngle: hla,
          spinSpeed: 4000,
          spinAxis: 0,
        });
      }
      // return;
    }


  }

  #gestureCancel() {
    if (this.#gesture?.mode === 'aim') this.#setAimDrag(0);
    this.#gesture = null;
  }

  #setAimDrag(dir: -1 | 0 | 1) {
    const left = dir === -1;
    const right = dir === 1;
    if (this.aimKeys.left !== left || this.aimKeys.right !== right) {
      this.aimKeys.left = left;
      this.aimKeys.right = right;
      this.emit('aim', this.aimKeys);
    }
  }  
  update(dt: number) {}
}