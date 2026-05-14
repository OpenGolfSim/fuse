import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls';
import { FlyControls } from 'three/addons/controls/FlyControls';
import { Line2 } from 'three/addons/lines/Line2';
import { LineGeometry } from 'three/addons/lines/LineGeometry';
import { LineMaterial } from 'three/addons/lines/LineMaterial';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader';
import { Water } from 'three/addons/objects/Water';
import { RenderPass } from 'three/addons/postprocessing/RenderPass';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass';
import { MeshLineGeometry, MeshLineMaterial } from 'meshline'

import RAPIER from '@dimforge/rapier3d-compat';
// import * as ogsUI from './ui';
import { UIShotData, UIRangeFinder } from './ui';
import { app } from './app';
import { BallPhysics, GroundPhysics, Heightfield } from './physics';
import { BallTrail } from './ballTrail';
import { GroundUtils } from './groundUtils';
import { VolumetricClouds, SkyBox } from './sky';
import { TreePlanter } from './trees';
import { WaterSurface } from './water';
import { ShotPerspectiveCamera, CourseMap } from './camera';
import { CourseLoader } from './course';
import { CourseLight } from './lights';
import { SandShaderMaterial } from './shaders/sand';
import { GrassShaderMaterial } from './shaders/grass';
import { extractTintAttribute } from './shaders/utils';
import pkg from '../package.json';
import './css/base.css';

window.THREE = THREE;
window.OrbitControls = OrbitControls;
window.FlyControls = FlyControls;
window.Line2 = Line2;
window.LineGeometry = LineGeometry;
window.LineMaterial = LineMaterial;
window.GLTFLoader = GLTFLoader;
window.EXRLoader = EXRLoader;
window.DRACOLoader = DRACOLoader;
window.Water = Water;
window.RenderPass = RenderPass;
window.EffectComposer = EffectComposer;
window.UnrealBloomPass = UnrealBloomPass;
window.MeshLineGeometry = MeshLineGeometry;
window.MeshLineMaterial = MeshLineMaterial;

window.RAPIER = RAPIER;

// custom elements
window.BallTrail = BallTrail;
window.VolumetricClouds = VolumetricClouds;
window.SkyBox = SkyBox;
window.GroundUtils = GroundUtils;
window.GroundPhysics = GroundPhysics;
window.Heightfield = Heightfield;
window.BallPhysics = BallPhysics;
window.TreePlanter = TreePlanter;
window.WaterSurface = WaterSurface;
window.ShotPerspectiveCamera = ShotPerspectiveCamera;
window.CourseMap = CourseMap;
window.CourseLoader = CourseLoader;
window.CourseLight = CourseLight;
// shaders
window.SandShaderMaterial = SandShaderMaterial;
window.GrassShaderMaterial = GrassShaderMaterial;
window.ShaderUtils = { extractTintAttribute };
window.UIShotData = UIShotData;
window.UIRangeFinder = UIRangeFinder;

window.openGolfSim = { _version: pkg.version, app };

// document.addEventListener('DOMContentLoaded', () => {
//   const uiRoot = document.createElement('div');
//   uiRoot.setAttribute('id', 'ui-root');
//   document.body.prepend(uiRoot);
//   ogsUI.setupDefaultUI(uiRoot);
// });

/**
 * Rapier needs async init before use, so we expose a custom window event (engine.ready)
 * 
 * window.addEventListener('engine.ready', () => {
 *   // three.js + rapier are ready, setup your game
 * })
 */
// that game code can await before doing anything
window.RAPIER_READY = RAPIER.init().then(() => {
  console.log('[runtime] Rapier initialized');
  const readyEvent = new CustomEvent('engine.ready', { detail: {} });
  window.dispatchEvent(readyEvent);
});