import {
  Color,
  WebGLRenderer,
  PCFShadowMap,
  ACESFilmicToneMapping,
  PMREMGenerator,
  Scene,
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

import { WebGLNodesHandler } from 'three/examples/jsm/tsl/WebGLNodesHandler.js';

type FuseRendererOptions = {
  canvas: HTMLElement | null;
  antialias?: boolean;
  width?: number;
  height?: number;
  aspect?: number;
  container?: HTMLElement;
  renderMode?: 'webgl' | 'webgpu';
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

    if (options.renderMode === 'webgpu') {
      this.renderer = new WebGPURenderer({ canvas: options.canvas, antialias: options.antialias, depth: true, });
    } else {
      this.renderer = new WebGLRenderer({ canvas: options.canvas, antialias: options.antialias });
      // Enable TSL node material support for WebGLRenderer
      // (WebGPURenderer handles this natively)
      this.renderer.setNodesHandler(new WebGLNodesHandler());
    }
    this.renderer.setSize(this.width, this.height);  
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    
    this.qualityLevel = options.qualityLevel ?? QualityMode.Medium;

    this.renderer.toneMapping = ACESFilmicToneMapping; // or whatever you pick
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
    }


    // Debug renderer
    const b: any = (this.renderer as any).backend;
    console.warn('[backend]', b?.constructor?.name);
    //  for (const fn of ['createRenderPipeline', 'createShaderModule']) {
    //    const t = b?.device; if (t?.[fn]) { const o = t[fn].bind(t); t[fn] = (d: any) => (console.warn('[compile]', d?.label ?? fn), o(d)); }
    //  }
    //  if (b?.gl) { const o = b.gl.linkProgram.bind(b.gl); b.gl.linkProgram = (p: any) => (console.warn('[compile] gl'), o(p)); }

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
    this.renderer.clear();
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

    this.pipeline = new RenderPipeline(this.renderer);

    // Create the scene render pass
    const scenePass = pass(scene, camera);

    // Get the color output texture node
    const scenePassColor = scenePass.getTextureNode('output');

    // Create the bloom effect
    // const strength = 0.08;
    const strength = 0.075;
    const radius = 0.1;
    const threshold = 0.65;
    const bloomPass = bloom(scenePassColor, strength, radius, threshold);

    // Combine: original scene + bloom glow
    this.pipeline.outputNode = scenePassColor.add(bloomPass);
  }

}