import {
  THREE,
  app,
  AimPoint,
  CourseLight,
  CourseKeyboardControls,
  GolfBall,
  GroundPhysics,
  ShotPerspectiveCamera,
  UIShotData,
  UIRangeFinder,
  UILoadingScreen,
  UIStats,
  UnitConversions,
  VolumetricClouds,
  MeshLoader,
  YardageLinesMaterial,
  FlatGrassShaderMaterial
} from '@opengolfsim/fuse';
import rangeMtnsModel from './models/rangeMtns.glb?url';
import fairwayTexture from './textures/gen_fairway_tex.png?url';
import fairwayMap from './textures/gen_fairway_map.png?url';
import { CourseSurfaces } from '@/courses/surfaces';

const sunColor = new THREE.Color('#fffbec');
const skyColor = new THREE.Color('#d5e4e9');
const fogColor = new THREE.Color('#7e9096');
const cloudColor = new THREE.Color('#ffffff');
const mountainColor = new THREE.Color('#687e80');
const hashMarks = [50, 100, 150, 200, 250, 300];

const gameContext = {
  timer: new THREE.Timer(),
  startPoint: new THREE.Vector3(0, 0, 0),
  aimPoint: new THREE.Vector3(0, 0, 200),
  setupData: null
};



function launchShot(shot) {
  if (shot.ballSpeed && !gameContext.golfBall.isShotActive) {

    gameContext.golfBall.launchShot(shot);
    gameContext.shotData.updateShotData(shot);
    // start tracking after a delay based on ball speed
    // the default is 3 seconds
    const trackingDelayScale = Math.min(shot.ballSpeed / 150, 1);
    gameContext.camera.setTracking(true, trackingDelayScale);
  }
}

function setupWorld() {
  gameContext.timer.connect(document);

  gameContext.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  gameContext.renderer.setSize(window.innerWidth, window.innerHeight);
  gameContext.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1));
  gameContext.renderer.shadowMap.enabled = true;
  gameContext.renderer.shadowMap.type = THREE.PCFShadowMap;

}

function setupShotButtons() {
const shotButtons = document.querySelectorAll(".test-shot");
  shotButtons.forEach(button => {
    button.addEventListener('click', () => {
      const shot = {
        ballSpeed: parseFloat(button.dataset.speed || 0),
        verticalLaunchAngle: parseFloat(button.dataset.vla || 0),
        horizontalLaunchAngle: parseFloat(button.dataset.hla || 0),
        spinAxis: parseFloat(button.dataset.axis || 0),
        spinSpeed: parseFloat(button.dataset.spin || 0),
      };
      launchShot(shot);
      console.log('button', shot);
    });
  });
}

async function createGroundPlane() {
  const rangeWidth = 500;
  const rangeHeight = 700;
  const widthRatio = rangeHeight / rangeWidth;
  const grassScale = 100;

  const textureLoader = new THREE.TextureLoader(gameContext.loadingScreen?.manager);
  const grassTexture = textureLoader.load(fairwayTexture);
  console.log('grassTexture', grassTexture);
  grassTexture.wrapS = THREE.RepeatWrapping;
  grassTexture.wrapT = THREE.RepeatWrapping;
  grassTexture.repeat.set(grassScale, grassScale * widthRatio); // tile 50x across, 100x down the 100x200 plane
  grassTexture.colorSpace = THREE.SRGBColorSpace; // correct color rendering
  grassTexture.anisotropy = gameContext.renderer.capabilities.getMaxAnisotropy();
  console.log('MAX ANISOTROPY', gameContext.renderer.capabilities.getMaxAnisotropy());
  
  const grassNormalMap = textureLoader.load(fairwayMap);
  grassNormalMap.wrapS = THREE.RepeatWrapping;
  grassNormalMap.wrapT = THREE.RepeatWrapping;
  grassNormalMap.repeat.set(grassScale, grassScale * widthRatio); // tile 50x across, 100x down the 100x200 plane
  grassNormalMap.colorSpace = THREE.SRGBColorSpace; // correct color rendering
  grassNormalMap.anisotropy = gameContext.renderer.capabilities.getMaxAnisotropy();
    
  let floorMaterial = new THREE.MeshStandardMaterial({
    name: 'floor',
    map: grassTexture,
    normalMap: grassNormalMap,
    roughness: 1,
    metalness: 0,
  });
  
  
    // Floor - Lighter wood planks
  // const floorGeometry = new THREE.PlaneGeometry(500, 700);
  const floorGeometry = new THREE.PlaneGeometry(rangeWidth, rangeHeight, 50, 70);

  gameContext.ground = new THREE.Mesh(floorGeometry, floorMaterial);
  gameContext.ground.rotation.x = -Math.PI / 2;
  gameContext.ground.position.y = 0;
  gameContext.ground.position.z = 140;
  gameContext.ground.receiveShadow = true;

  // console.log('mat', mat);

  gameContext.scene.add(gameContext.ground);
  
  gameContext.groundLines = gameContext.ground.clone();
  gameContext.groundLines.position.y = 0.001;
  gameContext.scene.add(gameContext.groundLines);

  
  gameContext.groundCollider = new GroundPhysics(gameContext.ground, app.world, app.rapier, {
    type: 'fairway',
    ...CourseSurfaces.fairway
  });  


  const downrange = new THREE.Vector3(0, 0, 1); // looking down -Z

  const distances = [...hashMarks].map(val => gameContext.setupData?.units === 'imperial' ? UnitConversions.yardsToMeters(val) : val);

  gameContext.yardageLines = new YardageLinesMaterial(
    gameContext.groundLines,
    gameContext.startPoint,
    downrange,
    distances,
    {
      lineWidth:  0.5,
      lineLength: 50,
      labels: hashMarks,
      lineColor:  [1, 1, 1, 0.5],
      feather:    0.2,   // 10% soft fade at each end
      texelsPerMeter: 40,
      // maxAnisotropy: gameContext.renderer.capabilities.getMaxAnisotropy(),
    }
  );

  gameContext.ground.material = new FlatGrassShaderMaterial(gameContext.ground.material, {
    blendNoiseScale: 0.1,
  });


  gameContext.mountain = await gameContext.meshLoader.load(rangeMtnsModel, true);

  const mountainMaterial = new THREE.MeshStandardMaterial({
    map: grassTexture,
    normalMap: grassNormalMap,
    roughness: 1,
    color: mountainColor,
    displacementScale: 0.5,
    roughness: 1.9,
    normalScale: new THREE.Vector2(0, 0.5),
    metalness: 0
  });
  
  const offsetZ = 900;
  gameContext.mountain.material = mountainMaterial;
  gameContext.mountain.position.set(0, -12, offsetZ);
  gameContext.mountain.scale.set(20, 20, 20);
  gameContext.scene.add(gameContext.mountain);


}


async function loadRange() {
  
  setupWorld();

  gameContext.meshLoader = new MeshLoader(gameContext.loadingScreen?.manager);

  gameContext.scene = new THREE.Scene();
  gameContext.scene.background = skyColor;
  gameContext.lightGroup = new CourseLight(sunColor);
  gameContext.scene.add(gameContext.lightGroup);

  gameContext.fog = new THREE.Fog(fogColor, 200, 1000);
  gameContext.scene.fog = gameContext.fog;

  await createGroundPlane();

  gameContext.camera = new ShotPerspectiveCamera(gameContext.renderer, gameContext.ground, {
    // fov: 20,
    // near: 0.5,
    // far: 1000,
    cameraOffsetX: -(gameContext.setupData.cameraOffset / 100),
    // cameraOffsetYZ: [1.4, 9],
  });

  gameContext.visualAimPoint = new AimPoint(gameContext.camera, {
    units: gameContext.setupData.units
  });
  gameContext.scene.add(gameContext.visualAimPoint.object);

  gameContext.controls = new CourseKeyboardControls({ testShots: true });
  gameContext.controls.on('aim', aimKeys => {
    gameContext.camera.aimKeys = aimKeys;
  });
  gameContext.controls.on('toggleStats', () => gameContext.stats.toggle());
  gameContext.controls.on('testShot', shot => launchShot(shot));
  
  gameContext.stats = new UIStats('#render-stats', { hidden: false }); // start hidden (press S to toggle)

  // Sky/Clouds
  gameContext.clouds = new VolumetricClouds(gameContext.camera, {
    radius: 800,
    density: 0.4,
    opacity: 0.8,
    scale: 6,
    skyColor,
    fogColor,
    cloudColor,
    position: new THREE.Vector3(0, 0, 0)
  });
  gameContext.scene.add(gameContext.clouds.object);
  
  gameContext.golfBall = new GolfBall(gameContext.scene, app.world, app.rapier, {
    setupData: gameContext.setupData,
    clearTrail: 'start'
  });
  gameContext.golfBall.on('shotEnded', onShotEnded);

  gameContext.shotData = new UIShotData('#shot-data', { units: gameContext.setupData?.units });
  gameContext.rangeFinder = new UIRangeFinder('#top-center', { units: gameContext.setupData?.units });

  setupNextShot();
}

async function setupRange() {
  gameContext.loadingScreen = new UILoadingScreen(document.body);
  gameContext.loadingScreen.on('load', () => {
    console.log('ALL LOADED!');
    requestAnimationFrame(animate);
  });
  gameContext.loadingScreen.load(loadRange);
}

function onShotEnded() {
  console.log('Shot ended!');
  setupNextShot();
}

async function initializeSetup(payload) {
  console.log(`setup from within app:`, payload);
  gameContext.setupData = payload.setupData;
  await setupRange();
}

async function initializeDebug() {
  gameContext.setupData = testSetupData();
  await setupRange();
  setupShotButtons();
  console.log('ready');
}


function testSetupData() {
  const clubs = [
    { fullName: 'Driver', name: 'DR', id: 'DR', distance: 180 },
    { fullName: '5 Iron', name: '5i', id: '5I', distance: 150 },
    { fullName: 'Pitching Wedge', name: 'PW', id: 'PW', distance: 100 },
    { fullName: 'Putter', name: 'P', id: 'PT', distance: 0 }
  ];
  return {
    units: 'imperial',
    players: [
      {
        name: 'Player One',
        id: 'player-1',
        clubs: [...clubs]
      },
      {
        name: 'Player Two',
        id: 'player-2',
        clubs: [...clubs]
      }
    ],
    cameraOffset: 0,
    puttingEnabled: false,
    gimmesEnabled: true,
    gimmeDistances: [10, 20],
    elevation: 0,
    gameMode: 2,
  }
}

function setupNextShot(event) {
  gameContext.camera.setTracking(false);
  gameContext.camera.setPositions(gameContext.startPoint, gameContext.aimPoint);
  // recreate ball after each shot to ensure physics are fully reset
  gameContext.golfBall.reset(gameContext.aimPoint, gameContext.startPoint);
  updateAimPoint()
}

function updateAimPoint() {
  gameContext.distanceToAim = gameContext.startPoint.distanceTo(gameContext.aimPoint);
  gameContext.heightToAim = gameContext.startPoint.y - gameContext.aimPoint.y;
  gameContext.rangeFinder.update(gameContext.distanceToAim, gameContext.heightToAim);
  gameContext.golfBall.aimAt(gameContext.aimPoint);
}

function animate(animDelta) {
  requestAnimationFrame(animate);
  // console.log('start anim', gameContext);
  gameContext.stats.begin();  
  const delta = gameContext.timer.getDelta();   

  if (gameContext.golfBall) {
    gameContext.golfBall.update(delta);
  }

  gameContext.renderer.clear();

  if (gameContext.controls) gameContext.controls.update(delta);
  
  if (gameContext.clouds) gameContext.clouds.update(delta);

  
  if (gameContext.camera) {
    // gameContext.yardageLines.update(gameContext.camera);

    const aimChanged = gameContext.camera.update(delta, gameContext.golfBall, gameContext.startPoint, gameContext.aimPoint);
    if (aimChanged) {
      updateAimPoint();
    }
    // gameContext.camera.render(gameContext.scene);    
    gameContext.camera.render(gameContext.scene, gameContext.fog);
  }
  // should come after the camera update
  gameContext.visualAimPoint?.update(gameContext.aimPoint, gameContext.distanceToAim, gameContext.heightToAim, gameContext.golfBall.isShotActive);
  
  if (gameContext.shotData && gameContext.golfBall) {
    gameContext.shotData.updateShotResult(gameContext.golfBall.stats);
  }
  
  gameContext.stats.end();
  gameContext.timer.update(animDelta);

}
// use this on load of page, with test data
app.initialize(initializeDebug);
// sent by OpenGolfSim Desktop/Mobile apps
app.on('setup', initializeSetup);
// sent by OpenGolfSim Desktop/Mobile apps
app.on('shot', shot => launchShot(shot));
