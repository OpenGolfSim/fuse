import * as THREE from 'three';
import styles from '@/css/ui.module.css';
import { Hole } from '@/courses/types';
import { UnitConversions } from '@/utils/units';
import { colors } from '@/utils/colors';

type UICourseMapOptions = {
  mapWidthPercent?: number;
  units?: OpenGolfSim.MeasurementUnits;
}

export class UICourseMap extends EventTarget {
  mapWidthPercent: number;
  camera: THREE.OrthographicCamera;
  renderer: THREE.WebGLRenderer;
  container: HTMLElement;
  canvasContainer: HTMLElement;
  header: HTMLElement;
  holeText: HTMLElement;
  parText: HTMLElement;
  distText: HTMLElement;
  units: OpenGolfSim.MeasurementUnits;
  canvas: HTMLCanvasElement;
  overlayCanvas: HTMLCanvasElement;

  aspect: number;
  width: number;
  height: number;

  constructor(options: UICourseMapOptions = {}) {
    super();
    // this.width = width;
    // this.height = height;
    // this.course = course;
    this.units = options.units ?? 'metric';
    this.mapWidthPercent = options.mapWidthPercent ?? 0.25;

    const mapSize = 40;
    const nearField = 10;
    const farField = 1000;
    
    // this.aspect = 3 / 2;
    // this.width = window.innerWidth * 0.15; // 10%
    // this.height = this.width * this.aspect; // 10%
    
    this.camera = new THREE.OrthographicCamera(-mapSize, mapSize, mapSize, -mapSize, nearField, farField);
    this.camera.position.set(0, 100, 0);
    this.camera.lookAt(0, 0, 0);
    this.aspect = 3 / 2;
    this.width = window.innerHeight * this.mapWidthPercent; // 10%
    this.height = this.width * this.aspect; // 10%    

    this.container = document.createElement('div');
    this.container.className = styles.mapContainer;
    // this.canvas.style = 'position: absolute; left: 10px; bottom: 10px;'
    this.header = document.createElement('div');
    this.header.className = styles.mapHeader;
    
    this.holeText = document.createElement('div');
    this.holeText.className = styles.mapHoleText;
    this.holeText.textContent = 'Hole 1';

    this.parText = document.createElement('div');
    this.parText.className = styles.mapParText;
    this.parText.textContent = 'Par 5';
    
    this.distText = document.createElement('div');
    this.distText.className = styles.mapDistText;
    this.distText.textContent = '225 yd';

    this.header.append(this.holeText, this.parText, this.distText);

    this.canvas = document.createElement('canvas');
    this.canvas.className = styles.mapCanvas;
    
    this.canvasContainer = document.createElement('div');
    this.canvasContainer.className = styles.canvasContainer;

    this.overlayCanvas = document.createElement('canvas');
    // this.canvas.style = 'position: absolute; left: 10px; bottom: 10px;'
    this.overlayCanvas.className = styles.overlayCanvas;
    
    this.canvasContainer.append(this.canvas, this.overlayCanvas);
    this.container.append(this.header, this.canvasContainer);

    this.overlayCanvas.addEventListener('click', this._handleCanvasClick.bind(this))

    document.body.append(this.container);

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    // this.renderer.setSize(this.width, this.height);

    this._handleResize();
    window.addEventListener('resize', this._handleResize.bind(this));
  }

  _handleResize() {
    
    this.width = window.innerHeight * this.mapWidthPercent; // 10%
    this.height = this.width * this.aspect; // 10%    

    this.container.style.display = this.width < 120 ? 'none' : 'block';

    this.canvas.width = this.overlayCanvas.width = this.width;
    this.canvas.height = this.overlayCanvas.height = this.height;
    this.renderer.setSize(this.width, this.height);

    if (window?.devicePixelRatio) {
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1));
    }
  }


  updateHole(currentHole: Hole) {
    this.holeText.textContent = `Hole ${currentHole.number}`;
    this.parText.textContent = `Par ${currentHole.par}`;
    const tee = currentHole.waypoints.get('tee');
    const pin = currentHole.waypoints.get('pin');

    const unitText = this.units === 'imperial' ? 'yd' : 'm';
    
    if (tee && pin) {
      const dist = tee.distanceTo(pin);
      let distanceValue = dist;
      if (this.units === 'imperial') {
        distanceValue = UnitConversions.metersToYards(distanceValue);
      }
      this.distText.textContent = `${distanceValue.toFixed(0)} ${unitText}`;
    } else {
      this.distText.textContent = '';
    }
  }

  render(scene: THREE.Scene, currentHole: Hole, currentPositions: { ball?: THREE.Vector3, aim?: THREE.Vector3 } = {}) {
    scene.fog = null;
    this.renderer.render(scene, this.camera);

    // render overlay
    const ctx = this.overlayCanvas.getContext('2d');
    if (!ctx) {
      throw new Error('Unable to get map overlay canvas context');
    }
    ctx.clearRect(0, 0, this.width, this.height);
    // const stsartPosition = currentHole?.waypoints?.get('pin');
    const ballPosition = currentPositions.ball ?? currentHole?.waypoints?.get('tee');
    const aimPosition = currentPositions.aim ?? currentHole?.waypoints?.get('aim');
    const pinPosition = currentHole?.waypoints?.get('pin');

    if (ballPosition) {
      this._drawDot(ctx, ballPosition, colors.white);
    }
    if (aimPosition) {
      const aimDist = ballPosition ? aimPosition.distanceTo(ballPosition) : 0;
      this._drawDot(ctx, aimPosition, colors.yellow, aimDist);
    }
    if (pinPosition) {
      const pinDist = ballPosition ? pinPosition.distanceTo(ballPosition) : 0;
      this._drawDot(ctx, pinPosition, colors.red, pinDist);
    }
  }

  _drawDot(ctx: CanvasRenderingContext2D, position: THREE.Vector3, color: string = '#e9c834', distanceMeters = 0) {
    const startXY = this._worldToMinimap(position);
    // tee marker
    ctx.beginPath();
    ctx.arc(startXY.x, startXY.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    
    if (distanceMeters) {
      this._drawDistance(ctx, position, '#000', distanceMeters, [2, 12]);
      this._drawDistance(ctx, position, '#fff', distanceMeters, [0, 10]);
    }
  }
  _drawDistance(ctx: CanvasRenderingContext2D, position: THREE.Vector3, color: string, distanceMeters: number, offset: [number, number] = [0, 0]) {
    const startXY = this._worldToMinimap(position);
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    let distanceUnits = 'm';
    if (this.units === 'imperial') {
      distanceMeters = UnitConversions.metersToYards(distanceMeters);
      distanceUnits = 'YD';
    }
    ctx.font = 'bold 10px Arial,Helvetica,sans-serif'
    ctx.fillText(`${distanceMeters.toFixed(0)} ${distanceUnits}`, startXY.x + offset[0], startXY.y + offset[1]);
  }

  _worldToMinimap(position: THREE.Vector3) {
    const v = position.clone().project(this.camera);
    // project() gives normalized device coords (-1 to 1)
    return {
      x: (v.x * 0.5 + 0.5) * this.width,
      y: (-v.y * 0.5 + 0.5) * this.height  // flip Y for canvas
    };
  }
  
  _minimapToWorld(event: PointerEvent) {
    const rect = this.overlayCanvas.getBoundingClientRect();
    // Convert click to normalized device coords (-1 to 1)
    const ndc = new THREE.Vector3(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
      0
    );
    ndc.unproject(this.camera);
    // Camera looks straight down, so just grab x/z and use ground height
    return new THREE.Vector3(ndc.x, 0, ndc.z);
  }

  _handleCanvasClick(event: PointerEvent) {
    console.log('CLICK', event);
    const pos = this._minimapToWorld(event);
    console.log('POS', pos);

    if (event.shiftKey) {
      this.dispatchEvent(new CustomEvent('updateStart', { detail: pos }));
    } else {
      this.dispatchEvent(new CustomEvent('updateAim', { detail: pos }));
    }
  }

  updatePosition(startPoint: THREE.Vector3, endPoint: THREE.Vector3) {
    // const tee = currentHole().waypoints.get('tee');
    // const hole = currentHole().waypoints.get('hole');

    // Center camera between tee and hole
    const mid = new THREE.Vector3().addVectors(startPoint, endPoint).multiplyScalar(0.5);
    this.camera.position.set(mid.x, 200, mid.z);

    // Rotate so tee→hole runs bottom-to-top on screen
    const dir = new THREE.Vector3().subVectors(endPoint, startPoint);
    dir.y = 0;
    const dist = dir.length();
    dir.normalize();

    this.camera.up.set(dir.x, 0, dir.z);
    this.camera.lookAt(mid.x, 0, mid.z);

    // Size the frustum to fit, respecting your minimap aspect ratio
    const aspect = this.width / this.height; // 200/300
    const padding = 1.2;
    const halfH = (dist / 2) * padding;
    const halfW = halfH * aspect;

    this.camera.left = -halfW;
    this.camera.right = halfW;
    this.camera.top = halfH;
    this.camera.bottom = -halfH;
    this.camera.updateProjectionMatrix();

  }
}