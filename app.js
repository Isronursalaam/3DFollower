import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/* ==========================================================================
   STATE
   ========================================================================== */
const state = {
  // 3D Scene
  model: null,
  mixer: null,
  headBone: null,
  neckBone: null,
  spineBone: null,

  // Eye Bones for Blinking
  eyeLBone: null,      // Bip001_eye_L
  eyeRBone: null,      // Bip001_eye_R
  boneEyeDL: null,     // Bip001_bone_eye_D_L
  boneEyeDR: null,     // Bip001_bone_eye_D_R

  // Mouth Meshes (Blue Archive Inverse Morph Targets)
  mouthNodes: {
    m300: null,
    m401: null,
    m402: null,
    m602: null
  },

  // Rest Quaternions
  headRestQuat: new THREE.Quaternion(),
  neckRestQuat: new THREE.Quaternion(),
  spineRestQuat: new THREE.Quaternion(),

  // Tracking Angles (radians)
  targetYaw: 0,
  targetPitch: 0,
  targetRoll: 0,
  curYaw: 0,
  curPitch: 0,
  curRoll: 0,

  // Eye Blink Mode: 'camera' | 'auto'
  blinkMode: 'camera',
  autoBlinkTimer: 0,
  autoBlinkInterval: 3.5,
  targetBlinkL: 0,
  targetBlinkR: 0,
  curBlinkL: 0,
  curBlinkR: 0,

  // Mouth Openness (0.0 = Closed, 1.0 = Wide Open)
  targetMouth: 0,
  curMouth: 0,

  // Natural blink timer for idle when camera is off
  idleBlinkTimer: 0,
  isIdleBlinking: false,

  // Calibration offset
  calibYaw: 0,
  calibPitch: 0,
  calibRoll: 0,
  hasAutoCalibrated: false,

  // Camera tracking status
  isCameraActive: false,
  isFaceDetected: false,
  cameraHandler: null,
  faceMesh: null,

  // Mouse fallback
  mouseNormX: 0,
  mouseNormY: 0
};

/* ==========================================================================
   DOM
   ========================================================================== */
const dom = {
  container: document.getElementById('canvas-container'),
  statusBadge: document.getElementById('status-badge'),
  btnCamera: document.getElementById('btn-camera'),
  btnBlinkMode: document.getElementById('btn-blink-mode'),
  btnReset: document.getElementById('btn-reset'),
  loadingOverlay: document.getElementById('loading-overlay'),
  progressFill: document.getElementById('progress-fill'),
  loadingText: document.getElementById('loading-text'),
  webcamBox: document.getElementById('webcam-box'),
  webcamVideo: document.getElementById('webcam-video'),
  webcamCanvas: document.getElementById('webcam-canvas'),
  webcamLabel: document.getElementById('webcam-label'),
  btnMinimizeCam: document.getElementById('btn-minimize-cam')
};

/* ==========================================================================
   THREE.JS SETUP
   ========================================================================== */
let scene, camera, renderer, controls;
const clock = new THREE.Clock();

function initThree() {
  const w = dom.container.clientWidth;
  const h = dom.container.clientHeight;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0c0d10);

  camera = new THREE.PerspectiveCamera(34, w / h, 0.1, 50);
  camera.position.set(0, 0.60, 1.45); // Upper body & face framing

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(w, h);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  dom.container.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.target.set(0, 0.52, 0); // Focus on chest/head
  controls.maxDistance = 4.0;
  controls.minDistance = 0.4;

  // Lighting
  const ambient = new THREE.AmbientLight(0xffffff, 1.3);
  scene.add(ambient);

  const keyLight = new THREE.DirectionalLight(0xffffff, 1.6);
  keyLight.position.set(1.5, 2.5, 2.0);
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0xa0c4ff, 0.8);
  fillLight.position.set(-1.8, 1.2, 1.5);
  scene.add(fillLight);

  const rimLight = new THREE.DirectionalLight(0xffffff, 0.5);
  rimLight.position.set(0, 2.0, -2.0);
  scene.add(rimLight);

  // Floor grid
  const grid = new THREE.GridHelper(3, 16, 0x242a35, 0x141820);
  grid.position.y = 0;
  scene.add(grid);

  window.addEventListener('resize', onResize);

  // Mouse fallback tracking when camera is off:
  window.addEventListener('mousemove', (e) => {
    if (!state.isCameraActive) {
      state.mouseNormX = (e.clientX / window.innerWidth - 0.5) * 2; // -1 to +1
      state.mouseNormY = (e.clientY / window.innerHeight - 0.5) * 2;
    }
  });
}

function onResize() {
  if (!camera || !renderer) return;
  const w = dom.container.clientWidth;
  const h = dom.container.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}

/* ==========================================================================
   MODEL LOADING & RIGGING (HEAD + EYES + MOUTH)
   ========================================================================== */
function loadModel() {
  const loader = new GLTFLoader();

  loader.load(
    'Shiroko.glb',
    (gltf) => {
      state.model = gltf.scene;

      // Map Head & Neck & Spine bones
      state.headBone = state.model.getObjectByName('Bip001_Head');
      state.neckBone = state.model.getObjectByName('Bip001_Neck');
      state.spineBone = state.model.getObjectByName('Bip001_Spine1');

      // Map Eye bones for blinking
      state.eyeLBone = state.model.getObjectByName('Bip001_eye_L');
      state.eyeRBone = state.model.getObjectByName('Bip001_eye_R');
      state.boneEyeDL = state.model.getObjectByName('Bip001_bone_eye_D_L');
      state.boneEyeDR = state.model.getObjectByName('Bip001_bone_eye_D_R');

      // Map Mouth meshes (Mouth_300, Mouth_401, Mouth_402, Mouth_602)
      state.mouthNodes = {
        m300: state.model.getObjectByName('Mouth_300'),
        m401: state.model.getObjectByName('Mouth_401'),
        m402: state.model.getObjectByName('Mouth_402'),
        m602: state.model.getObjectByName('Mouth_602')
      };

      // Ensure all mouth meshes are visible (their visibility is controlled via morph target collapse/expansion)
      Object.values(state.mouthNodes).forEach(m => {
        if (m) m.visible = true;
      });

      console.log('Mouth Meshes Mapped:');
      console.log('  Mouth_300:', !!state.mouthNodes.m300);
      console.log('  Mouth_401:', !!state.mouthNodes.m401);
      console.log('  Mouth_402:', !!state.mouthNodes.m402);
      console.log('  Mouth_602:', !!state.mouthNodes.m602);

      if (state.headBone) state.headRestQuat.copy(state.headBone.quaternion);
      if (state.neckBone) state.neckRestQuat.copy(state.neckBone.quaternion);
      if (state.spineBone) state.spineRestQuat.copy(state.spineBone.quaternion);

      // Setup AnimationMixer with Idle Animation
      state.mixer = new THREE.AnimationMixer(state.model);

      const idleAnim = gltf.animations.find(a => a.name === 'Cafe_Idle') || gltf.animations[0];
      if (idleAnim) {
        // Strip Head, Neck, Eye, AND Mouth tracks so animation DOES NOT fight tracking!
        idleAnim.tracks = idleAnim.tracks.filter(track => {
          const name = track.name;
          const isHeadOrNeck = name.startsWith('Bip001_Head') || name.startsWith('Bip001_Neck');
          const isEye = name.includes('_eye') || name.includes('eyeblow');
          const isMouth = name.startsWith('Mouth_') || name.includes('morphTargetInfluences');
          return !isHeadOrNeck && !isEye && !isMouth;
        });

        const action = state.mixer.clipAction(idleAnim);
        action.play();
      }

      // Initial eye & mouth states
      setBlink(0, 0);
      setMouth(0);

      scene.add(state.model);

      // Hide loading overlay
      dom.progressFill.style.width = '100%';
      setTimeout(() => {
        dom.loadingOverlay.style.opacity = '0';
        setTimeout(() => dom.loadingOverlay.style.display = 'none', 200);
      }, 300);
    },
    (xhr) => {
      if (xhr.lengthComputable) {
        const pct = Math.round((xhr.loaded / xhr.total) * 100);
        dom.progressFill.style.width = pct + '%';
        dom.loadingText.textContent = `Memuat Shiroko: ${pct}%`;
      }
    },
    (err) => {
      console.error('Gagal memuat Shiroko.glb:', err);
      dom.loadingText.textContent = 'Gagal memuat Shiroko.glb!';
    }
  );
}

/**
 * Menggerakkan mulut Shiroko sesuai keterbukaan bibir.
 * In Blue Archive glTF models:
 * morphTargetInfluences[0] == 0.0 -> EXPANDED / VISIBLE
 * morphTargetInfluences[0] == 1.0 -> COLLAPSED TO A POINT / HIDDEN
 * 
 * @param {number} openness 0.0 (tertutup) s/d 1.0 (terbuka lebar)
 */
function setMouth(openness) {
  const { m300, m401, m402, m602 } = state.mouthNodes;
  if (!m300) return;

  if (openness < 0.20) {
    // Mulut Tertutup (Mouth_300 aktif, yang lain diciutkan ke 1.0)
    if (m300.morphTargetInfluences) m300.morphTargetInfluences[0] = 0.0;
    if (m401 && m401.morphTargetInfluences) m401.morphTargetInfluences[0] = 1.0;
    if (m402 && m402.morphTargetInfluences) m402.morphTargetInfluences[0] = 1.0;
    if (m602 && m602.morphTargetInfluences) m602.morphTargetInfluences[0] = 1.0;
  } else if (openness < 0.60) {
    // Mulut Terbuka Sedang / Bicara (Mouth_401 aktif)
    if (m300.morphTargetInfluences) m300.morphTargetInfluences[0] = 1.0;
    if (m401 && m401.morphTargetInfluences) m401.morphTargetInfluences[0] = 0.0;
    if (m402 && m402.morphTargetInfluences) m402.morphTargetInfluences[0] = 1.0;
    if (m602 && m602.morphTargetInfluences) m602.morphTargetInfluences[0] = 1.0;
  } else {
    // Mulut Terbuka Lebar / Tertawa (Mouth_402 aktif)
    if (m300.morphTargetInfluences) m300.morphTargetInfluences[0] = 1.0;
    if (m401 && m401.morphTargetInfluences) m401.morphTargetInfluences[0] = 1.0;
    if (m402 && m402.morphTargetInfluences) m402.morphTargetInfluences[0] = 0.0;
    if (m602 && m602.morphTargetInfluences) m602.morphTargetInfluences[0] = 1.0;
  }
}

/**
 * Menggerakkan kelopak mata Shiroko (Kedipan).
 * @param {number} blinkL 0.0 (terbuka) s/d 1.0 (tertutup penuh)
 * @param {number} blinkR 0.0 (terbuka) s/d 1.0 (tertutup penuh)
 */
function setBlink(blinkL, blinkR) {
  // Bip001_eye_L & eye_R: terbuka = 0.1073, tertutup/kedip = 0.0642
  const eyeOpenX = 0.1073;
  const eyeClosedX = 0.0642;

  if (state.eyeLBone) {
    state.eyeLBone.position.x = eyeOpenX - blinkL * (eyeOpenX - eyeClosedX);
  }
  if (state.eyeRBone) {
    state.eyeRBone.position.x = eyeOpenX - blinkR * (eyeOpenX - eyeClosedX);
  }

  // Bip001_bone_eye_D_L & D_R: terbuka = 0.0557, tertutup/kedip = 0.0594
  const downOpenX = 0.0557;
  const downClosedX = 0.0594;

  if (state.boneEyeDL) {
    state.boneEyeDL.position.x = downOpenX + blinkL * (downClosedX - downOpenX);
  }
  if (state.boneEyeDR) {
    state.boneEyeDR.position.x = downOpenX + blinkR * (downClosedX - downOpenX);
  }
}

/* ==========================================================================
   FACIAL TRACKING (MEDIAPIPE FACE MESH LOCAL)
   ========================================================================== */
function initMediaPipe() {
  if (typeof FaceMesh === 'undefined') {
    console.error('FaceMesh library tidak terdefinisi');
    return;
  }

  state.faceMesh = new FaceMesh({
    locateFile: (file) => `mediapipe/${file}`
  });

  state.faceMesh.setOptions({
    maxNumFaces: 1,
    refineLandmarks: true,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5
  });

  state.faceMesh.onResults(onFaceResults);
}

async function startCamera() {
  if (state.isCameraActive) {
    stopCamera();
    return;
  }

  updateStatus('warn', '[MEMINTA IZIN KAMERA...]');

  try {
    if (!state.faceMesh) {
      initMediaPipe();
    }

    if (typeof Camera === 'undefined') {
      throw new Error('Camera utils tidak ditemukan');
    }

    state.cameraHandler = new Camera(dom.webcamVideo, {
      onFrame: async () => {
        if (!state.isCameraActive) return;
        try {
          await state.faceMesh.send({ image: dom.webcamVideo });
        } catch (e) {
          // ignore transient frame error
        }
      },
      width: 640,
      height: 480
    });

    await state.cameraHandler.start();

    state.isCameraActive = true;
    state.hasAutoCalibrated = false;
    dom.btnCamera.textContent = '[HENTIKAN KAMERA]';
    dom.btnCamera.className = 'btn btn-danger';
    updateStatus('warn', '[MENCARI WAJAH...]');
  } catch (err) {
    console.error('Error starting camera:', err);
    alert('Gagal membuka kamera: ' + err.message + '\nPastikan webcam terhubung dan izin kamera diberikan.');
    updateStatus('off', '[GAGAL BUKA KAMERA]');
  }
}

function stopCamera() {
  state.isCameraActive = false;
  state.isFaceDetected = false;

  if (state.cameraHandler) {
    try { state.cameraHandler.stop(); } catch (e) {}
    state.cameraHandler = null;
  }

  if (dom.webcamVideo.srcObject) {
    dom.webcamVideo.srcObject.getTracks().forEach(t => t.stop());
    dom.webcamVideo.srcObject = null;
  }

  dom.btnCamera.textContent = '[MULAI KAMERA]';
  dom.btnCamera.className = 'btn btn-primary';
  updateStatus('off', '[STATUS: KAMERA MATI]');
  if (dom.webcamLabel) dom.webcamLabel.textContent = '[FEED WEBCAM]';

  const ctx = dom.webcamCanvas.getContext('2d');
  ctx.clearRect(0, 0, dom.webcamCanvas.width, dom.webcamCanvas.height);
}

function updateStatus(type, text) {
  dom.statusBadge.textContent = text;
  dom.statusBadge.className = `badge badge-${type}`;
}

function onFaceResults(results) {
  if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
    state.isFaceDetected = false;
    if (state.isCameraActive) {
      updateStatus('warn', '[MENCARI WAJAH...]');
      if (dom.webcamLabel) dom.webcamLabel.textContent = '[WAJAH: TIDAK TERLIHAT]';
    }
    return;
  }

  state.isFaceDetected = true;
  updateStatus('active', '[STATUS: MENGIKUTI WAJAH]');

  const lm = results.multiFaceLandmarks[0];

  // Draw face points on PIP
  drawFaceDots(lm);

  // Key landmarks for Head Pose:
  const nose = lm[1];
  const eyeL = lm[33];
  const eyeR = lm[263];
  const forehead = lm[10];
  const chin = lm[152];

  const eyeCenter = { x: (eyeL.x + eyeR.x) / 2, y: (eyeL.y + eyeR.y) / 2 };
  const eyeSpan = Math.hypot(eyeR.x - eyeL.x, eyeR.y - eyeL.y) || 0.1;
  const faceHeight = Math.hypot(chin.x - forehead.x, chin.y - forehead.y) || 0.3;

  // Yaw: horizontal turning (Geleng kiri/kanan)
  const rawYaw = -((nose.x - eyeCenter.x) / eyeSpan) * 2.8;

  // Pitch: vertical nodding (Angguk atas/bawah)
  const rawPitch = (((nose.y - eyeCenter.y) / faceHeight) - 0.22) * 3.4;

  // Roll: tilting head sideways (Miring kiri/kanan)
  const rawRoll = Math.atan2(eyeR.y - eyeL.y, eyeR.x - eyeL.x);

  // Auto-calibrate on first detection
  if (!state.hasAutoCalibrated) {
    state.calibYaw = rawYaw;
    state.calibPitch = rawPitch;
    state.calibRoll = rawRoll;
    state.hasAutoCalibrated = true;
  }

  state.targetYaw = (rawYaw - state.calibYaw);
  state.targetPitch = (rawPitch - state.calibPitch);
  state.targetRoll = (rawRoll - state.calibRoll);

  // Clamp angles
  state.targetYaw = Math.max(-0.9, Math.min(0.9, state.targetYaw));
  state.targetPitch = Math.max(-0.7, Math.min(0.7, state.targetPitch));
  state.targetRoll = Math.max(-0.5, Math.min(0.5, state.targetRoll));

  // ==========================================
  // EYE BLINK DETECTION (EAR)
  // ==========================================
  const rW = Math.hypot(lm[33].x - lm[133].x, lm[33].y - lm[133].y);
  const rH = (Math.hypot(lm[159].x - lm[145].x, lm[159].y - lm[145].y) + Math.hypot(lm[158].x - lm[144].x, lm[158].y - lm[144].y)) / 2;
  const earR = rW > 0 ? (rH / rW) : 0.3;

  const lW = Math.hypot(lm[263].x - lm[362].x, lm[263].y - lm[362].y);
  const lH = (Math.hypot(lm[386].x - lm[374].x, lm[386].y - lm[374].y) + Math.hypot(lm[385].x - lm[380].x, lm[385].y - lm[380].y)) / 2;
  const earL = lW > 0 ? (lH / lW) : 0.3;

  const blinkThreshold = 0.20;
  state.targetBlinkR = earR < blinkThreshold ? 1.0 : (earR < 0.24 ? (0.24 - earR) / 0.04 : 0.0);
  state.targetBlinkL = earL < blinkThreshold ? 1.0 : (earL < 0.24 ? (0.24 - earL) / 0.04 : 0.0);

  // ==========================================
  // MOUTH TRACKING (LIP RATIO)
  // ==========================================
  // Outer lip corners: 61, 291
  // Inner lips top/bottom: 13, 14
  const mouthWidth = Math.hypot(lm[61].x - lm[291].x, lm[61].y - lm[291].y);
  const mouthInnerH = Math.hypot(lm[13].x - lm[14].x, lm[13].y - lm[14].y);
  const mouthRatio = mouthWidth > 0 ? (mouthInnerH / mouthWidth) : 0;

  // Nilai istirahat mulut biasanya 0.02 - 0.07. Mulut mulai bicara > 0.12
  if (mouthRatio > 0.11) {
    state.targetMouth = Math.min(1.0, (mouthRatio - 0.11) / 0.22);
  } else {
    state.targetMouth = 0.0;
  }

  // Status visual label
  if (dom.webcamLabel) {
    const isBlinking = state.targetBlinkL > 0.5 || state.targetBlinkR > 0.5;
    const eyeStatus = state.blinkMode === 'auto' ? 'KEDIP: AUTO' : (isBlinking ? 'KEDIP' : 'MATA OK');
    const isMouthOpen = state.targetMouth > 0.2;
    dom.webcamLabel.textContent = `[${eyeStatus} | ${isMouthOpen ? 'MULUT: BUKA' : 'MULUT: TUTUP'}]`;
  }
}

function drawFaceDots(lm) {
  const canvas = dom.webcamCanvas;
  const ctx = canvas.getContext('2d');
  if (canvas.width !== dom.webcamVideo.videoWidth && dom.webcamVideo.videoWidth > 0) {
    canvas.width = dom.webcamVideo.videoWidth;
    canvas.height = dom.webcamVideo.videoHeight;
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#00e5ff';

  // Highlight points: nose, chin, forehead, eyes, lips
  const pts = [1, 33, 133, 159, 145, 263, 362, 386, 374, 10, 152, 61, 291, 13, 14];
  for (let idx of pts) {
    const p = lm[idx];
    ctx.beginPath();
    ctx.arc(p.x * canvas.width, p.y * canvas.height, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

/* ==========================================================================
   RENDER & ANIMATION LOOP
   ========================================================================== */
function animate() {
  requestAnimationFrame(animate);

  const delta = clock.getDelta();

  // 1. Update mixer for body idle movement
  if (state.mixer) {
    state.mixer.update(delta);
  }

  // 2. Head motion tracking, Eye Blinking, and Mouth Movement
  if (state.headBone) {
    let desiredYaw = 0;
    let desiredPitch = 0;
    let desiredRoll = 0;
    let blinkL = 0;
    let blinkR = 0;

    if (state.isCameraActive && state.isFaceDetected) {
      // Use Camera tracking
      desiredYaw = state.targetYaw;
      desiredPitch = state.targetPitch;
      desiredRoll = state.targetRoll;

      // Eye Blinking logic: Camera vs Auto
      if (state.blinkMode === 'camera') {
        const blinkLerp = 0.55;
        state.curBlinkL += (state.targetBlinkL - state.curBlinkL) * blinkLerp;
        state.curBlinkR += (state.targetBlinkR - state.curBlinkR) * blinkLerp;
        blinkL = state.curBlinkL;
        blinkR = state.curBlinkR;
      } else {
        // Auto-blink mode (natural 160ms biological blink curve)
        state.autoBlinkTimer += delta;
        if (state.autoBlinkTimer >= state.autoBlinkInterval) {
          const phase = state.autoBlinkTimer - state.autoBlinkInterval;
          if (phase < 0.08) {
            blinkL = phase / 0.08;
            blinkR = blinkL;
          } else if (phase < 0.16) {
            blinkL = 1.0 - (phase - 0.08) / 0.08;
            blinkR = blinkL;
          } else {
            blinkL = 0;
            blinkR = 0;
            state.autoBlinkTimer = 0;
            state.autoBlinkInterval = 2.8 + Math.random() * 1.8;
          }
        }
      }

      // Smooth mouth transition
      state.curMouth += (state.targetMouth - state.curMouth) * 0.45;
    } else {
      // Fallback: subtly look toward mouse cursor
      desiredYaw = state.mouseNormX * 0.50;
      desiredPitch = state.mouseNormY * 0.35;
      desiredRoll = -state.mouseNormX * 0.12;

      // Natural periodic blinking when camera is off
      state.autoBlinkTimer += delta;
      if (state.autoBlinkTimer >= state.autoBlinkInterval) {
        const phase = state.autoBlinkTimer - state.autoBlinkInterval;
        if (phase < 0.08) {
          blinkL = phase / 0.08;
          blinkR = blinkL;
        } else if (phase < 0.16) {
          blinkL = 1.0 - (phase - 0.08) / 0.08;
          blinkR = blinkL;
        } else {
          blinkL = 0;
          blinkR = 0;
          state.autoBlinkTimer = 0;
          state.autoBlinkInterval = 2.8 + Math.random() * 1.8;
        }
      }
      state.curMouth = 0.0;
    }

    // Smooth Lerp for head rotation
    const lerpFactor = 0.25;
    state.curYaw += (desiredYaw - state.curYaw) * lerpFactor;
    state.curPitch += (desiredPitch - state.curPitch) * lerpFactor;
    state.curRoll += (desiredRoll - state.curRoll) * lerpFactor;

    // Apply to Head
    const qHeadYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), state.curYaw * 0.75);
    const qHeadPitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), state.curPitch * 0.75);
    const qHeadRoll = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), state.curRoll * 0.75);
    const qHead = new THREE.Quaternion().copy(qHeadYaw).multiply(qHeadPitch).multiply(qHeadRoll);

    state.headBone.quaternion.copy(state.headRestQuat).multiply(qHead);

    // Apply to Neck
    if (state.neckBone) {
      const qNeckYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), state.curYaw * 0.25);
      const qNeckPitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), state.curPitch * 0.25);
      const qNeckRoll = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), state.curRoll * 0.25);
      const qNeck = new THREE.Quaternion().copy(qNeckYaw).multiply(qNeckPitch).multiply(qNeckRoll);
      state.neckBone.quaternion.copy(state.neckRestQuat).multiply(qNeck);
    }

    // Apply to Spine
    if (state.spineBone) {
      const qSpineYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), state.curYaw * 0.14);
      const qSpinePitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), state.curPitch * 0.14);
      const qSpine = new THREE.Quaternion().copy(qSpineYaw).multiply(qSpinePitch);
      state.spineBone.quaternion.copy(state.spineRestQuat).multiply(qSpine);
    }

    // Apply Real-time Eye Blinking
    setBlink(blinkL, blinkR);

    // Apply Real-time Mouth Open/Close
    setMouth(state.curMouth);
  }

  // 3. OrbitControls update
  if (controls) {
    controls.update();
  }

  // 4. Render
  if (renderer && scene && camera) {
    renderer.render(scene, camera);
  }
}

/* ==========================================================================
   EVENT HANDLERS
   ========================================================================== */
function setupEvents() {
  dom.btnCamera.addEventListener('click', startCamera);

  // Toggle Mode Kedipan Mata: Kamera vs Otomatis
  dom.btnBlinkMode.addEventListener('click', () => {
    if (state.blinkMode === 'camera') {
      state.blinkMode = 'auto';
      dom.btnBlinkMode.textContent = '[KEDIP: OTOMATIS]';
    } else {
      state.blinkMode = 'camera';
      dom.btnBlinkMode.textContent = '[KEDIP: KAMERA]';
    }
  });

  dom.btnReset.addEventListener('click', () => {
    camera.position.set(0, 0.60, 1.45);
    controls.target.set(0, 0.52, 0);
    controls.update();

    state.hasAutoCalibrated = false;
    state.calibYaw = state.targetYaw;
    state.calibPitch = state.targetPitch;
    state.calibRoll = state.targetRoll;
  });

  dom.btnMinimizeCam.addEventListener('click', () => {
    const isMin = dom.webcamBox.classList.toggle('minimized');
    dom.btnMinimizeCam.textContent = isMin ? '[+]' : '[_]';
  });
}

/* ==========================================================================
   INIT
   ========================================================================== */
window.addEventListener('DOMContentLoaded', () => {
  initThree();
  setupEvents();
  loadModel();
  initMediaPipe();
  animate();
});
