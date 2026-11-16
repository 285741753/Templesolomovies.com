import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Box, ChevronDown, ChevronUp, RotateCcw } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import {
  buildProjectorStage,
  PROJECTOR_PARTS,
  type ProjectorFinish,
  type ProjectorPartInfo,
} from '../three/projectorModel';

// Pre-allocated math helpers outside loop (zero GC churn)
const _camTargetPos = new THREE.Vector3();
const _orbitTargetPos = new THREE.Vector3();

type CameraPresetId = 'hero' | 'reels' | 'lens' | 'screen';

const CAMERA_PRESETS: Record<
  CameraPresetId,
  { pos: [number, number, number]; target: [number, number, number] }
> = {
  hero: { pos: [-1.1, 2.35, 4.4], target: [0.35, 1.32, 0] },
  reels: { pos: [-2.1, 2.55, 2.35], target: [-0.65, 1.65, 0] },
  lens: { pos: [0.45, 1.65, 2.0], target: [-0.05, 1.42, 0] },
  screen: { pos: [-0.55, 1.55, 2.25], target: [2.25, 1.42, 0] },
};

function detectSoftwareWebGL(): boolean {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

export function CinemaStage3D() {
  const { t } = useLanguage();
  const mountRef = useRef<HTMLDivElement | null>(null);

  const [controlsCollapsed, setControlsCollapsed] = useState(false);
  const [explodeTarget, setExplodeTarget] = useState(0);
  const [reelSpeed, setReelSpeed] = useState(1);
  const [finish, setFinish] = useState<ProjectorFinish>('brass');
  const [preset, setPreset] = useState<CameraPresetId>('hero');
  const [selectedPart, setSelectedPart] = useState<ProjectorPartInfo>(PROJECTOR_PARTS.lens);
  const [beamOn, setBeamOn] = useState(true);

  const explodeRef = useRef(explodeTarget);
  const speedRef = useRef(reelSpeed);
  const beamRef = useRef(beamOn);
  const finishRef = useRef(finish);
  const presetTransitionRef = useRef<{ active: boolean; preset: CameraPresetId }>({
    active: false,
    preset: 'hero',
  });
  const applyFinishFnRef = useRef<((f: ProjectorFinish) => void) | null>(null);

  useEffect(() => {
    explodeRef.current = explodeTarget;
  }, [explodeTarget]);

  useEffect(() => {
    speedRef.current = reelSpeed;
  }, [reelSpeed]);

  useEffect(() => {
    beamRef.current = beamOn;
  }, [beamOn]);

  useEffect(() => {
    finishRef.current = finish;
    applyFinishFnRef.current?.(finish);
  }, [finish]);

  const handleSelectPreset = (next: CameraPresetId) => {
    setPreset(next);
    presetTransitionRef.current = { active: true, preset: next };
  };

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = detectSoftwareWebGL();
    const width = container.clientWidth || 960;
    const height = container.clientHeight || 480;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#09090b');
    scene.fog = new THREE.FogExp2('#09090b', 0.075);

    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 45);
    camera.position.set(...CAMERA_PRESETS.hero.pos);

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    container.appendChild(renderer.domElement);

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const roomEnvTexture = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = roomEnvTexture;
    pmremGenerator.dispose();

    // 3-Point Warm/Cool Studio Lighting
    const hemiLight = new THREE.HemisphereLight('#9fb4d8', '#1f1710', 0.65);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight('#ffd7a1', 2.4);
    keyLight.position.set(-4.5, 6.2, 4.8);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.left = -4;
    keyLight.shadow.camera.right = 4;
    keyLight.shadow.camera.top = 4;
    keyLight.shadow.camera.bottom = -4;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight('#6da8ff', 1.25);
    rimLight.position.set(4.8, 3.8, -4.2);
    scene.add(rimLight);

    const built = buildProjectorStage(isSoftwareGl, renderer.capabilities.getMaxAnisotropy());
    built.applyFinish(finishRef.current);
    applyFinishFnRef.current = built.applyFinish;
    scene.add(built.root);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(...CAMERA_PRESETS.hero.target);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.06;
    controls.minDistance = 1.6;
    controls.maxDistance = 9.5;
    controls.maxPolarAngle = Math.PI / 2 - 0.04;
    controls.update();

    const cancelPresetTransition = () => {
      presetTransitionRef.current.active = false;
    };
    controls.addEventListener('start', cancelPresetTransition);

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    // Dedicated Layer 1 Raycasting on click
    const raycaster = new THREE.Raycaster();
    raycaster.layers.set(1);
    const pointer = new THREE.Vector2();
    let pointerDownX = 0;
    let pointerDownY = 0;

    const handlePointerDown = (e: PointerEvent) => {
      pointerDownX = e.clientX;
      pointerDownY = e.clientY;
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - pointerDownX, e.clientY - pointerDownY) > 6) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(built.clickableMeshes, false);
      if (hits.length > 0) {
        const partId = hits[0].object.userData.partId as string | undefined;
        if (partId && PROJECTOR_PARTS[partId]) {
          setSelectedPart(PROJECTOR_PARTS[partId]);
        }
      }
    };

    renderer.domElement.addEventListener('pointerdown', handlePointerDown);
    renderer.domElement.addEventListener('pointerup', handlePointerUp);

    const handleResize = () => {
      const nextW = container.clientWidth || 960;
      const nextH = container.clientHeight || 480;
      camera.aspect = nextW / nextH;
      camera.updateProjectionMatrix();
      renderer.setSize(nextW, nextH);
    };
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    let disposed = false;
    let frameId = 0;
    let lastTime = performance.now();
    let totalElapsed = 0;
    let lastScreenDraw = 0;
    let currentExplode = 0;

    const afterDraw = (cb: () => void) => {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) {
          if (sync) gl.deleteSync(sync);
          return;
        }
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    };

    const tick = () => {
      if (disposed) return;
      const now = performance.now();
      const delta = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;
      totalElapsed += delta;

      // Spin film reels at speed multiplier
      const spin = delta * 1.9 * speedRef.current;
      built.upperReel.rotation.z -= spin;
      built.lowerReel.rotation.z -= spin * 1.12;

      // Update projection beam visibility & subtle shimmer
      built.beamMesh.visible = beamRef.current;
      if (beamRef.current) {
        const beamMat = built.beamMesh.material as THREE.MeshBasicMaterial;
        beamMat.opacity = 0.08 + Math.sin(totalElapsed * 18) * 0.012;
      }

      // Redraw procedural screen texture at ~15Hz
      if (now - lastScreenDraw > 66) {
        built.drawScreenFrame(totalElapsed);
        lastScreenDraw = now;
      }

      // Smoothly damp exploded view separation
      currentExplode = THREE.MathUtils.damp(currentExplode, explodeRef.current, 6, delta);
      built.setExplodeAmount(currentExplode);

      // Smoothly damp camera preset transitions
      if (presetTransitionRef.current.active) {
        const targetPreset = CAMERA_PRESETS[presetTransitionRef.current.preset];
        _camTargetPos.set(...targetPreset.pos);
        _orbitTargetPos.set(...targetPreset.target);

        camera.position.x = THREE.MathUtils.damp(camera.position.x, _camTargetPos.x, 5.5, delta);
        camera.position.y = THREE.MathUtils.damp(camera.position.y, _camTargetPos.y, 5.5, delta);
        camera.position.z = THREE.MathUtils.damp(camera.position.z, _camTargetPos.z, 5.5, delta);

        controls.target.x = THREE.MathUtils.damp(controls.target.x, _orbitTargetPos.x, 5.5, delta);
        controls.target.y = THREE.MathUtils.damp(controls.target.y, _orbitTargetPos.y, 5.5, delta);
        controls.target.z = THREE.MathUtils.damp(controls.target.z, _orbitTargetPos.z, 5.5, delta);

        if (
          camera.position.distanceTo(_camTargetPos) < 0.025 &&
          controls.target.distanceTo(_orbitTargetPos) < 0.025
        ) {
          presetTransitionRef.current.active = false;
        }
      }

      controls.update();
      renderer.render(scene, camera);

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    };

    if (isSoftwareGl) {
      renderer.render(scene, camera);
      afterDraw(tick);
    } else {
      frameId = requestAnimationFrame(tick);
    }

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      resizeObserver.disconnect();
      controls.removeEventListener('start', cancelPresetTransition);
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
      renderer.domElement.removeEventListener('pointerup', handlePointerUp);
      controls.dispose();
      built.dispose();
      roomEnvTexture.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <section
      id="stage-3d"
      aria-label={t('stage3dTitle')}
      className="mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-8 pb-10"
    >
      <div className="rounded-xl border border-[#27272A] bg-[#111114] overflow-hidden">
        <div className="border-b border-[#27272A] px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-mono uppercase tracking-wider text-[#E5A93B]">
              {t('stage3dEyebrow')}
            </p>
            <h2 className="font-display text-xl font-bold text-[#FAFAFA] flex items-center gap-2">
              <Box className="h-5 w-5 text-[#E5A93B]" aria-hidden="true" />
              <span>{t('stage3dTitle')}</span>
            </h2>
            <p className="text-xs text-[#A1A1AA] mt-0.5">{t('stage3dSubtitle')}</p>
          </div>
          <div className="text-right">
            <p className="text-xs font-semibold text-[#FAFAFA]">{selectedPart.label}</p>
            <p className="text-[11px] text-[#71717A]">{selectedPart.spec}</p>
          </div>
        </div>

        <div className="relative h-[460px] w-full bg-[#09090B]">
          {/* Isolated WebGL canvas mount node — no sibling overlays nested inside */}
          <div ref={mountRef} className="h-full w-full" />

          {/* Top-left minimal spec label (solid background, zero backdrop-filter) */}
          <div className="pointer-events-none absolute top-3 left-3 rounded-lg border border-[#27272A] bg-[#111114]/90 px-3 py-1.5 text-[11px] text-[#D4D4D8]">
            Click any component to inspect · Drag to orbit · Scroll to zoom
          </div>

          {/* Collapsible Bottom Control Dock (zero backdrop-filter over WebGL) */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 w-[min(900px,94%)] flex flex-col items-center">
            <button
              type="button"
              onClick={() => setControlsCollapsed((prev) => !prev)}
              className="mb-1.5 inline-flex items-center gap-1.5 rounded-t-lg border border-[#27272A] bg-[#111114] px-3 py-1 text-[11px] font-medium text-[#D4D4D8] hover:text-[#FAFAFA] whitespace-nowrap cursor-pointer"
            >
              {controlsCollapsed ? (
                <>
                  <ChevronUp className="h-3.5 w-3.5 text-[#E5A93B]" aria-hidden="true" />
                  <span>Show Controls</span>
                </>
              ) : (
                <>
                  <ChevronDown className="h-3.5 w-3.5 text-[#E5A93B]" aria-hidden="true" />
                  <span>Hide Controls</span>
                </>
              )}
            </button>

            {!controlsCollapsed && (
              <div className="w-full rounded-xl border border-[#27272A] bg-[#111114]/95 px-4 py-3 shadow-2xl flex flex-wrap items-center justify-between gap-4 text-xs">
                <label className="flex items-center gap-2.5 text-[#D4D4D8] whitespace-nowrap">
                  <span className="font-medium">Explode</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={explodeTarget}
                    onChange={(e) => setExplodeTarget(Number(e.target.value))}
                    className="w-24 accent-[#E5A93B] cursor-pointer"
                  />
                </label>

                <label className="flex items-center gap-2.5 text-[#D4D4D8] whitespace-nowrap">
                  <span className="font-medium">Reels</span>
                  <input
                    type="range"
                    min={0}
                    max={3}
                    step={0.1}
                    value={reelSpeed}
                    onChange={(e) => setReelSpeed(Number(e.target.value))}
                    className="w-20 accent-[#E5A93B] cursor-pointer"
                  />
                  <span className="font-mono tabular-nums text-[#E5A93B]">
                    {reelSpeed.toFixed(1)}x
                  </span>
                </label>

                <div className="flex items-center gap-1.5">
                  {(['brass', 'obsidian', 'silver'] as ProjectorFinish[]).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setFinish(f)}
                      className={`rounded-md border px-2.5 py-1 text-[11px] font-medium capitalize transition-colors whitespace-nowrap cursor-pointer ${
                        finish === f
                          ? 'border-[#E5A93B] bg-[#E5A93B]/15 text-[#E5A93B]'
                          : 'border-[#27272A] bg-[#18181B] text-[#A1A1AA] hover:text-[#FAFAFA]'
                      }`}
                    >
                      {f}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-1.5">
                  {(['hero', 'reels', 'lens', 'screen'] as CameraPresetId[]).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => handleSelectPreset(p)}
                      className={`rounded-md border px-2.5 py-1 text-[11px] font-medium capitalize transition-colors whitespace-nowrap cursor-pointer ${
                        preset === p
                          ? 'border-[#E5A93B] bg-[#E5A93B] text-[#09090B] font-semibold'
                          : 'border-[#27272A] bg-[#18181B] text-[#A1A1AA] hover:text-[#FAFAFA]'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setBeamOn((b) => !b)}
                    className={`rounded-md border px-2.5 py-1 text-[11px] font-medium whitespace-nowrap cursor-pointer ${
                      beamOn
                        ? 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                        : 'border-[#27272A] bg-[#18181B] text-[#71717A]'
                    }`}
                  >
                    {beamOn ? 'Lamp On' : 'Lamp Off'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setExplodeTarget(0);
                      setReelSpeed(1);
                      handleSelectPreset('hero');
                    }}
                    aria-label="Reset camera and stage"
                    className="rounded-md border border-[#27272A] bg-[#18181B] p-1.5 text-[#A1A1AA] hover:text-[#FAFAFA] cursor-pointer"
                  >
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
