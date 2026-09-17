/* ============================================================
 * 主场景：夜空星空 + 多材质 InstancedMesh 粒子系统 + 3D 环绕拍立得照片墙
 * 粒子构成（按规格）：
 *   57% 高光红球   MeshPhysicalMaterial #8B0000 clearcoat=1（车漆高光）
 *   19% 雪顶花纹球  红→白渐变贴图 + clearcoat
 *   9.5% 镜面银球  MeshStandardMaterial #E0E0E0 metalness=0.95
 *   9.5% 切面四面体 TetrahedronGeometry flatShading 深红高光
 *    5% 自发光金球  emissive #FFD700 ×2.0（Bloom 透光，随机分布）
 * 光照：HDR 环境贴图（PMREM 程序生成）+ 暖白/冷蓝双 PointLight
 * 后处理：自研 BrightPass（阈值 0.85）+ separable Gaussian Bloom（intensity 2.0）
 * 爆闪：金/银粒子 sin 频闪（0.2~3.5 跨越阈值）+ 银球晶体自转高光 + 50 星芒 sprite 呼吸
 * 暴露 window.APP 供 gestures.js / ui.js 调用
 * ============================================================ */
(function () {
  'use strict';

  // ---------------- 全局配置 ----------------
  const DEFAULTS = {
    title: '2026',
    subtitle: '愿星光与你同在',
    color: '#8B0000',
    accent: '#ffd700',
    particleType: 'glow',   // 已升级为多 Mesh 混合，此配置保留兼容
    text: '2026',
    photos: [],
    bgm: 'bgm.flac',
  };

  function loadConfig() {
    let cfg = { ...DEFAULTS };
    try {
      const saved = JSON.parse(localStorage.getItem('starry-config') || '{}');
      cfg = { ...cfg, ...saved };
    } catch (e) { /* ignore */ }
    const q = new URLSearchParams(location.search);
    if (q.get('c')) {
      try { cfg = { ...cfg, ...JSON.parse(atobSafe(q.get('c'))) }; } catch (e) { /* ignore */ }
    }
    if (cfg.color === '#ff4455' || cfg.color === '#a4133c') cfg.color = DEFAULTS.color;
    if (!cfg.bgm || cfg.bgm.startsWith('blob:')) cfg.bgm = DEFAULTS.bgm; // 空或失效 blob 回退到默认 BGM
    return cfg;
  }
  function atobSafe(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    return decodeURIComponent(escape(atob(s)));
  }

  const CONFIG = loadConfig();
  window.APP = { CONFIG, saveConfig, transitionTo, focusNextPhoto, rebuildPhotos, applyColors, setParticleType, morphToText, updateHandDrive };

  function saveConfig() {
    localStorage.setItem('starry-config', JSON.stringify(CONFIG));
  }

  // 手部驱动状态：手不动时云静止，移动/旋转跟随手掌
  const hand = { tx: 0, ty: 0, x: 0, y: 0, spin: 0 };
  function updateHandDrive(nx, ny) {
    hand.spin += (nx - hand.tx) * 0.9;
    hand.spin = Math.max(-1.5, Math.min(1.5, hand.spin));
    hand.tx = nx; hand.ty = ny;
  }

  // ---------------- Three 基础 ----------------
  const container = document.getElementById('scene');
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x05060f, 0.0075);

  // 手部驱动组：粒子与照片都挂在其中，作为整体跟随手部运动
  const driveGroup = new THREE.Group();
  scene.add(driveGroup);

  const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 400);
  camera.position.set(0, 0, 26);

  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.setClearColor(0x05060f);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);

  // ---------------- 环境贴图（程序生成 HDR 感）与灯光 ----------------
  function buildEnvMap() {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const es = new THREE.Scene();
    es.background = new THREE.Color(0x03040a);
    const panel = (hex, intensity, x, y, z, sx, sy, sz) => {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(sx, sy, sz),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(intensity) })
      );
      m.position.set(x, y, z);
      es.add(m);
    };
    panel(0xfff5e6, 7, 12, 14, 6, 9, 4, 3);    // 暖白主光板
    panel(0xe6f0ff, 4.5, -13, -5, 9, 6, 7, 3); // 冷蓝辅光板
    panel(0xffffff, 2.0, 0, -15, -8, 12, 3, 5);
    panel(0xffd9a0, 1.2, 4, 2, -14, 5, 5, 3);
    const tex = pmrem.fromScene(es, 0.06).texture;
    pmrem.dispose();
    return tex;
  }
  scene.environment = buildEnvMap();

  // 双点光源：暖白主光 + 冷蓝辅光，勾勒球体边缘高光
  const keyLight = new THREE.PointLight(0xfff5e6, 3400, 0, 2);
  keyLight.position.set(14, 16, 20);
  const fillLight = new THREE.PointLight(0xe6f0ff, 1600, 0, 2);
  fillLight.position.set(-16, -8, 12);
  const rimLight = new THREE.PointLight(0xffffff, 900, 0, 2);
  rimLight.position.set(0, 6, -20);
  scene.add(keyLight, fillLight, rimLight, new THREE.AmbientLight(0x35354a, 0.7));

  // 鼠标/触摸视差
  const pointer = { x: 0, y: 0 };
  addEventListener('pointermove', (e) => {
    pointer.x = (e.clientX / innerWidth) * 2 - 1;
    pointer.y = (e.clientY / innerHeight) * 2 - 1;
  });

  // 鼠标点住拖拽旋转视角（绕原点轨道，俯仰限位防止翻转）
  const orbit = { yaw: 0, pitch: 0, tYaw: 0, tPitch: 0, dragging: false, lx: 0, ly: 0 };
  const canvas = renderer.domElement;
  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', (e) => {
    orbit.dragging = true;
    orbit.lx = e.clientX; orbit.ly = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!orbit.dragging) return;
    orbit.tYaw -= (e.clientX - orbit.lx) * 0.005;
    orbit.tPitch += (e.clientY - orbit.ly) * 0.005;
    orbit.tPitch = Math.max(-1.2, Math.min(1.2, orbit.tPitch));
    orbit.lx = e.clientX; orbit.ly = e.clientY;
  });
  addEventListener('pointerup', () => { orbit.dragging = false; });

  // ---------------- 背景星空（微光漂浮） ----------------
  const glowTex = (() => {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const ctx = cv.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.5)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(cv);
  })();

  function makeStarfield(count, size, spread, color) {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count * 3; i++) pos[i] = (Math.random() - 0.5) * spread;
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({
      color, size, map: glowTex, sizeAttenuation: true, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    return new THREE.Points(g, m);
  }
  const bgStars = makeStarfield(2200, 0.22, 260, 0xbfd0ff);
  const bgStars2 = makeStarfield(900, 0.4, 200, 0xffe9b0);
  scene.add(bgStars, bgStars2);

  // ---------------- 多材质 InstancedMesh 粒子系统 ----------------
  const COUNT = 2000;
  // 种类：0 高光红球  1 雪顶花纹球  2 镜面银球  3 切面四面体  4 自发光金球
  const RATIOS = [0.57, 0.19, 0.095, 0.095, 0.05];
  const KIND_NAMES = ['red', 'decor', 'silver', 'tetra', 'gold'];

  const pPos = new Float32Array(COUNT * 3);
  const pTarget = new Float32Array(COUNT * 3);
  const pSize = new Float32Array(COUNT);
  const pSeed = new Float32Array(COUNT);
  const pKind = new Uint8Array(COUNT);
  const pQuat = new Array(COUNT);
  const pAxis = new Array(COUNT);   // 自旋轴（银球/四面体/金球）
  const pSpin = new Float32Array(COUNT);
  const pTwinkle = new Uint8Array(COUNT); // 1 = 频闪粒子
  const kindList = [[], [], [], [], []];

  (function initParticles() {
    const e = new THREE.Euler();
    for (let i = 0; i < COUNT; i++) {
      pPos[i * 3] = (Math.random() - 0.5) * 60;
      pPos[i * 3 + 1] = (Math.random() - 0.5) * 60;
      pPos[i * 3 + 2] = (Math.random() - 0.5) * 60;
      pSeed[i] = Math.random() * Math.PI * 2;
      const r = Math.random();
      let acc = 0, kind = 0;
      for (let k = 0; k < 5; k++) { acc += RATIOS[k]; if (r < acc) { kind = k; break; } }
      pKind[i] = kind;
      kindList[kind].push(i);
      // 尺寸按种类（偏大并交叠，消除表面凹凸缝隙感）
      const sz = [[0.78, 0.5], [0.78, 0.5], [0.62, 0.42], [0.78, 0.48], [0.2, 0.14]][kind];
      pSize[i] = sz[0] + Math.random() * sz[1];
      // 随机朝向
      e.set(Math.random() * Math.PI, Math.random() * Math.PI * 2, Math.random() * Math.PI);
      pQuat[i] = new THREE.Quaternion().setFromEuler(e);
      pAxis[i] = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      // 银球与切面晶体保持自转：切面/反射扫过光源瞬间高光爆表触发 Bloom
      pSpin[i] = kind === 2 || kind === 3 ? 0.5 + Math.random() * 0.8
        : kind === 4 ? 0.15 + Math.random() * 0.4 : 0;
      // 从暖金(金球)与白光(银球)中抽取 ~18% 作为频闪粒子
      if ((kind === 4 || kind === 2) && Math.random() < 0.18) pTwinkle[i] = 1;
    }
  })();

  // 雪顶花纹渐变贴图（顶部白 → 深红）
  function makeDecorTexture() {
    const cv = document.createElement('canvas');
    cv.width = 4; cv.height = 128;
    const ctx = cv.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0.0, '#ffffff');
    g.addColorStop(0.3, '#ffe3e3');
    g.addColorStop(0.52, '#c96a6a');
    g.addColorStop(0.8, '#7a1414');
    g.addColorStop(1.0, '#4a0808');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 4, 128);
    const tex = new THREE.CanvasTexture(cv);
    return tex;
  }

  const cMain = new THREE.Color(CONFIG.color);
  const cAccent = new THREE.Color(CONFIG.accent);

  const sphereGeo = new THREE.SphereGeometry(0.5, 22, 16);
  const silverGeo = sphereGeo.clone(); // 独立几何体：携带频闪 aGlow 实例属性
  const tetraGeo = new THREE.TetrahedronGeometry(0.62, 0);
  const goldGeo = new THREE.SphereGeometry(0.5, 14, 10);

  const KIND_GEO = [sphereGeo, sphereGeo, silverGeo, tetraGeo, goldGeo];

  // 为材质注入每实例发光倍率 aGlow（直接乘到自发光上，实现单粒子级频闪）
  function patchEmissiveGlow(mat) {
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aGlow;\nvarying float vGlow;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vGlow;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= vGlow;');
    };
  }
  const KIND_MAT = [
    // 0 高光红球：车漆质感
    new THREE.MeshPhysicalMaterial({
      color: cMain.clone(), roughness: 0.15, metalness: 0.7,
      clearcoat: 1.0, clearcoatRoughness: 0.08, envMapIntensity: 1.2,
    }),
    // 1 雪顶花纹球
    new THREE.MeshPhysicalMaterial({
      map: makeDecorTexture(), roughness: 0.28, metalness: 0.35,
      clearcoat: 0.9, clearcoatRoughness: 0.15, envMapIntensity: 0.9,
    }),
    // 2 镜面银球（带白色 emissive，aGlow 默认 0 不发光，频闪时打出白光爆闪）
    new THREE.MeshStandardMaterial({
      color: 0xe0e0e0, roughness: 0.05, metalness: 0.95, envMapIntensity: 1.4,
      emissive: 0xeaf2ff, emissiveIntensity: 1.0,
    }),
    // 3 切面四面体：深红高光切面
    new THREE.MeshPhysicalMaterial({
      color: cMain.clone(), roughness: 0.18, metalness: 0.65,
      clearcoat: 1.0, clearcoatRoughness: 0.1, flatShading: true, envMapIntensity: 1.3,
    }),
    // 4 自发光金球（Bloom 透光；实际亮度由 aGlow 控制：常亮 2.0 / 频闪 0.2~3.5）
    new THREE.MeshStandardMaterial({
      color: 0xffd700, emissive: 0xffd700, emissiveIntensity: 1.0,
      roughness: 0.3, metalness: 0.3,
    }),
  ];
  patchEmissiveGlow(KIND_MAT[2]);
  patchEmissiveGlow(KIND_MAT[4]);

  const instMeshes = KIND_NAMES.map((name, k) => {
    const m = new THREE.InstancedMesh(KIND_GEO[k], KIND_MAT[k], Math.max(1, kindList[k].length));
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false;
    driveGroup.add(m);
    return m;
  });

  // 频闪属性：aGlow = 每实例自发光倍率。银球默认 0（不发光），金球默认 2.0
  const glowAttr = {};
  const twinkleSlots = [];
  [2, 4].forEach((k) => {
    const arr = new Float32Array(kindList[k].length).fill(k === 2 ? 0 : 2.0);
    kindList[k].forEach((pi, j) => {
      if (pTwinkle[pi]) twinkleSlots.push({ arr, j, phase: pSeed[pi] });
    });
    const attr = new THREE.InstancedBufferAttribute(arr, 1);
    attr.setUsage(THREE.DynamicDrawUsage);
    KIND_GEO[k].setAttribute('aGlow', attr);
    glowAttr[k] = attr;
  });

  // ---------------- 星芒 Sparkle 粒子（四角星芒 sprite，呼吸隐现） ----------------
  function makeSparkTexture() {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const ctx = cv.getContext('2d');
    // 十字细光束（横竖两条，四角星芒）
    const spike = (rot) => {
      ctx.save(); ctx.translate(32, 32); ctx.rotate(rot);
      const g = ctx.createLinearGradient(0, -32, 0, 32);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.5, 'rgba(255,255,255,0.9)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(-1.1, -32, 2.2, 64);
      ctx.restore();
    };
    spike(0); spike(Math.PI / 2);
    // 中心光点
    const r = ctx.createRadialGradient(32, 32, 0, 32, 32, 11);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = r; ctx.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(cv);
  }

  const SPARK_N = 50;
  const sparkles = [];
  (function initSparkles() {
    const tex = makeSparkTexture();
    for (let i = 0; i < SPARK_N; i++) {
      const mat = new THREE.SpriteMaterial({
        map: tex, transparent: true, opacity: 0, depthWrite: false,
        blending: THREE.AdditiveBlending,
        color: Math.random() < 0.7 ? 0xffe9b0 : 0xeaf2ff,
      });
      const sp = new THREE.Sprite(mat);
      if (i < SPARK_N * 0.6) {
        // 爱心体积内部（与 heartTargets 同一 Taubin 心曲面，略缩 0.93）
        let x = 0, y = 0, z = 0, inside = false;
        while (!inside) {
          x = (Math.random() * 2 - 1) * 1.3;
          y = (Math.random() * 2 - 1) * 1.25;
          z = (Math.random() * 2 - 1) * 0.8;
          const s = x * x + 2.25 * z * z + y * y - 1;
          inside = s * s * s - x * x * y * y * y - 0.1125 * z * z * y * y * y <= 0;
        }
        sp.position.set(x * 6.3, y * 6.3, z * 6.3);
      } else {
        // 爱心周围壳层
        const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2;
        const rr = 8 + Math.random() * 5, q = Math.sqrt(1 - u * u);
        sp.position.set(q * Math.cos(a) * rr, q * Math.sin(a) * rr * 0.8, u * rr * 0.7);
      }
      sp.userData = {
        base: 0.3 + Math.random() * 0.5,
        phase: Math.random() * Math.PI * 2,
        speed: 1.6 + Math.random() * 2.4,
      };
      driveGroup.add(sp);
      sparkles.push(sp);
    }
  })();

  // ---------------- 形状目标生成 ----------------
  // 形状1：立体心形（Taubin 3D 心曲面拒绝采样）
  // (x² + 9/4·z² + y² − 1)³ − x²y³ − 9/80·z²y³ ≤ 0，前后为椭圆隆起，饱满不饼状
  function heartTargets() {
    const k = 6.3;
    let i = 0;
    while (i < COUNT) {
      const x = (Math.random() * 2 - 1) * 1.3;
      const y = (Math.random() * 2 - 1) * 1.25;
      const z = (Math.random() * 2 - 1) * 0.8;
      const s = x * x + 2.25 * z * z + y * y - 1;
      if (s * s * s - x * x * y * y * y - 0.1125 * z * z * y * y * y > 0) continue;
      pTarget[i * 3] = x * k + (Math.random() - 0.5) * 0.1;
      pTarget[i * 3 + 1] = y * k + (Math.random() - 0.5) * 0.1;
      pTarget[i * 3 + 2] = z * k + (Math.random() - 0.5) * 0.1;
      i++;
    }
  }

  // 形状2：Canvas 文字点阵
  function textTargets(str) {
    const cw = 480, ch = 160;
    const cv = document.createElement('canvas');
    cv.width = cw; cv.height = ch;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${str.length > 4 ? 90 : 120}px "Segoe UI", "Microsoft YaHei", sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(str, cw / 2, ch / 2);
    const data = ctx.getImageData(0, 0, cw, ch).data;
    const pts = [];
    for (let y = 0; y < ch; y += 3) {
      for (let x = 0; x < cw; x += 3) {
        if (data[(y * cw + x) * 4 + 3] > 128) pts.push([x, y]);
      }
    }
    if (!pts.length) return heartTargets();
    const W = 26, H = W * (ch / cw);
    for (let i = 0; i < COUNT; i++) {
      const p = pts[(Math.random() * pts.length) | 0];
      pTarget[i * 3] = (p[0] / cw - 0.5) * W + (Math.random() - 0.5) * 0.3;
      pTarget[i * 3 + 1] = (0.5 - p[1] / ch) * H + (Math.random() - 0.5) * 0.3;
      pTarget[i * 3 + 2] = (Math.random() - 0.5) * 3;
    }
  }

  // 形状3：满天星爆发散开
  function burstTargets() {
    for (let i = 0; i < COUNT; i++) {
      const u = Math.random() * 2 - 1, t2 = Math.random() * Math.PI * 2;
      const r = 13 + Math.pow(Math.random(), 0.8) * 32;
      const k = Math.sqrt(1 - u * u);
      pTarget[i * 3] = k * Math.cos(t2) * r;
      pTarget[i * 3 + 1] = k * Math.sin(t2) * r * 0.75;
      pTarget[i * 3 + 2] = u * r * 0.6;
    }
  }

  // ---------------- 照片系统 ----------------
  // 三种模式：orbit（倾斜轨道环绕心形，像卫星）/ scatter（满天星中随粒子散布）/ gallery（捏合聚焦单张）
  const PHOTO_R = 13.5, PHOTO_TILT = 0.34, PHOTO_SPEED = 0.12;
  const photosGroup = new THREE.Group();
  photosGroup.rotation.x = PHOTO_TILT;
  driveGroup.add(photosGroup);
  let photoMeshes = [];
  let galleryIdx = -1;
  let photoMode = 'orbit';

  function polaroidTexture(img, caption) {
    const W = 256, H = 310, P = 16;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#f6f2e8'; ctx.fillRect(0, 0, W, H);
    if (img) {
      ctx.drawImage(img, P, P, W - P * 2, H - P * 2 - 42);
      // 图像区域压暗至 Bloom 阈值(0.85)以下：照片正常显示不闪光，仅相框发光
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(P, P, W - P * 2, H - P * 2 - 42);
    }
    ctx.fillStyle = '#5a5347';
    ctx.font = 'italic 20px "Segoe Script", cursive';
    ctx.textAlign = 'center';
    ctx.fillText(caption, W / 2, H - 22);
    const tex = new THREE.CanvasTexture(cv);
    tex.anisotropy = 4;
    return tex;
  }

  function makePlaceholder(idx) {
    const cv = document.createElement('canvas');
    cv.width = 224; cv.height = 224;
    const ctx = cv.getContext('2d');
    const hues = [[340, 20], [210, 260], [45, 10], [280, 200], [160, 120], [15, 330]];
    const [h1, h2] = hues[idx % hues.length];
    const g = ctx.createLinearGradient(0, 0, 224, 224);
    g.addColorStop(0, `hsl(${h1}, 70%, 55%)`);
    g.addColorStop(1, `hsl(${h2}, 70%, 30%)`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, 224, 224);
    for (let i = 0; i < 60; i++) {
      ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.9})`;
      ctx.beginPath();
      ctx.arc(Math.random() * 224, Math.random() * 224, Math.random() * 1.8, 0, 7);
      ctx.fill();
    }
    return cv;
  }

  function buildPhotos() {
    for (const m of photoMeshes) {
      (m.parent || scene).remove(m);
      if (m.material.map) m.material.map.dispose();
      m.material.dispose();
    }
    photoMeshes = [];
    galleryIdx = -1;

    const photos = CONFIG.photos.length ? CONFIG.photos : null;
    const total = photos ? photos.length : 6;
    const center = photosGroup.localToWorld(new THREE.Vector3(0, 0, 0));

    for (let i = 0; i < total; i++) {
      const caption = photos ? '' : ['wish', 'star', '2026', 'dream', 'love', 'night'][i % 6];
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(2.3, 2.78),
        new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
      );
      const angle = (i / total) * Math.PI * 2;
      // 满天星散布位：约束在相机视锥内（按各照片深度计算可见范围）
      const zPos = -14 + Math.random() * 22;
      const distC = 26 - zPos;
      const halfH = Math.tan(Math.PI / 6) * distC;
      const halfW = halfH * camera.aspect;
      const scatterPos = new THREE.Vector3(
        (Math.random() * 2 - 1) * halfW * 0.7,
        (Math.random() * 2 - 1) * halfH * 0.7,
        zPos
      );
      mesh.userData = {
        angle,
        homeLocal: new THREE.Vector3(Math.cos(angle) * PHOTO_R, Math.sin(angle * 2) * 0.5, Math.sin(angle) * PHOTO_R),
        scatterPos,
        scatterRot: new THREE.Euler((Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.6, (Math.random() - 0.5) * 0.8),
        spin: (Math.random() - 0.5) * 0.15,
        mode: 'orbit',
        focusPos: new THREE.Vector3(0, 0.5, 13),
        hidden: false,
        curScale: 0.01,
        targetScale: 1,
      };
      mesh.position.copy(mesh.userData.homeLocal);
      photosGroup.add(mesh);
      mesh.lookAt(center);
      photoMeshes.push(mesh);

      const apply = (img) => {
        mesh.material.map = polaroidTexture(img, caption);
        mesh.material.needsUpdate = true;
      };
      if (photos) {
        new THREE.ImageLoader().load(photos[i], (img) => apply(img), undefined, () => apply(makePlaceholder(i)));
      } else {
        apply(makePlaceholder(i));
      }
    }
    photoMode = 'orbit';
  }

  function syncPhotoMode(shape) {
    if (shape === 'burst') {
      photoMode = 'scatter';
      // 保留 galleryIdx 浏览游标，张手退出后再捏合应继续下一张
      for (const m of photoMeshes) {
        if (m.userData.mode === 'gallery' || m.parent !== driveGroup) driveGroup.attach(m);
        m.userData.mode = 'scatter';
        m.userData.hidden = false;
        m.userData.targetScale = 0.75 + Math.random() * 0.5;
        m.visible = true;
      }
    } else {
      photoMode = 'orbit';
      for (const m of photoMeshes) {
        photosGroup.attach(m);
        m.userData.mode = 'orbit';
        m.userData.hidden = false;
        m.userData.targetScale = 1;
        m.visible = true;
      }
    }
  }

  // 捏合：聚焦一张照片（画廊模式，隐藏其余）
  function focusNextPhoto() {
    if (!photoMeshes.length) return;
    if (galleryIdx >= 0 && photoMeshes[galleryIdx]) {
      const prev = photoMeshes[galleryIdx];
      prev.userData.mode = photoMode === 'scatter' ? 'scatter' : 'orbit';
      prev.userData.hidden = true; // 画廊期间保持隐藏，张手/握拳退出后由 syncPhotoMode 恢复
      prev.userData.targetScale = prev.userData.mode === 'scatter' ? 0.9 : 1;
      prev.material.depthTest = true;  // 恢复正常深度遮挡
      prev.renderOrder = 0;
      if (prev.userData.mode === 'orbit') photosGroup.attach(prev);
      else driveGroup.attach(prev);
    }
    galleryIdx = (galleryIdx + 1) % photoMeshes.length;
    const m = photoMeshes[galleryIdx];
    scene.attach(m); // 固定到镜头前（不随粒子云转动），脱离驱动组
    m.material.depthTest = false; // 画廊查看时置顶，不被任何粒子遮挡
    m.renderOrder = 999;
    m.userData.mode = 'gallery';
    m.userData.hidden = false;
    m.userData.targetScale = 2.2;
    photoMeshes.forEach((p, i) => {
      if (i !== galleryIdx) { p.userData.hidden = true; p.userData.targetScale = 0.01; }
    });
  }

  function rebuildPhotos() { buildPhotos(); syncPhotoMode(currentShape); }

  // ---------------- 形态切换 API ----------------
  let currentShape = 'heart';
  function transitionTo(shape) {
    currentShape = shape;
    if (shape === 'heart') heartTargets();
    else if (shape === 'text') textTargets(CONFIG.text || '2026');
    else burstTargets();
    syncPhotoMode(shape);
  }
  function morphToText(str) {
    if (str) CONFIG.text = str;
    transitionTo('text');
  }
  function applyColors() {
    cMain.set(CONFIG.color);
    cAccent.set(CONFIG.accent);
    KIND_MAT[0].color.copy(cMain);
    KIND_MAT[3].color.copy(cMain);
    KIND_MAT[4].emissive.copy(cAccent);
    KIND_MAT[4].color.copy(cAccent);
  }
  function setParticleType(t) {
    CONFIG.particleType = t; // 多 Mesh 混合模式下保留兼容（不再区分单一点形）
  }

  // ---------------- 自研 Bloom 后处理管线 ----------------
  const fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const fsScene = new THREE.Scene();
  const fsMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
  fsMesh.frustumCulled = false;
  fsScene.add(fsMesh);

  const FS_VERT = `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

  const brightMat = new THREE.ShaderMaterial({
    uniforms: { tSrc: { value: null } },
    vertexShader: FS_VERT,
    fragmentShader: `
      uniform sampler2D tSrc; varying vec2 vUv;
      void main() {
        vec3 c = texture2D(tSrc, vUv).rgb;
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        float w = smoothstep(0.85, 0.87, l); // luminanceThreshold 0.85 + smoothing 0.02
        gl_FragColor = vec4(c * w, 1.0);
      }`,
    depthTest: false, depthWrite: false,
  });

  const blurMat = new THREE.ShaderMaterial({
    uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2(0, 0) } },
    vertexShader: FS_VERT,
    fragmentShader: `
      uniform sampler2D tSrc; uniform vec2 uDir; varying vec2 vUv;
      void main() {
        vec3 s = texture2D(tSrc, vUv).rgb * 0.227;
        s += (texture2D(tSrc, vUv + uDir * 1.384).rgb + texture2D(tSrc, vUv - uDir * 1.384).rgb) * 0.316;
        s += (texture2D(tSrc, vUv + uDir * 3.230).rgb + texture2D(tSrc, vUv - uDir * 3.230).rgb) * 0.070;
        gl_FragColor = vec4(s, 1.0);
      }`,
    depthTest: false, depthWrite: false,
  });

  const compositeMat = new THREE.ShaderMaterial({
    uniforms: { tBase: { value: null }, tBloom: { value: null }, uStrength: { value: 2.0 } },
    vertexShader: FS_VERT,
    fragmentShader: `
      uniform sampler2D tBase; uniform sampler2D tBloom; uniform float uStrength; varying vec2 vUv;
      void main() {
        vec3 b = texture2D(tBase, vUv).rgb;
        vec3 bl = texture2D(tBloom, vUv).rgb;
        gl_FragColor = vec4(b + bl * uStrength, 1.0);
      }`,
    depthTest: false, depthWrite: false,
  });

  let rtScene, rtHalfA, rtHalfB;
  function buildRenderTargets() {
    const w = renderer.domElement.width, h = renderer.domElement.height;
    rtScene && rtScene.dispose(); rtHalfA && rtHalfA.dispose(); rtHalfB && rtHalfB.dispose();
    rtScene = new THREE.WebGLRenderTarget(w, h, { samples: 4 });
    const hw = Math.max(1, w >> 1), hh = Math.max(1, h >> 1);
    rtHalfA = new THREE.WebGLRenderTarget(hw, hh);
    rtHalfB = new THREE.WebGLRenderTarget(hw, hh);
  }
  buildRenderTargets();

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    buildRenderTargets();
  });

  function pass(mat, target) {
    fsMesh.material = mat;
    renderer.setRenderTarget(target);
    renderer.render(fsScene, fsCam);
  }

  function renderFrame() {
    // 1. 场景 → RT
    renderer.setRenderTarget(rtScene);
    renderer.render(scene, camera);
    // 2. 亮部提取 → A
    brightMat.uniforms.tSrc.value = rtScene.texture;
    pass(brightMat, rtHalfA);
    // 3.  separable 高斯模糊（半分辨率，三遍加宽，等效 mipmapBlur 的柔和发散）
    for (let i = 0; i < 3; i++) {
      blurMat.uniforms.tSrc.value = rtHalfA.texture;
      blurMat.uniforms.uDir.value.set(2.2 / rtHalfA.width, 0);
      pass(blurMat, rtHalfB);
      blurMat.uniforms.tSrc.value = rtHalfB.texture;
      blurMat.uniforms.uDir.value.set(0, 2.2 / rtHalfA.height);
      pass(blurMat, rtHalfA);
    }
    // 4. 合成到屏幕
    compositeMat.uniforms.tBase.value = rtScene.texture;
    compositeMat.uniforms.tBloom.value = rtHalfA.texture;
    pass(compositeMat, null);
  }

  // ---------------- 渲染循环 ----------------
  const clock = new THREE.Clock();
  const _m4 = new THREE.Matrix4();
  const _v3 = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _s3 = new THREE.Vector3();
  const _spin = new THREE.Quaternion();

  function writeInstanceMatrices(t) {
    for (let k = 0; k < 5; k++) {
      const mesh = instMeshes[k];
      const list = kindList[k];
      for (let j = 0; j < list.length; j++) {
        const i = list[j], b = i * 3;
        _v3.set(pPos[b], pPos[b + 1], pPos[b + 2]);
        if (pSpin[i] > 0) {
          _spin.setFromAxisAngle(pAxis[i], t * pSpin[i] + pSeed[i]);
          _q.copy(_spin).multiply(pQuat[i]);
        } else {
          _q.copy(pQuat[i]);
        }
        _s3.setScalar(pSize[i]);
        _m4.compose(_v3, _q, _s3);
        mesh.setMatrixAt(j, _m4);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  function animate() {
    requestAnimationFrame(animate);
    const t = clock.getElapsedTime();

    // 背景星空缓慢漂移
    bgStars.rotation.y = t * 0.008;
    bgStars2.rotation.y = -t * 0.005;
    bgStars2.material.opacity = 0.6 + Math.sin(t * 0.8) * 0.25;

    // 粒子向目标收敛（无自主噪声：手不动则云静止）
    for (let i = 0; i < COUNT; i++) {
      const j = i * 3;
      const k = 0.045 + (Math.sin(pSeed[i]) * 0.5 + 0.5) * 0.035;
      pPos[j] += (pTarget[j] - pPos[j]) * k;
      pPos[j + 1] += (pTarget[j + 1] - pPos[j + 1]) * k;
      pPos[j + 2] += (pTarget[j + 2] - pPos[j + 2]) * k;
    }
    writeInstanceMatrices(t);

    // 自发光频闪：sin 波 + 随机相位，0.2~3.5 高速交替，反复跨越 Bloom 阈值 0.85
    for (const s of twinkleSlots) {
      s.arr[s.j] = Math.max(0.2, Math.sin(t * 6 + s.phase) * 2.0 + 1.5);
    }
    glowAttr[2].needsUpdate = true;
    glowAttr[4].needsUpdate = true;

    // 星芒 sprite 呼吸隐现（眨眼爆彩）
    for (const sp of sparkles) {
      const u = sp.userData;
      const w = 0.5 + 0.5 * Math.sin(t * u.speed + u.phase);
      const sc = u.base * (0.25 + 0.75 * w);
      sp.scale.set(sc, sc, 1);
      sp.material.opacity = w * w * 0.95;
    }

    // 手部驱动：整个粒子+照片世界组跟随手掌，手静止时完全静止
    hand.x += (hand.tx - hand.x) * 0.07;
    hand.y += (hand.ty - hand.y) * 0.07;
    hand.spin *= 0.93;
    driveGroup.rotation.set(-hand.y * 0.3, hand.x * 0.55 + hand.spin, 0);
    driveGroup.position.set(hand.x * 1.2, -hand.y * 0.9, 0);

    // 照片系统
    photosGroup.rotation.y = t * PHOTO_SPEED;
    for (const m of photoMeshes) {
      const u = m.userData;
      u.curScale += (u.targetScale - u.curScale) * 0.07;
      const s = Math.max(u.curScale, 0.0001);
      m.scale.setScalar(s);
      if (u.hidden) m.visible = false;
      else if (u.targetScale < 0.01 && s < 0.03) m.visible = false;
      else if (u.targetScale > 0.05) m.visible = true;

      if (u.mode === 'scatter') {
        m.position.lerp(u.scatterPos, 0.045);
        m.rotation.x += (u.scatterRot.x - m.rotation.x) * 0.03 + u.spin * 0.003;
        m.rotation.y += (u.scatterRot.y - m.rotation.y) * 0.03 + u.spin * 0.005;
        m.rotation.z += (u.scatterRot.z - m.rotation.z) * 0.03;
      } else if (u.mode === 'orbit') {
        m.position.lerp(u.homeLocal, 0.08);
      } else if (u.mode === 'gallery') {
        // 始终吸附在镜头正前方固定距离，正对屏幕居中显示
        _v3.set(0, 0, -9.5).applyQuaternion(camera.quaternion).add(camera.position);
        m.position.lerp(_v3, 0.14);
        m.quaternion.slerp(camera.quaternion, 0.14);
      }
    }

    // 相机：拖拽轨道 + 轻微视差（平滑趋近目标角度）
    orbit.yaw += (orbit.tYaw - orbit.yaw) * 0.08;
    orbit.pitch += (orbit.tPitch - orbit.pitch) * 0.08;
    const R = 26, cp = Math.cos(orbit.pitch);
    camera.position.set(
      Math.sin(orbit.yaw) * cp * R + pointer.x * 1.2,
      Math.sin(orbit.pitch) * R - pointer.y * 0.8,
      Math.cos(orbit.yaw) * cp * R
    );
    camera.lookAt(0, 0, 0);

    renderFrame();
  }

  // ---------------- 启动 ----------------
  transitionTo('heart');
  buildPhotos();
  animate();

  window.APP.sceneReady = true;
  // 调试钩子
  window.APP._debug = () => photoMeshes.map((m) => ({
    mode: m.userData.mode, hidden: m.userData.hidden,
    scale: +m.userData.curScale.toFixed(3), target: +m.userData.targetScale.toFixed(3),
    visible: m.visible, parent: m.parent === scene ? 'scene' : (m.parent === photosGroup ? 'group' : 'drive'),
    map: !!m.material.map,
    rot: [m.rotation.x, m.rotation.y, m.rotation.z].map((v) => +v.toFixed(2)),
    pos: m.position.toArray().map((v) => +v.toFixed(1)),
    wp: m.getWorldPosition(new THREE.Vector3()).toArray().map((v) => +v.toFixed(1)),
  }));
})();
