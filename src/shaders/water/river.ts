import * as THREE from 'three';
import { WaterSurface, type WaterSurfaceOptions, type FlowMapData } from './';

export class RiverSurface extends WaterSurface {
  constructor(
    waterObject: THREE.Mesh,
    flowMapData?: FlowMapData,
    options: WaterSurfaceOptions = {}
  ) {
    super(waterObject, flowMapData, {
      speed: 0.35,
      flowStrength: 0.3,
      sideFlowStrength: 0.3,
      uvTiling: [6, 6],
      normalStrength: 0.5,
      // shallowColor: new THREE.Color('#374949'),
      // deepColor: new THREE.Color('#1a3534'),
      shallowColor: new THREE.Color('#27383b'),
      deepColor: new THREE.Color('#050d0f'),
      depthRange: 2,
      // shallowColor: new THREE.Color('#243f42'),
      opacity: 0.4,
      roughness: 0.05,
      envMapIntensity: 0.15,
      yOffset: 0.15,
      ...options,
    });
  }
}
