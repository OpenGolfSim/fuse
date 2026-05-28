import * as THREE from 'three';
import { GroundUtils } from '@/physics/groundPhysics';
import { type GolfBall } from '@/objects/golfBall';

export type AimKeys = { left: boolean, right: boolean, forward: boolean, backward: boolean };

type ShotPerspectiveCameraOptions = {
  fov?: number,
  near?: number,
  far?: number,
  trackingDelay?: number;
  cameraOffsetX?: number;
  cameraOffsetYZ?: [number, number];
  cameraTrackingOffsetYZ?: [number, number];
}

export class ShotPerspectiveCamera extends THREE.PerspectiveCamera {
  scene: THREE.Object3D | THREE.Object3D[];
  renderer: THREE.WebGLRenderer;
  shotDirection: THREE.Vector3;
  staticCamPos: THREE.Vector3;
  staticLookAt: THREE.Vector3;
  currentLookAt: THREE.Vector3;
  desiredCamPos: THREE.Vector3;
  desiredLookAt: THREE.Vector3;
  // cameraOffset: THREE.Vector3;
  cameraOffsetYZ: [number, number];
  cameraTrackingOffsetYZ: [number, number];
  cameraOffsetX: number;
  isTracking: boolean;
  aimVelocity: { lateral: number, longitudinal: number };
  aimSpeed: number;
  aimKeys: AimKeys;
  trackingDelay: number;
  
  #lastGroundCheck: THREE.Vector3;
  #groundY: number;
  #right: THREE.Vector3;
  #up: THREE.Vector3;
  #trackTimeout: number;
  #activeFrustumOffset: number = 0;
  #tmpBack: THREE.Vector3;
  #tmpRight: THREE.Vector3;


  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Object3D | THREE.Object3D[],
    options: ShotPerspectiveCameraOptions = {}
  ) {
    const aspect = (window.innerWidth / window.innerHeight);
    const fov = options.fov ?? 20;
    const near = options.near ?? 0.75;
    const far = options.far ?? 900;
    super(fov, aspect, near, far);
    this.scene = scene;
    this.renderer = renderer;

    // defaults
    this.cameraOffsetX = options.cameraOffsetX ?? 0;
    this.cameraOffsetYZ = options.cameraOffsetYZ ?? [1.5, 10];
    this.cameraTrackingOffsetYZ = options.cameraTrackingOffsetYZ ?? [4.5, 15];
    // this.cameraOffset = new THREE.Vector3(this.cameraOffsetX, this.cameraOffsetYZ[0], this.cameraOffsetYZ[1]);

    this.#activeFrustumOffset = this.cameraOffsetX;
    this.projectionMatrix.elements[8] = this.#activeFrustumOffset;
    this.shotDirection = new THREE.Vector3();
    this.staticCamPos = new THREE.Vector3();
    this.staticLookAt = new THREE.Vector3();
    this.currentLookAt = new THREE.Vector3();
    this.desiredCamPos = new THREE.Vector3();
    this.desiredLookAt = new THREE.Vector3();
    
    this.isTracking = false;
    this.layers.enable(2);
    
    this.aimVelocity = { lateral: 0, longitudinal: 0 };
    this.#lastGroundCheck = new THREE.Vector3();
    this.#groundY = 0;
    this.#right = new THREE.Vector3();
    this.#up = new THREE.Vector3(0, 1, 0);
    // Initialize in constructor
    this.#tmpBack = new THREE.Vector3();
    this.#tmpRight = new THREE.Vector3();

    this.aimSpeed = 7; // meters per second
    this.aimKeys = { left: false, right: false, forward: false, backward: false };    
    this.trackingDelay = options.trackingDelay ?? 3000;
    this.#trackTimeout = 0;
    
    window.addEventListener('resize', this._handleResize.bind(this));
  }
  _handleResize() {
    this.aspect = window.innerWidth / window.innerHeight;
    this.updateProjectionMatrix();
    this.projectionMatrix.elements[8] = this.#activeFrustumOffset;
    if (this.renderer) {
      this.renderer.setSize(window.innerWidth, window.innerHeight);  
    }
  }
  
  applyFrustumOffset(dt: number, target: number, smooth: boolean) {
    if (smooth) {
      const t = 1 - Math.exp(-Math.min(dt, 1 / 60) * 3);
      this.#activeFrustumOffset += (target - this.#activeFrustumOffset) * t;
    } else {
      if (this.#activeFrustumOffset === target) return;
      this.#activeFrustumOffset = target;
    }
    this.projectionMatrix.elements[8] = this.#activeFrustumOffset;
  }


  // updateProjectionMatrix() {
  //   super.updateProjectionMatrix();
  //   if (this.cameraOffset) {
  //     this.projectionMatrix.elements[8] += this.#activeFrustumOffset;
  //   }

  // }


  setTracking(track: boolean, timeScale = 1) {
    clearTimeout(this.#trackTimeout);
    if (track) {
      const trackingDelay = Math.max(this.trackingDelay * timeScale, 500);
      this.#trackTimeout = setTimeout(() => {
        this.isTracking = true;
      }, trackingDelay);
    } else {
      this.isTracking = false;
    }
  }
  
  setPositions(startPoint: THREE.Vector3, aimPoint: THREE.Vector3) {
    // const back = new THREE.Vector3().subVectors(startPoint, aimPoint).normalize();
    const back = this.#tmpBack.subVectors(startPoint, aimPoint).normalize();
    back.y = 0;
    back.normalize();

    // const right = new THREE.Vector3().crossVectors(this.#up, back).normalize();
    // const right = this.#tmpRight.crossVectors(this.#up, back).normalize();

    // z = behind ball, y = height above ball
    this.staticCamPos.copy(startPoint)
      .addScaledVector(back, this.cameraOffsetYZ[1]);
    this.staticCamPos.y += this.cameraOffsetYZ[0];

    this.staticLookAt.copy(aimPoint);

    // x = lateral dolly: shift BOTH camera and lookAt by the same amount
    // so the whole frame slides left/right without changing the view angle
    // if (this.cameraOffset.x !== 0) {
    //   const lateralShift = right.clone().multiplyScalar(this.cameraOffset.x);
    //   this.staticCamPos.add(lateralShift);
    //   this.staticLookAt.add(lateralShift);
    // }

    this.shotDirection.subVectors(aimPoint, startPoint);
    this.shotDirection.y = 0;
    this.shotDirection.normalize();
  }

  updateAim(dt: number, startPoint: THREE.Vector3, aimPoint: THREE.Vector3) {
    const { left, right, forward, backward } = this.aimKeys;
    const ramp = 1 - Math.exp(-dt * 20);
    const decay = 1 - Math.exp(-dt * 12);

    const latTarget = left ? 1 : right ? -1 : 0;
    const lonTarget = forward ? 1 : backward ? -1 : 0;

    this.aimVelocity.lateral += (latTarget - this.aimVelocity.lateral) * (latTarget ? ramp : decay);
    this.aimVelocity.longitudinal += (lonTarget - this.aimVelocity.longitudinal) * (lonTarget ? ramp : decay);

    if (Math.abs(this.aimVelocity.lateral) < 0.001) this.aimVelocity.lateral = 0;
    if (Math.abs(this.aimVelocity.longitudinal) < 0.001) this.aimVelocity.longitudinal = 0;

    if (this.aimVelocity.lateral === 0 && this.aimVelocity.longitudinal === 0) return

    const dist = startPoint.distanceTo(aimPoint);
    const angleStep = this.aimSpeed * dt * (Math.PI / 180); // degrees per second

    if (this.aimVelocity.lateral !== 0) {
      const angle = this.aimVelocity.lateral * angleStep;
      const offset = this.#tmpBack.subVectors(aimPoint, startPoint);
      offset.applyAxisAngle(this.#up, angle);
      aimPoint.copy(startPoint).add(offset);
    }

    if (this.aimVelocity.longitudinal !== 0) {
      aimPoint.addScaledVector(this.shotDirection, this.aimVelocity.longitudinal * dist * angleStep);
    }

    const dx = aimPoint.x - this.#lastGroundCheck.x;
    const dz = aimPoint.z - this.#lastGroundCheck.z;
    const threshold = dist * 0.01; // 1% of distance to aim point
    if (dx * dx + dz * dz > threshold * threshold) {
      const ground = GroundUtils.getGroundYFromScene(this.scene, aimPoint.x, aimPoint.z);
      if (ground) {
        this.#groundY = ground.y;
      }
      this.#lastGroundCheck.set(aimPoint.x, 0, aimPoint.z);
    }
    aimPoint.y = THREE.MathUtils.lerp(aimPoint.y, this.#groundY, 0.3);

    this.setPositions(startPoint, aimPoint);
    return true;
  }

  render(scene: THREE.Scene, fog?: THREE.Fog) {
    if (fog) {
      scene.fog = fog;
    }
    this.renderer.render(scene, this);
  }


  update(dt: number, golfBall: GolfBall, startPoint: THREE.Vector3, aimPoint: THREE.Vector3) {
    if (dt && this.isTracking && golfBall.object) {
      const posSmooth  = 1 - Math.exp(-dt * 2.5);
      const lookSmooth = 1 - Math.exp(-dt * 3.5);
      const tmpBack = this.#tmpBack.copy(this.shotDirection).negate();

      this.staticCamPos.copy(startPoint)
    //   .addScaledVector(back, this.cameraOffsetYZ[1]);
    // this.staticCamPos.y += this.cameraOffsetYZ[0];

      this.desiredCamPos.copy(golfBall.object.position).addScaledVector(tmpBack, this.cameraTrackingOffsetYZ[1]);
      this.desiredCamPos.y += this.cameraTrackingOffsetYZ[0];
      this.desiredLookAt.copy(golfBall.object.position);

      this.position.lerp(this.desiredCamPos, posSmooth);
      this.currentLookAt.lerp(this.desiredLookAt, lookSmooth);
      this.lookAt(this.currentLookAt);
      this.applyFrustumOffset(dt, 0, true);
      return false;
    }
    // Only allow aiming when no shot is active
    let aimChanged = false;
    if (!golfBall.isShotActive) {
      aimChanged = !!this.updateAim(dt, startPoint, aimPoint);
    }

    this.position.copy(this.staticCamPos);
    this.currentLookAt.copy(this.staticLookAt);
    this.lookAt(this.currentLookAt);
    this.applyFrustumOffset(dt, this.cameraOffsetX, false);
    if (aimChanged) return true;

    return false;
  }
}