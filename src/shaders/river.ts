import * as THREE from 'three';
import { MeshPhysicalNodeMaterial } from 'three/webgpu';
import {
  texture, uv, uniform,
  vec2, float,
  fract, abs, mix, clamp, pow, sub, dot, normalize,
  positionWorld, normalWorld, cameraPosition,
  normalMap,
} from 'three/tsl';
import normals from '@/images/waternormals.jpg';

type RiverSurfaceOptions = {
  speed?: number;
  flowStrength?: number;
  uvTiling?: [number, number];
  normalStrength?: number;
  shallowColor?: THREE.Color;
  deepColor?: THREE.Color;
  opacity?: number;
  roughness?: number;
};

type FlowMapData = { data: ImageDataArray, width: number, height: number };

export class RiverSurface {
  material: MeshPhysicalNodeMaterial;
  water: THREE.Mesh;
  speed: number;
  private timeUniform: any;
  
  constructor(
    waterObject: THREE.Mesh,
    flowMapData?: FlowMapData,
    options: RiverSurfaceOptions = {}
  ) {

    // Initialize these first, before the TSL setup
    this.material = new MeshPhysicalNodeMaterial({
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    // this.mesh = new THREE.Mesh(geometry.clone(), this.material);
    this.water = new THREE.Mesh(waterObject.geometry.clone(), this.material);
    this.water.position.set(this.water.position.x, this.water.position.y - 0.45, this.water.position.z);

    this.timeUniform = uniform(0);

    // Recompute UVs to [0,1] range for flow map alignment
    const pos = this.water.geometry.attributes.position;
    const uvAttr = new Float32Array(pos.count * 2);
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      if (x < minX) minX = x;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (z > maxZ) maxZ = z;
    }

    const rangeX = maxX - minX || 1;
    const rangeZ = maxZ - minZ || 1;

    for (let i = 0; i < pos.count; i++) {
      uvAttr[i * 2]     = (pos.getX(i) - minX) / rangeX;
      uvAttr[i * 2 + 1] = (pos.getZ(i) - minZ) / rangeZ;
    }

    this.water.geometry.setAttribute('uv', new THREE.BufferAttribute(uvAttr, 2));
    console.log('[FLOWMAP] Mesh bounds:', JSON.stringify({ minX, minZ, maxX, maxZ: maxZ }));

    const opts = {
      speed: 0.25,
      flowStrength: 0.15,
      uvTiling: [6, 6] as [number, number],
      normalStrength: 1.0,
      shallowColor: new THREE.Color('#243f42'),
      deepColor: new THREE.Color('#0a3a5c'),
      opacity: 0.7,
      roughness: 0.15,
      ...options,
    };
    this.speed = opts.speed;
    
    // --- Uniforms ---
    const flowSpeed      = uniform(opts.speed);
    const flowStrength   = uniform(opts.flowStrength);
    const tileSize = Math.min(rangeX, rangeZ) / opts.uvTiling[0];
    const tiling = uniform(new THREE.Vector2(rangeX / tileSize, rangeZ / tileSize));

    const normStrength   = uniform(opts.normalStrength);

    // --- Textures ---
    const textureLoader = new THREE.TextureLoader();
    const waterNormalTex = textureLoader.load(normals, (tex) => {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    });

    let flowMapTexture: THREE.DataTexture;

    if (flowMapData) {
      flowMapTexture = new THREE.DataTexture(
        new Uint8Array(flowMapData.data),
        flowMapData.width,
        flowMapData.height,
        THREE.RGBAFormat
      );
    } else {
      // Default: uniform flow in -Y direction, full speed
      flowMapTexture = new THREE.DataTexture(
        new Uint8Array([128, 255, 255, 255]),
        1, 1,
        THREE.RGBAFormat
      );
    }

    flowMapTexture.needsUpdate = true;
    flowMapTexture.minFilter = THREE.LinearFilter;
    flowMapTexture.magFilter = THREE.LinearFilter;

    // flowMapTexture.flipY = true;
    flowMapTexture.wrapS = flowMapTexture.wrapT = THREE.ClampToEdgeWrapping;

    
    const baseUV = uv();
    // Decode flow direction
    const flow = texture(flowMapTexture, baseUV).rg
      .sub(0.5)
      .mul(2.0)
      .mul(flowStrength)
      .negate();

    // Speed from blue channel
    const speed = texture(flowMapTexture, baseUV).b;

    // --- Dual-phase time (prevents scroll reset pop) ---
    // const t = this.timeUniform.mul(flowSpeed).mul(speed);
    const t = this.timeUniform.mul(flowSpeed);

    // const t = time.mul(flowSpeed).mul(speed);
    const phase0 = fract(t);
    const phase1 = fract(t.add(0.5));
    const blend = abs(phase0.mul(2.0).sub(1.0)); // triangle wave 0→1→0

    // --- Sample water normals at two offset UVs and blend ---
    const tiledUV = baseUV.mul(tiling);
    const uv0 = tiledUV.add(flow.mul(speed).mul(phase0));
    const uv1 = tiledUV.add(flow.mul(speed).mul(phase1));

    const n0 = texture(waterNormalTex, uv0);
    const n1 = texture(waterNormalTex, uv1);
    const blendedNormals = mix(n0, n1, blend);

    // Second layer: smaller ripples, different speed and angle for turbulence
    const detailTiling = uniform(new THREE.Vector2(rangeX / tileSize * 2.3, rangeZ / tileSize * 2.3));
    const detailTime = this.timeUniform.mul(0.37); // different speed
    const detailPhase0 = fract(detailTime);
    const detailPhase1 = fract(detailTime.add(0.5));
    const detailBlend = abs(detailPhase0.mul(2.0).sub(1.0));
    const detailFlow = flow.mul(0.7).add(vec2(0.1, 0.05)); // slightly offset direction
    const detailUV = baseUV.mul(detailTiling);
    const d0 = texture(waterNormalTex, detailUV.add(detailFlow.mul(detailPhase0)));
    const d1 = texture(waterNormalTex, detailUV.add(detailFlow.mul(detailPhase1)));
    const detailNormals = mix(d0, d1, detailBlend);

    // Combine both layers
    const combinedNormals = mix(blendedNormals, detailNormals, 0.2);
    this.material.normalNode = normalMap(combinedNormals, vec2(normStrength));

    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const NdotV = clamp(dot(normalWorld, viewDir), 0.0, 1.0);
    const fresnel = pow(sub(float(1.0), NdotV), float(3.0));
    this.material.opacityNode = clamp(
      mix(float(0.6), float(0.95), fresnel),
      0.0, 1.0
    );

    this.material.color = opts.shallowColor;
    this.material.roughness = 0.15;
    this.material.metalness = 0.0;
    this.material.specularIntensity = 1.0;
    this.material.specularColor = new THREE.Color(0xffffff);
    this.material.envMapIntensity = 0.5;

  }

  updateEnvironment(envMap: THREE.Texture) {
    this.material.envMap = envMap;
    this.material.needsUpdate = true;
  }
  
  update(_dt?: number) {
    this.timeUniform.value += this.speed / 60.0;
  }
}
