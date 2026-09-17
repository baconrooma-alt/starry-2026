/* ============================================================
 * MediaPipe Hands 手势检测
 *   ✋ 张开手掌 -> 满天星散开
 *   🤏 捏合     -> 聚焦下一张照片（画廊模式）
 *   ✊ 握拳     -> 聚合成心形
 * ============================================================ */
(function () {
  'use strict';

  const video = document.getElementById('camVideo');
  const camBox = document.getElementById('camPreview');
  const camStatus = document.getElementById('camStatus');
  const btn = document.getElementById('gestureBtn');

  let active = false;
  let busy = false;
  let lastGesture = '';
  let lastTime = 0;
  let lastNoneTime = 0;
  const COOLDOWN = 250; // ms，手势防抖（过快的手势切换仍会被识别）
  const RELEASE_ARM_MS = 400; // ms，手势释放后重新武装边沿触发

  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));

  //  landmarks 分类：握拳 > 捏合 > 张手（避免握拳时拇指搭在食指上被误判为捏合）
  function classify(lm) {
    const wrist = lm[0];
    const fingerPairs = [[8, 6], [12, 10], [16, 14], [20, 18]]; // tip, pip
    let extended = 0;
    for (const [tip, pip] of fingerPairs) {
      if (dist(lm[tip], wrist) > dist(lm[pip], wrist) * 1.1) extended++;
    }
    if (extended === 0) return 'fist';
    if (dist(lm[4], lm[8]) < 0.05) return 'pinch';
    if (extended >= 4) return 'open';
    return '';
  }

  function onGesture(g) {
    const now = Date.now();
    // 边沿触发：同一手势保持不动不会重复执行（如捏合住不翻阅），需变换手势后再次触发
    if (g === lastGesture) return;
    // 手势释放重武装：松开后无手势持续 RELEASE_ARM_MS 即解除边沿锁，
    // 使"捏合→放开→再捏合"可以查看下一张
    if (!g) {
      if (lastGesture && now - lastNoneTime > RELEASE_ARM_MS) lastGesture = '';
      lastNoneTime = now;
      return;
    }
    if (now - lastTime < COOLDOWN && lastGesture) return;
    lastGesture = g;
    lastTime = now;

    if (g === 'open') {
      window.APP.transitionTo('burst');
      camStatus.textContent = '✋ 满天星模式';
    } else if (g === 'fist') {
      window.APP.transitionTo('heart');
      camStatus.textContent = '✊ 心形聚合';
    } else if (g === 'pinch') {
      window.APP.focusNextPhoto();
      camStatus.textContent = '🤏 浏览照片';
    }
  }

  async function start() {
    if (busy) return;
    busy = true;
    btn.classList.add('active');
    camBox.classList.remove('hidden');
    camStatus.textContent = '正在启动摄像头…';

    try {
      // 动态加载 MediaPipe（多 CDN 回退），避免静态引用在 CDN 不可达时直接报错
      const base = await ensureMediaPipe();
      const hands = new Hands({
        locateFile: (f) => `${base}/@mediapipe/hands/${f}`,
      });
      hands.setOptions({
        maxNumHands: 1,
        modelComplexity: 1,
        minDetectionConfidence: 0.6,
        minTrackingConfidence: 0.5,
      });
      hands.onResults((res) => {
        if (res.multiHandLandmarks && res.multiHandLandmarks.length) {
          const lm = res.multiHandLandmarks[0];
          // 手掌质心驱动粒子云（镜像 x 与预览画面一致）：手停则云静，云跟随手移动/旋转
          let cx = 0, cy = 0;
          for (const i of [0, 5, 9, 13, 17]) { cx += lm[i].x; cy += lm[i].y; }
          window.APP.updateHandDrive((0.5 - cx / 5) * 2, (cy / 5 - 0.5) * 2);
          onGesture(classify(lm));
        }
      });

      const cam = new Camera(video, {
        onFrame: async () => { await hands.send({ image: video }); },
        width: 480,
        height: 360,
      });
      await cam.start();
      active = true;
      camStatus.textContent = '手势识别已启用';
    } catch (e) {
      camStatus.textContent = '启动失败：' + (e && e.message ? e.message : e);
      btn.classList.remove('active');
    }
    busy = false;
  }

  // ---- MediaPipe 多 CDN 动态加载 ----
  const MP_CDNS = ['https://cdn.jsdelivr.net/npm', 'https://unpkg.com'];

  function loadScriptOnce(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('脚本加载失败 ' + src));
      document.head.appendChild(s);
    });
  }

  // 确保 Hands / Camera 全局对象可用，返回可用的 CDN 基地址
  async function ensureMediaPipe() {
    let base = MP_CDNS[0];
    if (typeof Hands === 'undefined') {
      let ok = false;
      for (const b of MP_CDNS) {
        try { await loadScriptOnce(b + '/@mediapipe/hands/hands.js'); base = b; ok = true; break; } catch (e) { /* try next */ }
      }
      if (!ok || typeof Hands === 'undefined') {
        throw new Error('手势模型加载失败，无法访问 cdn.jsdelivr.net / unpkg.com，请检查网络');
      }
    }
    if (typeof Camera === 'undefined') {
      let ok = false;
      for (const b of MP_CDNS) {
        try { await loadScriptOnce(b + '/@mediapipe/camera_utils/camera_utils.js'); ok = true; break; } catch (e) { /* try next */ }
      }
      if (!ok || typeof Camera === 'undefined') {
        throw new Error('摄像头工具加载失败，无法访问 cdn.jsdelivr.net / unpkg.com，请检查网络');
      }
    }
    return base;
  }

  function stop() {
    active = false;
    btn.classList.remove('active');
    camBox.classList.add('hidden');
    const s = video.srcObject;
    if (s) s.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  }

  btn.addEventListener('click', () => (active ? stop() : start()));

  // 测试钩子：供自动化测试注入合成 landmark，验证分类与触发逻辑
  window.__gestureTest = { classify, onGesture, isActive: () => active };

  // 手势快捷键（无摄像头时演示用）：O=张手 B=握拳 P=捏合
  addEventListener('keydown', (e) => {
    const map = { o: 'open', b: 'burst', f: 'fist', p: 'pinch' };
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.key === 'o') onGesture('open');
    else if (e.key === 'f') onGesture('fist');
    else if (e.key === 'p') onGesture('pinch');
  });
})();
