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
import Stats from 'three/addons/libs/stats.module';
import { MeshLineGeometry, MeshLineMaterial } from 'meshline'

import RAPIER from '@dimforge/rapier3d-compat';

// import { UIShotData, UIRangeFinder, UIPlayerMenu } from '@/ui';
import { UIPlayerMenu } from '@/ui/UIPlayerMenu';
import { UIRangeFinder } from '@/ui/UIRangeFinder';
import { UIShotData } from '@/ui/UIShotData';
import { AppBridge } from '@/app';
import { BallPhysics } from '@/physics/ballPhysics';
import { GroundPhysics, GroundUtils } from '@/physics/groundPhysics';
import { GolfBall } from '@/objects/golfBall';
import { BallTrail } from '@/objects/ballTrail';
import { VolumetricClouds, SkyBox } from '@/sky';
import { TreePlanter } from '@/trees';
import { ShotPerspectiveCamera } from '@/camera';
import { CourseKeyboardControls } from '@/controls';
import { CourseMap } from '@/map';
import { CourseLoader } from '@/courses/loader';
import { CourseGame } from '@/courses/game';
import { CourseLight } from '@/lights';
import { WaterSurface } from '@/shaders/water';
import { SandShaderMaterial } from '@/shaders/sand';
import { FlagStick } from '@/objects/flagStick';
import { AimPoint } from '@/objects/aimPoint';
import { UnitConversions } from '@/utils/units';

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
window.Stats = Stats;

window.RAPIER = RAPIER;
window.GRAVITY = { x: 0, y: -9.81, z: 0 };
// custom elements
window.GolfBall = GolfBall;
window.BallTrail = BallTrail;
window.VolumetricClouds = VolumetricClouds;
window.SkyBox = SkyBox;
window.GroundUtils = GroundUtils;
window.GroundPhysics = GroundPhysics;
window.BallPhysics = BallPhysics;
window.TreePlanter = TreePlanter;
window.WaterSurface = WaterSurface;
window.ShotPerspectiveCamera = ShotPerspectiveCamera;
window.CourseKeyboardControls = CourseKeyboardControls;
window.CourseMap = CourseMap;
window.CourseLoader = CourseLoader;
window.CourseGame = CourseGame;
window.CourseLight = CourseLight;
// shaders
window.SandShaderMaterial = SandShaderMaterial;
window.UIShotData = UIShotData;
window.UIRangeFinder = UIRangeFinder;
window.UIPlayerMenu = UIPlayerMenu;
// objects
window.AimPoint = AimPoint;
window.FlagStick = FlagStick;
window.UnitConversions = UnitConversions;

window.OpenGolfSimVersion = pkg.version;
window.app = new AppBridge(RAPIER);
