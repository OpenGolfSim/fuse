import '@/css/base.css';
import './cornhole.css';

const FIXED_DT = 1 / 60;
const MAX_SUBSTEPS = 5; // cap to prevent "spiral of death"

import {
  CourseKeyboardControls,
  MeshLoader,
  ShotPerspectiveCamera,
  THREE,
  UIMainMenu,
  UIStats,
  VolumetricClouds,
  app,
  generateSetupData,
  UILoadingScreen,
  FuseRenderer
} from '@opengolfsim/fuse';
import { Water } from 'three/examples/jsm/Addons.js';
import groundBeachModel from './models/GroundBeach.glb?url';
import cornHoleBoardModel from './models/CornHoleBoard.glb?url';
import sandCastleModel from './models/SandCastle.glb?url';

// import cornHoleRed from './textures/cornhole_red.png?url';
import cornHoleBlue from './textures/cornhole_blue.png?url';
import sandTexture from './textures/gen_sand_tex.png?url';
import waterNormals from './textures/waternormals.jpg?url';

const YARDS_IN_METER = 1.09361;
const stopThreshold = 0.05;
const baseBoardDistance = 7;
let boardZOffset = 10;

const fogColor = new THREE.Color('#bddefc');
const skyColor = new THREE.Color('#bddefc');

const textureLoader = new THREE.TextureLoader();
// const gltfLoader = new GLTFLoader();

const gameContext = {
  timer: new THREE.Timer(),
  aimPoint: new THREE.Vector3(0, 0, -10),
  startPoint: new THREE.Vector3(0, 0.25, 0),
  round: {
    number: 1,
    maxPoints: 21,
    bagsPerPlayer: 4,
    throwOrder: [], // queue of player indices for this round
    currentThrowIdx: 0,
    bagsThrown: [], // bags thrown this round
    firstTeam: 'red',
  },
  scores: {
    red: 0,
    blue: 0,
  },
  clock: new THREE.Clock(),
  shotEndTimer: null,
  accumulator: 0,
  world: null,
  scene: null,
  ground: {
    mesh: null,
    collider: null
  },
  water: {
    object: null,
    speed: 0.06
    // speed: 0.09
  },
  isShotActive: false,
  players: [
    { name: 'Red Player 1', team: 'red' },
    { name: 'Blue Player 1', team: 'blue' },
    // { name: 'Red Player 2', team: 'red' },
    // { name: 'Blue Player 2', team: 'blue' },
  ],
  bags: [],
  boards: {
    blue: {
      object: null,
      start: new THREE.Vector3(0, 0.3, -2.5),
      board: new THREE.Vector3(0, 0.2, -baseBoardDistance)
    },
    red: {
      object: null,
      start: new THREE.Vector3(0, 0.05, 15),
      board: new THREE.Vector3(0, 0.2, baseBoardDistance)
    }
  },
  debug: {
    enabled: false,
    geometry: null
  }
};

function clearRoundBags() {
  for (const bag of gameContext.round.bagsThrown) {
    gameContext.scene.remove(bag.mesh);
    bag.mesh.geometry.dispose();
    bag.mesh.material.dispose();
    app.world.removeRigidBody(bag.body);
  }
  // Remove from main bag list too
  gameContext.bags = gameContext.bags.filter(
    b => !gameContext.round.bagsThrown.includes(b)
  );
}

function setupBoard(team, boardMeshOriginal) {
  const boardData = gameContext.boards[team];
  const tiltRad = 10 * (Math.PI / 180);

  // Tear down existing physics if rebuilding
  if (boardData.collider) app.world.removeCollider(boardData.collider, false);
  if (boardData.colliderHole) app.world.removeCollider(boardData.colliderHole, false);
  if (boardData.body) app.world.removeRigidBody(boardData.body);

  // Create the visual mesh on first setup, reuse on rebuilds
  let boardMesh = boardData.object;
  if (!boardMesh) {
    boardMesh = boardMeshOriginal.clone();
    let rotateRad = 90 * (Math.PI / 180);

    if (team === 'red') {
      const newMaterial = boardMesh.material.clone();
      const redBoardTexture = textureLoader.load(cornHoleBlue);
      redBoardTexture.flipY = false;
      redBoardTexture.colorSpace = THREE.SRGBColorSpace;
      newMaterial.map = redBoardTexture;
      boardMesh.receiveShadow = true;
      boardMesh.material = newMaterial;
      boardMesh.material.needsUpdate = true;
      rotateRad = 270 * (Math.PI / 180);
    }

    boardMesh.scale.set(0.25, 0.25, 0.25);
    boardMesh.rotation.set(0, rotateRad, tiltRad);

    boardMesh.geometry.computeBoundingBox();
    const bbox = boardMesh.geometry.boundingBox;
    boardData.localBounds = {
      halfW: (bbox.max.x - bbox.min.x) / 2,
      halfL: (bbox.max.z - bbox.min.z) / 2,
    };

    boardData.object = boardMesh;
    gameContext.scene.add(boardMesh);
  }

  // Position (or reposition) the visual
  boardMesh.position.copy(boardData.board);
  boardMesh.position.y += 0.02;
  boardMesh.castShadow = true;
  boardMesh.position.z += boardData.boardOffset || 0;
  boardMesh.updateWorldMatrix(true, false);

  // Bake world transform into geometry and create the trimesh
  const geom = boardMesh.geometry.clone();
  geom.applyMatrix4(boardMesh.matrixWorld);

  const vertices = geom.attributes.position.array;
  const indices = geom.index
    ? new Uint32Array(geom.index.array)
    : new Uint32Array(Array.from({ length: vertices.length / 3 }, (_, i) => i));

  boardData.body = app.world.createRigidBody(app.rapier.RigidBodyDesc.fixed());

  boardData.collider = app.world.createCollider(
    app.rapier.ColliderDesc.trimesh(vertices, indices)
      .setFriction(0.03)
      .setRestitution(0.05),
    boardData.body
  );

  // Hole sensor
  const holeZOffset = team === 'red' ? 0.75 : -0.75;
  boardData.colliderHole = app.world.createCollider(
    app.rapier.ColliderDesc.cylinder(0.3, 0.2)
      .setSensor(true)
      .setTranslation(0, 0, boardMesh.position.z + holeZOffset)
      .setRotation({
        x: Math.sin(tiltRad / 2), y: 0, z: 0, w: Math.cos(tiltRad / 2)
      })
  );

  return boardMesh;
}

async function loadModels() {
  const sandCastle = await gameContext.meshLoader?.load(sandCastleModel, true);  
  sandCastle.scale.set(0.25, 0.25, 0.25);
  sandCastle.position.set(-3, 0.3, -8);
  sandCastle.castShadow = true;
  gameContext.scene.add(sandCastle);
}

async function loadGameBoards() {
  const boardMeshOriginal = await gameContext.meshLoader?.load(cornHoleBoardModel, true);
  // const boardMeshOriginal = await gameContext.meshLoader('models/CornHoleBoard.glb', true);  
  console.log('boardMesh', boardMeshOriginal);
  boardMeshOriginal.receiveShadow = true;
  setupBoard('blue', boardMeshOriginal);
  setupBoard('red', boardMeshOriginal);
}

async function setupScene() {
  gameContext.scene = new THREE.Scene();
  gameContext.scene.background = new THREE.Color(skyColor);
  gameContext.scene.fog = new THREE.Fog(fogColor, 10, 140);

  const ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
  gameContext.scene.add(ambientLight);
  
  const directionalLight = new THREE.DirectionalLight(0xffffff, 1.5);
  directionalLight.position.set(-5, 20, 0);
  directionalLight.castShadow = true;
  directionalLight.shadow.mapSize.width = 2048; // Higher = crisper shadows
  directionalLight.shadow.mapSize.height = 2048;
  directionalLight.shadow.camera.near = 1;
  directionalLight.shadow.camera.far = 50;
  directionalLight.shadow.camera.left = -50;
  directionalLight.shadow.camera.right = 50;
  directionalLight.shadow.camera.top = 50;
  directionalLight.shadow.camera.bottom = -50;
  gameContext.scene.add(directionalLight);
  directionalLight.target.position.set(0, 0, 0);

  const waterGroup = new THREE.Group();
  const underwaterGeometry = new THREE.PlaneGeometry(300, 100);
  const underwaterMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color('#1a5972') });
  const underwaterPlane = new THREE.Mesh(underwaterGeometry, underwaterMaterial);
  // underwaterPlane.rotation.x = -Math.PI / 2;
  
  // underwaterPlane.rotation.y = -90 * (Math.PI / 180);

  waterGroup.add(underwaterPlane);
  

  const waterGeometry = new THREE.PlaneGeometry(300, 100);

  gameContext.water.object = new Water(waterGeometry, {
    textureWidth: 256,
    textureHeight: 256,
    waterNormals: textureLoader.load(
      waterNormals,
      (texture) => {
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      }
    ),
    alpha: 0.4,
    sunColor: new THREE.Color('#ffffff'),
    waterColor: new THREE.Color('#3a8fc4'),
    distortionScale: 5.0,
    speed: 0.5,
    sunDirection: new THREE.Vector3(0, 2, 0.70707),
    fog: gameContext.scene.fog !== undefined,
  });
  
  gameContext.water.object.material.transparent = true;
  // gameContext.water.object.rotation.x = -Math.PI / 2;

  const radians = -89.5 * (Math.PI / 180);
  underwaterPlane.rotation.x = radians;
  // underwaterPlane.rotation.z = 2;
  // underwaterPlane.position.y = -10.6; // just below the water
  underwaterPlane.position.z = -50;
  
  gameContext.water.object.rotation.copy(underwaterPlane.rotation);
  // gameContext.water.object.rotation.x = radians;
  // gameContext.water.object.rotation.x = underwaterPlane.rotation.x;
  gameContext.water.object.position.copy(underwaterPlane.position);
  gameContext.water.object.position.y += 0.006;
  // gameContext.water.object.position.z = -50;

  waterGroup.add(gameContext.water.object);
  waterGroup.position.y = 0;
  waterGroup.position.z = -20;
  gameContext.scene.add(waterGroup);



}

function createSky() {
  gameContext.clouds = new VolumetricClouds(gameContext.camera, {
    radius: 800,
    density: 0.4,
    opacity: 0.8,
    scale: 6,
    skyColor,
    fogColor,
    cloudColor: new THREE.Color('#ffffff'),
    position: new THREE.Vector3(0, 0, 0)

    // density: 0.4,
    // opacity: 0.8,
    // scale: 6,
    // fogColor,
    // skyColor: 0x00ff00,
    // position: new THREE.Vector3(0, 10, 0)
  });
  console.log('gameContext.clouds', gameContext.clouds);
  gameContext.scene.add(gameContext.clouds.object);
}

async function createGround(width = 100, depth = 100) {

  const tex = textureLoader.load(sandTexture);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(100, 100); // tile 50x across, 100x down the 100x200 plane
  tex.colorSpace = THREE.SRGBColorSpace; // correct color rendering
  tex.anisotropy = gameContext.renderer.getMaxAnisotropy();

  const floorMaterial = new THREE.MeshStandardMaterial({
    map: tex,
    roughness: 0,
    metalness: 0,
    color: new THREE.Color('#e9e3c2')
  });

  // const groundMesh = await loadMesh('models/GroundBeach.glb', true);
  const groundMesh = await gameContext.meshLoader?.load(groundBeachModel, true);
  console.log('groundMesh', groundMesh.geometry);
  // const geo = new THREE.PlaneGeometry(100, 100);

  const mesh = new THREE.Mesh(groundMesh.geometry, floorMaterial);
  // floor.rotation.x = -Math.PI / 2;
  mesh.scale.set(2, 2, 2);
  mesh.rotation.y = 1 * (Math.PI / 180);
  mesh.position.x = 0;
  mesh.position.y = -2.75;
  mesh.position.z = -10;
  mesh.receiveShadow = true;
  gameContext.scene.add(mesh);
  gameContext.ground.mesh = mesh;

  const desc = app.rapier.ColliderDesc.cuboid(width / 2, 0.1, depth / 2)
    .setTranslation(0, -0.1, 0)   // top surface sits at y=0
    .setRestitution(0.35)
    .setFriction(0.8);

  gameContext.ground.collider = app.world.createCollider(desc);
}

function updateScoreboard() {
  document.getElementById('round').textContent =
    `Round ${gameContext.round.number}`;
  document.getElementById('blue-team-score').textContent =
    gameContext.scores.blue;
  document.getElementById('red-team-score').textContent =
    gameContext.scores.red;

  const currentTeam = gameContext.round.throwOrder[gameContext.round.currentThrowIdx];
  document.getElementById('team-blue').classList.toggle('active', currentTeam === 'blue');
  document.getElementById('team-red').classList.toggle('active', currentTeam === 'red');
  
  document.getElementById('current-team').classList.toggle('red', currentTeam === 'red');
  document.getElementById('current-team').classList.toggle('blue', currentTeam === 'blue');
  document.getElementById('current-team-up').textContent = `${currentTeam} is up`;
  
  
  // Count remaining bags for the current team by slicing from currentThrowIdx forward
  const remainingBags = gameContext.round.throwOrder
    .slice(gameContext.round.currentThrowIdx)
    .filter(team => team === currentTeam).length;

  document.getElementById('current-team-bags').innerHTML =
    Array(remainingBags).fill('<div class="team-bag"></div>').join('');


  // document.getElementById('current-team-bags').innerHTML = '<div class="team-bag"></div>';
  // QUESTION: How to add team-bag divs for number of bags remaining?
  // console.log('currentThrowIdx', gameContext.round.currentThrowIdx);

  const { red, blue } = computeRoundScore();
  // document.getElementById('round-score').textContent = `R: ${red} b: ${blue}`;

}



function positionCamera() {
  const cameraPosition = new THREE.Vector3();
  cameraPosition.copy(gameContext.boards.blue.start);
  cameraPosition.y += 1;
  cameraPosition.z += 1;

  gameContext.camera.position.copy(cameraPosition);
  const rot = 0; // gameContext.bags.length % 4 === 0 ? 180 * (Math.PI / 180) : 0;
  gameContext.camera.rotation.set(-0.2, rot, 0);


  const distance = getBoardDistance();

  const mapRange = (value, inMin, inMax, outMin, outMax) => {
    return ((value - inMin) * (outMax - outMin)) / (inMax - inMin) + outMin;
  };
  const d = getBoardDistance();
  const fovMin = 60;
  const fovMax = 56;
  gameContext.camera.fov = mapRange(d, 5, 10, fovMin, fovMax); // Set to new angle
  gameContext.camera.updateProjectionMatrix(); // REQUIRED: Updates the camera projection
}

function getBoardDistance() {
  return baseBoardDistance + boardZOffset;
}

function updateDistance() {
  gameContext.boards.blue
  const distanceText = document.querySelector("#board-distance");
  const distanceMeters = getBoardDistance();
  distanceText.textContent = `${(distanceMeters * YARDS_IN_METER).toFixed(0)}`;
}

function computeRoundScore() {
  let red = 0, blue = 0;
  for (const bag of gameContext.round.bagsThrown) {
    const result = evaluateBagPosition(bag);
    const points = result.status === 'in' ? 3 : result.status === 'on' ? 1 : 0;
    if (bag.team === 'red') red += points;
    else if (bag.team === 'blue') blue += points;
  }
  return { red, blue };
}

function startRound() {
  gameContext.round.bagsThrown = [];
  gameContext.round.currentThrowIdx = 0;

  // const first = gameContext.lastScoringTeam || 'red';
  const first = gameContext.round.firstTeam;
  const second = first === 'red' ? 'blue' : 'red';

  // All 4 from one team, then all 4 from the other
  const order = [
    ...Array(gameContext.round.bagsPerPlayer).fill(first),
    ...Array(gameContext.round.bagsPerPlayer).fill(second),
  ];
  gameContext.round.throwOrder = order;

  // Flip for next round
  gameContext.round.firstTeam = second;

  console.log(`Round ${gameContext.round.number} — ${first} throws all 4, then ${second}`);
}

async function setupGame() {

  const boardOffset = window.localStorage.getItem('boardOffset') || 0;
  if (boardOffset) {
    boardZOffset = parseFloat(boardOffset);
    gameContext.boards.blue.boardOffset = boardZOffset * -1;
    gameContext.boards.red.boardOffset = boardZOffset;
  }

  gameContext.eventQueue = new app.rapier.EventQueue(true);

  const stats = document.createElement('div');
  document.body.append(stats);
  gameContext.stats = new UIStats(stats, { hidden: false });


  gameContext.controls = new CourseKeyboardControls({ testShots: false });
  gameContext.controls.on('aim', aimKeys => {
    if (gameContext.camera) gameContext.camera.aimKeys = aimKeys;
  });
  gameContext.controls.on('toggleStats', () => gameContext.stats?.toggle());
  gameContext.controls.on('testShot', shot => {
    launchShot({ ballSpeed: 12 + (Math.random() * 2), verticalLaunchAngle: 35, horizontalLaunchAngle: -5 + (Math.random() * 10) });
  });

  const canvas = document.getElementById('canvas');
  if (!canvas) {
    throw new Error('Missing canvas!');
  }
  gameContext.renderer = new FuseRenderer({
    canvas,
    antialias: true
    // renderMode: 'webgpu'
  });
  // gameContext.renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('canvas'), antialias: true });
  // gameContext.renderer.setSize(window.innerWidth, window.innerHeight);
  // gameContext.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  // gameContext.renderer.shadowMap.enabled = true;
  // gameContext.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  
  
  // window.addEventListener('resize', () => {
  //   if (gameContext.camera) {
  //     gameContext.camera.aspect = window.innerWidth / window.innerHeight;
  //     gameContext.camera.updateProjectionMatrix();
  //   }
  //   gameContext.renderer.setSize(window.innerWidth, window.innerHeight);
  // });


  await setupScene();
  
  gameContext.camera = new ShotPerspectiveCamera({
    canvas,
    fov: 30,
    cameraOffsetX: 0,
    cameraOffsetYZ: [1.5, 1],
  });

  await gameContext.renderer.init();

  gameContext.meshLoader = new MeshLoader(gameContext.renderer);  

  await createGround();

  gameContext.camera.setScene(gameContext.ground.mesh);

  const geo = new THREE.BoxGeometry(0.06, 2, 0.06);
  const mat = new THREE.MeshBasicMaterial({ color: 'red', transparent: true, opacity: 0.8 });
  
  gameContext.aimMesh = new THREE.Mesh(geo, mat);
  gameContext.aimMesh.visible = false;
  gameContext.aimMesh.castShadow = true;
  gameContext.aimMesh.position.copy(gameContext.aimPoint);
  gameContext.scene.add(gameContext.aimMesh);

  gameContext.camera?.setPositions(gameContext.startPoint, gameContext.aimPoint);
  // createSky();


  await loadGameBoards();
  await loadModels();
  

  startRound();
  updateScoreboard();
  // positionCamera();


  
  // Create custom geometry to hold Rapier's line data
  if (gameContext.debug.enabled) {
    gameContext.debug.geometry = new THREE.BufferGeometry();
  
    // Material configured to look like standard physics boundaries
    const debugMaterial = new THREE.LineBasicMaterial({ 
      vertexColors: true, 
      depthTest: false // Ensures lines are always visible on top of solid meshes
    });
  
    const debugLines = new THREE.LineSegments(gameContext.debug.geometry, debugMaterial);
    gameContext.scene.add(debugLines);
  }

  gameContext.mainMenu = new UIMainMenu('#top-left');
  gameContext.mainMenu.on('exit', () => app.exit())
}

function loadGame() {
  gameContext.timer.connect(document);  

  gameContext.loadingScreen = new UILoadingScreen(document.body, { loadingPrefix: 'Filling the bags' });
  gameContext.loadingScreen.on('load', async () => {
    gameContext.clock.start();
    requestAnimationFrame(animate);
  });
  gameContext.loadingScreen.load(setupGame);

  document.body.style.opacity = '1';

  // requestAnimationFrame(animate);
}

function getActiveBag() {
  return gameContext.bags[gameContext.bags.length - 1];
}



function getAimAngle() {
  // this.aimPoint = aimPoint;
  // if (!this.object) {
  //   console.error('No ball object created yet');
  //   return;
  // }
  const direction = new THREE.Vector3().subVectors(gameContext.aimPoint, gameContext.startPoint);
  direction.y = 0; // flatten to horizontal — we only want the yaw
  direction.normalize();
  // 2. Extract yaw angle from that direction
  const yaw = Math.atan2(direction.x, direction.z);
  // 3. Set a clean rotation — only yaw, no pitch/roll
  // bag.rotation.set(0, 0, 0);  
  return yaw;
}

function launchShot(shot) {
  if (gameContext.isShotActive) {
    console.log('shot already active');
    return;
  }
  console.log('Received shot', shot);
  const nextTeam = gameContext.round.throwOrder[gameContext.round.currentThrowIdx];
  const bag = createBag(nextTeam);
  // bag.ended = false;
  

  gameContext.isShotActive = true;


  const speed = shot.ballSpeed * 0.44704;  // m/s
  const hla = shot.horizontalLaunchAngle * Math.PI / 180;
  const vla = shot.verticalLaunchAngle * Math.PI / 180;

  // // -Z is toward the board
  // const horiz = Math.cos(vla) * speed;
  // const vert = Math.sin(vla) * speed;
  // const vx = horiz * Math.sin(hla);
  // const vz = -horiz * Math.cos(hla);
  // const vy = vert;

  // bag.body.setLinvel({ x: vx, y: vy, z: vz }, true);

  const aimDir = new THREE.Vector3()
    .subVectors(gameContext.aimPoint, gameContext.startPoint);
  aimDir.y = 0;
  aimDir.normalize();
  aimDir.applyAxisAngle(new THREE.Vector3(0, 1, 0), -hla); // deviate off aim by HLA

  const horiz = Math.cos(vla) * speed;
  bag.body.setLinvel({
    x: aimDir.x * horiz,
    y: Math.sin(vla) * speed,
    z: aimDir.z * horiz,
  }, true);

  bag.body.setAngvel({
    x: (Math.random() - 0.5) * 4,
    y: (Math.random() - 0.5) * 2,
    z: (Math.random() - 0.5) * 4,
  }, true);

}

function createBag(team) {
  const position = gameContext.boards.blue.start;
  console.log('create bag');
  // Official cornhole bag: ~6" x 6" x ~1" thick, ~15-16 oz (~0.43 kg)
  const halfW = 0.0762;  // 3 inches
  const halfH = 0.0127;  // 0.5 inches
  const halfD = halfW;
  const borderRadius = 0.015;

  const angle = getAimAngle();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, angle, 0));

  // boardData.collider = RAPIER.ColliderDesc.roundCuboid(halfW, halfH, cornerRadius);

  const bodyDesc = app.rapier.RigidBodyDesc.dynamic()
    .setTranslation(position.x, position.y, position.z)
    .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })   // the key line
    .setLinearDamping(0.15)    // mild air drag
    .setAngularDamping(0.4)    // bags don't spin freely like a ball
    .setCcdEnabled(true);      // prevents tunneling at high launch speeds

  const body = app.world.createRigidBody(bodyDesc);

  const colDesc = app.rapier.ColliderDesc
    .roundCuboid(halfW, halfH, halfD, borderRadius)
    .setMass(0.43)
    .setRestitution(0.05)      // key: almost no bounce
    .setFriction(0.3)          // key: grabs the board, doesn't slide forever
    .setRestitutionCombineRule(app.rapier.CoefficientCombineRule.Min)
    .setFrictionCombineRule(app.rapier.CoefficientCombineRule.Max)
    .setActiveEvents(app.rapier.ActiveEvents.COLLISION_EVENTS);

  const collider = app.world.createCollider(colDesc, body);

  // Visual — this is what was missing
  const geo = new THREE.BoxGeometry(halfW * 2, halfH * 2, halfD * 2);
  const mat = new THREE.MeshStandardMaterial({ color: team === 'red' ? 0xcc3333 : 0x3333cc });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  
  mesh.position.copy(position);


  gameContext.scene.add(mesh);

  const bag = {
    mesh,
    body,
    collider,
    team,
    round: gameContext.round.number,
    scored: null
  };
  gameContext.bags.push(bag);
  gameContext.round.bagsThrown.push(bag);

  return bag;
}

function evaluateBagPosition(bag) {
  if (bag.inHole) {
    return { status: 'in', board: bag.inHole };
  }

  const t = bag.body.translation();
  const bagPos = new THREE.Vector3(t.x, t.y, t.z);

  for (const team of ['red', 'blue']) {
    const boardData = gameContext.boards[team];
    const localPos = boardData.object.worldToLocal(bagPos.clone());
    const bounds = boardData.localBounds;

    if (
      Math.abs(localPos.x) < bounds.halfW &&
      Math.abs(localPos.z) < bounds.halfL &&
      localPos.y > 0
    ) {
      return { status: 'on', board: team };
    }
  }

  return { status: 'off', board: null };
}

function scoreRound() {
  let redPoints = 0;
  let bluePoints = 0;

  for (const bag of gameContext.round.bagsThrown) {
    const result = evaluateBagPosition(bag);
    bag.scored = result.status;
    bag.scoringBoard = result.board;

    if (result.status === 'in') {
      if (bag.team === 'red') redPoints += 3;
      else bluePoints += 3;
    } else if (result.status === 'on') {
      if (bag.team === 'red') redPoints += 1;
      else bluePoints += 1;
    }
  }

  // Cancellation scoring: only the net difference is awarded
  const net = redPoints - bluePoints;
  if (net > 0) {
    gameContext.scores.red += net;
    gameContext.lastScoringTeam = 'red';
  } else if (net < 0) {
    gameContext.scores.blue += -net;
    gameContext.lastScoringTeam = 'blue';
  }
  // If net === 0, no one scores and lastScoringTeam stays the same

  console.log(`Round ${gameContext.round.number}: red ${redPoints}, blue ${bluePoints}, net to ${net > 0 ? 'red' : net < 0 ? 'blue' : 'nobody'}`);
  console.log(`Total: red ${gameContext.scores.red}, blue ${gameContext.scores.blue}`);

  // Check for game end
  if (gameContext.scores.red >= gameContext.round.maxPoints || gameContext.scores.blue >= gameContext.round.maxPoints) {
    // gameOver();
    console.log('GAME OVER');
  } else {
    clearRoundBags();
    gameContext.round.number++;
    startRound();
  }
}

function onShotEnded() {
  gameContext.round.currentThrowIdx++;

  const totalThrows = gameContext.round.throwOrder.length;
  if (gameContext.round.currentThrowIdx >= totalThrows) {
    scoreRound();
  } else {
    // Ready for next throw
    const nextTeam = gameContext.round.throwOrder[gameContext.round.currentThrowIdx];
    console.log(`Next up: ${nextTeam}`);
    // Update UI, enable throw button, etc.
  }
  updateScoreboard();
}

function animate(animDelta) {
  requestAnimationFrame(animate);
  gameContext.stats?.begin();  
  const delta = gameContext.timer.getDelta();
  gameContext.timer.update(animDelta);

  // fixed-rate physics
  gameContext.accumulator += delta;

  // Clamp so a long hitch doesn't queue dozens of steps
  if (gameContext.accumulator > FIXED_DT * MAX_SUBSTEPS) {
    gameContext.accumulator = FIXED_DT * MAX_SUBSTEPS;
  }

  while (gameContext.accumulator >= FIXED_DT) {
    app.world.timestep = FIXED_DT;
    app.world.step(gameContext.eventQueue);
    gameContext.accumulator -= FIXED_DT;

    // Drain collision events *inside* the loop so you don't
    // miss events from intermediate substeps
    gameContext.eventQueue.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;
      const blueHole = gameContext.boards.blue.colliderHole.handle;
      const redHole  = gameContext.boards.red.colliderHole.handle;

      let holeTeam = null;
      if (h1 === blueHole || h2 === blueHole) holeTeam = 'blue';
      else if (h1 === redHole || h2 === redHole) holeTeam = 'red';
      if (!holeTeam) return;

      const bagHandle = (h1 === blueHole || h1 === redHole) ? h2 : h1;
      const bag = gameContext.bags.find(b => b.collider.handle === bagHandle);
      if (bag) bag.inHole = holeTeam;
    });
  }

  // Sync meshes to physics
  for (const bag of gameContext.bags) {
    const t = bag.body.translation();
    const r = bag.body.rotation();
    bag.mesh.position.set(t.x, t.y, t.z);
    bag.mesh.quaternion.set(r.x, r.y, r.z, r.w);
  }
  
  const bag = getActiveBag();
  if (bag) {
    const lv = bag.body.linvel();
    // const av = bag.body.angvel();
    const speed = Math.sqrt(lv.x * lv.x + lv.y * lv.y + lv.z * lv.z);
    // const angSpeed = Math.sqrt(av.x * av.x + av.y * av.y + av.z * av.z);
    if (speed < stopThreshold && gameContext.isShotActive) {
      if (!gameContext.shotEndTimer) {
        gameContext.shotEndTimer = performance.now();
      } else if (performance.now() - gameContext.shotEndTimer > 500) {
        gameContext.isShotActive = false;
        gameContext.shotEndTimer = null;
        onShotEnded();
      }
    } else {
      gameContext.shotEndTimer = null; // reset if it starts moving again
    }
  }

  
  if (gameContext.water.object) {
    gameContext.water.object.material.uniforms['time'].value += gameContext.water.speed / 60.0;
  }

  if (gameContext.debug.enabled) {
    const { vertices, colors } = app.world.debugRender();
    gameContext.debug.geometry.setAttribute(
      'position', new THREE.BufferAttribute(vertices, 3)
    );
    gameContext.debug.geometry.setAttribute(
      'color', new THREE.BufferAttribute(colors, 4)
    );
  }

  // gameContext.renderer.render(gameContext.scene, gameContext.camera);
  const aimChanged = gameContext.camera?.update(
    delta,
    gameContext.startPoint,
    gameContext.aimPoint
  );
  
  if (gameContext.aimMesh) gameContext.aimMesh.position.copy(gameContext.aimPoint);

  // gameContext.camera?.render(gameContext.scene, gameContext.fog);
  gameContext.renderer?.render(gameContext.scene, gameContext.camera, gameContext.fog);

  gameContext.stats?.end();
}


function initializeDebug() {
  console.log('debug');
  gameContext.setupData = generateSetupData(1);
  loadGame();
}

function initializeSetup(payload) {
  console.log('setup');
  console.log('Received setup event', payload);
  if (!payload?.setupData) throw new Error('No setupData received in setup event!');
  gameContext.setupData = payload?.setupData;
  loadGame();
}

// use this on load of page, with test data
app.initialize(initializeDebug);
// sent by OpenGolfSim Desktop/Mobile apps
app.on('setup', initializeSetup);
// sent by OpenGolfSim Desktop/Mobile apps
app.on('shot', shot => launchShot(shot));


window.addEventListener('keypress', (e) => {
  if (e.code === 'Space') {
    launchShot({ ballSpeed: 12 + (Math.random() * 2), verticalLaunchAngle: 35, horizontalLaunchAngle: -5 + (Math.random() * 10) });
  }
});