import * as THREE from 'three/webgpu';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  vec3, vec4, float,
  uniform as tslUniform,
  positionLocal, positionWorld,
  dot, mix, normalize,
  smoothstep as tslSmoothstep,
  mx_fractal_noise_float,
} from 'three/tsl';

type VolumetricCloudsOptions = {
  density?: number;
  opacity?: number;
  scale?: number;
  radius?: number;
  position?: THREE.Vector3;
  skyColor?: THREE.Color;
  cloudColor?: THREE.Color;
  fogColor?: THREE.Color;
};

export class VolumetricClouds {
  camera: THREE.Camera;
  object: THREE.Mesh;
  material: MeshBasicNodeMaterial;
  sphereCenterUniform: any;
  timeUniform: any;

  constructor(camera: THREE.Camera, options: VolumetricCloudsOptions = {}) {
    this.camera = camera;

    const density = options.density ?? 0.4;
    const cloudOpacity = options.opacity ?? 0.8;
    const scale = options.scale ?? 5.0;
    const radius = options.radius ?? 800;
    const position = options.position ?? new THREE.Vector3(0, 0, 0);

    // Fit geometry inside frustum; compensate noise so pattern matches original radius
    const cameraFar = (camera as THREE.PerspectiveCamera).far ?? 1000;
    const geometryRadius = Math.min(radius, cameraFar * 0.9);
    const noiseCompensation = radius / geometryRadius;

    const skyColor = options.skyColor ?? new THREE.Color(0.53, 0.81, 0.92);
    const cloudColor = options.cloudColor ?? new THREE.Color(1.0, 1.0, 1.0);
    const fogColor = options.fogColor ?? new THREE.Color(0.75, 0.82, 0.92);

    // Dynamic uniforms
    this.timeUniform = tslUniform(0.0);
    this.sphereCenterUniform = tslUniform(position.clone());

    // Static TSL values
    const densityThreshold = float(density);
    const opacityVal = float(cloudOpacity);
    const scaleVal = float(scale);
    const skyCol = vec3(skyColor.r, skyColor.g, skyColor.b);
    const cloudCol = vec3(cloudColor.r, cloudColor.g, cloudColor.b);
    const fogCol = vec3(fogColor.r, fogColor.g, fogColor.b);

    const noiseInput = positionLocal.mul(float(noiseCompensation)).mul(float(0.05).div(scaleVal))
      .add(vec3(this.timeUniform.mul(0.02), 0, 0));

    const rawDensity = mx_fractal_noise_float(
      noiseInput, 4, float(2.0), float(0.5)
    ).mul(0.5).add(0.5);

    const d = tslSmoothstep(densityThreshold, densityThreshold.add(0.3), rawDensity);

    // Height factor
    const dir = normalize(positionWorld.sub(this.sphereCenterUniform));
    const heightFactor = dot(dir, vec3(0, 1, 0));

    const horizonBlend = float(1).sub(tslSmoothstep(float(-0.05), float(0.25), heightFactor));
    const cloudFade = tslSmoothstep(float(0), float(0.2), heightFactor);
    const fadedDensity = d.mul(cloudFade);

    // Color
    const baseColor = mix(skyCol, cloudCol, fadedDensity);
    const finalColor = mix(baseColor, fogCol, horizonBlend);

    // Alpha
    const baseAlpha = float(0.15);
    const finalAlpha = mix(baseAlpha.add(fadedDensity.mul(opacityVal)), float(1.0), horizonBlend);

    // --- Material ---
    this.material = new MeshBasicNodeMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
    });

    this.material.fragmentNode = vec4(finalColor, finalAlpha);

    const geometry = new THREE.SphereGeometry(geometryRadius, 32, 32);

    this.object = new THREE.Mesh(geometry, this.material);
    this.object.frustumCulled = false;
    this.object.renderOrder = -1;
    this.object.castShadow = false;
    this.object.receiveShadow = false;

    this.object.position.copy(position);
  }

  update(dt?: number) {
    // Uncomment to animate clouds:
    // this.timeUniform.value += 0.01;

    this.object.position.x = this.camera.position.x;
    this.object.position.z = this.camera.position.z;
    this.sphereCenterUniform.value.copy(this.object.position);
  }
}