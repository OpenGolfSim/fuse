import * as RAPIER from '@dimforge/rapier3d-compat';
import EventEmitter from 'eventemitter3';
import { GRAVITY_VECTOR } from './physics/constants';

export type SetupMessage = {
  type: 'setup',
  setupData: OpenGolfSim.SetupData
};

export type ShotMessage = {
  type: 'shot',
  shot: OpenGolfSim.Shot
};

export type ReadyMessage = {
  type: 'ready'
};

export type PlayerUpdateMessage = {
  type: 'player',
  player: OpenGolfSim.Player
};

/**
 * Sets up physics and communication with external apps.
 */
export class AppBridge extends EventEmitter {
  isReady: boolean;
  rapier: RapierInstance;
  world?: RAPIER.World;

  constructor() {
    super();
    this.isReady = false;

    if (typeof window.ReactNativeWebView !== 'undefined') {
      window.addEventListener('reactNativeMessage', this.#handleReactNativeMessage.bind(this));
    } else if (typeof window.ogsElectron !== 'undefined') {
      window.ogsElectron!.onMessage(this.#handleElectronMessage.bind(this));
    }
    this.rapier = RAPIER;
    this.rapier.init().then(() => {
      this.world = new RAPIER.World(GRAVITY_VECTOR);
      this.setReady();
    });
  }

  #handleReactNativeMessage(event: CustomEvent<string>) {
    const data = JSON.parse(event.detail);
    this.#handleEvent(data);
  }

  #handleElectronMessage(data: any) {
    this.#handleEvent(data);
  }

  #handleEvent(data: any) {
    const { type: eventType, ...payload } = data;
    if (eventType) {
      this.emit(eventType, payload);
    }
  }

  initialize(callback: () => void) {
    if (this.isReady) {
      return callback();
    }
    this.once('ready', callback);
  }

  setReady() {
    console.log('[runtime] Rapier initialized');
    this.isReady = true;
    this.sendMessage({ type: 'ready' });
  }

  sendMessage(payload: ReadyMessage | PlayerUpdateMessage) {
    // handle mobile apps
    if (typeof window.ReactNativeWebView !== 'undefined') {
      window.ReactNativeWebView.postMessage(JSON.stringify(payload));
    } else if (typeof window.ogsElectron !== 'undefined') {
      console.log('Sending to electron: ', payload);
      window.ogsElectron.postMessage(payload);
    } else {
      const { type, ...detail } = payload;
      this.emit(type, detail);
    }
  }
}

// export const app = new AppBridge();