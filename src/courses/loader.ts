import * as THREE from 'three';
import { type World } from '@dimforge/rapier3d-compat';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import EventEmitter from 'eventemitter3';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';

import { getAverageTextureColor, getTextureImageData } from '@/utils/image';
import { TreeGroup, TreePlanter } from '@/trees';
import { TargetShaderMaterial } from '@/shaders/target';
import { SandMaterial } from '@/shaders/sand';
import { GrassAssets, GrassShader } from '@/shaders/grass';
import { FlagStick } from '@/objects/flagStick';
import { type ShotPerspectiveCamera } from '@/camera';
import { CourseSurfaceProperties, CourseSurfaces, isCourseSurfaceType } from '@/courses/surfaces';
import perlinNoise from '@/images/perlinnoise.webp?url';
import { isMeshObject } from '@/utils/mesh';
import grassBladesModel from '@/models/grassBlades.glb?url';
import golfCupModel from '@/models/golfCup.glb?url';
import { QualityMode } from '@/utils/quality';
import { DefaultGimmeDistances } from '@/utils/data';
import { Hole } from './types';
import { LakeSurface, RiverSurface, VolumetricClouds } from '@/shaders';
import { FuseRenderer } from '@/renderer';
import { type GolfBall } from '@/objects/golfBall';
import { PuttingGridMaterial } from '@/shaders/putting';
import { SkyBox } from '@/sky';
import { CourseLight } from '@/lights';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const defaultSkyColor = 'rgb(177, 205, 236)';
const defaultFogColor = 'rgb(255, 247, 224)';
const defaultCloudColor = 'rgb(255, 255, 255)';

export type CourseMapSource = {
  blob: Blob;          // original compressed JPEG (~1MB) — kept for region decodes
  fullW: number;       // native dimensions (4096)
  fullH: number;
  overview: ImageBitmap; // small whole-course bitmap for zoomed-out view
};

export interface SceneSettings {
  sky?: {
    type?: 'clouds' | 'hdri';
    clouds?: {
      skyColor?: string;
      fogColor?: string;
      cloudColor?: string;
      density?: number;
      opacity?: number;
      scale?: number;
      position?: number[];
    };
  }
}

interface CourseLoaderProgressEvent {
  percent: number,
  itemsLoaded: number,
  itemsTotal: number
}

interface CourseLoaderEvents {
  progress: (progress: CourseLoaderProgressEvent) => void
}

type MeshLoaderOptions = {
  ktx2Path?: string;
}
export class MeshLoader extends EventEmitter<CourseLoaderEvents> {
  gltfLoader: GLTFLoader;
  
  constructor(renderer: FuseRenderer, manager?: THREE.LoadingManager, options: MeshLoaderOptions = {}) {
    super();
    const ktx2Path = options.ktx2Path ?? '/ktx2/';
    const ktx2Loader = new KTX2Loader().setTranscoderPath(ktx2Path).detectSupport(renderer.renderer);
    this.gltfLoader = new GLTFLoader(manager);
    this.gltfLoader.setKTX2Loader(ktx2Loader);
  }
  
  async load(meshUri: string, firstMeshOnly?: false): Promise<THREE.Group>;
  async load(meshUri: string, firstMeshOnly: true): Promise<THREE.Mesh | undefined>;
  async load(meshUri: string, firstMeshOnly = false): Promise<THREE.Mesh | THREE.Group | undefined> {
    const model = await this.gltfLoader.loadAsync(meshUri);
    if (!firstMeshOnly) {
      return model.scene;
    }
    let mesh: THREE.Mesh | undefined;
    model.scene.traverse((child) => {
      if (isMeshObject(child) && !mesh) mesh = child;
    });
    if (!mesh) {
      return;
    }
    return mesh;
  }
  async fetchWithResume(
    url: string,
    chunkSize = 8 * 1024 * 1024,
    maxRetries = 5
  ): Promise<ArrayBuffer> {
    // const head = await fetch(url, { method: 'HEAD' });
    // const total = parseInt(head.headers.get('content-length') ?? '0', 10);
    // if (!total) throw new Error(`No content-length for ${url}`);
    let total = 0;
    let supportsRanges = false;

    try {
      const head = await fetch(url, { method: 'HEAD' });
      total = parseInt(head.headers.get('content-length') ?? '0', 10);
      supportsRanges = head.headers.get('accept-ranges') === 'bytes';
    } catch {
      // HEAD unsupported (e.g. electron custom protocol) — use plain fetch
    }

    // Fallback: single plain request (local files, no range support)
    if (!total || !supportsRanges) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.arrayBuffer();
    }

    const buffer = new Uint8Array(total);
    let offset = 0;

    while (offset < total) {
      const end = Math.min(offset + chunkSize, total) - 1;
      let attempt = 0;
      for (;;) {
        try {
          const res = await fetch(url, { headers: { Range: `bytes=${offset}-${end}` } });
          if (res.status === 200) return res.arrayBuffer(); // server ignored Range
          if (res.status !== 206 && !res.ok) throw new Error(`HTTP ${res.status}`);
          buffer.set(new Uint8Array(await res.arrayBuffer()), offset);
          break;
        } catch (e) {
          if (++attempt > maxRetries) throw e;
          await new Promise(r => setTimeout(r, 500 * 2 ** attempt));
        }
      }
      offset = end + 1;
      this.emit('progress', {
        percent: offset / total,
        itemsLoaded: offset,
        itemsTotal: total,
      });
    }
    return buffer.buffer;
  }

  async loadChunked(meshUri: string): Promise<GLTF> {
    const buffer = await this.fetchWithResume(meshUri);
    const resourcePath = THREE.LoaderUtils.extractUrlBase(meshUri);
    return this.gltfLoader.parseAsync(buffer, resourcePath);
  }

}

interface LoadedCourseSurface extends CourseSurfaceProperties {
  mesh: THREE.Mesh,
  // ground: GroundPhysics,
}

type CourseLoaderOptions = {
  manager?: THREE.LoadingManager,
  setupData: Partial<OpenGolfSim.SetupData>,
  qualityLevel: QualityMode,
  meshLoaderOptions?: MeshLoaderOptions
}


type CourseGreen = {
  flag: FlagStick;
  target?: TargetShaderMaterial;
  grid?: PuttingGridMaterial;
  object: THREE.Object3D;
}

export type CourseHole = {
  green?: CourseGreen;
} & Hole;

export type CourseHoleMap = Map<number, CourseHole>;

export class CourseLoader extends EventEmitter<CourseLoaderEvents> {
  // world: World;
  // rapier: RapierInstance;
  meshLoader: MeshLoader;
  holes: CourseHoleMap;
  waterSurfaces: Map<string, any>;
  surfaces: Map<string, LoadedCourseSurface>;
  grasses: Map<string, any>;
  greenGrids: Map<string, any>;
  courseMap?: CourseMapSource;
  courseSize: number;
  qualityLevel: QualityMode;
  
  gltf?: GLTF;
  scene?: THREE.Group;
  setupData?: Partial<OpenGolfSim.SetupData>;
  golfCup?: THREE.Mesh;
  sceneSettings?: SceneSettings;
  grassAssets?: GrassAssets;
  planter?: TreePlanter;
  clouds?: VolumetricClouds;
  light?: CourseLight;
  #renderer: FuseRenderer;
  #camera: ShotPerspectiveCamera;
  #raycaster: THREE.Raycaster;
  #origin: THREE.Vector3;
  #direction: THREE.Vector3;
  #accumulator = 10;
  #blendMaps: Map<string, BlendMapData>;

  constructor(
    // world: World,
    // rapier: RapierInstance,
    renderer: FuseRenderer,
    camera: ShotPerspectiveCamera,
    options: CourseLoaderOptions
  ) {
    super();
    // this.world = world;
    // this.rapier = rapier;
    this.#renderer = renderer;
    this.#camera = camera;
    this.qualityLevel = options.qualityLevel;
    this.meshLoader = new MeshLoader(renderer, options.manager, options.meshLoaderOptions);
    this.setupData = options.setupData || {};
    this.courseSize = 1000;

    this.holes = new Map();
    this.waterSurfaces = new Map();
    // this.surfaceByCollider = new Map();
    this.surfaces = new Map();
    this.grasses = new Map();
    this.greenGrids = new Map();
    this.#blendMaps = new Map();
    
    this.#raycaster = new THREE.Raycaster();
    this.#origin = new THREE.Vector3();
    this.#direction = new THREE.Vector3(0, -1, 0);

  }

  async load(coursePath: string, scene: THREE.Scene) {
    this.gltf = await this.meshLoader.loadChunked(coursePath);
    this.scene = this.gltf.scene;
    if (this.gltf.userData?.courseSize) {
      this.courseSize = this.gltf.userData.courseSize;
    } else {
      console.warn('Course missing world size! Defaulting to 1000');
    }
    this.sceneSettings = this.gltf.userData?.sceneSettings ?? {};

    console.log(' ---- Loaded FUSE course ---- ');
    console.log(JSON.stringify(this.gltf.userData, null, 1));
    console.log(' ---------------------------- ');
    
    this.golfCup = await this.meshLoader.load(golfCupModel, true);

    // load the model + textures once during init
    this.grassAssets = await GrassShader.loadAssets({
      modelPath: grassBladesModel,
      noisePath: perlinNoise
    });
    if (!this.grassAssets) {
      throw new Error('Unable to load grass assets');
    }

    await this._parseTextures();

    this._setupCourseSurfaces();
    this._parseCourseHoles();
    this._addWater();
    await this._addSkyAndEnvironment(scene);
    await this._addTrees();
    await this._parseMap();

    // Everything is built — release the parser and its retained GLB buffers.
    // (this.scene and userData were extracted above; live textures/geometry
    // are referenced by the scene, not the parser.)
    this.gltf = undefined;

    return this.scene;
  }

  update(dt: number, camera: ShotPerspectiveCamera, golfBall: GolfBall, activeHole = 1) {
    
    // update water and other animations that happen each frame
    this.waterSurfaces.forEach(water => water.update(dt));
    
    const hole = this.holes.get(activeHole);

    // planting / LOD logic only needs to happen every few frames
    if (this.#accumulator >= 4) {
      // this.greenGrids.forEach(grid => grid.update(camera));
      this.grasses.forEach(grass => grass.update(dt, camera));
      this.planter?.update(camera, golfBall.isShotActive);
      this.#accumulator = 0;
    }
    this.#accumulator++;

    if (hole?.green?.target) {
      hole.green.target.update(golfBall, dt);
    }    
    if (hole?.green?.grid) {
      hole.green.grid.update(dt, camera);
    }    
    if (hole?.green?.flag) {
      hole.green.flag.update(dt);
    }
  }

  async _parseTextures() {
    if (!this.scene) throw new Error('No scene defined!');
    if (!this.gltf) throw new Error('Course file not loaded');
    const parser = this.gltf.parser;

    // parse blend maps
    const blendMapRecords = (parser.json?.images || []).filter(
      (img: any) => img.extras?.type === 'blend_map'
    ) as BlendMapImage[];

    for (const blendMapRecord of blendMapRecords) {
      // const blendMapRecord = blendMapRecords.find(image => image.extras?.id === child.userData.id);
      if (blendMapRecord?.extras?.id) {
        const buffer = await parser.getDependency('bufferView', blendMapRecord.bufferView);
        const blendMapImageData = await getTextureImageData(buffer);
        const blendMap = {
          data: blendMapImageData.data,
          width: blendMapImageData.width,
          height: blendMapImageData.height,
          bounds: blendMapRecord.extras.bounds ?? { w: 0, h: 0, x: 0, y: 0 },
        };
        this.#blendMaps.set(blendMapRecord.extras.id, blendMap);
      }
    }


  }

  _setupCourseSurfaces() {
    if (!this.scene) throw new Error('No scene defined!');
    if (!this.gltf) throw new Error('Course file not loaded');
    const parser = this.gltf.parser;

    this.scene.updateMatrixWorld(true); // critical — bakes the position.set applied when loaded
    this.surfaces.clear();
    this.grasses.clear();
    this.greenGrids.clear();
        
    // Pre-pass: collect all surface meshes for neighbor lookup
    const allSurfaceMeshes: THREE.Mesh[] = [];
    this.scene.traverse((child) => {
      if (!(child instanceof THREE.Mesh) || !child.isMesh) return;
      if (this._detectSurface(child)) {
        child.geometry.computeBoundsTree();
        allSurfaceMeshes.push(child);
      }
    });

    this.scene.traverse((child) => {
      if (!this.scene) { return; }
      if (!(child instanceof THREE.Mesh)) { return; }
      if (!child.isMesh || !child.geometry?.attributes.position) return;
      child.receiveShadow = true;

      // Disable vertex color rendering on all meshes —
      // we only use them as data, not visual color
      if (child.material instanceof THREE.MeshStandardMaterial) {
        // child.material
        // grassTexture.anisotropy = this.#renderer.getMaxAnisotropy() || 1;
        if (this.qualityLevel > QualityMode.Medium) {
          if (child.material.map) child.material.map.anisotropy = this.#renderer.getMaxAnisotropy() || 1;
        }
        child.material.vertexColors = false;
        child.material.needsUpdate = true;
      }

      const detected = this._detectSurface(child);
      if (detected?.surfaceType && detected?.surfaceSettings) {
        const { surfaceType, surfaceSettings } = detected;
        const surfaceOptions = { type: surfaceType, ...surfaceSettings };

        const blendMap = this.#blendMaps.get(child.userData.id);
        if (blendMap) {

          // const neighborMesh = this.findNeighborMesh(child, allSurfaceMeshes);
          // if (neighborMesh && this.grassAssets?.noiseTexture) {
          //    const sand = new SandMaterial(
          //      child,
          //      this.grassAssets.noiseTexture,
          //      blendMap,
          //      neighborMesh,
          //      child.userData.blendSettings || {},
          //    );
          // } else {
          //   console.warn(`Unable to find neighbor mesh for ${child.name}`);
          // }

        } else if (this.qualityLevel > QualityMode.Medium && surfaceType === 'rough') {
          const grassOptions = {
            density: 15,
            renderDistance: 50,
            cellSize: 10,
            lean: 0.01,
            heightVariation: 0.5,
            maxNewCellsPerFrame: 20,
            scaleXZ: 0.6,
            scaleY: 0.65,
            layer: 2,
            baseColor: new THREE.Color('#415722'),
            tipColor1: new THREE.Color('#5c7c2e'),
            tipColor2: new THREE.Color('#ffffff'),
          };
          
          // if (this.qualityLevel > QualityMode.Medium) {
          //   grassOptions.renderDistance = 50;
          //   grassOptions.density = 15;
          // }
          
          const grass = new GrassShader(child, this.grassAssets!, grassOptions);
          this.scene.add(grass.mesh);
          this.grasses.set(child.uuid, grass);

        } else if (this.qualityLevel > QualityMode.Medium && ['deep_rough', 'base'].includes(surfaceType)) {
          
          const grass = new GrassShader(child, this.grassAssets!, {
            density: 8,
            renderDistance: 60,
            cellSize: 10,
            lean: 0.03,
            layer: 2,
            heightVariation: 0.1,
            maxNewCellsPerFrame: 10,
            scaleXZ: 0.8,
            scaleY: 0.6,
          });
          this.scene.add(grass.mesh);
          this.grasses.set(child.uuid, grass);
        }

        this.surfaces.set(child.uuid, { ...surfaceOptions, mesh: child });
      }
    });
    // this.world.step();
    for (const surface of this.surfaces.values()) {
      surface.mesh.geometry.computeBoundsTree();
    }

  }
  
  findNeighborMesh(sandMesh: THREE.Mesh, allSurfaceMeshes: THREE.Mesh[]) {
    // Get the bounding box center, offset slightly outward
    const bbox = new THREE.Box3().setFromObject(sandMesh);
    const center = bbox.getCenter(new THREE.Vector3());
    const size = bbox.getSize(new THREE.Vector3());
    
    // Test point just outside the bounding box edge
    const testPoint = new THREE.Vector3(
      center.x + size.x * 0.25 + 0.25,
      center.y + 50,
      center.z
    );

    const raycaster = new THREE.Raycaster(testPoint, new THREE.Vector3(0, -1, 0));
    const hits = raycaster.intersectObjects(allSurfaceMeshes, false);
    
    // First hit that isn't the sand mesh itself
    for (const hit of hits) {
      if (hit.object !== sandMesh && hit.object instanceof THREE.Mesh) {
        return hit.object;
      }
    }
    return null;
  }
  getGroundY(x: number, z: number, startY = 1000, maxDistance = 2000) {
    this.#origin.set(x, startY, z);
    this.#raycaster.set(this.#origin, this.#direction);
    this.#raycaster.far = maxDistance;

    const meshes = this.getGroundMeshes();
    const hits = this.#raycaster.intersectObjects(meshes, false);
    if (hits.length > 0) {
      const hit = hits[0];
      return { y: hit.point.y, object: hit.object };
    }
    return null;
  }

  getGroundMeshes() {
    return [...this.surfaces.values()].map(surface => surface.mesh).filter(Boolean);
  }

  async _parseMap() {
    if (!this.gltf) {
      throw new Error('Course file not loaded');
    }
    const parser = this.gltf.parser;
    const courseMap = (parser.json?.images || []).find(
      (img: any) => img.extras?.type === 'course_map'
    );
    const buffer = await parser.getDependency('bufferView', courseMap.bufferView);
    const blob = new Blob([buffer], { type: 'image/jpeg' });
    const bitmap = await window.createImageBitmap(blob, { premultiplyAlpha: 'none' });
    // this.courseMap = bitmap;
    // Probe native dimensions, then release the full-res decode immediately
    const probe = await window.createImageBitmap(blob, { premultiplyAlpha: 'none' });
    const fullW = probe.width;
    const fullH = probe.height;
    probe.close(); // frees the ~64MB decode

    const overview = await window.createImageBitmap(blob, {
      premultiplyAlpha: 'none',
      resizeWidth: 512,
      resizeHeight: 512,
      resizeQuality: 'high',
    });
    this.courseMap = { blob, fullW, fullH, overview };    
  }

  async _addTrees() {
    if (!this.scene) {
      throw new Error('Course scene not loaded');
    }
    if (!this.gltf) {
      throw new Error('Course file not loaded');
    }
    

    const parser = this.gltf.parser;
    const treeMasks = (parser.json?.images || []).filter(
      (img: any) => img.extras?.type === 'tree_mask'
    ) as TreeImage[];

    console.log(`[plant] Planting trees... (qual:${this.qualityLevel})`);
    this.planter = new TreePlanter({
      scene: this.scene,
      worldSize: this.courseSize,
      qualityLevel: this.qualityLevel,
      // world: this.world,
      // rapier: this.rapier,
      groundMeshes: this.getGroundMeshes(),
      refreshShadows: () => this.light?.refreshShadows(),
    });

    const treeConfigs: Record<string, TreeGroup[]> = {};
    this.scene.traverse((child) => {
      if (child.userData?.type === 'tree_template') {
        const layerId = child.userData?.treeLayerId;

        const group = TreePlanter.loadTree(child);

        let lodDistances = [0, 40];
        let maxDistance = 500;
        if (this.qualityLevel === QualityMode.Medium) {
          lodDistances = [60, 100];
          maxDistance = 800;
        } else if (this.qualityLevel === QualityMode.High) {
          lodDistances = [200, 400];
          maxDistance = Infinity;
        }
        console.log(`[plant] Planting tree layer... (lods:${lodDistances.join(',')})`, group);
        const config: TreeGroup = {
          collider: {
            radius: 0.3,
            height: 2.0,
          },
          scaleRange: { min: 1, max: 1 },
          density: 1,
          minDistance: 3,
          maxDistance,
          lodDistances,
          colors: [],
          meshGroup: group,
          ...child.userData
        };

        if (!treeConfigs?.[layerId]) {
          treeConfigs[layerId] = [config];
        } else {
          treeConfigs[layerId].push(config);
        }
      }
    });


    for (const treeMask of treeMasks) {
      if (!treeMask.extras?.id) {
        continue;
      }
      const configs = treeConfigs?.[treeMask.extras.id];

      if (configs?.length && treeMask.bufferView) {
        const buffer = await this.gltf.parser.getDependency('bufferView', treeMask.bufferView);
        const maskData = await getTextureImageData(buffer);
        console.log(`[plant] Planting from mask... (w:${maskData.width},h:${maskData.height},len:${maskData.data.byteLength})`);
        this.planter.plantFromMask(configs, maskData);
        // this.planter.treeGroup.visible = false;
      }
    }

    // Templates are fully consumed by the BatchedMeshes — free them
    this.planter.disposeTemplates();

  }
  
  _addWater() {
    if (!this.scene) throw new Error('Scene missing');
    if (!this.gltf) throw new Error('Course file not loaded');

    this.waterSurfaces.clear();
    const toReplace: THREE.Object3D[] = [];
    this.scene.traverse((child) => {
      if (['plane_river', 'plane_lake'].includes(child.userData?.surface)) {
        toReplace.push(child);
      }
    });
    
    const parser = this.gltf.parser;
    const flowMaps = (parser.json?.images || []).filter(
      (img: any) => img.extras?.type === 'flow_map'
    ) as FlowMapImage[];
    
    toReplace.forEach(async child => {
      let surface;
      let offsetY = 0;
      if (!isMeshObject(child)) return;
      if (child.userData?.surface === 'plane_river') {
        offsetY = 0;
        const flowMapImage = flowMaps.find(image => image.extras?.id === child.userData.id);
        let flowImageData;
        if (flowMapImage) {
          const buffer = await parser.getDependency('bufferView', flowMapImage.bufferView);
          flowImageData = await getTextureImageData(buffer);
        }
        surface = new RiverSurface(child, flowImageData, { qualityLevel: this.qualityLevel });

      } else if (child.userData?.surface === 'plane_lake') {
        offsetY = 0;
        surface = new LakeSurface(child, { qualityLevel: this.qualityLevel });
        // surface = new LakeSurface(child, {
          // speed: 0.25,
          // textureScale: 4,
          // water: {
          //   alpha: 0.8,
          //   waterColor: new THREE.Color('#0b4753')
          // },
        // });
      }

      if (surface) {
        // Copy the original mesh's world transform onto the water
        // child.updateWorldMatrix(true, false);
        // surface.water.applyMatrix4(child.matrixWorld);
        // surface.water.position.y += offsetY;
        this.waterSurfaces.set(child.uuid, surface);
        this.scene?.add(surface.water);
        this.scene?.remove(child);
      }
    });
  }

  async _addSkyAndEnvironment(scene: THREE.Scene) {
    if (!this.scene) {
      console.warn('No scene to add sky');
      return;
    }
    const skyType = this.sceneSettings?.sky?.type;
    const cloudSettings = this.sceneSettings?.sky?.clouds;
    const skyColor = new THREE.Color(cloudSettings?.skyColor ?? defaultSkyColor);
    const fogColor = new THREE.Color(cloudSettings?.fogColor ?? defaultFogColor);
    const cloudColor = new THREE.Color(cloudSettings?.cloudColor ?? defaultCloudColor);

    let lightOptions = {
      qualityLevel: this.qualityLevel,
      color: new THREE.Color('#fffac0'),
      directional: { enabled: true },
      ambient: { enabled: true }
    };
    if (skyType === 'clouds') {
      // Sky/Clouds
      scene.background = skyColor;
      this.clouds = new VolumetricClouds(this.#camera, {
        radius: 800,
        scale: cloudSettings?.scale ?? 3,
        opacity: cloudSettings?.opacity ?? 0.8,
        density: cloudSettings?.density ?? 0.5,
        cloudColor,
        fogColor,
        skyColor,
        position: new THREE.Vector3(0, -40, 0)
      });
      scene.add(this.clouds.object);
      this.#renderer.generateEnvironment(scene, this.clouds.object);

      const fog = new THREE.Fog(fogColor, 500, 1200);
      scene.fog = fog;
      // gameContext.fog = new THREE.Fog(fogColor, 300, 800);
      // gameContext.scene.fog = gameContext.fog;

    } else if (skyType === 'hdri') {
      // lightOptions.ambient = { enabled: true, intensity: 0.5 };
      // lightOptions.directional = { enabled: true, intensity: 0.6 };
      const parser = this?.gltf?.parser;
      if (parser) {
        const skyboxDef = (parser.json?.images || []).find(
          (img: any) => img.extras?.type === 'hdri'
        );
        const buffer: ArrayBuffer = await parser.getDependency('bufferView', skyboxDef.bufferView);
        const box = new SkyBox();
        box.load(scene, buffer);
        scene.environmentIntensity = 0.25;
      }
    }

    this.light = new CourseLight(lightOptions);
    
    scene.add(this.light);
  }

  updateEnvironment(environment: THREE.Texture) {
    this.waterSurfaces.forEach(water => water.updateEnvironment && water.updateEnvironment(environment));
  }

  _detectSurface(mesh: THREE.Object3D) {
    const surfaceType = mesh.userData.surface;
    if (!surfaceType) {
      return;
    }
    const surfaceSettings = isCourseSurfaceType(surfaceType) && CourseSurfaces[surfaceType];
    if (!surfaceSettings) {
      console.warn(`Missing settings for surface type: ${surfaceType}`);
      return { surfaceType, surfaceSettings: CourseSurfaces.default };
    }    
    return { surfaceType, surfaceSettings };
  }

  _parseCourseHoles() {
    if (!this.scene) throw new Error('Scene missing');
    const raycaster = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);

    this.holes.clear();

    const groundMeshes: THREE.Mesh[] = [];
    this.scene?.traverse((node) => {
      if (node instanceof THREE.Mesh && node.isMesh) {
        groundMeshes.push(node);
      }
    });

    this.scene.traverse((node) => {
      const { type, hole: holeNumber, order, mapX, mapY } = node.userData;
      if (type === 'hole_group') {
        const { holeNum, par } = node.userData;
        if (!this.holes.has(holeNum)) {
          this.holes.set(holeNum, { number: `${holeNum}`, par, waypoints: new Map() });
        }
      } else if (type === 'waypoint') {
        // ['tee','aim','pin'].includes(type)
        const { holeNum, order, mapX, mapY, waypoint: waypointType } = node.userData;
        raycaster.set(new THREE.Vector3(mapX, 5000, mapY), down);
        const hits = raycaster.intersectObjects(groundMeshes);
        let position = new THREE.Vector3(mapX, 10, mapY);
        if (hits.length > 0) {
          position.y = hits[0].point.y;
          if (waypointType === 'pin') {
            // add flagstick and target material
            if (this.holes.has(holeNum)) {
              const hole = this.holes.get(holeNum);
              if (hole) {
                hole.green = this._setupGreen(hits[0], position, hole.number);
              }
            }

          }
        }
        const hole = this.holes.get(holeNum);
        if (hole) {
          hole.waypoints.set(waypointType, position);
        }
      }
    });
  }
  
  _setupGreen(hit: THREE.Intersection, position: THREE.Vector3, holeNumber: string) {
    if (!this.scene) throw new Error('Scene missing');

    const worldNormal = hit.face
      ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld)
      : undefined;
    const flag = new FlagStick(position, holeNumber, this.golfCup, worldNormal);
    this.scene.add(flag.object);

    let target;
    let grid;
    if (this.setupData?.puttingEnabled) {
      grid = new PuttingGridMaterial(hit.object, { holeWorldPos: position });
    } else {
      target = new TargetShaderMaterial(hit.object, position, { gimmeDistances: this.setupData?.gimmeDistances || DefaultGimmeDistances });
    }

    return { object: hit.object, flag, target, grid };
  }

  updateActiveGreen(camera: ShotPerspectiveCamera, activeHole: number) {
    const hole = this.holes.get(activeHole);
    if (hole?.green?.grid) {
      hole.green.grid.updateGrid(camera);
    }  
  }
}