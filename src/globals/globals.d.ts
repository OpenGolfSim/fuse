
interface Window {
  ReactNativeWebView?: {
    postMessage: (payload: string) => {}
  }
  ogsElectron?: {
    onMessage: (callback: (data: any) => void) => {},
    postMessage: (payload: any) => {}
  }
}

interface WindowEventMap {
  "reactNativeMessage": CustomEvent<string>;
}

declare module '*.webp' {
  const src: string;
  export default src;
}

declare module '*.png' {
  const src: string;
  export default src;
}

declare module '*.svg' {
  const src: string;
  export default src;
}

namespace OpenGolfSim {

  type MeasurementUnits = 'imperial' | 'metric';

  interface Club {
    name: string;
    id: string;
    distance: number;
  }

  interface Player {
    name: string;
    id: string;
    clubs: Club[];
  }
  
  /** The data used to simulate a golf shot */
  type Shot = {
    /** Ball speed in MPH */
    ballSpeed: number;
    /** Vertical launch angle of shot (degrees) */
    verticalLaunchAngle: number;
    /** Horizontal launch angle of shot (degrees) */
    horizontalLaunchAngle: number;
    /** Spin speed in RPM */
    spinSpeed: number;
    /** Spin axis in degrees */
    spinAxis: number;
  }
  
  /** The result of the simulated golf shot */
  type ShotResult = {
    apex: number;
    carry: number;
    total: number;
    roll: number;
    lateral: number;
  }

  type SetupData = {
    players: OpenGolfSim.Player[],
    practiceMode: boolean;
    puttingEnabled?: boolean;
    elevation?: number;
    units?: MeasurementUnits;
    cameraOffset?: number;
    qualityLevel?: number;
    gimmeDistances?: number[];
  }

  type GameData = {
    id: string;
    gameMode: number;
    courseUrl?: string;
  }

  
  interface ShotResultEvent {
    type: 'result';
    data?: Partial<ShotResult>;
    shot?: Shot;
    club?: Club;
    surface?: string;
    player?: Player;
    startPosition?: [number, number, number];
    landPosition?: [number, number, number];
    endPosition?: [number, number, number];
    ballTrail?: [number, number, number][];
    heightSamples?: number[];
    distanceSamples?: number[];
    lateralSamples?: number[];
  }

}


interface GLTFImage {
  bufferView: number;
  name?: string,
  mimeType?: string,
  extras?: Record<string, any>
}

interface FlowMapImage extends GLTFImage {
  extras?: {
    type?: 'flow_map',
    id?: string,
    riverId?: string,
  }
}

interface TreeImage extends GLTFImage {
  extras?: {
    type?: 'tree_mask' | 'tree_billboard',
    id?: string,
    treeLayerId?: string,
    configId?: string,
    size?: {
      depth?: number,
      height?: number,
      maxDim?: number,
      width?: number
    }
  }
}