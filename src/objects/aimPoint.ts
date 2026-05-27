import { colors } from '@/utils/colors';
import { UnitConversions } from '@/utils/units';
import * as THREE from 'three';

const MIN_SCALE = 0.05;

type AimPointOptions = {
  units?: OpenGolfSim.MeasurementUnits;
}

export class AimPoint {
  scaleFactor: number;
  units: OpenGolfSim.MeasurementUnits;
  opacity: number;
  camera: THREE.Camera;
  color: THREE.Color;
  point: THREE.Mesh;
  panel: THREE.Mesh;
  object: THREE.Group;
  #pointHeight: number;
  #pointOffsetY: number;
  #panelWidth: number;
  #panelHeight: number;
  #panelAspect: number;
  #pixelRatio: number;
  fadeDistance: [number, number];
  #lastAimPoint?: THREE.Vector3;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;

  #cachedTexture?: THREE.Texture;
  #cachedTextureKey?: string;

  constructor(camera: THREE.Camera, options: AimPointOptions = {}) {
    this.#pixelRatio = Math.round( window.devicePixelRatio || 1 );
    this.camera = camera;
    this.units = options.units || 'metric';
    
    this.scaleFactor = 0.004;
    this.opacity = 0.98;
    this.fadeDistance = [60, 20];
    this.color = new THREE.Color(colors.background);
    this.#pointHeight = 5;
    this.#pointOffsetY = 0.25;
    this.#panelWidth = 10;
    this.#panelHeight = 5;
    this.#panelAspect = this.#panelHeight / this.#panelWidth;

    this.canvas = document.createElement('canvas');
    this.canvas.width = 512 * this.#pixelRatio;
    this.canvas.height = Math.round(512 * this.#panelAspect) * this.#pixelRatio;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Unable to get 2d context for aim point panel');
    }
    this.ctx = ctx;

    this.object = new THREE.Group();
    this.object.layers.set(2);
    this.object.name = 'AimPointGroup';

    this.point = this.#buildPoint();
    this.object.add(this.point);

    this.panel = this.#buildPanel();
    this.object.add(this.panel);
  }

  #buildPoint() {

    const geometry = new THREE.ConeGeometry( 2, this.#pointHeight, 16 );

    const material = new THREE.MeshBasicMaterial({
      color: this.color,
      transparent: true
    });
    
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.z = 180 * (Math.PI / 180); // rotate 180
    mesh.position.y = (this.#pointHeight / 2) + this.#pointOffsetY;
    mesh.name = 'AimPointMesh';
    return mesh;
  }

  #buildPanel() {
    const yOffset = -0.5;

    // 3. Create a plane geometry and apply the texture to the material
    const geometry = new THREE.PlaneGeometry(this.#panelWidth, this.#panelHeight); // Width, Height
    const material = new THREE.MeshBasicMaterial({ 
      // map: texture,
      // color: colors.background,
      // blending: THREE.AdditiveBlending,
      // opacity: this.opacity,
      transparent: true,
      side: THREE.DoubleSide // Optional: visible from both sides
    });
    

    const plane = new THREE.Mesh(geometry, material);
    plane.position.y = (this.#panelHeight / 2) + this.#pointOffsetY + this.#pointHeight + yOffset;
    plane.position.z = 0.1;
    // plane.rotation.z = 180 * (Math.PI / 180);
    // plane.rotation.x = 180 * (Math.PI / 180);
    return plane;
  }

  #fontStyle(fontSize: number, fontWeight = 'bold') {
    return [
      fontWeight,
      `${fontSize}px`,
      'system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol"'
    ].join(' ');
  }
  #updateDistanceMaterial(distance: number, height: number, units: string) {

    this.ctx.fillStyle = colors.background;
    this.ctx.roundRect(0, 0, this.canvas.width, this.canvas.height, 30); // 20px radius for all corners
    this.ctx.fill();
    this.ctx.fillStyle = 'white';
    const fontSize = 100 * this.#pixelRatio;
    this.ctx.font = this.#fontStyle(fontSize, '800');
    this.ctx.textBaseline = 'middle';
    this.ctx.textAlign = 'center';
    this.ctx.fillText(`${distance.toFixed(0)} ${units}`, this.canvas.width/2, (this.canvas.height/2) - (30 * this.#pixelRatio));

    const fontSizeHeight = 60 * this.#pixelRatio;
    this.ctx.font = this.#fontStyle(fontSizeHeight, '400');
    const prefix = height >= 0.1 ? '+' : '';
    this.ctx.fillStyle = '#aaa';
    this.ctx.fillText(`${prefix}${height.toFixed(1)} ${units}`, this.canvas.width/2, (this.canvas.height/2) + (60 * this.#pixelRatio));


    const texture = new THREE.CanvasTexture(this.canvas);
    texture.colorSpace = THREE.SRGBColorSpace; // correct color rendering
    // texture.anisotropy = gameContext.renderer.capabilities.getMaxAnisotropy();
    return texture;
  }

  reset(aimPoint: THREE.Vector3) {
    this.#lastAimPoint = undefined;
    // this.object.position.copy(aimPoint);
    // if (this.camera) {
    //   this.object.lookAt(this.camera.position);
    // }
  }

  update(aimPoint: THREE.Vector3, distance: number, height: number, isShotActive: boolean) {
    this.object.visible = !isShotActive;
    if (isShotActive) {
      return;
    }
    
    if (this.#lastAimPoint) {
      const diff = this.#lastAimPoint.distanceTo(aimPoint);
      if (diff < 0.001) {
        return;
      }
      this.#lastAimPoint.copy(aimPoint);
    } else {
      this.#lastAimPoint = aimPoint.clone();
    }

    this.object.position.copy(aimPoint);
    if (this.camera) {
      this.object.lookAt(this.camera.position);
    }

    const cameraDistance = this.camera.position.distanceTo(this.object.position);
    const desiredScale = Math.max(cameraDistance * this.scaleFactor, MIN_SCALE); // tweak this factor to taste
    this.object.scale.setScalar(desiredScale);
    
    const fadeStart = this.fadeDistance[0];
    const fadeEnd = this.fadeDistance[1];
    const opacity = THREE.MathUtils.clamp((cameraDistance - fadeEnd) / (fadeStart - fadeEnd), 0, 1);
    //@ts-expect-error
    this.point.material.opacity = this.opacity * opacity;
    //@ts-expect-error
    this.panel.material.opacity = this.opacity * opacity;
    
    let distanceDisplay = distance;
    let heightDisplay = height;
    let unitsDisplay = 'm';
    if (this.units === 'imperial') {
      distanceDisplay = UnitConversions.metersToYards(distanceDisplay);
      heightDisplay = UnitConversions.metersToFeet(heightDisplay);
      unitsDisplay = 'yd';
    }

    const texKey = `${distanceDisplay}-${heightDisplay}`;
    if (this.#cachedTextureKey !== texKey) {
      const tex = this.#updateDistanceMaterial(distanceDisplay, heightDisplay, unitsDisplay);
      //@ts-expect-error
      this.panel.material.map = tex;
      this.#cachedTextureKey = texKey;
    }
    //@ts-expect-error
    this.panel.material.needsUpdate = true;
  }
}