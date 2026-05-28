
interface Window {
  ReactNativeWebView?: {
    postMessage: (payload: string) => {}
  }
  ogsElectron?: {
    onMessage: (callback: (data: any) => void) => {},
    postMessage: (payload: any) => {}
  }
  // whatever else you're attaching
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
    elevation?: number;
    units?: MeasurementUnits;
    cameraOffset?: number;
  }

  type GameData = {
    id: string;
    gameMode: number;
    courseUrl?: string;
  }
}