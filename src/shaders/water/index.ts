import * as THREE from 'three/webgpu';
import { MeshPhysicalNodeMaterial } from 'three/webgpu';
import {
  texture, uv, uniform,
  vec2, vec3, float,
  fract, abs, mix, clamp, pow, sub, dot, normalize,
  positionWorld, normalWorld, cameraPosition,
  normalMap, pmremTexture,
  viewportDepthTexture, linearDepth, smoothstep as tslSmoothstep, step,
  cameraNear, cameraFar
} from 'three/tsl';
import normals from '@/images/waternormals.jpg';

export type WaterSurfaceOptions = {
  speed?: number;
  flowStrength?: number;
  sideFlowStrength?: number;
  envMapIntensity?: number;
  uvTiling?: [number, number];
  normalStrength?: number;
  shallowColor?: THREE.Color;
  deepColor?: THREE.Color;
  specularColor?: THREE.Color;
  opacity?: number;
  roughness?: number;
  yOffset?: number;
  depthRange?: number;
  foamWidth?: number;
  foamColor?: THREE.Color;
  foamDensity?: number;
  foamSharpness?: number;
  foamOpacity?: number;
};

export type FlowMapData = { data: ImageDataArray, width: number, height: number };

export class WaterSurface {
  material: MeshPhysicalNodeMaterial;
  water: THREE.Mesh;
  speed: number;
  private timeUniform: any;
  
  constructor(
    waterObject: THREE.Mesh,
    flowMapData?: FlowMapData,
    options: WaterSurfaceOptions = {}
  ) {

    // Initialize these first, before the TSL setup
    this.material = new MeshPhysicalNodeMaterial({
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    // this.mesh = new THREE.Mesh(geometry.clone(), this.material);
    this.water = new THREE.Mesh(waterObject.geometry.clone(), this.material);
    if (options.yOffset) {
      this.water.position.set(this.water.position.x, this.water.position.y - options.yOffset, this.water.position.z);
    }

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
      sideFlowStrength: 0.2,
      envMapIntensity: 0.5,
      uvTiling: [6, 6] as [number, number],
      normalStrength: 1.0,
      shallowColor: new THREE.Color('#243f42'),
      deepColor: new THREE.Color('#0a1f2a'),
      specularColor: new THREE.Color('#ffffff'),
      opacity: 0.7,
      roughness: 0.15,
      depthRange: 5.0,
      foamWidth: 1,
      foamColor: new THREE.Color('#7a9889'),
      foamDensity: 0.98,
      foamSharpness: 0.25,
      foamOpacity: 0.2,
      ...options,
    };
    this.speed = opts.speed;
    
    // --- Uniforms ---
    const flowSpeed      = float(opts.speed);
    const flowStrength   = float(opts.flowStrength);
    const sideFlowStrength   = float(opts.sideFlowStrength);
    const tileSize = Math.min(rangeX, rangeZ) / opts.uvTiling[0];
    const tiling = vec2(rangeX / tileSize, rangeZ / tileSize);

    // const normStrength   = uniform(opts.normalStrength);
    const normStrength   = float(opts.normalStrength);

    // --- Textures ---
    const textureLoader = new THREE.TextureLoader();
    // const waterNormalTex = textureLoader.load(normals, (tex) => {
    //   tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    // });
    const waterNormalTex = textureLoader.load(normals, () => {
      this.material.needsUpdate = true;
    });
    waterNormalTex.wrapS = waterNormalTex.wrapT = THREE.RepeatWrapping;

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
        new Uint8Array([160, 180, 200, 255]),
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
    const detailTiling = vec2(rangeX / tileSize * 2.3, rangeZ / tileSize * 2.3);
    const detailTime = this.timeUniform.mul(0.23); // different speed
    const detailPhase0 = fract(detailTime);
    const detailPhase1 = fract(detailTime.add(0.5));
    const detailBlend = abs(detailPhase0.mul(2.0).sub(1.0));
    // const detailFlow = flow.mul(0.7).add(vec2(0.1, 0.05)); // slightly offset direction
     // Swap and negate to get perpendicular direction
    const detailFlow = vec2(flow.y.negate(), flow.x).mul(0.5);
    const detailUV = baseUV.mul(detailTiling);
    const d0 = texture(waterNormalTex, detailUV.add(detailFlow.mul(detailPhase0)));
    const d1 = texture(waterNormalTex, detailUV.add(detailFlow.mul(detailPhase1)));
    const detailNormals = mix(d0, d1, detailBlend);

    // Combine both layers
    const combinedNormals = mix(blendedNormals, detailNormals, sideFlowStrength);
    this.material.normalNode = normalMap(combinedNormals, vec2(normStrength));

    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const NdotV = clamp(dot(normalWorld, viewDir), 0.0, 1.0);
    const fresnel = pow(sub(float(1.0), NdotV), float(3.0));


    const sceneDepth = linearDepth(viewportDepthTexture());
    // const waterDepth = linearDepth(positionView.z.negate());
    // const depthDiff = sceneDepth.sub(waterDepth).max(0);

    const waterDepth = linearDepth();
    const depthDiff = sceneDepth.sub(waterDepth).max(0).mul(cameraFar);

    // const depthDiff = sceneDepth.sub(waterDepth).max(0).mul(cameraFar);

    // Shallow → transparent, deep → opaque
    const depthFade = tslSmoothstep(float(0), float(opts.depthRange), depthDiff);
    // Combine depth fade with fresnel: shallow water is more transparent
    const baseOpacity = mix(float(0.05), float(opts.opacity), depthFade);
    this.material.opacityNode = clamp(
      mix(baseOpacity, float(0.95), fresnel),
      0.0, 1.0
    );

    // this.material.opacityNode = clamp(
    //   // mix(float(0.6), float(0.95), fresnel),
    //   mix(float(opts.opacity), float(0.95), fresnel),
    //   0.0, 1.0
    // );

    // this.material.color = opts.shallowColor;

    // Shallow → light color, deep → dark color
    const shallowCol = vec3(opts.shallowColor.r, opts.shallowColor.g, opts.shallowColor.b);
    const deepCol = vec3(opts.deepColor.r, opts.deepColor.g, opts.deepColor.b);
    const waterColor = mix(shallowCol, deepCol, depthFade);

    // --- Edge foam ---
    const foamThreshold = float(opts.foamWidth);
    const foamFactor = tslSmoothstep(foamThreshold, float(0), depthDiff);
    // // const foamNoise = texture(waterNormalTex, tiledUV.mul(3.0)).r;
    // const foamN0 = texture(waterNormalTex, uv0.mul(1.5)).r;
    // const foamN1 = texture(waterNormalTex, uv1.mul(1.5)).r;
    // const foamNoise = mix(foamN0, foamN1, blend);

    // // const foam = foamFactor.mul(step(foamNoise, foamFactor));

    // const edgeStability = pow(foamFactor, float(0.5));
    // const foamPattern = mix(foamNoise, float(0.85), edgeStability);
    // const foam = foamFactor.mul(foamPattern);

    // Two noise scales for organic bubble pattern
    const foamN0_a = texture(waterNormalTex, uv0.mul(1.5)).r;
    const foamN1_a = texture(waterNormalTex, uv1.mul(1.5)).r;
    const foamLarge = mix(foamN0_a, foamN1_a, blend);

    const foamN0_b = texture(waterNormalTex, uv0.mul(4.0)).g;
    const foamN1_b = texture(waterNormalTex, uv1.mul(4.0)).g;
    const foamSmall = mix(foamN0_b, foamN1_b, blend);

    // Multiply two noise layers — creates cellular-like clumps
    const foamNoise = foamLarge.mul(foamSmall);

    // Threshold test: noise must exceed a cutoff to become foam.
    // At the edge (foamFactor=1), cutoff is low (0.15) → lots of foam patches.
    // Away from edge (foamFactor=0), cutoff is 1.0 → no foam.
    // const foamCutoff = float(1.0).sub(foamFactor.mul(0.85));
    // const foamPatches = tslSmoothstep(foamCutoff, foamCutoff.add(0.05), foamNoise);
    const foamCutoff = float(1.0).sub(foamFactor.mul(opts.foamDensity));
    const foamPatches = tslSmoothstep(foamCutoff, foamCutoff.add(opts.foamSharpness), foamNoise);

    const foam = foamPatches.mul(opts.foamOpacity);

    const foamCol = vec3(opts.foamColor.r, opts.foamColor.g, opts.foamColor.b);

    // this.material.colorNode = mix(waterColor, foamCol, foam);
    // this.material.colorNode = waterColor;
    
    // this.material.colorNode = vec3(depthFade);

    // DEBUG: visualize raw depth difference at different scales
    // const rawDepth = sceneDepth.sub(waterDepth).max(0);
    // this.material.colorNode = vec3(rawDepth.mul(10000.0));
    // const rawDepth = viewportDepthTexture();
    // this.material.colorNode = vec3(float(rawDepth), float(rawDepth), float(rawDepth));
    // this.material.colorNode = waterColor;
    this.material.colorNode = mix(waterColor, foamCol, foam);

    this.material.roughness = opts.roughness;
    this.material.metalness = 0.0;
    this.material.specularIntensity = 1.0;
    this.material.specularColor = opts.specularColor;
    this.material.envMapIntensity = opts.envMapIntensity;
    // this.material.emissive = opts.shallowColor.clone().multiplyScalar(0.15);
    this.material.emissive = opts.shallowColor.clone().multiplyScalar(0.15);
    

  }

  updateEnvironment(envMap: THREE.Texture) {
    this.material.envMap = envMap;
    this.material.envNode = pmremTexture(envMap);
    this.material.needsUpdate = true;
    console.log('updateEnvironment called, envMap:', envMap);
  }
  
  update(_dt?: number) {
    this.timeUniform.value += this.speed / 60.0;
  }
}
