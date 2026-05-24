/**
 * GrassShader.js — Blade geometry with lazy jittered-grid sampling
 *
 * Supports loaded GLB clump models or procedural single blades.
 * No alpha texture, no transparency overdraw.
 *
 * Chunked mode:
 *   - Init: bucket source mesh triangles into grid cells (fast)
 *   - Runtime: generate grass via jittered grid on first cell activation, then cache
 *   - Uniform distribution guaranteed by grid — no random clustering
 *
 * Usage:
 *   const assets = await GrassShader.loadAssets({
 *     modelPath: '/models/grassClump.glb',
 *     noisePath: '/textures/perlinnoise.webp',
 *   });
 *
 *   const grass = new GrassShader(roughMesh, assets, {
 *     density: 10,
 *     renderDistance: 50,
 *     cellSize: 5,
 *   });
 *   scene.add(grass.object);
 *   grass.update(dt, camera);
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js';

export type GrassAssets = {
  noiseTexture: THREE.Texture<HTMLImageElement, THREE.TextureEventMap>;
  geometry: THREE.BufferGeometry | null;
}

export type GrassShaderOptions = {
  bladeWidth?: number,
  bladeHeight?: number,
  scaleXZ?: number,
  scaleY?: number,
  lean?: number,
  heightVariation?: number,
  shadows?: boolean
  lightIntensity?: number,
  noiseScale?: number,
  renderDistance?: number,
  baseColor?: THREE.ColorRepresentation,
  tipColor1?: THREE.ColorRepresentation,
  tipColor2?: THREE.ColorRepresentation,
  layer?: number,
  cellSize?: number
  maxNewCellsPerFrame?: number
  density?: number  
}
/**
 * Blade geometry (procedural fallback)
 */
function createBladeGeometry() {
  const halfBase = 0.5;
  const halfTip = 0.08;

  const vertices = new Float32Array([
    -halfBase, 0, 0,
     halfBase, 0, 0,
     halfTip,  1, 0,
    -halfTip,  1, 0,
  ]);

  const uvs = new Float32Array([
    0, 0,  1, 0,  1, 1,  0, 1,
  ]);

  const normals = new Float32Array([
    0, 0, 1,  0, 0, 1,  0, 0, 1,  0, 0, 1,
  ]);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);

  return geo;
}

function createBladeMaterial(noiseTexture: GrassAssets['noiseTexture'], opts: GrassShaderOptions = {}) {
  const uniforms = {
    uGrassLightIntensity: { value: opts.lightIntensity ?? 1.0 },
    uNoiseScale:          { value: opts.noiseScale ?? 1.5 },
    uRenderDistance:      { value: opts.renderDistance ?? 0.0 },
    baseColor:            { value: new THREE.Color(opts.baseColor ?? '#3a5a20') },
    tipColor1:            { value: new THREE.Color(opts.tipColor1 ?? '#6a9a45') },
    tipColor2:            { value: new THREE.Color(opts.tipColor2 ?? '#4a7a30') },
    noiseTexture:         { value: noiseTexture },
  };

  const material = new THREE.MeshLambertMaterial({
    side: THREE.DoubleSide,
    transparent: true,
  });

  material.customProgramCacheKey = () => 'grass-blade-material';
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTipColor1           = uniforms.tipColor1;
    shader.uniforms.uTipColor2           = uniforms.tipColor2;
    shader.uniforms.uBaseColor           = uniforms.baseColor;
    shader.uniforms.uGrassLightIntensity = uniforms.uGrassLightIntensity;
    shader.uniforms.uNoiseScale          = uniforms.uNoiseScale;
    shader.uniforms.uNoiseTexture        = uniforms.noiseTexture;
    shader.uniforms.uRenderDistance      = uniforms.uRenderDistance;

    // ---- Vertex shader ----

    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      /* glsl */ `#include <common>
      uniform sampler2D uNoiseTexture;
      uniform float uNoiseScale;
      uniform float uRenderDistance;
      varying vec2 vBladeUV;
      varying vec2 vGlobalUV;
      varying float vDistanceFade;
      `,
    );

    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      /* glsl */ `
      #ifdef USE_INSTANCING
        vec4 grassWorldPos = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
      #else
        vec4 grassWorldPos = modelMatrix * vec4(transformed, 1.0);
      #endif

      float terrainSize = 100.0;
      vGlobalUV = (terrainSize - grassWorldPos.xz) / terrainSize;
      vBladeUV = uv;

      if (uRenderDistance > 0.0) {
        float distToCam = length(grassWorldPos.xz - cameraPosition.xz);
        vDistanceFade = 1.0 - smoothstep(uRenderDistance * 0.6, uRenderDistance, distToCam);
      } else {
        vDistanceFade = 1.0;
      }

      // Terrain backface culling — hide grass on surfaces facing away from camera
      vec3 surfaceNormal = normalize((modelMatrix * instanceMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
      vec3 viewDir = normalize(cameraPosition - grassWorldPos.xyz);
      if (dot(surfaceNormal, viewDir) < 0.0) {
        vDistanceFade = 0.0;
      }
      // Fade out grass too close to camera
      float nearDist = length(grassWorldPos.xyz - cameraPosition);
      vDistanceFade *= smoothstep(0.5, 2.0, nearDist);

      #include <project_vertex>
      `,
    );

    // ---- Fragment shader ----

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      /* glsl */ `#include <common>
      uniform vec3 uBaseColor;
      uniform vec3 uTipColor1;
      uniform vec3 uTipColor2;
      uniform sampler2D uNoiseTexture;
      uniform float uNoiseScale;
      uniform float uGrassLightIntensity;
      varying vec2 vBladeUV;
      varying vec2 vGlobalUV;
      varying float vDistanceFade;
      `,
    );

    // Override normal to point upward for correct shadow receiving
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_maps>',
      /* glsl */ `#include <normal_fragment_maps>
      normal = vec3(0.0, 1.0, 0.0);
      `,
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      /* glsl */ `
      if (vDistanceFade < 0.01) discard;

      vec4 grassVariation = texture2D(uNoiseTexture, vGlobalUV * uNoiseScale);
      vec3 tipColor = mix(uTipColor1, uTipColor2, grassVariation.r);

      diffuseColor.rgb = mix(uBaseColor, tipColor, 1.0 - vBladeUV.y) * uGrassLightIntensity;
      diffuseColor.a = vDistanceFade;
      `,
    );
  };

  return { material, uniforms };
}

/* ================================================================== */
/*  GrassShader                                                        */
/* ================================================================== */


export class GrassShader {
  static async loadAssets(paths: { noisePath: string, modelPath: string }): Promise<GrassAssets> {
    const texLoader = new THREE.TextureLoader();

    const noiseTexture = texLoader.load(paths.noisePath);
    noiseTexture.wrapS = noiseTexture.wrapT = THREE.RepeatWrapping;

    let geometry: THREE.BufferGeometry | null = null;
    if (paths.modelPath) {
      const gltfLoader = new GLTFLoader();
      geometry = await new Promise((resolve, reject) => {
        gltfLoader.load(paths.modelPath, (gltf) => {
          let geo: THREE.BufferGeometry | null = null;
          gltf.scene.traverse((child) => {
            if (!(child instanceof THREE.Mesh)) { return; }
            if (child.isMesh && !geo) geo = child.geometry;
          });
          geo ? resolve(geo) : reject(new Error('No mesh found in grass model'));
        }, undefined, reject);
      });
    }

    return { noiseTexture, geometry };
  }

  _uniforms: Record<string, any>;
  _material: THREE.MeshLambertMaterial;
  _geo: THREE.BufferGeometry;
  _heightVariation: number;
  _lean: number;
  _layer?: number;
  _object: THREE.Group;
  _worldMatrix: THREE.Matrix4;
  _shadows: boolean;
  _renderDistance: number;
  _cellSize: number;
  _maxNewPerFrame: number;
  _density: number;
  _meshPool: THREE.InstancedMesh[];
  _activeCells: Map<string, any>;
  _cellCache: Map<string, any>;
  _cellTriangles: Map<string, any>;

  constructor(sourceMesh: THREE.Mesh, assets: GrassAssets, opts: GrassShaderOptions = {}) {
    const bladeWidth  = opts.bladeWidth  ?? 0.025;
    const bladeHeight = opts.bladeHeight ?? 0.08;

    const { material, uniforms } = createBladeMaterial(assets.noiseTexture, opts);
    this._uniforms = uniforms;
    this._material = material;
    this._shadows = opts.shadows ?? true;
    this._renderDistance = opts.renderDistance ?? 40;

    const scaleXZ = opts.scaleXZ ?? 1;
    const scaleY  = opts.scaleY ?? 1;

    if (assets.geometry) {
      this._geo = assets.geometry.clone();
      this._geo.scale(scaleXZ, scaleY, scaleXZ);
    } else {
      this._geo = createBladeGeometry();
      this._geo.scale(bladeWidth * scaleXZ, bladeHeight * scaleY, bladeWidth * scaleXZ);
    }
    
    this._heightVariation = opts.heightVariation ?? 0.4;
    this._lean = opts.lean ?? 0.3;
    this._layer = opts.layer;


    this._cellSize = opts.cellSize ?? 5;
    this._maxNewPerFrame = opts.maxNewCellsPerFrame ?? 15;
    this._density = opts.density ?? 10;

    this._object = new THREE.Group();
    this._meshPool = [];
    this._activeCells = new Map();
    this._cellCache = new Map();
    this._cellTriangles = new Map();

    sourceMesh.updateWorldMatrix(true, false);
    
    this._worldMatrix = sourceMesh.matrixWorld.clone();

    this._initChunked(sourceMesh);
  }

  get object() { return this._object; }
  get mesh() { return this._object; }

  update(dt: number, camera: THREE.Camera) {
    if (camera) {
      this._updateChunks(camera);
    }
  }

  set baseColor(hex: number)    { this._uniforms.baseColor.value.set(hex); }
  set tipColor1(hex: number)    { this._uniforms.tipColor1.value.set(hex); }
  set tipColor2(hex: number)    { this._uniforms.tipColor2.value.set(hex); }
  set lightIntensity(v: number) { this._uniforms.uGrassLightIntensity.value = v; }
  set noiseScale(v: number)     { this._uniforms.uNoiseScale.value = v; }

  dispose() {
    this._geo.dispose();
    this._material.dispose();
    for (const m of this._activeCells.values()) m.dispose();
    for (const m of this._meshPool) m.dispose();
  }

  /* ================================================================ */
  /*  Chunked mode — lazy jittered-grid sampling                       */
  /* ================================================================ */

  _initChunked(sourceMesh: THREE.Mesh) {
    const cs = this._cellSize;
    const geo = sourceMesh.geometry;
    const pos = geo.attributes.position;
    const nor = geo.attributes.normal;
    const idx = geo.index;
    const triCount = idx ? idx.count / 3 : pos.count / 3;

    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const na = new THREE.Vector3();
    const nb = new THREE.Vector3();
    const nc = new THREE.Vector3();

    for (let t = 0; t < triCount; t++) {
      const i0 = idx ? idx.getX(t * 3)     : t * 3;
      const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;

      a.fromBufferAttribute(pos, i0);
      b.fromBufferAttribute(pos, i1);
      c.fromBufferAttribute(pos, i2);

      if (nor) {
        na.fromBufferAttribute(nor, i0);
        nb.fromBufferAttribute(nor, i1);
        nc.fromBufferAttribute(nor, i2);
      } else {
        const ab = new THREE.Vector3().subVectors(b, a);
        const ac = new THREE.Vector3().subVectors(c, a);
        na.crossVectors(ab, ac).normalize();
        nb.copy(na);
        nc.copy(na);
      }

      const wa = a.clone().applyMatrix4(this._worldMatrix);
      const wb = b.clone().applyMatrix4(this._worldMatrix);
      const wc = c.clone().applyMatrix4(this._worldMatrix);

      // Assign triangle to ALL cells its bbox overlaps
      const minCX = Math.floor(Math.min(wa.x, wb.x, wc.x) / cs);
      const maxCX = Math.floor(Math.max(wa.x, wb.x, wc.x) / cs);
      const minCZ = Math.floor(Math.min(wa.z, wb.z, wc.z) / cs);
      const maxCZ = Math.floor(Math.max(wa.z, wb.z, wc.z) / cs);

      for (let gx = minCX; gx <= maxCX; gx++) {
        for (let gz = minCZ; gz <= maxCZ; gz++) {
          const key = gx + ',' + gz;
          let cell = this._cellTriangles.get(key);
          if (!cell) {
            cell = { localVerts: [], norms: [], worldVerts: [] };
            this._cellTriangles.set(key, cell);
          }
          cell.localVerts.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
          cell.norms.push(na.x, na.y, na.z, nb.x, nb.y, nb.z, nc.x, nc.y, nc.z);
          cell.worldVerts.push(wa.x, wa.y, wa.z, wb.x, wb.y, wb.z, wc.x, wc.y, wc.z);
        }
      }
    }

    console.log(
      `[GrassShader] chunked: "${sourceMesh.name}" ` +
      `${this._cellTriangles.size} cells, density=${this._density}, cellSize=${cs}`
    );

    this._object.matrixAutoUpdate = false;
    this._object.matrix.copy(this._worldMatrix);
    this._object.matrixWorldNeedsUpdate = true;
  }

  _generateCell(key: string) {
    const cell = this._cellTriangles.get(key);
    if (!cell) return null;

    const { localVerts, norms, worldVerts } = cell;
    const triCount = localVerts.length / 9;
    const spacing = 1 / Math.sqrt(this._density);
    const jitter = spacing * 0.4;
    const cs = this._cellSize;
    const floats = [];

    // Cell bounds
    const parts = key.split(',');
    const cellMinX = parseInt(parts[0]) * cs;
    const cellMaxX = cellMinX + cs;
    const cellMinZ = parseInt(parts[1]) * cs;
    const cellMaxZ = cellMinZ + cs;

    // Reusable temp objects
    const position = new THREE.Vector3();
    const normal = new THREE.Vector3();
    const na = new THREE.Vector3();
    const nb = new THREE.Vector3();
    const nc = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const yRot = new THREE.Quaternion();
    const leanQuat = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const yAxis = new THREE.Vector3(0, 1, 0);
    const scaleVec = new THREE.Vector3();
    const mat = new THREE.Matrix4();

    // Precompute barycentric data for all triangles
    const triData = [];
    for (let ti = 0; ti < triCount; ti++) {
      const wi = ti * 9;
      const wax = worldVerts[wi],   waz = worldVerts[wi+2];
      const wbx = worldVerts[wi+3], wbz = worldVerts[wi+5];
      const wcx = worldVerts[wi+6], wcz = worldVerts[wi+8];

      const v0x = wbx - wax, v0z = wbz - waz;
      const v1x = wcx - wax, v1z = wcz - waz;
      const d00 = v0x * v0x + v0z * v0z;
      const d01 = v0x * v1x + v0z * v1z;
      const d11 = v1x * v1x + v1z * v1z;
      const det = d00 * d11 - d01 * d01;
      if (Math.abs(det) < 1e-10) continue;

      triData.push({ ti, wax, waz, v0x, v0z, v1x, v1z, d00, d01, d11, invDenom: 1 / det });
    }

    // Iterate a uniform grid across the cell, find containing triangle per point
    const startX = Math.floor(cellMinX / spacing) * spacing;
    const startZ = Math.floor(cellMinZ / spacing) * spacing;

    for (let gx = startX; gx <= cellMaxX; gx += spacing) {
      for (let gz = startZ; gz <= cellMaxZ; gz += spacing) {
        const px = gx + (Math.random() - 0.5) * jitter * 2;
        const pz = gz + (Math.random() - 0.5) * jitter * 2;

        if (px < cellMinX || px >= cellMaxX || pz < cellMinZ || pz >= cellMaxZ) continue;

        // Find which triangle contains this point
        let found = false;
        for (let t = 0; t < triData.length; t++) {
          const td = triData[t];
          const v2x = px - td.wax, v2z = pz - td.waz;
          const d02 = td.v0x * v2x + td.v0z * v2z;
          const d12 = td.v1x * v2x + td.v1z * v2z;

          const bv = (td.d11 * d02 - td.d01 * d12) * td.invDenom;
          const bw = (td.d00 * d12 - td.d01 * d02) * td.invDenom;
          const bu = 1 - bv - bw;

          if (bu < 0 || bv < 0 || bw < 0) continue;

          // Found containing triangle — interpolate position in local space
          const li = td.ti * 9;
          const ni = td.ti * 9;

          position.set(
            bu * localVerts[li]   + bv * localVerts[li+3] + bw * localVerts[li+6],
            bu * localVerts[li+1] + bv * localVerts[li+4] + bw * localVerts[li+7],
            bu * localVerts[li+2] + bv * localVerts[li+5] + bw * localVerts[li+8],
          );

          na.set(norms[ni], norms[ni+1], norms[ni+2]);
          nb.set(norms[ni+3], norms[ni+4], norms[ni+5]);
          nc.set(norms[ni+6], norms[ni+7], norms[ni+8]);

          normal.set(
            bu * na.x + bv * nb.x + bw * nc.x,
            bu * na.y + bv * nb.y + bw * nc.y,
            bu * na.z + bv * nb.z + bw * nc.z,
          ).normalize();

          // Build instance matrix
          quat.setFromUnitVectors(yAxis, normal);
          yRot.setFromEuler(euler.set(0, Math.random() * Math.PI * 2, 0));
          quat.multiply(yRot);

          const lean = (Math.random() - 0.5) * 2 * this._lean;
          const leanDir = Math.random() * Math.PI * 2;
          leanQuat.setFromEuler(euler.set(
            Math.sin(leanDir) * lean, 0, Math.cos(leanDir) * lean,
          ));
          quat.multiply(leanQuat);

          const hVar = 1.0 + (Math.random() - 0.5) * 2 * this._heightVariation;
          scaleVec.set(1, hVar, 1);

          mat.compose(position, quat, scaleVec);
          const elements = mat.elements;
          for (let j = 0; j < 16; j++) floats.push(elements[j]);

          found = true;
          break;
        }
      }
    }

    if (floats.length === 0) return null;
    return new Float32Array(floats);
  }

  _updateChunks(camera: THREE.Camera) {
    const cs = this._cellSize;
    const rd = this._renderDistance;
    const hr = Math.ceil(rd / cs);
    const camX = camera.position.x;
    const camZ = camera.position.z;
    const ccx = Math.floor(camX / cs);
    const ccz = Math.floor(camZ / cs);

    const want = new Set();
    const toActivate = [];

    for (let dx = -hr; dx <= hr; dx++) {
      for (let dz = -hr; dz <= hr; dz++) {
        const kx = ccx + dx;
        const kz = ccz + dz;
        const key = kx + ',' + kz;
        if (!this._cellTriangles.has(key)) continue;

        const dist = Math.hypot((kx + 0.5) * cs - camX, (kz + 0.5) * cs - camZ);
        if (dist > rd) continue;

        want.add(key);
        if (!this._activeCells.has(key)) {
          toActivate.push({ key, dist });
        }
      }
    }

    if (toActivate.length) {
      toActivate.sort((a, b) => a.dist - b.dist);
      const n = Math.min(this._maxNewPerFrame, toActivate.length);
      for (let i = 0; i < n; i++) {
        this._activateCell(toActivate[i].key);
      }
    }

    for (const [key, mesh] of this._activeCells) {
      if (!want.has(key)) {
        mesh.parent.remove(mesh);
        mesh.visible = false;
        this._meshPool.push(mesh);
        this._activeCells.delete(key);
      }
    }
  }

  _activateCell(key: string) {
    let data = this._cellCache.get(key);
    if (!data) {
      data = this._generateCell(key);
      if (!data) return;
      this._cellCache.set(key, data);
    }

    const count = data.length / 16;
    const bufferSize = Math.ceil(this._density * this._cellSize * this._cellSize * 1.5);

    let mesh: THREE.InstancedMesh | undefined;
    if (this._meshPool.length) {
      mesh = this._meshPool.pop();
      if (mesh?.instanceMatrix?.array && mesh.instanceMatrix.array.length < count * 16) {
        mesh.dispose();
        mesh = this._createInstancedMesh(Math.max(count, bufferSize));
      }
    } else {
      mesh = this._createInstancedMesh(Math.max(count, bufferSize));
    }

    if (!mesh) {
      throw new Error('Unable to create instanced mesh in mesh pool');
    }
    mesh.count = count;
    mesh.instanceMatrix.set(data);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.visible = true;

    // Apply world transform directly (not via parent Group) for shadow compatibility
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(this._worldMatrix);
    mesh.matrixWorldNeedsUpdate = true;

    this._activeCells.set(key, mesh);
    this._object?.parent?.add(mesh);
  }

  /* ================================================================ */
  /*  Shared helpers                                                    */
  /* ================================================================ */

  _createInstancedMesh(count: number) {
    const mesh = new THREE.InstancedMesh(this._geo, this._material, count);
    mesh.receiveShadow = this._shadows;
    mesh.frustumCulled = true;
    if (this._layer !== undefined) mesh.layers.set(this._layer);
    return mesh;
  }

  _buildBladeMatrix(position: THREE.Vector3, normal: THREE.Vector3) {
    const quat = new THREE.Quaternion();
    const yAxis = new THREE.Vector3(0, 1, 0);

    quat.setFromUnitVectors(yAxis, normal);

    const yRot = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0, Math.random() * Math.PI * 2, 0),
    );
    quat.multiply(yRot);

    const lean = (Math.random() - 0.5) * 2 * this._lean;
    const leanDir = Math.random() * Math.PI * 2;
    const leanQuat = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(
        Math.sin(leanDir) * lean,
        0,
        Math.cos(leanDir) * lean,
      ),
    );
    quat.multiply(leanQuat);

    const hVar = 1.0 + (Math.random() - 0.5) * 2 * this._heightVariation;
    const scale = new THREE.Vector3(1, hVar, 1);

    const mat = new THREE.Matrix4();
    mat.compose(position, quat, scale);
    return mat;
  }

  _scatterBlades(sourceMesh: THREE.Mesh, instancedMesh: THREE.InstancedMesh, count: number) {
    const sampler = new MeshSurfaceSampler(sourceMesh).build();
    const position = new THREE.Vector3();
    const normal = new THREE.Vector3();

    for (let i = 0; i < count; i++) {
      sampler.sample(position, normal);
      const mat = this._buildBladeMatrix(position, normal);
      instancedMesh.setMatrixAt(i, mat);
    }
    instancedMesh.instanceMatrix.needsUpdate = true;
    console.log(`[GrassShader] ${count} blades on "${sourceMesh.name}"`);
  }

  static _getSurfaceArea(mesh: THREE.Mesh) {
    mesh.updateWorldMatrix(true, false);
    const matrix = mesh.matrixWorld;
    const geo = mesh.geometry;
    const pos = geo.attributes.position;
    const idx = geo.index;
    const triCount = idx ? idx.count / 3 : pos.count / 3;

    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const ab = new THREE.Vector3();
    const ac = new THREE.Vector3();
    const cross = new THREE.Vector3();
    let total = 0;

    for (let t = 0; t < triCount; t++) {
      const i0 = idx ? idx.getX(t * 3)     : t * 3;
      const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;

      a.fromBufferAttribute(pos, i0).applyMatrix4(matrix);
      b.fromBufferAttribute(pos, i1).applyMatrix4(matrix);
      c.fromBufferAttribute(pos, i2).applyMatrix4(matrix);

      ab.subVectors(b, a);
      ac.subVectors(c, a);
      cross.crossVectors(ab, ac);
      total += cross.length() * 0.5;
    }

    return total;
  }
}