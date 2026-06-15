import * as RAPIER from '@dimforge/rapier3d-compat';
import EventEmitter from 'eventemitter3';
import { GRAVITY_VECTOR } from './physics/constants';

export enum OGSKeyCommands {
  AimLeft = 0,
  AimRight = 1,
  DistanceIncrease = 2,
  DistanceDecrease = 3,
  ClubUp = 4,
  ClubDown = 5,
  PlayerUp = 6,
  PlayerDown = 7,
  Drop = 8,
  ReHit = 9,
  Mulligan = 10,
  Scorecard = 11,
  ToggleMap = 12
};

export type SetupMessage = {
  type: 'setup',
  setupData: OpenGolfSim.SetupData,
  gameData: OpenGolfSim.GameData,
};

export type ShotMessage = {
  type: 'shot',
  shot: OpenGolfSim.Shot
};

export type CommandMessage = {
  type: 'command',
  key: {
    ogs_code?: OGSKeyCommands;
    name: string;
    code: number;
  },
  state: 'down' | 'up' | 'press'
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
  command: (key: CommandMessage['key'], state: CommandMessage['state']) => void;
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

  #handleEvent(data: CommandMessage | ShotMessage | SetupMessage) {
    switch (data.type) {
      case 'shot':
        this.emit('shot', data.shot);
        break;
      case 'setup':
        this.emit('setup', data);
        break;
      case 'command':
        this.emit('command', data.key, data.state);
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
      console.warn('No parent to send message to!', payload);
      // TODO: use a cloud-based websocket here to sync for web play?
    }
  }
}

