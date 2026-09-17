/* ============================================================
 * UI：加载页 / 配置抽屉 / BGM / 分享系统
 * ============================================================ */
(function () {
  'use strict';
  const { CONFIG, saveConfig } = window.APP;
  const $ = (id) => document.getElementById(id);

  // ---------------- 加载页 ----------------
  (function loader() {
    const bar = $('loaderProgress'), pct = $('loaderPercent'), box = $('loader');
    let p = 0;
    const tick = setInterval(() => {
      // 前 90% 模拟进度，场景就绪后快速补满
      const cap = window.APP.sceneReady ? 100 : 90;
      p += (cap - p) * 0.12 + 0.4;
      if (p >= 100) {
        p = 100;
        clearInterval(tick);
        setTimeout(() => box.classList.add('done'), 350);
      }
      bar.style.width = p + '%';
      pct.textContent = Math.floor(p) + '%';
    }, 80);
  })();

  // ---------------- 标题应用 ----------------
  function applyText() {
    $('title').textContent = CONFIG.title;
    $('subtitle').textContent = CONFIG.subtitle;
    document.title = CONFIG.title + ' · 星空粒子';
  }

  // ---------------- BGM ----------------
  const bgm = $('bgm'), bgmBtn = $('bgmBtn');
  function applyBgm(src) {
    if (!src) return;
    CONFIG.bgm = src;
    bgm.src = src;
    saveConfig();
  }
  bgmBtn.addEventListener('click', async () => {
    if (!bgm.src && CONFIG.bgm) bgm.src = CONFIG.bgm;
    if (!bgm.src) { alert('请先在配置面板设置背景音乐'); return; }
    try {
      if (bgm.paused) { await bgm.play(); bgmBtn.classList.add('playing'); }
      else { bgm.pause(); bgmBtn.classList.remove('playing'); }
    } catch (e) { alert('音乐播放失败：' + e.message); }
  });
  if (CONFIG.bgm) {
    bgm.src = CONFIG.bgm;
    // 打开页面即尝试自动播放；若被浏览器自动播放策略拦截，首次点击/触摸/按键时补播
    bgm.play().then(() => bgmBtn.classList.add('playing')).catch(() => {
      const kick = () => bgm.play().then(() => bgmBtn.classList.add('playing')).catch(() => {});
      addEventListener('pointerdown', kick, { once: true });
      addEventListener('keydown', kick, { once: true });
    });
  }

  // ---------------- 抽屉 ----------------
  const drawer = $('drawer');
  $('drawerBtn').addEventListener('click', () => drawer.classList.add('open'));
  $('drawerClose').addEventListener('click', () => drawer.classList.remove('open'));

  // 文本配置
  const cfgTitle = $('cfgTitle'), cfgSubtitle = $('cfgSubtitle');
  cfgTitle.value = CONFIG.title;
  cfgSubtitle.value = CONFIG.subtitle;
  cfgTitle.addEventListener('input', () => { CONFIG.title = cfgTitle.value || '2026'; applyText(); saveConfig(); });
  cfgSubtitle.addEventListener('input', () => { CONFIG.subtitle = cfgSubtitle.value; applyText(); saveConfig(); });

  // 视觉配置
  $('cfgParticleType').value = CONFIG.particleType;
  $('cfgParticleType').addEventListener('change', (e) => {
    window.APP.setParticleType(e.target.value); saveConfig();
  });
  $('cfgColor').value = CONFIG.color;
  $('cfgAccent').value = CONFIG.accent;
  $('cfgColor').addEventListener('input', (e) => { CONFIG.color = e.target.value; window.APP.applyColors(); saveConfig(); });
  $('cfgAccent').addEventListener('input', (e) => { CONFIG.accent = e.target.value; window.APP.applyColors(); saveConfig(); });

  $('cfgText').value = CONFIG.text;
  $('applyText').addEventListener('click', () => {
    const v = $('cfgText').value.trim();
    if (v) { window.APP.morphToText(v); saveConfig(); }
  });
  document.querySelectorAll('[data-shape]').forEach((b) =>
    b.addEventListener('click', () => window.APP.transitionTo(b.dataset.shape))
  );

  // 媒体配置：照片
  const photoList = $('photoList');
  function renderPhotoList() {
    photoList.innerHTML = '';
    CONFIG.photos.forEach((src, i) => {
      const div = document.createElement('div');
      div.className = 'thumb';
      const img = document.createElement('img');
      img.src = src;
      const del = document.createElement('button');
      del.textContent = '×';
      del.addEventListener('click', () => {
        CONFIG.photos.splice(i, 1);
        window.APP.rebuildPhotos(); renderPhotoList(); saveConfig();
      });
      div.append(img, del);
      photoList.appendChild(div);
    });
  }
  renderPhotoList();

  function addPhotos(srcs) {
    CONFIG.photos.push(...srcs);
    window.APP.rebuildPhotos();
    renderPhotoList();
    saveConfig();
  }
  $('cfgPhotoUpload').addEventListener('change', (e) => {
    [...e.target.files].forEach((f) => {
      const rd = new FileReader();
      rd.onload = () => addPhotos([rd.result]);
      rd.readAsDataURL(f);
    });
    e.target.value = '';
  });
  $('addPhotoUrl').addEventListener('click', () => {
    const v = $('cfgPhotoUrl').value.trim();
    if (v) { addPhotos([v]); $('cfgPhotoUrl').value = ''; }
  });

  // 媒体配置：BGM
  $('cfgBgmUrl').value = CONFIG.bgm && !CONFIG.bgm.startsWith('blob:') ? CONFIG.bgm : '';
  $('applyBgm').addEventListener('click', () => {
    const v = $('cfgBgmUrl').value.trim();
    if (v) { applyBgm(v); alert('背景音乐已更换，点击右下角 ♪ 播放'); }
  });
  $('cfgBgmFile').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (f) { applyBgm(URL.createObjectURL(f)); alert('背景音乐已更换，点击右下角 ♪ 播放'); }
    e.target.value = '';
  });

  // ---------------- 分享系统 ----------------
  const modal = $('shareModal');
  $('openShare').addEventListener('click', () => {
    modal.classList.remove('hidden');
    $('shareResult').classList.add('hidden');
    $('shareMsg').textContent = '';
  });
  $('shareClose').addEventListener('click', () => modal.classList.add('hidden'));
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });

  function showShare(url, note) {
    $('shareLink').textContent = url;
    $('shareMsg').textContent = note || '';
    $('shareResult').classList.remove('hidden');
    const box = $('qrcode');
    box.innerHTML = '';
    new QRCode(box, { text: url, width: 150, height: 150 });
  }
  $('copyLink').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('shareLink').textContent); $('shareMsg').textContent = '已复制到剪贴板 ✓'; }
    catch { $('shareMsg').textContent = '复制失败，请手动复制'; }
  });

  $('genShare').addEventListener('click', async () => {
    const msg = $('shareMsg');
    msg.textContent = '正在生成…';
    const slug = $('shareSlug').value.trim();
    const code = $('shareCode').value.trim();
    // 本地链接永远可用（配置编码进 URL）
    const local = location.origin + location.pathname + '?c=' + encodeURIComponent(configToB64());
    try {
      const res = await fetch('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: publicConfig(), slug: slug || undefined, code: code || undefined }),
      });
      const data = await res.json();
      if (data.ok) {
        const pretty = slug ? `${location.origin}/${slug}` : `${location.origin}/?share=${data.key}`;
        showShare(pretty, `兑换码：${data.key} 已保存到服务器`);
        if (navigator.clipboard && pretty !== local) {
          try { await navigator.clipboard.writeText(pretty); } catch { /* ignore */ }
        }
      } else if (res.status === 409) {
        msg.textContent = data.error + '，已生成纯链接版本';
        showShare(local);
      } else {
        showShare(local, '服务器不可用，已生成纯链接版本');
      }
    } catch {
      showShare(local, '服务器不可用，已生成纯链接版本');
    }
  });

  // 分享内容里去掉体积过大的 dataURL 照片（改传 URL），避免超长链接
  function publicConfig() {
    const c = { ...CONFIG };
    c.photos = CONFIG.photos.filter((p) => !p.startsWith('data:'));
    return c;
  }
  function configToB64() {
    const s = JSON.stringify(publicConfig());
    return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  // ---------------- 从分享/兑换码加载 ----------------
  (async function boot() {
    applyText();
    const q = new URLSearchParams(location.search);
    const share = q.get('share');
    if (share) {
      try {
        const res = await fetch('/api/share/' + encodeURIComponent(share));
        const data = await res.json();
        if (data.ok) applyRemote(data.config);
      } catch { /* ignore */ }
    } else if (location.pathname.length > 1 && !location.pathname.endsWith('.html')) {
      // 自定义 slug 如 /2026-01-01-go
      const slug = location.pathname.slice(1);
      try {
        const res = await fetch('/api/share/' + encodeURIComponent(slug));
        const data = await res.json();
        if (data.ok) applyRemote(data.config);
      } catch { /* ignore */ }
    }
  })();

  function applyRemote(cfg) {
    if (!cfg) return;
    Object.assign(CONFIG, cfg);
    saveConfig();
    applyText();
    window.APP.applyColors();
    window.APP.setParticleType(CONFIG.particleType);
    window.APP.morphToText(CONFIG.text);
    window.APP.rebuildPhotos();
    cfgTitle.value = CONFIG.title;
    cfgSubtitle.value = CONFIG.subtitle;
    $('cfgText').value = CONFIG.text;
    $('cfgParticleType').value = CONFIG.particleType;
    $('cfgColor').value = CONFIG.color;
    $('cfgAccent').value = CONFIG.accent;
    renderPhotoList();
  }

  applyText();
})();
