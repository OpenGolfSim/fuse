import {
  Color,
  WebGLRenderer,
  PCFShadowMap,
  ACESFilmicToneMapping,
  AgXToneMapping,
  ReinhardToneMapping,
  LinearToneMapping,
  CineonToneMapping,
  NeutralToneMapping,
  PMREMGenerator,
  Scene,
  Vector2,
  type Camera,
  type Fog,
  type Mesh,
  type Texture,
} from 'three';
import { pass } from 'three/tsl';
import { QualityMode } from './utils/quality';
import {
  WebGPURenderer,
  RenderPipeline,
  HemisphereLight,
  PMREMGenerator as WebGPUPMREMGenerator,
} from 'three/webgpu';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { WebGLNodesHandler } from 'three/examples/jsm/tsl/WebGLNodesHandler.js';
import { app } from './';

type FuseRendererOptions = {
  canvas: HTMLElement | null;
  antialias?: boolean;
  width?: number;
  height?: number;
  aspect?: number;
  container?: HTMLElement;
  renderMode?: 'webgl' | 'webgpu';
  forceWebGL?: boolean,
  qualityLevel?: QualityMode;
}

export class FuseRenderer {
  renderer: WebGLRenderer | WebGPURenderer;
  container: HTMLElement;
  width: number;
  height: number;
  qualityLevel: QualityMode;

  environment?: Texture;
  pipeline?: RenderPipeline;
  constructor(options: FuseRendererOptions) {
    if (!options.canvas || !(options.canvas instanceof HTMLCanvasElement)) {
      throw new Error('Must provide a valid canvas element');
    }
    this.container = options.container ?? options.canvas.parentElement ?? document.body;
    this.width = this.container.offsetWidth;
    this.height = this.container.offsetHeight;
    this.qualityLevel = options.qualityLevel ?? QualityMode.Medium;

    if (options.renderMode === 'webgpu') {
      // this.renderer = new WebGPURenderer({ canvas: options.canvas, antialias: options.antialias, depth: true, });
      // this.renderer = new WebGPURenderer({ canvas: options.canvas, antialias: false, depth: true, });
      // Med/High: MSAA lives on the pipeline pass → canvas AA off.
      // Low: no pipeline, so canvas MSAA provides AA — safe because Low water
      // never samples scene depth (useDepthFade: false), the other half of the bug.
      // const canvasAA = this.qualityLevel === QualityMode.Low;
      this.renderer = new WebGPURenderer({
        canvas: options.canvas,
        antialias: this.qualityLevel === QualityMode.Low ? false : true,
        depth: true,
        forceWebGL: !!options.forceWebGL,
      });
      // @ts-expect-error - isWebGPUBackend exists not added to three types yet
      app.log(`isWebGPUBackend: ${this.renderer.backend.isWebGPUBackend}`);
      
    } else {
      this.renderer = new WebGLRenderer({ canvas: options.canvas, antialias: options.antialias });
      // Enable TSL node material support for WebGLRenderer
      // (WebGPURenderer handles this natively)
      this.renderer.setNodesHandler(new WebGLNodesHandler());
    }
    this.renderer.setSize(this.width, this.height);  
    
    let pixelRatio = 1.25;
    if (this.qualityLevel === QualityMode.High) {
      pixelRatio = 1;
    } else if (this.qualityLevel === QualityMode.VeryHigh) {
      pixelRatio = 2;
    }

    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;

    // this.renderer.toneMapping = ACESFilmicToneMapping;
    // this.renderer.toneMapping = AgXToneMapping;
    this.renderer.toneMapping = NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.1;

    window.addEventListener('resize', this._handleResize.bind(this));

    const resizeObserver = new ResizeObserver((entries) => this._handleResize());
    resizeObserver.observe(this.container);
  
  }
  
  _handleResize() {  
    this.width = this.container.offsetWidth;
    this.height = this.container.offsetHeight;
    this.renderer.setSize(this.width, this.height);  
  }

  async init() {
    if (this.renderer instanceof WebGPURenderer) {
      await this.renderer.init();
      // // TEMP: log every pipeline/shader compile with its material label —
      // // whatever prints at the mid-shot hang is the unwarmed material
      // const b: any = (this.renderer as any).backend;
      // for (const fn of ['createRenderPipeline', 'createShaderModule']) {
      //   const t = b?.device;
      //   if (t?.[fn]) {
      //     const orig = t[fn].bind(t);
      //     t[fn] = (d: any) => (console.warn('[compile]', d?.label ?? fn), orig(d));
      //   }
      // }
    }
  }

  async compile(scene: Scene, camera: Camera) {
    // WebGLRenderer compiles cheaply on demand only need for WebGPURenderer
    if (!(this.renderer instanceof WebGPURenderer)) return;
    if (this.pipeline) {
      // Real frames go through the pipeline — warm that path,
      // with culling disabled so every material compiles.
      const culled: any[] = [];
      scene.traverse((o: any) => {
        if (o.frustumCulled) {
          o.frustumCulled = false;
          culled.push(o);
        }
      });
      this.pipeline.render();
      for (const o of culled) o.frustumCulled = true;
    } else {
      // No post-processing
      await this.renderer.compileAsync(scene, camera);
    }

  }

  clear() {
    // this.renderer.clear();
  }
  
  render(scene: Scene, camera: Camera, fog?: Fog) {
    if (fog) {
      scene.fog = fog;
    }
    if (this.pipeline) {
      this.pipeline.render();
    } else {
      this.renderer.render(scene, camera);
    }

  }

  getMaxAnisotropy() {
    if (this.renderer instanceof WebGPURenderer) {
      return this.renderer.getMaxAnisotropy();
    } else if (this.renderer instanceof WebGLRenderer) {
      return this.renderer.capabilities.getMaxAnisotropy();
    }
    return 1;
  }

  generateEnvironment(scene: Scene, sky?: Mesh) {
    if (!this.renderer) {
      throw new Error('Missing renderer');
    }

    const tempScene = new Scene();
    tempScene.background = scene.background || new Color('#c8dbe5');
    if (sky) {
      tempScene.add(sky);
    }
    
    const hemiLight = new HemisphereLight('#c8dbe8', '#4a7a5c', 1.0);
    tempScene.add(hemiLight);

    const pmrem = this.renderer instanceof WebGPURenderer ? new WebGPUPMREMGenerator(this.renderer) : new PMREMGenerator(this.renderer);
    this.environment = pmrem.fromScene(tempScene, 0, 0.1, 10000).texture;
    pmrem.dispose();
    
    // Move sky back to the real scene
    if (sky) scene.add(sky);
    // scene.environment = this.environment;

  }

  // In your FuseRenderer class, add a setup method:
  setupPostProcessing(scene: Scene, camera: Camera) {
    if (!(this.renderer instanceof WebGPURenderer)) {
      console.warn('Post-processing pipeline requires WebGPURenderer');
      return;
    }
    // Low tier: no pipeline — direct render, sample count 1 everywhere
    // (water depth bug can't trigger without MSAA; pass cost too high on weak GPUs)
    if (this.qualityLevel === QualityMode.Low) return;

    this.pipeline = new RenderPipeline(this.renderer);

    // Create the scene render pass
    // const scenePass = pass(scene, camera);
    // Low: no MSAA (mobile bandwidth win), FXAA instead. Med/High: 4x MSAA as before.
    // const samples = this.qualityLevel === QualityMode.Low ? 4 : 4;
    const scenePass = pass(scene, camera, { samples: 4 });

    // Get the color output texture node
    const scenePassColor = scenePass.getTextureNode('output');

    if (this.qualityLevel <= QualityMode.Medium) {
      // this.pipeline.outputNode = samples === 1 ? fxaa(scenePassColor) : scenePassColor;
      this.pipeline.outputNode = scenePassColor;
      return;
    }

    // Create the bloom effect on high quality
    const strength = 0.12;
    const radius = 0.1;
    const threshold = 0.25;
    const bloomPass = bloom(scenePassColor, strength, radius, threshold);

    // Combine: original scene + bloom glow
    this.pipeline.outputNode = scenePassColor.add(bloomPass);

  }


  /**
   * DEBUG: compile the scene one mesh at a time, logging before/after each,
   * so the material that hangs the driver's shader compiler identifies itself.
   * The last "[probe] compiling ..." without a matching "[probe] ok" is the culprit.
   */
  async compileProbe(scene: Scene, camera: Camera) {
    if (!(this.renderer instanceof WebGPURenderer)) return;

    const meshes: any[] = [];
    scene.traverse((o: any) => { if (o.isMesh) meshes.push(o); });

    // Hide everything, remember prior visibility
    const prevVisible = meshes.map(o => o.visible);
    for (const o of meshes) o.visible = false;

    for (let i = 0; i < meshes.length; i++) {
      const o = meshes[i];
      const matType = Array.isArray(o.material)
        ? o.material.map((m: any) => m.type).join(',')
        : o.material?.type;
      o.visible = true;
      console.log(`[probe] compiling ${i + 1}/${meshes.length}: name="${o.name || '(unnamed)'}" obj=${o.constructor.name} mat=${matType}`);
      const t0 = performance.now();
      await this.renderer.compileAsync(scene, camera);
      console.log(`[probe] ok ${i + 1} (${(performance.now() - t0).toFixed(0)}ms)`);
      // Leave visible: compileAsync skips already-compiled pipelines on later passes
    }

    // Restore original visibility
    meshes.forEach((o, i) => (o.visible = prevVisible[i]));
  }  
}