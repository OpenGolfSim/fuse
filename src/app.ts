import * as RAPIER from '@dimforge/rapier3d-compat';
import EventEmitter from 'eventemitter3';
import { GRAVITY_VECTOR } from './physics/constants';

export type SetupMessage = {
  type: 'setup',
  setupData: OpenGolfSim.SetupData,
  gameData: OpenGolfSim.GameData,
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

interface EventMap {
  ready: () => void;
  shot: (shotData: OpenGolfSim.Shot) => void;
  setup: (message: Omit<SetupMessage, 'type'>) => void;
}

/**
 * Sets up physics and communication with external apps.
 */
export class AppBridge extends EventEmitter<EventMap> {
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

  #handleEvent(data: ShotMessage | SetupMessage) {
    switch (data.type) {
      case 'shot':
        this.emit('shot', data.shot);
        break;
      case 'setup':
        this.emit('setup', data);
        break;
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
    if (typeof window.ReactNativeWebView !== 'undefined') {
      console.log('Sending to react native: ', payload);
      window.ReactNativeWebView.postMessage(JSON.stringify(payload));
    } else if (typeof window.ogsElectron !== 'undefined') {
      console.log('Sending to electron: ', payload);
      window.ogsElectron.postMessage(payload);
    } else if (payload.type === 'ready') {
      this.emit('ready');
    } else {
      console.warn('No parent app to to send message!', payload);
      // TODO: use a cloud-based websocket here to sync for web play?
    }
  }
}

