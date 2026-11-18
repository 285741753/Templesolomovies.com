import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  BALL_RADIUS,
  GOAL_HALF_WIDTH,
  GOAL_HEIGHT,
  GOAL_NET_DEPTH,
  POST_RADIUS,
  getWallDefenderHeightOffset,
  sampleKeeperPoseAtTime,
} from './physics';
import {
  createAdBoardTexture,
  createContactShadowTexture,
  createPitchTexture,
  createSoccerBallTexture,
} from './textures';
import type {
  FootballGameMode,
  FreeKickSpot,
  KickSimulationResult,
  PhysicsFrame,
} from './types';

// Pre-allocated scratch math objects (zero GC inside tick loop)
const _camTargetPos = new THREE.Vector3();
const _camTargetLook = new THREE.Vector3();
const _camCurrentLook = new THREE.Vector3(0, 1.3, 0);
const _dummyMatrix = new THREE.Object3D();

interface KeeperRig {
  root: THREE.Group;
  body: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  jerseyMat: THREE.MeshStandardMaterial;
}

interface CrowdMember {
  baseX: number;
  baseY: number;
  baseZ: number;
  phase: number;
  rotY: number;
}

interface NetPanel {
  mesh: THREE.Mesh;
  geo: THREE.BufferGeometry;
  basePositions: Float32Array;
}

interface CelebrationParticle {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  scale: number;
  life: number;
}

export interface StadiumSceneCallbacks {
  onAnimationEvent?: (event: 'woodwork' | 'save' | 'wall' | 'net' | 'finish') => void;
  onQualityAdjusted?: (tier: 'high' | 'balanced') => void;
}

export class StadiumScene {
  private container: HTMLElement;
  private callbacks: StadiumSceneCallbacks;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private isSoftwareGl: boolean;
  private keyLight!: THREE.DirectionalLight;

  private ballGroup!: THREE.Group;
  private ballMesh!: THREE.Mesh;
  private ballShadow!: THREE.Mesh;
  private aimPreviewLine!: THREE.Line;
  private aimPreviewGeo!: THREE.BufferGeometry;

  private keeperRig!: KeeperRig;
  private wallGroup!: THREE.Group;
  private wallDefenders: THREE.Group[] = [];

  private netPanels: NetPanel[] = [];
  private netRippleTime = -1;
  private netImpactPoint = new THREE.Vector3(0, 1.2, -GOAL_NET_DEPTH);

  private trailMesh!: THREE.InstancedMesh;
  private trailPoints: Array<{ x: number; y: number; z: number; active: boolean }> = [];
  private trailHead = 0;

  private burstMesh!: THREE.InstancedMesh;
  private burstParticles: CelebrationParticle[] = [];

  private crowdMesh!: THREE.InstancedMesh;
  private crowdMembers: CrowdMember[] = [];
  private crowdCheerTimer = 0;

  private mode: FootballGameMode = 'penalty';
  private spot: FreeKickSpot = {
    x: 0,
    z: 11,
    distance: 11,
    wallCenterX: 0,
    wallCenterZ: 2,
    wallAngleY: 0,
  };

  private activeSim: KickSimulationResult | null = null;
  private simElapsed = 0;
  private playbackRate = 1.0;
  private isReplay = false;
  private firedWoodwork = false;
  private firedSave = false;
  private firedWall = false;
  private firedNet = false;
  private firedFinish = false;

  private cameraShakeTime = 0;
  private frameId = 0;
  private lastTimestamp = 0;
  private paused = false;
  private disposed = false;

  // Adaptive 60fps monitor
  private frameTimeSum = 0;
  private frameCount = 0;
  private qualityTier: 'high' | 'balanced' = 'high';

  private resizeObserver: ResizeObserver | null = null;
  private disposableTextures: THREE.Texture[] = [];
  private disposableGeos: THREE.BufferGeometry[] = [];
  private disposableMats: THREE.Material[] = [];

  constructor(container: HTMLElement, callbacks: StadiumSceneCallbacks = {}) {
    this.container = container;
    this.callbacks = callbacks;

    this.isSoftwareGl = (() => {
      try {
        const probeCanvas = document.createElement('canvas');
        const gl = probeCanvas.getContext('webgl2') || probeCanvas.getContext('webgl');
        if (!gl) return true;
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
        const gpu = String(gl.getParameter(param) || '');
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
      } catch {
        return true;
      }
    })();

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.setPixelRatio(
      this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2)
    );
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.touchAction = 'none';
    this.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x06080d);
    this.scene.fog = new THREE.FogExp2(0x06080d, 0.011);

    const width = Math.max(container.clientWidth, 320);
    const height = Math.max(container.clientHeight, 240);
    this.camera = new THREE.PerspectiveCamera(48, width / height, 0.1, 180);
    this.renderer.setSize(width, height, false);

    // Procedural RoomEnvironment for metallic gold trims & glossy ball leather
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = envTex;
    this.disposableTextures.push(envTex);
    pmrem.dispose();

    this.buildLighting();
    this.buildStadium();
    this.buildGoalAndNet();
    this.buildBallAndTrail();
    this.buildKeeper();
    this.buildDefensiveWall();
    this.buildAimPreview();
    this.buildCrowd();
    this.buildCelebrationBurst();

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    this.resetCameraImmediate();

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(this.container);
    window.addEventListener('resize', this.handleResize);

    this.lastTimestamp = performance.now();
    this.startLoop();
  }

  private trackGeo<T extends THREE.BufferGeometry>(geo: T): T {
    this.disposableGeos.push(geo);
    return geo;
  }

  private trackMat<T extends THREE.Material>(mat: T): T {
    this.disposableMats.push(mat);
    return mat;
  }

  private trackTex<T extends THREE.Texture>(tex: T): T {
    this.disposableTextures.push(tex);
    return tex;
  }

  private buildLighting(): void {
    // Cool night sky / deep turf bounce fill
    const hemi = new THREE.HemisphereLight(0xa5b4fc, 0x14532d, 0.68);
    this.scene.add(hemi);

    // Warm primary stadium floodlight with tight orthographic shadow frustum
    this.keyLight = new THREE.DirectionalLight(0xfff4d6, 2.35);
    this.keyLight.position.set(16, 28, 18);
    this.keyLight.target.position.set(0, 0, 5);
    this.scene.add(this.keyLight.target);

    if (!this.isSoftwareGl) {
      this.keyLight.castShadow = true;
      this.keyLight.shadow.mapSize.set(1024, 1024);
      this.keyLight.shadow.camera.near = 4;
      this.keyLight.shadow.camera.far = 65;
      const d = 18;
      this.keyLight.shadow.camera.left = -d;
      this.keyLight.shadow.camera.right = d;
      this.keyLight.shadow.camera.top = d;
      this.keyLight.shadow.camera.bottom = -d;
      this.keyLight.shadow.bias = -0.0005;
      this.keyLight.shadow.normalBias = 0.025;
    }
    this.scene.add(this.keyLight);

    // Back rim light behind goal to outline keeper, crossbar & spinning ball
    const rimLight = new THREE.DirectionalLight(0xfde68a, 0.95);
    rimLight.position.set(-14, 16, -18);
    this.scene.add(rimLight);
  }

  private buildStadium(): void {
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();

    // Extended surrounding ground beyond playable pitch
    const outerGeo = this.trackGeo(new THREE.PlaneGeometry(180, 180));
    const outerMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x0a130e, roughness: 0.95, metalness: 0 })
    );
    const outerFloor = new THREE.Mesh(outerGeo, outerMat);
    outerFloor.rotation.x = -Math.PI / 2;
    outerFloor.position.y = -0.02;
    this.scene.add(outerFloor);

    // Main pitch 56m x 56m (z from -8 to +48)
    const pitchTex = this.trackTex(createPitchTexture(maxAniso));
    const pitchGeo = this.trackGeo(new THREE.PlaneGeometry(56, 56));
    const pitchMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        map: pitchTex,
        roughness: 0.88,
        metalness: 0.02,
      })
    );
    const pitchMesh = new THREE.Mesh(pitchGeo, pitchMat);
    pitchMesh.rotation.x = -Math.PI / 2;
    pitchMesh.position.set(0, 0, 20);
    pitchMesh.receiveShadow = !this.isSoftwareGl;
    this.scene.add(pitchMesh);

    // Gold-and-black Temple Cinema LED Perimeter Boards
    const adTex = this.trackTex(createAdBoardTexture(maxAniso));
    const boardMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        map: adTex,
        emissiveMap: adTex,
        emissive: new THREE.Color(0x554215),
        emissiveIntensity: 0.75,
        roughness: 0.4,
        metalness: 0.2,
      })
    );
    const backBoardGeo = this.trackGeo(new THREE.BoxGeometry(50, 1.05, 0.3));
    const backBoard = new THREE.Mesh(backBoardGeo, boardMat);
    backBoard.position.set(0, 0.52, -4.5);
    this.scene.add(backBoard);

    const sideBoardGeo = this.trackGeo(new THREE.BoxGeometry(0.3, 1.05, 50));
    const leftBoard = new THREE.Mesh(sideBoardGeo, boardMat);
    leftBoard.position.set(-25, 0.52, 20);
    const rightBoard = new THREE.Mesh(sideBoardGeo, boardMat);
    rightBoard.position.set(25, 0.52, 20);
    this.scene.add(leftBoard, rightBoard);

    // Stadium concrete bowl tiers (back + sides)
    const standMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x141418, roughness: 0.82, metalness: 0.1 })
    );
    const goldTrimMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0xe5a93b, roughness: 0.25, metalness: 0.82 })
    );

    const tierConfigs = [
      { y: 1.8, z: -8.5, h: 3.6, d: 6.5 },
      { y: 4.9, z: -14.2, h: 3.4, d: 7.5 },
      { y: 8.1, z: -20.5, h: 3.6, d: 8.5 },
    ];
    for (const tc of tierConfigs) {
      const mesh = new THREE.Mesh(
        this.trackGeo(new THREE.BoxGeometry(66, tc.h, tc.d)),
        standMat
      );
      mesh.position.set(0, tc.y, tc.z);
      this.scene.add(mesh);
    }

    // Stadium roof fascia with Temple gold trim behind goal
    const roof = new THREE.Mesh(
      this.trackGeo(new THREE.BoxGeometry(68, 0.9, 14)),
      standMat
    );
    roof.position.set(0, 12.2, -18.5);
    const fascia = new THREE.Mesh(
      this.trackGeo(new THREE.BoxGeometry(68, 0.28, 0.35)),
      goldTrimMat
    );
    fascia.position.set(0, 11.75, -11.5);
    this.scene.add(roof, fascia);

    // Side grandstands
    for (const side of [-1, 1]) {
      const sideLower = new THREE.Mesh(
        this.trackGeo(new THREE.BoxGeometry(8, 4.5, 58)),
        standMat
      );
      sideLower.position.set(side * 30, 2.25, 16);
      const sideUpper = new THREE.Mesh(
        this.trackGeo(new THREE.BoxGeometry(10, 5.2, 58)),
        standMat
      );
      sideUpper.position.set(side * 36.5, 6.2, 16);
      this.scene.add(sideLower, sideUpper);
    }

    // 4 Multi-part Floodlight Towers (mast + bracket + glowing lamp head)
    const pylonMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x27272a, roughness: 0.45, metalness: 0.7 })
    );
    const lampMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0xfff3c4,
        emissiveIntensity: 3.2,
        roughness: 0.2,
      })
    );
    const towerCoords: Array<[number, number]> = [
      [-28, -16],
      [28, -16],
      [-31, 34],
      [31, 34],
    ];
    for (const [tx, tz] of towerCoords) {
      const tower = new THREE.Group();
      tower.position.set(tx, 0, tz);
      tower.lookAt(0, 0, 8);

      const mast = new THREE.Mesh(
        this.trackGeo(new THREE.CylinderGeometry(0.32, 0.55, 22, 10)),
        pylonMat
      );
      mast.position.y = 11;
      tower.add(mast);

      const bracket = new THREE.Mesh(
        this.trackGeo(new THREE.BoxGeometry(4.6, 2.2, 0.45)),
        pylonMat
      );
      bracket.position.set(0, 22, 0.35);
      bracket.rotation.x = 0.28;
      tower.add(bracket);

      const lampBank = new THREE.Mesh(
        this.trackGeo(new THREE.PlaneGeometry(4.1, 1.8)),
        lampMat
      );
      lampBank.position.set(0, 22, 0.62);
      lampBank.rotation.x = 0.28;
      tower.add(lampBank);

      this.scene.add(tower);
    }
  }

  private buildGoalAndNet(): void {
    const goalGroup = new THREE.Group();
    const postMat = this.trackMat(
      new THREE.MeshPhysicalMaterial({
        color: 0xfafafa,
        roughness: 0.22,
        metalness: 0.45,
        clearcoat: 0.65,
      })
    );
    const accentMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xe5a93b,
        roughness: 0.25,
        metalness: 0.85,
      })
    );

    const postGeo = this.trackGeo(
      new THREE.CylinderGeometry(POST_RADIUS, POST_RADIUS, GOAL_HEIGHT, 14)
    );
    const leftPost = new THREE.Mesh(postGeo, postMat);
    leftPost.position.set(-GOAL_HALF_WIDTH, GOAL_HEIGHT / 2, 0);
    leftPost.castShadow = !this.isSoftwareGl;

    const rightPost = new THREE.Mesh(postGeo, postMat);
    rightPost.position.set(GOAL_HALF_WIDTH, GOAL_HEIGHT / 2, 0);
    rightPost.castShadow = !this.isSoftwareGl;

    const crossbarGeo = this.trackGeo(
      new THREE.CylinderGeometry(POST_RADIUS, POST_RADIUS, GOAL_HALF_WIDTH * 2 + POST_RADIUS * 2, 14)
    );
    const crossbar = new THREE.Mesh(crossbarGeo, postMat);
    crossbar.rotation.z = Math.PI / 2;
    crossbar.position.set(0, GOAL_HEIGHT, 0);
    crossbar.castShadow = !this.isSoftwareGl;

    // Gold base collars & rear stanchions
    const collarGeo = this.trackGeo(new THREE.CylinderGeometry(0.085, 0.085, 0.14, 12));
    const leftCollar = new THREE.Mesh(collarGeo, accentMat);
    leftCollar.position.set(-GOAL_HALF_WIDTH, 0.07, 0);
    const rightCollar = new THREE.Mesh(collarGeo, accentMat);
    rightCollar.position.set(GOAL_HALF_WIDTH, 0.07, 0);

    const supportTubeGeo = this.trackGeo(new THREE.CylinderGeometry(0.032, 0.032, GOAL_NET_DEPTH, 8));
    for (const sx of [-GOAL_HALF_WIDTH, GOAL_HALF_WIDTH]) {
      const groundBar = new THREE.Mesh(supportTubeGeo, accentMat);
      groundBar.rotation.x = Math.PI / 2;
      groundBar.position.set(sx, 0.032, -GOAL_NET_DEPTH / 2);

      const topBar = new THREE.Mesh(supportTubeGeo, accentMat);
      topBar.rotation.x = Math.PI / 2;
      topBar.position.set(sx, GOAL_HEIGHT, -GOAL_NET_DEPTH / 2);

      const backStanchion = new THREE.Mesh(
        this.trackGeo(new THREE.CylinderGeometry(0.032, 0.032, GOAL_HEIGHT, 8)),
        accentMat
      );
      backStanchion.position.set(sx, GOAL_HEIGHT / 2, -GOAL_NET_DEPTH);

      goalGroup.add(groundBar, topBar, backStanchion);
    }

    const backGroundBar = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.032, 0.032, GOAL_HALF_WIDTH * 2, 8)),
      accentMat
    );
    backGroundBar.rotation.z = Math.PI / 2;
    backGroundBar.position.set(0, 0.032, -GOAL_NET_DEPTH);

    const backTopBar = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.032, 0.032, GOAL_HALF_WIDTH * 2, 8)),
      accentMat
    );
    backTopBar.rotation.z = Math.PI / 2;
    backTopBar.position.set(0, GOAL_HEIGHT, -GOAL_NET_DEPTH);

    goalGroup.add(leftPost, rightPost, crossbar, leftCollar, rightCollar, backGroundBar, backTopBar);

    // Deformable Net Panels (wireframe mesh whose vertices ripple smoothly on impact)
    const netMat = this.trackMat(
      new THREE.MeshBasicMaterial({
        color: 0xf4f4f5,
        wireframe: true,
        transparent: true,
        opacity: 0.42,
      })
    );

    const registerNetPlane = (
      w: number,
      h: number,
      segsW: number,
      segsH: number,
      pos: [number, number, number],
      rot: [number, number, number]
    ) => {
      const geo = this.trackGeo(new THREE.PlaneGeometry(w, h, segsW, segsH));
      const mesh = new THREE.Mesh(geo, netMat);
      mesh.position.set(...pos);
      mesh.rotation.set(...rot);
      goalGroup.add(mesh);
      const posAttr = geo.attributes.position as THREE.BufferAttribute;
      this.netPanels.push({
        mesh,
        geo,
        basePositions: new Float32Array(posAttr.array as Float32Array),
      });
    };

    // Back net
    registerNetPlane(
      GOAL_HALF_WIDTH * 2,
      GOAL_HEIGHT,
      24,
      10,
      [0, GOAL_HEIGHT / 2, -GOAL_NET_DEPTH],
      [0, 0, 0]
    );
    // Top roof net
    registerNetPlane(
      GOAL_HALF_WIDTH * 2,
      GOAL_NET_DEPTH,
      24,
      8,
      [0, GOAL_HEIGHT, -GOAL_NET_DEPTH / 2],
      [-Math.PI / 2, 0, 0]
    );
    // Left side net
    registerNetPlane(
      GOAL_NET_DEPTH,
      GOAL_HEIGHT,
      8,
      10,
      [-GOAL_HALF_WIDTH, GOAL_HEIGHT / 2, -GOAL_NET_DEPTH / 2],
      [0, Math.PI / 2, 0]
    );
    // Right side net
    registerNetPlane(
      GOAL_NET_DEPTH,
      GOAL_HEIGHT,
      8,
      10,
      [GOAL_HALF_WIDTH, GOAL_HEIGHT / 2, -GOAL_NET_DEPTH / 2],
      [0, -Math.PI / 2, 0]
    );

    this.scene.add(goalGroup);
  }

  private buildBallAndTrail(): void {
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    this.ballGroup = new THREE.Group();
    this.ballGroup.position.set(0, BALL_RADIUS, 11);

    const ballTex = this.trackTex(createSoccerBallTexture(maxAniso));
    const ballMat = this.trackMat(
      new THREE.MeshPhysicalMaterial({
        map: ballTex,
        roughness: 0.35,
        metalness: 0.08,
        clearcoat: 0.55,
        clearcoatRoughness: 0.2,
      })
    );
    this.ballMesh = new THREE.Mesh(
      this.trackGeo(new THREE.SphereGeometry(BALL_RADIUS, 28, 28)),
      ballMat
    );
    this.ballMesh.castShadow = !this.isSoftwareGl;
    this.ballGroup.add(this.ballMesh);
    this.scene.add(this.ballGroup);

    // Soft contact ground shadow directly under ball
    const shadowTex = this.trackTex(createContactShadowTexture());
    const shadowMat = this.trackMat(
      new THREE.MeshBasicMaterial({
        map: shadowTex,
        transparent: true,
        depthWrite: false,
        opacity: 0.6,
      })
    );
    this.ballShadow = new THREE.Mesh(
      this.trackGeo(new THREE.PlaneGeometry(0.42, 0.42)),
      shadowMat
    );
    this.ballShadow.rotation.x = -Math.PI / 2;
    this.ballShadow.position.set(0, 0.015, 11);
    this.scene.add(this.ballShadow);

    // Instanced flight trail
    const trailCount = 28;
    const trailMat = this.trackMat(
      new THREE.MeshBasicMaterial({
        color: 0xe5a93b,
        transparent: true,
        opacity: 0.45,
      })
    );
    this.trailMesh = new THREE.InstancedMesh(
      this.trackGeo(new THREE.SphereGeometry(BALL_RADIUS * 0.65, 8, 8)),
      trailMat,
      trailCount
    );
    this.trailMesh.frustumCulled = false;
    this.trailMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < trailCount; i++) {
      this.trailPoints.push({ x: 0, y: -50, z: 0, active: false });
      _dummyMatrix.position.set(0, -50, 0);
      _dummyMatrix.scale.setScalar(0.001);
      _dummyMatrix.updateMatrix();
      this.trailMesh.setMatrixAt(i, _dummyMatrix.matrix);
    }
    this.trailMesh.instanceMatrix.needsUpdate = true;
    this.scene.add(this.trailMesh);
  }

  private createArticulatedPlayer(
    jerseyColor: number,
    shortsColor: number,
    trimColor: number,
    withGloves: boolean
  ): KeeperRig {
    const root = new THREE.Group();
    const body = new THREE.Group();
    body.position.y = 0.92;
    root.add(body);

    const skinMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x8d5524, roughness: 0.65 })
    );
    const jerseyMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: jerseyColor, roughness: 0.55, metalness: 0.08 })
    );
    const shortsMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: shortsColor, roughness: 0.68 })
    );
    const accentMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: trimColor,
        roughness: 0.35,
        metalness: 0.45,
      })
    );

    // Torso & shoulders (primary silhouette)
    const torso = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(0.46, 0.58, 0.25)), jerseyMat);
    torso.position.y = 0.22;
    torso.castShadow = !this.isSoftwareGl;
    body.add(torso);

    const chestStripe = new THREE.Mesh(
      this.trackGeo(new THREE.BoxGeometry(0.47, 0.11, 0.26)),
      accentMat
    );
    chestStripe.position.y = 0.3;
    body.add(chestStripe);

    const pelvis = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(0.42, 0.2, 0.24)), shortsMat);
    pelvis.position.y = -0.14;
    pelvis.castShadow = !this.isSoftwareGl;
    body.add(pelvis);

    // Head + hair band
    const head = new THREE.Mesh(this.trackGeo(new THREE.SphereGeometry(0.14, 14, 14)), skinMat);
    head.position.y = 0.68;
    head.castShadow = !this.isSoftwareGl;
    body.add(head);

    const capBand = new THREE.Mesh(
      this.trackGeo(new THREE.SphereGeometry(0.144, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.48)),
      shortsMat
    );
    capBand.position.y = 0.695;
    body.add(capBand);

    // Articulated Arms
    const buildArm = (side: -1 | 1) => {
      const armGroup = new THREE.Group();
      armGroup.position.set(side * 0.29, 0.46, 0);

      const upper = new THREE.Mesh(
        this.trackGeo(new THREE.CylinderGeometry(0.055, 0.05, 0.36, 10)),
        jerseyMat
      );
      upper.position.y = -0.18;
      upper.castShadow = !this.isSoftwareGl;
      armGroup.add(upper);

      const forearm = new THREE.Mesh(
        this.trackGeo(new THREE.CylinderGeometry(0.048, 0.042, 0.3, 10)),
        skinMat
      );
      forearm.position.y = -0.48;
      armGroup.add(forearm);

      const hand = new THREE.Mesh(
        this.trackGeo(
          withGloves ? new THREE.BoxGeometry(0.12, 0.16, 0.08) : new THREE.SphereGeometry(0.05, 8, 8)
        ),
        withGloves ? accentMat : skinMat
      );
      hand.position.y = -0.66;
      armGroup.add(hand);

      body.add(armGroup);
      return armGroup;
    };

    // Articulated Legs
    const buildLeg = (side: -1 | 1) => {
      const legGroup = new THREE.Group();
      legGroup.position.set(side * 0.13, -0.22, 0);

      const thigh = new THREE.Mesh(
        this.trackGeo(new THREE.CylinderGeometry(0.082, 0.068, 0.4, 10)),
        shortsMat
      );
      thigh.position.y = -0.2;
      thigh.castShadow = !this.isSoftwareGl;
      legGroup.add(thigh);

      const shin = new THREE.Mesh(
        this.trackGeo(new THREE.CylinderGeometry(0.056, 0.046, 0.38, 10)),
        jerseyMat
      );
      shin.position.y = -0.54;
      shin.castShadow = !this.isSoftwareGl;
      legGroup.add(shin);

      const boot = new THREE.Mesh(
        this.trackGeo(new THREE.BoxGeometry(0.11, 0.09, 0.22)),
        accentMat
      );
      boot.position.set(0, -0.74, 0.05);
      legGroup.add(boot);

      body.add(legGroup);
      return legGroup;
    };

    const leftArm = buildArm(-1);
    const rightArm = buildArm(1);
    const leftLeg = buildLeg(-1);
    const rightLeg = buildLeg(1);

    return { root, body, leftArm, rightArm, leftLeg, rightLeg, jerseyMat };
  }

  private buildKeeper(): void {
    // High-contrast gold & obsidian Temple Cinema keeper kit
    this.keeperRig = this.createArticulatedPlayer(0xe5a93b, 0x111114, 0xfafafa, true);
    this.keeperRig.root.position.set(0, 0, 0.32);
    this.scene.add(this.keeperRig.root);
  }

  private buildDefensiveWall(): void {
    this.wallGroup = new THREE.Group();
    const offsets = [-1.02, -0.34, 0.34, 1.02];
    for (const offsetX of offsets) {
      const def = this.createArticulatedPlayer(0x18181b, 0x09090b, 0xe5a93b, false);
      def.root.position.set(offsetX, 0, 0);
      // Tuck arms defensively across chest
      def.leftArm.rotation.set(-0.4, 0, -0.45);
      def.rightArm.rotation.set(-0.4, 0, 0.45);
      this.wallGroup.add(def.root);
      this.wallDefenders.push(def.root);
    }
    this.wallGroup.visible = false;
    this.scene.add(this.wallGroup);
  }

  private buildAimPreview(): void {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < 24; i++) pts.push(new THREE.Vector3());
    this.aimPreviewGeo = this.trackGeo(new THREE.BufferGeometry().setFromPoints(pts));
    const mat = this.trackMat(
      new THREE.LineBasicMaterial({
        color: 0xe5a93b,
        transparent: true,
        opacity: 0.72,
      })
    );
    this.aimPreviewLine = new THREE.Line(this.aimPreviewGeo, mat);
    this.aimPreviewLine.visible = false;
    this.scene.add(this.aimPreviewLine);
  }

  private buildCrowd(): void {
    const count = 420;
    const mat = this.trackMat(new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0.05 }));
    this.crowdMesh = new THREE.InstancedMesh(
      this.trackGeo(new THREE.CapsuleGeometry(0.18, 0.36, 4, 8)),
      mat,
      count
    );
    this.crowdMesh.frustumCulled = false;

    const palette = [
      new THREE.Color(0xe5a93b),
      new THREE.Color(0xfafafa),
      new THREE.Color(0x27272a),
      new THREE.Color(0xd97706),
      new THREE.Color(0x71717a),
    ];

    for (let i = 0; i < count; i++) {
      let bx = 0;
      let by = 4;
      let bz = -10;
      let rotY = 0;

      if (i < 240) {
        // Behind goal tiered crowd
        const tier = Math.floor(i / 80);
        const col = i % 80;
        bx = -29 + (col / 79) * 58 + (Math.random() - 0.5) * 0.4;
        by = 3.9 + tier * 3.1;
        bz = -7.2 - tier * 5.8 + (Math.random() - 0.5) * 1.6;
        rotY = 0;
      } else {
        // Side stand crowd
        const side = i % 2 === 0 ? -1 : 1;
        bx = side * (28.5 + Math.random() * 6.5);
        by = 4.8 + (Math.random() > 0.5 ? 4.2 : 0);
        bz = -4 + Math.random() * 44;
        rotY = side * -Math.PI / 2;
      }

      this.crowdMembers.push({
        baseX: bx,
        baseY: by,
        baseZ: bz,
        phase: Math.random() * Math.PI * 2,
        rotY,
      });

      _dummyMatrix.position.set(bx, by, bz);
      _dummyMatrix.rotation.set(0, rotY, 0);
      _dummyMatrix.scale.setScalar(0.85 + Math.random() * 0.3);
      _dummyMatrix.updateMatrix();
      this.crowdMesh.setMatrixAt(i, _dummyMatrix.matrix);
      this.crowdMesh.setColorAt(i, palette[i % palette.length]);
    }
    this.crowdMesh.instanceMatrix.needsUpdate = true;
    if (this.crowdMesh.instanceColor) this.crowdMesh.instanceColor.needsUpdate = true;
    this.crowdMesh.computeBoundingSphere();
    this.scene.add(this.crowdMesh);
  }

  private buildCelebrationBurst(): void {
    const count = 48;
    const mat = this.trackMat(
      new THREE.MeshBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.9 })
    );
    this.burstMesh = new THREE.InstancedMesh(
      this.trackGeo(new THREE.OctahedronGeometry(0.11, 0)),
      mat,
      count
    );
    this.burstMesh.frustumCulled = false;
    this.burstMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    for (let i = 0; i < count; i++) {
      this.burstParticles.push({
        active: false,
        x: 0,
        y: -50,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        scale: 0.001,
        life: 0,
      });
      _dummyMatrix.position.set(0, -50, 0);
      _dummyMatrix.scale.setScalar(0.001);
      _dummyMatrix.updateMatrix();
      this.burstMesh.setMatrixAt(i, _dummyMatrix.matrix);
    }
    this.burstMesh.instanceMatrix.needsUpdate = true;
    this.scene.add(this.burstMesh);
  }

  public setRoundSetup(mode: FootballGameMode, spot: FreeKickSpot): void {
    this.mode = mode;
    this.spot = spot;
    this.activeSim = null;
    this.isReplay = false;
    this.playbackRate = 1.0;
    this.simElapsed = 0;
    this.netRippleTime = -1;
    this.aimPreviewLine.visible = false;

    this.ballGroup.position.set(spot.x, BALL_RADIUS, spot.z);
    this.ballGroup.rotation.set(0, 0, 0);
    this.ballShadow.position.set(spot.x, 0.015, spot.z);
    this.ballShadow.scale.setScalar(1);

    // Clear trail
    for (let i = 0; i < this.trailPoints.length; i++) {
      this.trailPoints[i].active = false;
      _dummyMatrix.position.set(0, -50, 0);
      _dummyMatrix.scale.setScalar(0.001);
      _dummyMatrix.updateMatrix();
      this.trailMesh.setMatrixAt(i, _dummyMatrix.matrix);
    }
    this.trailMesh.instanceMatrix.needsUpdate = true;

    // Reset net vertices
    for (const panel of this.netPanels) {
      const posAttr = panel.geo.attributes.position as THREE.BufferAttribute;
      (posAttr.array as Float32Array).set(panel.basePositions);
      posAttr.needsUpdate = true;
    }

    // Reset goalkeeper pose
    const keeperStartX =
      mode === 'freekick' ? Math.max(-0.85, Math.min(0.85, -Math.sign(spot.x || 1) * 0.65)) : 0;
    this.resetKeeperPose(keeperStartX);

    // Setup defensive wall for Free Kick Challenge
    if (mode === 'freekick') {
      this.wallGroup.visible = true;
      this.wallGroup.position.set(spot.wallCenterX, 0, spot.wallCenterZ);
      this.wallGroup.rotation.y = spot.wallAngleY;
      for (const def of this.wallDefenders) {
        def.position.y = 0;
      }
    } else {
      this.wallGroup.visible = false;
    }

    this.resetCameraImmediate();
  }

  private resetKeeperPose(startX: number): void {
    this.keeperRig.root.position.set(startX, 0, 0.32);
    this.keeperRig.body.position.set(0, 0.92, 0);
    this.keeperRig.body.rotation.set(0, 0, 0);
    this.keeperRig.leftArm.rotation.set(-0.35, 0, 0.45);
    this.keeperRig.rightArm.rotation.set(-0.35, 0, -0.45);
    this.keeperRig.leftLeg.rotation.set(0, 0, 0.08);
    this.keeperRig.rightLeg.rotation.set(0, 0, -0.08);
  }

  public updateAimPreview(aimX: number, aimY: number, curve: number, visible: boolean): void {
    if (!visible) {
      this.aimPreviewLine.visible = false;
      return;
    }
    this.aimPreviewLine.visible = true;
    const posAttr = this.aimPreviewGeo.attributes.position as THREE.BufferAttribute;
    const targetX = aimX * 3.55;
    const targetY = 0.25 + aimY * 2.15;

    for (let i = 0; i < 24; i++) {
      const u = i / 23;
      const bow = Math.sin(u * Math.PI) * (-curve * (this.mode === 'freekick' ? 1.8 : 0.75));
      const x = this.spot.x + (targetX - this.spot.x) * u + bow;
      const y = BALL_RADIUS + (targetY - BALL_RADIUS) * u + Math.sin(u * Math.PI) * 0.75;
      const z = this.spot.z + (0 - this.spot.z) * u;
      posAttr.setXYZ(i, x, y, z);
    }
    posAttr.needsUpdate = true;
  }

  public playSimulation(sim: KickSimulationResult, replay = false): void {
    this.activeSim = sim;
    this.isReplay = replay;
    this.playbackRate = replay ? 0.36 : 1.0;
    this.simElapsed = 0;
    this.firedWoodwork = false;
    this.firedSave = false;
    this.firedWall = false;
    this.firedNet = false;
    this.firedFinish = false;
    this.aimPreviewLine.visible = false;

    for (const p of this.trailPoints) p.active = false;
    this.resetKeeperPose(sim.keeperPlan.startX);
  }

  public triggerGoalBurst(x: number, y: number, z: number): void {
    this.crowdCheerTimer = 2.6;
    for (let i = 0; i < this.burstParticles.length; i++) {
      const p = this.burstParticles[i];
      p.active = true;
      p.x = x;
      p.y = Math.max(0.4, y);
      p.z = z;
      p.vx = (Math.random() - 0.5) * 8;
      p.vy = 2.5 + Math.random() * 6;
      p.vz = 1.5 + Math.random() * 6;
      p.scale = 0.7 + Math.random() * 0.9;
      p.life = 1.6 + Math.random() * 0.6;
    }
  }

  public setPaused(paused: boolean): void {
    this.paused = paused;
  }

  private resetCameraImmediate(): void {
    const len = Math.hypot(this.spot.x, this.spot.z) || 1;
    const backDist = this.mode === 'freekick' ? 4.4 : 4.2;
    const camX = this.spot.x + (this.spot.x / len) * backDist;
    const camZ = this.spot.z + (this.spot.z / len) * backDist;
    const camY = this.mode === 'freekick' ? 1.85 : 1.68;

    this.camera.position.set(camX, camY, camZ);
    _camCurrentLook.set(this.spot.x * 0.2, 1.15, 0);
    this.camera.lookAt(_camCurrentLook);
  }

  private sampleFrameAtTime(frames: PhysicsFrame[], t: number): PhysicsFrame {
    if (frames.length === 0) {
      return {
        t: 0,
        x: this.spot.x,
        y: BALL_RADIUS,
        z: this.spot.z,
        vx: 0,
        vy: 0,
        vz: 0,
        spinX: 0,
        spinY: 0,
        spinZ: 0,
      };
    }
    if (t <= 0) return frames[0];
    const last = frames[frames.length - 1];
    if (t >= last.t) return last;

    const dtStep = last.t / Math.max(1, frames.length - 1);
    const idx = Math.min(frames.length - 2, Math.max(0, Math.floor(t / dtStep)));
    const a = frames[idx];
    const b = frames[idx + 1];
    const span = Math.max(1e-5, b.t - a.t);
    const alpha = Math.max(0, Math.min(1, (t - a.t) / span));

    return {
      t,
      x: a.x + (b.x - a.x) * alpha,
      y: a.y + (b.y - a.y) * alpha,
      z: a.z + (b.z - a.z) * alpha,
      vx: a.vx + (b.vx - a.vx) * alpha,
      vy: a.vy + (b.vy - a.vy) * alpha,
      vz: a.vz + (b.vz - a.vz) * alpha,
      spinX: a.spinX,
      spinY: a.spinY,
      spinZ: a.spinZ,
    };
  }

  private updateKeeperVisual(t: number): void {
    if (!this.activeSim) {
      // Subtle ready crouch idle animation
      const pulse = Math.sin(performance.now() * 0.004) * 0.03;
      this.keeperRig.body.position.y = 0.9 + pulse;
      return;
    }

    const plan = this.activeSim.keeperPlan;
    const pose = sampleKeeperPoseAtTime(plan, t);
    this.keeperRig.root.position.set(pose.x, 0, pose.z);
    this.keeperRig.body.position.y = pose.y;

    let tiltZ = 0;
    if (plan.diveDir === 'left' || plan.diveDir === 'up-left') tiltZ = 1.25 * pose.progress;
    else if (plan.diveDir === 'right' || plan.diveDir === 'up-right') tiltZ = -1.25 * pose.progress;

    this.keeperRig.body.rotation.z = tiltZ;

    // Outstretch keeper arms toward dive side
    if (plan.diveDir === 'left' || plan.diveDir === 'up-left') {
      this.keeperRig.leftArm.rotation.set(0, 0, 2.3 * pose.progress);
      this.keeperRig.rightArm.rotation.set(0, 0, 1.5 * pose.progress);
    } else if (plan.diveDir === 'right' || plan.diveDir === 'up-right') {
      this.keeperRig.rightArm.rotation.set(0, 0, -2.3 * pose.progress);
      this.keeperRig.leftArm.rotation.set(0, 0, -1.5 * pose.progress);
    } else if (plan.diveDir === 'up') {
      this.keeperRig.leftArm.rotation.set(0, 0, 2.8 * pose.progress);
      this.keeperRig.rightArm.rotation.set(0, 0, -2.8 * pose.progress);
    }
  }

  private updateNetDeformation(dt: number): void {
    if (this.netRippleTime < 0) return;
    this.netRippleTime += dt;
    const decay = Math.exp(-this.netRippleTime * 2.1);
    if (decay < 0.015) {
      this.netRippleTime = -1;
      for (const panel of this.netPanels) {
        const attr = panel.geo.attributes.position as THREE.BufferAttribute;
        (attr.array as Float32Array).set(panel.basePositions);
        attr.needsUpdate = true;
      }
      return;
    }

    const waveFreq = 18;
    for (const panel of this.netPanels) {
      const attr = panel.geo.attributes.position as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      const base = panel.basePositions;

      for (let i = 0; i < arr.length; i += 3) {
        const lx = base[i];
        const ly = base[i + 1];
        const lz = base[i + 2];

        // World approximation for back net deformation ripple
        const dist = Math.hypot(
          lx + panel.mesh.position.x - this.netImpactPoint.x,
          ly + panel.mesh.position.y - this.netImpactPoint.y
        );
        const ripple =
          Math.exp(-dist * 0.85) *
          Math.sin(this.netRippleTime * waveFreq - dist * 3.0) *
          0.32 *
          decay;
        arr[i + 2] = lz - Math.abs(ripple) - 0.14 * decay * Math.exp(-dist * 0.7);
      }
      attr.needsUpdate = true;
    }
  }

  private updateCamera(dt: number, ballPos: THREE.Vector3): void {
    const dampLambda = this.isReplay ? 7.5 : 5.5;
    if (this.activeSim) {
      if (this.isReplay) {
        // Dramatic slow-mo side angle looking across goal mouth
        const sideSign = this.spot.x >= 0 ? -1 : 1;
        _camTargetPos.set(sideSign * 8.2, 2.35, 3.8);
        _camTargetLook.set(ballPos.x * 0.7, Math.max(0.6, ballPos.y * 0.75), ballPos.z * 0.6);
      } else {
        // Follow shot smoothly toward the goal mouth
        const followX = THREE.MathUtils.clamp(ballPos.x * 0.45, -4.5, 4.5);
        _camTargetPos.set(this.spot.x * 0.55 + followX * 0.45, 2.25, Math.max(5.5, ballPos.z * 0.55 + 4.8));
        _camTargetLook.set(ballPos.x * 0.55, Math.max(0.85, ballPos.y * 0.7), Math.min(2, ballPos.z * 0.35));
      }
    } else {
      const len = Math.hypot(this.spot.x, this.spot.z) || 1;
      const backDist = this.mode === 'freekick' ? 4.4 : 4.2;
      _camTargetPos.set(
        this.spot.x + (this.spot.x / len) * backDist,
        this.mode === 'freekick' ? 1.85 : 1.68,
        this.spot.z + (this.spot.z / len) * backDist
      );
      _camTargetLook.set(this.spot.x * 0.2, 1.15, 0);
    }

    if (this.cameraShakeTime > 0) {
      this.cameraShakeTime = Math.max(0, this.cameraShakeTime - dt);
      const amp = this.cameraShakeTime * 0.28;
      _camTargetPos.x += (Math.random() - 0.5) * amp;
      _camTargetPos.y += (Math.random() - 0.5) * amp;
    }

    const alpha = 1 - Math.exp(-dampLambda * dt);
    this.camera.position.lerp(_camTargetPos, alpha);
    _camCurrentLook.lerp(_camTargetLook, alpha);
    this.camera.lookAt(_camCurrentLook);
  }

  private startLoop(): void {
    const tick = (now?: number) => {
      if (this.disposed) return;
      const ts = typeof now === 'number' ? now : performance.now();
      const rawDt = Math.min(0.05, Math.max(0.001, (ts - this.lastTimestamp) / 1000));
      this.lastTimestamp = ts;

      // Adaptive FPS monitor for mid-range phones
      if (!this.isSoftwareGl && !this.paused) {
        this.frameTimeSum += rawDt;
        this.frameCount++;
        if (this.frameCount >= 40) {
          const avg = this.frameTimeSum / this.frameCount;
          if (avg > 0.028 && this.qualityTier === 'high') {
            this.qualityTier = 'balanced';
            this.renderer.setPixelRatio(1);
            this.renderer.shadowMap.autoUpdate = false;
            this.callbacks.onQualityAdjusted?.('balanced');
          }
          this.frameTimeSum = 0;
          this.frameCount = 0;
        }
      }

      if (!this.paused) {
        this.stepSimulation(rawDt);
      }

      this.renderer.render(this.scene, this.camera);

      if (this.isSoftwareGl) {
        this.afterDraw(() => tick(performance.now()));
      } else {
        this.frameId = requestAnimationFrame(tick);
      }
    };

    if (this.isSoftwareGl) {
      this.afterDraw(() => tick(performance.now()));
    } else {
      this.frameId = requestAnimationFrame(tick);
    }
  }

  private afterDraw(cb: () => void): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (!gl || typeof gl.fenceSync !== 'function') {
      this.frameId = window.setTimeout(cb, 80);
      return;
    }
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      if (this.disposed) return;
      const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
      if (state === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, 80);
      }
    };
    this.frameId = window.setTimeout(poll, 5);
  }

  private stepSimulation(rawDt: number): void {
    const simDt = rawDt * this.playbackRate;

    if (this.activeSim) {
      this.simElapsed += simDt;
      const sim = this.activeSim;
      const f = this.sampleFrameAtTime(sim.frames, this.simElapsed);

      this.ballGroup.position.set(f.x, f.y, f.z);
      this.ballGroup.rotation.x += f.spinX * simDt * 0.45;
      this.ballGroup.rotation.y += f.spinY * simDt * 0.45;
      this.ballGroup.rotation.z += f.spinZ * simDt * 0.45;

      // Ground contact shadow directly underneath
      this.ballShadow.position.set(f.x, 0.015, f.z);
      const heightFade = Math.max(0.25, 1 - f.y * 0.25);
      this.ballShadow.scale.setScalar(heightFade);

      // Update flight trail
      this.trailPoints[this.trailHead] = { x: f.x, y: f.y, z: f.z, active: true };
      this.trailHead = (this.trailHead + 1) % this.trailPoints.length;
      for (let i = 0; i < this.trailPoints.length; i++) {
        const pt = this.trailPoints[i];
        if (!pt.active) continue;
        const age = ((this.trailHead - 1 - i + this.trailPoints.length) % this.trailPoints.length) /
          this.trailPoints.length;
        _dummyMatrix.position.set(pt.x, pt.y, pt.z);
        _dummyMatrix.scale.setScalar(Math.max(0.05, 1 - age));
        _dummyMatrix.updateMatrix();
        this.trailMesh.setMatrixAt(i, _dummyMatrix.matrix);
      }
      this.trailMesh.instanceMatrix.needsUpdate = true;

      // Jumping defensive wall
      if (this.mode === 'freekick') {
        const jumpY = getWallDefenderHeightOffset(this.simElapsed);
        for (const def of this.wallDefenders) {
          def.position.y = jumpY;
        }
      }

      // Collision audio / VFX triggers
      if (sim.wallHit && !this.firedWall && this.simElapsed >= sim.wallHit.time) {
        this.firedWall = true;
        this.callbacks.onAnimationEvent?.('wall');
      }
      if (sim.woodworkHit && !this.firedWoodwork && this.simElapsed >= sim.woodworkHit.time) {
        this.firedWoodwork = true;
        this.cameraShakeTime = 0.28;
        this.callbacks.onAnimationEvent?.('woodwork');
      }
      if (sim.saveHit && !this.firedSave && this.simElapsed >= sim.saveHit.time) {
        this.firedSave = true;
        this.cameraShakeTime = 0.22;
        this.callbacks.onAnimationEvent?.('save');
      }
      if (sim.netImpact && !this.firedNet && this.simElapsed >= sim.netImpact.time) {
        this.firedNet = true;
        this.netImpactPoint.set(sim.netImpact.x, sim.netImpact.y, sim.netImpact.z);
        this.netRippleTime = 0;
        if (!this.isReplay) {
          this.triggerGoalBurst(sim.netImpact.x, sim.netImpact.y, sim.netImpact.z);
        }
        this.callbacks.onAnimationEvent?.('net');
      }

      const endWindow = this.isReplay ? 1.55 : 1.75;
      if (!this.firedFinish && this.simElapsed >= endWindow) {
        this.firedFinish = true;
        this.callbacks.onAnimationEvent?.('finish');
      }
    } else {
      // Gentle ball idle breathing wait
      this.ballShadow.position.set(this.spot.x, 0.015, this.spot.z);
    }

    this.updateKeeperVisual(this.simElapsed);
    this.updateNetDeformation(rawDt);
    this.updateCamera(rawDt, this.ballGroup.position);

    // Update celebration particles
    let hasBurst = false;
    for (let i = 0; i < this.burstParticles.length; i++) {
      const p = this.burstParticles[i];
      if (!p.active) continue;
      hasBurst = true;
      p.life -= rawDt;
      if (p.life <= 0) {
        p.active = false;
        _dummyMatrix.position.set(0, -50, 0);
        _dummyMatrix.scale.setScalar(0.001);
      } else {
        p.vy -= 9.81 * rawDt;
        p.x += p.vx * rawDt;
        p.y = Math.max(0.05, p.y + p.vy * rawDt);
        p.z += p.vz * rawDt;
        _dummyMatrix.position.set(p.x, p.y, p.z);
        _dummyMatrix.rotation.set(p.life * 6, p.life * 4, 0);
        _dummyMatrix.scale.setScalar(p.scale * Math.min(1, p.life));
      }
      _dummyMatrix.updateMatrix();
      this.burstMesh.setMatrixAt(i, _dummyMatrix.matrix);
    }
    if (hasBurst) {
      this.burstMesh.instanceMatrix.needsUpdate = true;
    }

    // Update crowd cheering wave
    const nowSec = performance.now() * 0.001;
    const cheering = this.crowdCheerTimer > 0;
    if (cheering) {
      this.crowdCheerTimer = Math.max(0, this.crowdCheerTimer - rawDt);
    }
    const bounceAmp = cheering ? 0.34 : 0.05;
    const bounceSpeed = cheering ? 11.5 : 2.8;
    for (let i = 0; i < this.crowdMembers.length; i++) {
      const m = this.crowdMembers[i];
      const jump = Math.max(0, Math.sin(nowSec * bounceSpeed + m.phase)) * bounceAmp;
      _dummyMatrix.position.set(m.baseX, m.baseY + jump, m.baseZ);
      _dummyMatrix.rotation.set(0, m.rotY, 0);
      _dummyMatrix.scale.setScalar(1);
      _dummyMatrix.updateMatrix();
      this.crowdMesh.setMatrixAt(i, _dummyMatrix.matrix);
    }
    this.crowdMesh.instanceMatrix.needsUpdate = true;
  }

  private handleResize = (): void => {
    if (this.disposed) return;
    const width = Math.max(this.container.clientWidth, 320);
    const height = Math.max(this.container.clientHeight, 240);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  };

  public dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
    this.resizeObserver?.disconnect();
    window.removeEventListener('resize', this.handleResize);

    for (const geo of this.disposableGeos) geo.dispose();
    for (const mat of this.disposableMats) mat.dispose();
    for (const tex of this.disposableTextures) tex.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
