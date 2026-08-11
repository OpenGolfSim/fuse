import * as THREE from 'three';
import { vec2, vec3, positionLocal, positionWorld, cameraPosition } from 'three/tsl';
import { WaterSurface, type WaterSurfaceOptions } from './';

export type OceanSurfaceOptions = WaterSurfaceOptions & {
  size?: number;      // plane extent, should exceed far/fog distance
  tileSize?: number;  // world units per texture tile
};

export class OceanSurface extends WaterSurface {
  private static tileSizeStatic = 20;

  constructor(options: OceanSurfaceOptions = {}) {
    const size = options.size ?? 4000;
    OceanSurface.tileSizeStatic = options.tileSize ?? 20;

    const geo = new THREE.PlaneGeometry(size, size, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const proxy = new THREE.Mesh(geo);

    super(proxy, undefined, {
      depthRange: 12,
      opacity: 0.95,
      shallowColor: new THREE.Color('#184a5f'),
      deepColor: new THREE.Color('#042034'),
      envMapIntensity: 0.4,
      normalStrength: 0.6,
      roughness: 0.1,
      ...options,
    });

    // Vertex shader: recenter the plane on the camera every frame.
    // Y stays at the mesh's own height (sea level / yOffset).
    this.material.positionNode = positionLocal.add(
      vec3(cameraPosition.x, 0, cameraPosition.z)
    );

    // Mesh origin no longer matches rendered position — culling would be wrong
    this.water.frustumCulled = false;

    this.material.side = THREE.FrontSide;
  }

  protected uvNode() {
    // World-anchored UVs: texture pattern is fixed in world space,
    // so the camera-following mesh shows no movement at all.
    return positionWorld.xz.div(OceanSurface.tileSizeStatic);
  }
}