import EventEmitter from 'eventemitter3';
import { ShotStats } from '@/objects/golfBall';
import { type CoursePlayer } from '@/courses/player';

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
  appType: 'mobile' | 'desktop' | 'web' | 'webapp';
  isReady: boolean;

  constructor() {
    super();
    this.isReady = false;
    this.appType = 'web';
    if (typeof window.ReactNativeWebView !== 'undefined') {
      this.appType = 'mobile';
    } else if (typeof window.ogsElectron !== 'undefined') {
       this.appType = 'desktop';
    } else if (window.self !== window.top) {
      this.appType = 'webapp';
    }
    if (this.appType === 'desktop') {
      window.ogsElectron!.onMessage(this.#handleElectronMessage.bind(this));
    } else {
      window.addEventListener("message", this.#handleWindowMessage.bind(this));
    }
    this.setReady();
  }

  #handleWindowMessage(event: MessageEvent<any>) {
    try {
      const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
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
  
  log(message: any) {
    this.sendMessage({ type: 'log', message });
  }

  setReady() {
    console.log('[runtime] FUSE initialized');
    this.isReady = true;
    this.sendMessage({ type: 'ready' });
  }

  sendPlayerUpdate(player: CoursePlayer, position: [number, number, number]) {
    const { name, id, clubs } = player;
    const update: OpenGolfSim.PlayerUpdateEvent = {
      type: 'player',
      player: { name, id, clubs },
      currentPosition: position,
      club: player.currentClub
    };
    this.sendMessage(update);
  }

  sendShotResult(options: {
    shot?: OpenGolfSim.Shot,
    stats?: ShotStats,
    player?: OpenGolfSim.Player,
    club?: OpenGolfSim.Club
  }) {
    const { shot, stats, player, club } = options;
    if (!shot) throw new Error('Missing shot data');
    if (!stats) throw new Error('Missing result stats');
    if (!player) throw new Error('Missing player');
    if (!club) throw new Error('Missing club');

    const {
      startPosition,
      landPosition,
      endPosition,
      lateralSamples,
      heightSamples,
      distanceSamples,
      surface,
      apex,
      lateral,
      carry,
      total,
      roll
    } = stats || {};

    const update: OpenGolfSim.ShotResultEvent = {
      type: 'result',
      data: { apex, lateral, carry, total, roll },
      shot,
      player,
      club,
      surface,
      startPosition: startPosition?.toArray(),
      endPosition: endPosition?.toArray(),
      landPosition: landPosition?.toArray(),
      lateralSamples: [],
      heightSamples: [],
      distanceSamples: [],
      // lateralSamples,
      // heightSamples,
      // distanceSamples,
    }
    this.sendMessage(update);
  }

  settings() {
    this.sendMessage({ type: 'settings' });
  }
  exit() {

    this.sendMessage({ type: 'exit' });

    if (this.appType === 'web') {
      try {
        window.navigation.back();
      } catch (error) {
        console.log(error);
      }
    }
  }
  help() {
    this.sendMessage({ type: 'help' });
    
    if (this.appType === 'web') {
      try {
        window.open('https://help.opengolfsim.com');
      } catch (error) {
        console.log(error);
      }
    }
  }

  sendMessage(payload: any) {
    console.log('send', this.appType, payload);
    if (this.appType === 'mobile') {
      console.log('Sending to react native: ', payload);
      window.ReactNativeWebView?.postMessage(JSON.stringify(payload));
    } else if (this.appType === 'desktop') {
      console.log('Sending to electron: ', payload);
      window.ogsElectron?.postMessage(payload);
    } else if (this.appType === 'webapp' && window.parent?.postMessage) {
      console.log('Sending to iframe: ', payload);
      window.parent.postMessage(payload, '*');
    } else if (payload.type === 'ready') {
      this.emit('ready');
    } else {
      console.warn('No parent to send message to!', payload);
      // TODO: use a cloud-based websocket here to sync for web play?
    }
  }
}

