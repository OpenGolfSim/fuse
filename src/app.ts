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
  appType: 'mobile' | 'desktop' | 'web';
  isReady: boolean;
  rapier: RapierInstance;
  world?: RAPIER.World;

  constructor() {
    super();
    this.isReady = false;
    this.appType = 'web';
    if (typeof window.ReactNativeWebView !== 'undefined') {
      this.appType = 'mobile';
    } else if (typeof window.ogsElectron !== 'undefined') {
       this.appType = 'desktop';
    }

    if (this.appType === 'mobile') {
      window.addEventListener("message", this.#handleReactNativeMessage.bind(this));
    } else if (this.appType === 'desktop') {
      window.ogsElectron!.onMessage(this.#handleElectronMessage.bind(this));
    }

    this.rapier = RAPIER;
    this.rapier.init().then(() => {
      this.world = new RAPIER.World(GRAVITY_VECTOR);
      this.setReady();
    });
  }

  #handleReactNativeMessage(event: MessageEvent<any>) {
    try {
      const data = JSON.parse(event.data);
      this.#handleEvent(data);
    } catch (error) {
      console.log('Could not parse ReactNative message', error);
      console.log(event);
    }
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

  exit() {
    if (this.appType === 'web') {
      window.navigation.back();
    } else {
      this.sendMessage({ type: 'exit' });
    }
  }

  sendMessage(payload: any) {
    if (this.appType === 'mobile') {
      console.log('Sending to react native: ', payload);
      window.ReactNativeWebView?.postMessage(JSON.stringify(payload));
    } else if (this.appType === 'desktop') {
      console.log('Sending to electron: ', payload);
      window.ogsElectron?.postMessage(payload);
    } else if (payload.type === 'ready') {
      this.emit('ready');
    } else {
      console.warn('No parent to send message to!', JSON.stringify(payload, null, 1));
      // TODO: use a cloud-based websocket here to sync for web play?
    }
  }
}

