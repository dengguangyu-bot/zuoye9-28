/* 翼生 WingBorn · 机体渲染公共层 —— 场景 / 材质 / 涂装 / 计算标注
 *
 * 生产渲染（Track A 底模手术）与 G7 样机对比页共用同一份实现：
 *   §3B.5 场景与光影：阴影、自适应地面、ACES 色调映射
 *   §3B.6 材质与环境光：程序化环境贴图（canvas→PMREM）→ 全材质反射
 *   §3A.4 计算标注：CAD 风格尺寸线 + 数值（CSS2DRenderer）
 *
 * 约定坐标系：长轴 Z（机头 +Z）、展向 X、高度 Y，机体以原点为中心。
 */
const PlaneStage = (function () {
  'use strict';

  const BG = 0x0B1220;

  /* ───────────────────────── 颜色工具 ───────────────────────── */

  function hslToHex(h, s, l) {          // h 0..360, s/l 0..1
    const hn = ((h % 360) + 360) % 360 / 360;
    const f = function (n) {
      const k = (n + hn * 12) % 12;
      const a = s * Math.min(l, 1 - l);
      return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)))));
    };
    return '#' + [f(0), f(8), f(4)].map(function (v) {
      return ('0' + v.toString(16)).slice(-2);
    }).join('');
  }

  function hashHue(mission) {
    const s = [mission.pax, mission.range_km, mission.mach].join('|');
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return Math.abs(h) % 360;
  }

  function livery(mission, hex) {
    const hue = hex ? hexToHue(hex) : hashHue(mission);
    return {
      hue: hue,
      hex: hex || hslToHex(hue, 0.75, 0.55),
      accent: new THREE.Color().setHSL(hue / 360, 0.78, 0.55),
      accentLight: new THREE.Color().setHSL(hue / 360, 0.55, 0.72),
      base: new THREE.Color().setHSL(hue / 360, 0.06, 0.93),
      belly: new THREE.Color().setHSL(hue / 360, 0.14, 0.66)
    };
  }

  function hexToHue(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return 0;
    const v = parseInt(m[1], 16);
    const r = ((v >> 16) & 255) / 255, g = ((v >> 8) & 255) / 255, b = (v & 255) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    if (d === 0) return 0;
    let h;
    if (mx === r) h = ((g - b) / d + 6) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return (h * 60) % 360;
  }

  /* ───────────────────── 程序化环境贴图（§3B.6）───────────────────── */

  let envCache = null;

  function environmentTexture(renderer) {
    if (envCache) return envCache;
    const W = 1024, H = 512;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    // 天空渐变：顶部冷蓝 → 地平线暖白 → 底部深色（给机身一条天际线反射）
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0.00, '#0d1b33');
    grad.addColorStop(0.34, '#2c5b8f');
    grad.addColorStop(0.48, '#9fc4e0');
    grad.addColorStop(0.52, '#e8e2d4');
    grad.addColorStop(0.60, '#4a5a70');
    grad.addColorStop(1.00, '#0a1018');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    // 两处柔和高光：模拟摄影棚柔光箱，让蒙皮有明确的反射高光
    [0.22, 0.72].forEach(function (fx, i) {
      const cx = W * fx, cy = H * (i ? 0.30 : 0.24), r = W * 0.14;
      const rg = g.createRadialGradient(cx, cy, 0, cx, cy, r);
      rg.addColorStop(0, 'rgba(255,255,255,0.85)');
      rg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = rg;
      g.fillRect(cx - r, cy - r, r * 2, r * 2);
    });
    const tex = new THREE.CanvasTexture(cv);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    if ('encoding' in tex) tex.encoding = THREE.sRGBEncoding;
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    envCache = pmrem.fromEquirectangular(tex).texture;
    tex.dispose();
    pmrem.dispose();
    return envCache;
  }

  /* ───────────────────── 地面（§3B.5）───────────────────── */

  function groundTexture() {
    const S = 1024;
    const cv = document.createElement('canvas');
    cv.width = S; cv.height = S;
    const g = cv.getContext('2d');
    g.clearRect(0, 0, S, S);
    const rg = g.createRadialGradient(S / 2, S / 2, S * 0.04, S / 2, S / 2, S * 0.5);
    rg.addColorStop(0.00, 'rgba(38,54,80,0.95)');
    rg.addColorStop(0.45, 'rgba(24,35,54,0.72)');
    rg.addColorStop(0.80, 'rgba(13,20,34,0.28)');
    rg.addColorStop(1.00, 'rgba(11,18,32,0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, S, S);
    // 细网格线画在同一张 canvas 上，随地面一起淡出
    g.strokeStyle = 'rgba(120,160,210,0.16)';
    g.lineWidth = 1;
    const step = S / 32;
    for (let i = 1; i < 32; i++) {
      const p = i * step;
      g.globalAlpha = 1 - Math.abs(i - 16) / 16;      // 中心亮、边缘淡
      g.beginPath(); g.moveTo(p, 0); g.lineTo(p, S); g.stroke();
      g.beginPath(); g.moveTo(0, p); g.lineTo(S, p); g.stroke();
    }
    g.globalAlpha = 1;
    const tex = new THREE.CanvasTexture(cv);
    if ('encoding' in tex) tex.encoding = THREE.sRGBEncoding;
    return tex;
  }

  /* ───────────────────── 场景搭建 ───────────────────── */

  function stage(canvas, opts) {
    opts = opts || {};
    const renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(BG, 1);
    if ('outputEncoding' in renderer) renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const scene = new THREE.Scene();
    scene.environment = environmentTexture(renderer);

    const camera = new THREE.PerspectiveCamera(38, 1, 0.5, 4000);

    const controls = new THREE.OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.autoRotate = false;
    controls.autoRotateSpeed = 0.4;
    controls.maxPolarAngle = Math.PI * 0.5 - 0.02;
    controls.minDistance = 15;
    controls.maxDistance = 900;

    scene.add(new THREE.HemisphereLight(0xBBD4FF, 0x0A1020, 0.55));
    const key = new THREE.DirectionalLight(0xFFFFFF, 1.5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 2000;
    key.shadow.bias = -0.0012;
    key.shadow.normalBias = 0.6;
    scene.add(key);
    scene.add(key.target);
    const rim = new THREE.DirectionalLight(0x7FB6E8, 0.7);
    rim.position.set(-1, 0.5, -1).normalize().multiplyScalar(200);
    scene.add(rim);

    // 地面：透明圆盘 + canvas 径向渐变（两轨共用）
    const groundTex = groundTexture();
    const groundMat = new THREE.MeshStandardMaterial({
      map: groundTex, transparent: true, roughness: 0.92, metalness: 0.0,
      depthWrite: false
    });
    const ground = new THREE.Mesh(new THREE.CircleGeometry(1, 72), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // CSS2D 标注层
    const labelRenderer = new THREE.CSS2DRenderer();
    labelRenderer.domElement.style.position = 'absolute';
    labelRenderer.domElement.style.top = '0';
    labelRenderer.domElement.style.left = '0';
    labelRenderer.domElement.style.pointerEvents = 'none';
    canvas.parentElement.appendChild(labelRenderer.domElement);

    const st = {
      renderer: renderer, scene: scene, camera: camera, controls: controls,
      key: key, ground: ground, labelRenderer: labelRenderer, bg: BG,
      content: new THREE.Group()
    };
    scene.add(st.content);

    function resize() {
      const el = canvas.parentElement;
      const w = el.clientWidth, h = el.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      labelRenderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    st.resize = resize;
    new ResizeObserver(resize).observe(canvas.parentElement);
    resize();

    // 按机体尺寸布置地面 / 阴影相机 / 主光
    st.fitTo = function (L, span) {
      const R = Math.sqrt(Math.pow(L / 2, 2) + Math.pow(span / 2, 2));
      const gr = Math.max(L, span) * 1.1;                 // ≈2.2× 投影
      ground.scale.setScalar(gr);
      ground.position.y = -(0.55 * R * 0.34 + 1.2);
      const ext = R * 1.35;
      const sc = key.shadow.camera;
      sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext;
      sc.near = 1; sc.far = ext * 12;
      sc.updateProjectionMatrix();
      const dir = new THREE.Vector3(0.55, 1.05, 0.72).normalize();
      key.position.copy(dir.multiplyScalar(ext * 3.2));
      key.target.position.set(0, 0, 0);
      key.target.updateMatrixWorld();
      return { R: R, groundY: ground.position.y };
    };

    st.cameraAt = function (az, el, dist) {
      const a = az * Math.PI / 180, e = el * Math.PI / 180;
      camera.position.set(dist * Math.cos(e) * Math.sin(a),
                          dist * Math.sin(e),
                          dist * Math.cos(e) * Math.cos(a));
      controls.target.set(0, 0, 0);
      controls.update();
    };

    st.render = function () {
      controls.update();
      renderer.render(scene, camera);
      labelRenderer.render(scene, camera);
    };
    return st;
  }

  /* ───────────────────── §3A.4 计算标注 ───────────────────── */

  const DIM_COLOR = 0x6FD3F7;

  function dimLine(pts) {
    const geo = new THREE.BufferGeometry().setFromPoints(
      pts.map(function (p) { return new THREE.Vector3(p[0], p[1], p[2]); }));
    const mat = new THREE.LineBasicMaterial({
      color: DIM_COLOR, transparent: true, opacity: 0.85
    });
    return new THREE.Line(geo, mat);
  }

  function label(text, cls) {
    const el = document.createElement('div');
    el.className = 'dim-label' + (cls ? ' ' + cls : '');
    el.textContent = text;
    return new THREE.CSS2DObject(el);
  }

  function dimension(from, to, text, tickAxis, labelOffset) {
    return dimensionAt(from, to, text, tickAxis, 0.5, labelOffset);
  }

  // tPos：数值沿尺寸线的位置（0=起点 1=终点）；labelOffset：再叠加的三维偏移，
  // 两者合起来把文字推离机体，避免压在机身/机翼上或彼此重叠。
  function dimensionAt(from, to, text, tickAxis, tPos, labelOffset) {
    const g = new THREE.Group();
    g.add(dimLine([from, to]));
    const t = 0.6;
    [from, to].forEach(function (p) {
      const q = p.slice();
      const ax = tickAxis || 'y';
      const i = ax === 'x' ? 0 : (ax === 'y' ? 1 : 2);
      const a = q.slice(), b = q.slice();
      a[i] -= t; b[i] += t;
      g.add(dimLine([a, b]));
    });
    const k = tPos === undefined ? 0.5 : tPos;
    const mid = [from[0] + (to[0] - from[0]) * k,
                 from[1] + (to[1] - from[1]) * k,
                 from[2] + (to[2] - from[2]) * k];
    const lb = label(text);
    const off = labelOffset || [0, 0, 0];
    lb.position.set(mid[0] + off[0], mid[1] + off[1], mid[2] + off[2]);
    g.add(lb);
    return g;
  }

  /**
   * 尺寸标注组：翼展 / 机身长 / 发动机直径（数值直接取自引擎输出）
   * geo 为 engine.design() 的 geometry 子字典
   */
  function dimensions(geo) {
    const g = new THREE.Group();
    g.name = 'dimensions';
    const L = geo.fuselage.length, D = geo.fuselage.dia;
    const span = geo.wing.span;
    const dEng = geo.engines.dia;
    const yTop = D * 0.75;
    // 翼展：机翼正下方一条横线；数值下移，避开机身
    const ySpan = geo.wing.root_z - D * 0.55;
    const zSpan = L / 2 - (geo.wing.root_le_x_frac || 0.42) * L - geo.wing.root_chord * 0.5;
    g.add(dimension([-span / 2, ySpan, zSpan], [span / 2, ySpan, zSpan],
                    '翼展 ' + span.toFixed(1) + ' m', 'y', [0, -0.030 * L, 0]));
    // 机身长：机身右侧一条纵线；数值挂在机头端，避免与翼展标注挤在中段
    const xLen = D * 0.95;
    g.add(dimensionAt([xLen, 0, -L / 2], [xLen, 0, L / 2],
                      '机身长 ' + L.toFixed(1) + ' m', 'y', 0.26,
                      [0.040 * L, 0.012 * L, 0]));
    // 发动机直径：右侧短舱处一小段
    const yEng = geo.wing.root_z - dEng * 0.30;
    const xEng = geo.engines.y_frac * span / 2;
    const zEng = zSpan + (geo.wing.root_chord * 0.5);
    // 发动机：标注推到短舱外侧下方，避开翼展线与机体
    g.add(dimensionAt([xEng, yEng + dEng / 2, zEng], [xEng, yEng - dEng / 2, zEng],
                      '发动机 Ø' + dEng.toFixed(2) + ' m', 'x', 0.5,
                      [0, -0.040 * L, 0]));
    // 标注用小尺寸也跟着缩放：巨机上字号不该还是 0.6 m
    g.scale.setScalar(Math.max(1, L / 40));
    return g;
  }

  /* ───────────────────── Track A 贴图色相重映射 ───────────────────── */

  /**
   * 底模贴图烧死了航司涂装（深蓝尾翼 + 蓝条纹）。直接乘 tint 会发脏。
   * 做法：饱和区（涂装）换成目标色相、保留明度；低饱和区（机身板线/金属）原样保留。
   */
  function recolorTexture(image, hue) {
    const W = image.width, H = image.height;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    g.drawImage(image, 0, 0);
    let img;
    try {
      img = g.getImageData(0, 0, W, H);
    } catch (e) {
      return cv;                    // 跨域等异常时退回原图
    }
    const d = img.data;
    const target = hue / 360;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i] / 255, gg = d[i + 1] / 255, b = d[i + 2] / 255;
      const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), l = (mx + mn) / 2;
      const sat = mx === mn ? 0 : (l > 0.5 ? (mx - mn) / (2 - mx - mn) : (mx - mn) / (mx + mn));
      if (sat > 0.18) {             // 涂装区：换色相、保留明度与饱和
        const c = new THREE.Color().setHSL(target, Math.min(sat * 1.05, 0.85), l);
        d[i] = Math.round(c.r * 255);
        d[i + 1] = Math.round(c.g * 255);
        d[i + 2] = Math.round(c.b * 255);
      } else {                      // 结构区：轻微去饱和，避免残留脏色
        const lv = Math.round((0.299 * r + 0.587 * gg + 0.114 * b) * 255);
        d[i] = Math.round(lv * 0.94 + d[i] * 0.06);
        d[i + 1] = Math.round(lv * 0.94 + d[i + 1] * 0.06);
        d[i + 2] = Math.round(lv * 0.94 + d[i + 2] * 0.06);
      }
    }
    g.putImageData(img, 0, 0);
    return cv;
  }

  /* ───────────────────── 机库缩略图：俯视剪影（按各设计涂装着色）───────────────────── */

  /**
   * 用引擎参数画一张俯视平面剪影（机头朝上）。机库墙靠它实现"一面彩墙"。
   * 纯 canvas，无外部资产；尺寸随设计的翼展/机身长自适应。
   */
  function planformCanvas(geo, lv, W, H) {
    const cv = document.createElement('canvas');
    cv.width = W || 250; cv.height = H || 140;
    const g = cv.getContext('2d');
    const hex = function (c) { return '#' + c.getHexString(); };
    g.clearRect(0, 0, cv.width, cv.height);

    const fus = geo.fuselage, wing = geo.wing, ht = geo.htail, vt = geo.vtail;
    const L = fus.length, span = wing.span, D = fus.dia;
    const s = Math.min(cv.width * 0.90 / span, cv.height * 0.86 / L);
    const cx = cv.width / 2, cy = cv.height / 2;
    const X = function (v) { return cx + v * s; };
    const Y = function (z) { return cy - z * s; };       // 机头在 +Z → 画布上方

    const accent = hex(lv.accent);
    const body = hex(lv.base);
    const edge = hex(lv.belly);

    // 机翼（后掠四点，左右镜像）
    const hspan = span / 2;
    const rootLeZ = L / 2 - (wing.root_le_x_frac || 0.42) * L;
    const tipLeZ = rootLeZ - hspan * Math.tan(wing.sweep_deg * Math.PI / 180);
    [1, -1].forEach(function (sgn) {
      g.beginPath();
      g.moveTo(X(0), Y(rootLeZ));
      g.lineTo(X(sgn * hspan), Y(tipLeZ));
      g.lineTo(X(sgn * hspan), Y(tipLeZ - wing.tip_chord));
      g.lineTo(X(0), Y(rootLeZ - wing.root_chord));
      g.closePath();
      g.fillStyle = accent;
      g.fill();
    });

    // 平尾
    const htLeZ = -L / 2 + L * 0.055;
    [1, -1].forEach(function (sgn) {
      g.beginPath();
      g.moveTo(X(0), Y(htLeZ));
      g.lineTo(X(sgn * ht.span / 2), Y(htLeZ - ht.span / 2 * 0.42));
      g.lineTo(X(sgn * ht.span / 2), Y(htLeZ - ht.span / 2 * 0.72));
      g.lineTo(X(0), Y(htLeZ - ht.span / 2 * 0.58));
      g.closePath();
      g.fillStyle = accent;
      g.fill();
    });

    // 机身
    const w = Math.max(D * s, 3);
    g.beginPath();
    if (g.roundRect) {
      g.roundRect(cx - w / 2, Y(L / 2), w, L * s, w * 0.42);
    } else {
      g.rect(cx - w / 2, Y(L / 2), w, L * s);
    }
    g.fillStyle = body;
    g.fill();
    g.strokeStyle = edge;
    g.lineWidth = 1;
    g.stroke();

    // 垂尾（俯视是细长条，画在尾部中线作提示）
    g.fillStyle = accent;
    g.fillRect(cx - w * 0.22, Y(-L / 2 + L * 0.02), w * 0.44, Math.min(vt.height * 0.42 * s, L * s * 0.16));

    return cv;
  }

  return {
    BG: BG,
    stage: stage,
    planformCanvas: planformCanvas,
    dimensions: dimensions,
    label: label,
    livery: livery,
    hslToHex: hslToHex,
    hexToHue: hexToHue,
    hashHue: hashHue,
    recolorTexture: recolorTexture
  };
})();
