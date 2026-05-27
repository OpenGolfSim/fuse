import {
  THREE,
  app,
  AimPoint,
  CourseLight,
  CourseLoader,
  CourseMap,
  CourseGame,
  CourseKeyboardControls,
  GolfBall,
  GroundPhysics,
  ShotPerspectiveCamera,
  Stats,
  UIShotData,
  UIRangeFinder,
  UIPlayerMenu,
  UILoadingScreen,
  UnitConversions,
  VolumetricClouds,
 } from '@opengolfsim/fuse';

const gameContext = {
  world: null,
  scene: null,
  renderer: null,
  course: null,
  timer: new THREE.Timer(),
  startPoint: new THREE.Vector3(0, 0, 0),
  aimPoint: new THREE.Vector3(0, 0, 0)
};

let canvas;


const lights = {};

const defaultSkyColor = 'rgb(192, 215, 241)';
const lightColor = new THREE.Color('rgb(255, 255, 253)');

let trackTimeout;

function launchShot(shot) {
  console.log('Received new shot!', shot);
  if (shot.ballSpeed && !gameContext.golfBall.isShotActive) {
    // aimMarker.visible = false;
    // // preShot();
    // gameContext.isShotActive = true;

    gameContext.golfBall.launchShot(shot);
    
    gameContext.shotData.updateShotData(shot);
    const trackingScale = Math.min(shot.ballSpeed / 150, 1);
    gameContext.camera.setTracking(true, trackingScale);
  }
}

function setupNextShot(event) {
  console.log('setupNextShot', event);

  gameContext.camera.setTracking(false);
  
  // const startPoint = gameContext.game.startPoint();
  gameContext.startPoint.copy(gameContext.game.startPoint());
  gameContext.aimPoint.copy(gameContext.game.aimPoint());

  // const aimPoint = gameContext.game.aimPoint();

  gameContext.camera.setPositions(gameContext.startPoint, gameContext.aimPoint);

  // recreate ball after each shot to ensure physics are fully reset
  gameContext.golfBall.reset(gameContext.aimPoint, gameContext.startPoint);  
  // aimMarker.visible = true;

  // calculate distance to aim point in UI
  const distFromAim = gameContext.aimPoint.distanceTo(gameContext.golfBall.object.position);
  const heightDiff = gameContext.golfBall.object.position.y - gameContext.aimPoint.y;
  gameContext.rangeFinder.update(distFromAim, heightDiff);

  // const pinPosition = gameContext.game.pinPoint().waypoints.get('pin');
  
  gameContext.courseMap.updatePosition(gameContext.startPoint, gameContext.game.pinPoint());
  gameContext.courseMap.updateHole(gameContext.game.activeHole);
  gameContext.playerMenu.update(gameContext.game.currentPlayer());
}

async function onProgress(progress) {
  document.getElementById('progress-bar-fill').style.width = `${progress.percent.toFixed(1)}%`;
  document.getElementById('progress-text').textContent = `${progress.percent.toFixed(0)}%`;
}

function onHoleEnded() {
  console.log('onHoleEnded[main]');
  gameContext.playerMenu.update(gameContext.game.currentPlayer());
}

function onShotEnded() {
  console.log('onShotEnded[main]');
  gameContext.playerMenu.update(gameContext.game.currentPlayer());
}

function createStats() {
  gameContext.stats = new Stats();
  // stats.dom.style.width = '80px';
  // stats.dom.style.height = '48px';
  // stats.dom.style.position = 'fixed';
  // // stats.dom.style.left = '20px';
  // stats.dom.style.bottom = '10px';
  // stats.dom.style.right = '10px'; // move to top-right
  const statsContainer = document.createElement('div');
  Object.assign(statsContainer.style, {
    position: 'fixed',
    width: '80px',
    height: '48px',
    bottom: '10px',
    right: '10px',
    // left: 'auto',
    zIndex: '9999'
  });
  gameContext.stats.dom.style.cssText = 'position: relative;';
  statsContainer.appendChild(gameContext.stats.dom);
  document.body.appendChild(statsContainer);
}

function setupWorld() {
  canvas = document.getElementById('canvas');
  gameContext.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  gameContext.renderer.setSize(window.innerWidth, window.innerHeight);
  gameContext.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1));
  gameContext.renderer.shadowMap.enabled = true;
  gameContext.renderer.shadowMap.type = THREE.PCFShadowMap;
}

// helpers, move to core?
function setupScene() {
  const skyType = gameContext.course?.sceneSettings?.sky?.type;
  const clouds = gameContext.course?.sceneSettings?.sky?.clouds;
  console.log('clouds', skyType, clouds);
  gameContext.scene = new THREE.Scene(); 
  gameContext.scene.background = new THREE.Color(clouds?.skyColor ?? defaultSkyColor);

  gameContext.fog = new THREE.Fog(clouds?.fogColor ?? fogColor, 100, 800);
  gameContext.scene.fog = gameContext.fog;

  gameContext.lightGroup = new CourseLight(gameContext.scene, lightColor);
  gameContext.scene.add(gameContext.lightGroup);

  gameContext.camera = new ShotPerspectiveCamera(30, 0.5, 1000, gameContext.renderer, gameContext.course.getGroundMeshes());
  gameContext.courseMap = new CourseMap();
  // gameContext.controls = new OrbitControls( gameContext.camera, gameContext.renderer.domElement );
  gameContext.controls = new CourseKeyboardControls({ testShots: true });
  gameContext.controls.on('aim', aimKeys => {
    gameContext.camera.aimKeys = aimKeys;
  });
  gameContext.controls.on('testShot', launchShot);
  gameContext.controls.on('toggleStats', () => {
    const hidden = gameContext.stats.dom.style.display === 'none';
    gameContext.stats.dom.style.display = hidden ? 'block' : 'none';
  });

  gameContext.visualAimPoint = new AimPoint();
  gameContext.scene.add(gameContext.visualAimPoint.object);

  // Sky/Clouds
  gameContext.clouds = new VolumetricClouds(gameContext.camera, {
    radius: 800,
    density: clouds?.density ?? 0.4,
    opacity: clouds?.opacity ?? 0.8,
    scale: clouds?.scale ?? 6,
    skyColor: new THREE.Color(clouds?.skyColor ?? defaultSkyColor),
    cloudColor: clouds?.cloudColor && new THREE.Color(clouds?.cloudColor),
    fogColor: clouds?.fogColor && new THREE.Color(clouds?.fogColor),
    // position: new THREE.Vector3(0, -50, 0)
    position: new THREE.Vector3(clouds?.position ?? [0, -50, 0])
  });
  gameContext.scene.add(gameContext.clouds.object);
  
  // gameContext.playerMenu = new UIPlayerMenu('#top-left');
  gameContext.shotData = new UIShotData('#shot-data', { units: gameContext.setupData?.units });
  gameContext.rangeFinder = new UIRangeFinder('#top-center', { units: gameContext.setupData?.units });
  gameContext.playerMenu = new UIPlayerMenu('#top-left');
}

function getObjectBounds(obj) {
  const box = new THREE.Box3().setFromObject(obj);
  const center = new THREE.Vector3();
  box.getCenter(center);
  const size = new THREE.Vector3();
  box.getSize(size);
  return { size, center };
}

async function setupCourse(coursePath, setupData) {
  
  setupWorld();
  
  // load course details and meshes
  gameContext.course = new CourseLoader(app.world, app.rapier, setupData, gameContext.loadingScreen.manager);
  // gameContext.course.on('progress', onProgress);

  gameContext.setupData = setupData;

  await gameContext.course.load(coursePath);
  
  console.log('Course loaded', gameContext.course);
  console.log('Course settings', gameContext.course.sceneSettings);

  setupScene();

  const bounds = getObjectBounds(gameContext.course.scene);
  // console.log('Course bounds', bounds);
  gameContext.scene.add(gameContext.course.scene);

  gameContext.golfBall = new GolfBall(gameContext.scene, app.world, app.rapier);
  
  gameContext.game = new CourseGame(gameContext.course, gameContext.golfBall, gameContext.setupData);
  gameContext.game.addEventListener('nextShot', setupNextShot);
  
  gameContext.aimPoint.copy(gameContext.game.aimPoint());

  gameContext.playerMenu.update(gameContext.game.currentPlayer());
  gameContext.courseMap.updatePosition(gameContext.game.startPoint(), gameContext.aimPoint);
  gameContext.courseMap.updateHole(gameContext.game.activeHole);
  gameContext.courseMap.addEventListener('updateAim', adjustAimPoint);
  gameContext.courseMap.addEventListener('updateStart', adjustStartPoint);
}

function adjustStartPoint(event) {
  const newPosition = event.detail;
  console.log('update start', newPosition);
  const ground = gameContext.course.getGroundY(newPosition.x, newPosition.z);
  if (ground) {
    newPosition.y = ground.y;
  }
  gameContext.game.updateStartPoint(newPosition);
  setupNextShot();
}

function adjustAimPoint(event) {
  const newPosition = event.detail;
  // console.log('update aim', newPosition);
  const ground = gameContext.course.getGroundY(newPosition.x, newPosition.z);
  if (ground) {
    newPosition.y = ground.y;
  }
  // console.log('find ground', newPosition);
  gameContext.aimPoint.copy(newPosition);
  gameContext.camera.setPositions(gameContext.game.startPoint(), gameContext.aimPoint);
  updateAimPoint();
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
    practiceMode: false,
    puttingEnabled: false,
    gimmesEnabled: true,
    gimmeDistances: [10, 20],
    elevation: 0,
    gameMode: 2,
  }
}


async function initialize(payload) {
  preLoad();
  console.log('SETUP RECEIVED', payload);
  if (!payload?.setupData) {
    throw new Error('Missing setupData');
  }
  if (!payload?.gameData?.courseUrl) {
    throw new Error('Missing courseUrl in gameData');
  }

  // test data
  // const courseUrl = './MountainVista.glb';
  // // pretend we're given a URL and setupData
  // const setupData = testSetupData();
  await setupCourse(payload.gameData.courseUrl, payload.setupData);
  console.log('POST SETUP');
  postLoad();
}

let isLoaded = false;
let isSetup = false;

function preLoad() {
  gameContext.loadingScreen = new UILoadingScreen();
  gameContext.loadingScreen.on('load', () => {
    // requestAnimationFrame(animate);
    console.log('POST LOAD');
    isLoaded = true;
  });
  createStats();
  gameContext.timer.connect(document);
}

function postLoad() {
  setupNextShot();

  // canvas.style.visibility = 'visible';
  // splash.addEventListener('transitionend', () => splash.style.display = 'none');
  // splash.style.opacity = 0;

  requestAnimationFrame(animate);
}



function updateAimPoint() {
  const dist = gameContext.aimPoint.distanceTo(gameContext.startPoint);
  const heightDiff = gameContext.startPoint.y - gameContext.aimPoint.y;
  gameContext.rangeFinder.update(dist, heightDiff);
  gameContext.golfBall.aimAt(gameContext.aimPoint);
}

function animate(animDelta) {
  requestAnimationFrame(animate);
  gameContext.stats.begin();
  const delta = gameContext.timer.getDelta();
  // const frameDelta = Math.min(delta, 0.1);
  
  // accumulator += frameDelta;
  // // Fixed-timestep physics
  // while (accumulator >= FIXED_DT) {
  //   gameContext.golfBall.physics.update(FIXED_DT);
  //   accumulator -= FIXED_DT;
  // }
  if (gameContext.golfBall) {
    gameContext.golfBall.update(delta);
  }

  gameContext.renderer.clear();

  // main camera, full screen
  const { width, height } = gameContext.renderer.getSize(new THREE.Vector2());
  gameContext.renderer.setViewport(0, 0, width, height);

  // gameContext.renderer.render(gameContext.scene, gameContext.camera);
  gameContext.camera.render(gameContext.scene, gameContext.fog);

  if (gameContext.clouds) gameContext.clouds.update(delta);
  if (gameContext.course) gameContext.course.update(delta, gameContext.camera);
  if (gameContext.game) gameContext.game.update(delta);
  if (gameContext.visualAimPoint) gameContext.visualAimPoint.update(gameContext.aimPoint, gameContext.camera, gameContext.golfBall.isShotActive);

  if (gameContext.courseMap) {
    gameContext.courseMap.render(
      gameContext.scene,
      gameContext.game.activeHole,
      {
        ball: gameContext.startPoint,
        aim: gameContext.aimPoint,
      }
    );
  }
  if (gameContext.controls) gameContext.controls.update(delta);

  if (gameContext.camera) {
    const aimChanged = gameContext.camera.update(delta, gameContext.golfBall, gameContext.startPoint, gameContext.aimPoint);
    if (aimChanged) {
      updateAimPoint();
      // const dist = gameContext.aimPoint.distanceTo(gameContext.startPoint);
      // const heightDiff = gameContext.startPoint.y - gameContext.aimPoint.y;
      // gameContext.rangeFinder.update(dist, heightDiff);
      // gameContext.golfBall.aimAt(gameContext.aimPoint);
    }
    
    gameContext.shotData.updateShotResult(gameContext.golfBall.stats);
  }

  gameContext.stats.end();
  gameContext.timer.update(animDelta);
}

async function initializeDebug() {
  const params = new URLSearchParams(window.location.search);
  const courseUrl = params.get('courseUrl');
  console.log('LOAD COURSE', courseUrl);
  if (courseUrl) {
    preLoad();
    await setupCourse(courseUrl, testSetupData());
    postLoad();
  }
}

/**
 * Required setup for OpenGolfSim FUSE
 */
// listen for setup event from OpenGolfSim app
app.on('setup', initialize);
// listen for shot event from OpenGolfSim app
app.on('shot', launchShot);
// initialize must be called before engaging physics/world
app.initialize(() => {
  if (window.location.search) {
    initializeDebug();
  }
});