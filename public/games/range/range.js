// import {
//   THREE,
//   app,
//   CourseLight,
//   CourseKeyboardControls,
//   GolfBall,
//   GroundPhysics,
//   ShotPerspectiveCamera,
//   UIShotData,
//   UIRangeFinder,
//   UnitConversions,
//   VolumetricClouds,
//  } from '/dist/fuse.js';

console.log('THREE', THREE);

const yardages = [50, 100, 150, 200, 250, 300];

const gameContext = {
  timer: new THREE.Timer(),
  startPoint: new THREE.Vector3(0, 0, 0),
  aimPoint: new THREE.Vector3(0, 0, 200)
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

function createGroundPlane() {
  const textureLoader = new THREE.TextureLoader();
  const grassTexture = textureLoader.load('https://coursedata.opengolfsim.com/webgl/assets/textures/gen_fairway_tex.png');
  
  grassTexture.wrapS = THREE.RepeatWrapping;
  grassTexture.wrapT = THREE.RepeatWrapping;
  grassTexture.repeat.set(50, 100); // tile 50x across, 100x down the 100x200 plane
  grassTexture.colorSpace = THREE.SRGBColorSpace; // correct color rendering
  grassTexture.anisotropy = gameContext.renderer.capabilities.getMaxAnisotropy();
  
  const grassNormalMap = textureLoader.load('https://coursedata.opengolfsim.com/webgl/assets/textures/gen_fairway_map.png');
  grassNormalMap.wrapS = THREE.RepeatWrapping;
  grassNormalMap.wrapT = THREE.RepeatWrapping;
  grassNormalMap.repeat.set(50, 100); // tile 50x across, 100x down the 100x200 plane
  grassNormalMap.colorSpace = THREE.SRGBColorSpace; // correct color rendering
  grassNormalMap.anisotropy = gameContext.renderer.capabilities.getMaxAnisotropy();
    
  const floorMaterial = new THREE.MeshStandardMaterial({
    map: grassTexture,
    normalMap: grassNormalMap,
    roughness: 1,
    metalness: 0,
  });
    // Floor - Lighter wood planks
  const floorGeometry = new THREE.PlaneGeometry(500, 700);
  
  gameContext.ground = new THREE.Mesh(floorGeometry, floorMaterial);
  gameContext.ground.rotation.x = -Math.PI / 2;
  gameContext.ground.position.y = 0;
  gameContext.ground.position.z = 140;
  gameContext.ground.receiveShadow = true;
  gameContext.scene.add(gameContext.ground);

  gameContext.groundCollider = new GroundPhysics(gameContext.ground, app.world, app.rapier);  

  // Assuming the plane is rotated to lie flat (rotation.x = -Math.PI / 2)
  // and the tee is at the near edge (z = +250 if centered at origin)
  const teeZ = 250; // half of the 500m plane length

  yardages.forEach((yds) => {
    const distMeters = UnitConversions.yardsToMeters(yds);
    const marker = createYardageMarker(yds);

    marker.rotation.x = -Math.PI / 2;
    marker.position.y = 0.01;           // slight hover above ground
    marker.position.z = distMeters;

    gameContext.scene.add(marker);
  });
}

function setupRange(setupData) {

  setupWorld();

  const skyColor = new THREE.Color('#c4daed');
  const fogColor = new THREE.Color('#f2f8f8');

  gameContext.scene = new THREE.Scene();
  gameContext.scene.background = skyColor;
  gameContext.lightGroup = new CourseLight(gameContext.scene, 0xffffff);
  gameContext.scene.add(gameContext.lightGroup);

  gameContext.fog = new THREE.Fog(fogColor, 100, 800);
  gameContext.scene.fog = gameContext.fog;

  createGroundPlane();

  gameContext.camera = new ShotPerspectiveCamera(35, 0.5, 1000, gameContext.renderer, gameContext.ground);

  gameContext.controls = new CourseKeyboardControls({ testShots: true });
  gameContext.controls.on('aim', aimKeys => {
    console.log('aim', aimKeys);
    gameContext.camera.aimKeys = aimKeys;
  });
  gameContext.controls.on('testShot', shot => launchShot(shot));

  // Sky/Clouds
  gameContext.clouds = new VolumetricClouds(gameContext.camera, {
    radius: 800,
    density: 0.4,
    opacity: 0.8,
    scale: 6,
    skyColor,
    fogColor,
    cloudColor: new THREE.Color('#ffffff'),
    position: new THREE.Vector3(0, 0, 0)
  });
  gameContext.scene.add(gameContext.clouds.object);
  



  gameContext.golfBall = new GolfBall(gameContext.scene, app.world, app.rapier);
  gameContext.golfBall.on('shotEnded', onShotEnded);

  gameContext.shotData = new UIShotData('#shot-data');
  gameContext.rangeFinder = new UIRangeFinder('#top-center');

  console.log('Range setup!');

  setupNextShot();
  requestAnimationFrame(animate);
}

function onShotEnded() {
  console.log('Shot ended!');
  setupNextShot();
}

async function initializeSetup(payload) {
  console.log(`setup from within app:`, payload);
  setupRange(payload.setupData);
}

async function initializeDebug() {
  const setupData = testSetupData();
  setupRange(setupData);
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

function createYardageMarker(yardage, planeWidth = 150) {
  const group = new THREE.Group();
  const stripeGeo = new THREE.PlaneGeometry(planeWidth * 0.6, 0.2);
  const stripeMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 1,
    metalness: 0,
    blending: THREE.AdditiveBlending,
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const stripe = new THREE.Mesh(stripeGeo, stripeMat);
  group.add(stripe);


  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'white';
  ctx.font = 'bold 120px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${yardage}`, 512, 256);

  const texture = new THREE.CanvasTexture(canvas);
  // texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const labelGeo = new THREE.PlaneGeometry(8, 4);
  const labelMat = new THREE.MeshStandardMaterial({
    map: texture,
    transparent: true,
    roughness: 1,
    opacity: 0.6,
    metalness: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const label = new THREE.Mesh(labelGeo, labelMat);
  label.position.y = 1.5; // tiny extra offset above stripe
  label.position.z = 0.001; // tiny extra offset above stripe
  group.add(label);
  group.rotation.z = Math.PI;

  return group;
}

function setupNextShot(event) {
  console.log('setupNextShot', event);

  gameContext.camera.setTracking(false);

  gameContext.camera.setPositions(gameContext.startPoint, gameContext.aimPoint);

  // recreate ball after each shot to ensure physics are fully reset
  gameContext.golfBall.reset(gameContext.aimPoint, gameContext.startPoint);  
}

function updateAimPoint() {
  const dist = gameContext.aimPoint.distanceTo(gameContext.startPoint);
  const heightDiff = gameContext.startPoint.y - gameContext.aimPoint.y;
  gameContext.rangeFinder.update(dist, heightDiff);
  gameContext.golfBall.aimAt(gameContext.aimPoint);
}

function animate(animDelta) {
  const delta = gameContext.timer.getDelta();   

  if (gameContext.golfBall) {
    gameContext.golfBall.update(delta);
  }
  gameContext.timer.update(animDelta);


  gameContext.renderer.clear();

  // main camera, full screen
  // const { width, height } = gameContext.renderer.getSize(new THREE.Vector2());
  // gameContext.renderer.setViewport(0, 0, width, height);

  // gameContext.renderer.render(gameContext.scene, gameContext.camera);
  gameContext.camera.render(gameContext.scene);
  
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
    
    // gameContext.shotData.updateShotResult(gameContext.golfBall.stats);
  }


  requestAnimationFrame(animate); 
}

app.initialize(initializeDebug);
app.on('setup', initializeSetup);
app.on('shot', (payload) => {
  console.log('SHOT RECEIVED', payload);
  if (payload.shot) {
    launchShot(payload.shot);
  }
});
