/* 翼生 WingBorn · G7 Track B 样机 —— 全参数化放样（零外部资产）
 *
 * §3B.1 多截面翼型放样   §3B.2 座级翼梢三式   §3B.3 canvas 机身涂装贴图
 * §3B.4 发动机细节       §3B.6 车漆材质
 *
 * 全部几何由引擎参数生成。返回的 Group 以原点为中心、机头朝 +Z。
 */
const TrackB = (function () {
  'use strict';

  const RING = 16;                 // 翼型环点数（NACA 对称翼型）
  const WASHOUT = 3.0;             // 梢根扭转 washout，度
  const ROOT_TC = 0.12, TIP_TC = 0.09;

  /* ───────────────────── 翼型与放样（§3B.1）───────────────────── */

  function thickness(x, tc) {
    return 5 * tc * (0.2969 * Math.sqrt(x) - 0.1260 * x - 0.3516 * x * x
                     + 0.2843 * x * x * x - 0.1036 * x * x * x * x);
  }

  function airfoilRing(tc) {
    const half = RING / 2, pts = [];
    const xOf = function (i) { return 0.5 * (1 - Math.cos(Math.PI * i / half)); };
    for (let i = 0; i <= half; i++) {          // 后缘 → 前缘（上表面）
      const x = xOf(i);
      pts.push([x, thickness(x, tc)]);
    }
    for (let i = half - 1; i >= 1; i--) {      // 前缘 → 后缘（下表面）
      const x = xOf(i);
      pts.push([x, -thickness(x, tc)]);
    }
    return pts;
  }

  // 单截面：展向 x、垂直 y、弦向 −z（机头 +Z，故向后为 −z）
  function sectionAt(s, c) {
    let chord = c.rootChord + (c.tipChord - c.rootChord) * s;
    // 前缘后掠：曲线分布（内段后掠小、外段大），非直线
    const curve = 0.58 * s + 0.42 * Math.sqrt(s);
    let zLe = -c.halfSpan * c.tanSweep * curve;
    // 斜削翼尖（宽体）：末段后掠骤增、尖弦收窄
    if (c.tipStyle === 'raked' && s > 0.94) {
      const k = (s - 0.94) / 0.06;
      zLe -= c.halfSpan * c.tanSweep * 0.60 * k;
      chord *= (1 - 0.24 * k);
    }
    // 上反：曲线抬升，避免翼根折角
    const y = c.halfSpan * Math.sin(c.dihedral * Math.PI / 180) * (0.35 * s + 0.65 * s * s);
    const tc = ROOT_TC + (TIP_TC - ROOT_TC) * s;
    const twist = -WASHOUT * s * Math.PI / 180;
    const cosT = Math.cos(twist), sinT = Math.sin(twist);
    const ring = airfoilRing(tc);
    const out = [];
    const x = s * c.halfSpan;
    for (let k = 0; k < ring.length; k++) {
      const xi = ring[k][0] * chord, eta = ring[k][1] * chord;
      const dx = xi - 0.25 * chord;                    // 绕 1/4 弦点扭转
      out.push([x, y + dx * sinT + eta * cosT, zLe - (0.25 * chord + dx * cosT - eta * sinT)]);
    }
    return out;
  }

  function loftGeometry(sections) {
    const nR = sections[0].length, nS = sections.length;
    const verts = [], idx = [];
    for (let i = 0; i < nS; i++)
      for (let j = 0; j < nR; j++) {
        const p = sections[i][j];
        verts.push(p[0], p[1], p[2]);
      }
    for (let i = 0; i < nS - 1; i++)
      for (let j = 0; j < nR; j++) {
        const j2 = (j + 1) % nR;
        const a = i * nR + j, b = i * nR + j2;
        const cc = (i + 1) * nR + j2, d = (i + 1) * nR + j;
        idx.push(a, b, cc, a, cc, d);
      }
    // 端盖：首末截面各扇一圈，封闭成实体（投影与阴影更干净）
    [[0, false], [nS - 1, true]].forEach(function (pair) {
      const base = pair[0] * nR, flip = pair[1];
      let cx = 0, cy = 0, cz = 0;
      for (let j = 0; j < nR; j++) {
        cx += verts[(base + j) * 3]; cy += verts[(base + j) * 3 + 1]; cz += verts[(base + j) * 3 + 2];
      }
      cx /= nR; cy /= nR; cz /= nR;
      const ci = verts.length / 3;
      verts.push(cx, cy, cz);
      for (let j = 0; j < nR; j++) {
        const a = base + j, b = base + (j + 1) % nR;
        if (flip) idx.push(ci, b, a); else idx.push(ci, a, b);
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  }

  function stallion(cfg) {
    const stations = cfg.tipStyle === 'raked'
      ? [0, 0.20, 0.42, 0.62, 0.82, 0.94, 1.0]
      : [0, 0.20, 0.42, 0.62, 0.82, 1.0];
    return loftGeometry(stations.map(function (s) { return sectionAt(s, cfg); }));
  }

  /* ───────────────────── 座级翼梢三式（§3B.2）───────────────────── */

  function tipDevice(style, c, mat) {
    const g = new THREE.Group();
    const h = c.tipChord;
    if (style === 'fence') {
      // 支线：翼尖帆（上下两片小板）
      [1, -1].forEach(function (up) {
        const cfg = {
          halfSpan: h * 0.52, rootChord: h * 0.66, tipChord: h * 0.40,
          tanSweep: Math.tan(38 * Math.PI / 180), dihedral: 0, tipStyle: 'plain'
        };
        const m = new THREE.Mesh(stallion(cfg), mat);
        m.rotation.z = up > 0 ? Math.PI / 2 : -Math.PI / 2;
        m.position.set(c.halfSpan - h * 0.02, up * h * 0.03, 0);
        g.add(m);
      });
    } else if (style === 'sharklet') {
      // 窄体：单片大后掠鲨鳍，外倾 ~75°
      const cfg = {
        halfSpan: h * 0.95, rootChord: h * 1.10, tipChord: h * 0.42,
        tanSweep: Math.tan(52 * Math.PI / 180), dihedral: 0, tipStyle: 'plain'
      };
      const m = new THREE.Mesh(stallion(cfg), mat);
      m.rotation.z = 75 * Math.PI / 180;
      m.position.set(c.halfSpan - h * 0.06, 0, 0);
      g.add(m);
    }
    // 宽体 raked：无垂直件，由主放样的末段后掠承载
    return g;
  }

  /* ───────────────────── 机身（§3B.3）───────────────────── */

  function fuselageGeometry(L, D, noseLen, tailLen) {
    const R = D / 2, N = 64, pts = [];
    for (let i = 0; i <= N; i++) {
      const u = L * i / N;
      let r;
      if (u < noseLen) {
        // 幂次 0.38 < 0.5：同长度下剖面更饱满，接近真机钝头（纯椭圆会被拉成尖锥）
        const t = (noseLen - u) / noseLen;
        r = R * Math.pow(Math.max(0, 1 - t * t), 0.38);
      } else if (u > L - tailLen) {
        const t = (u - (L - tailLen)) / tailLen;
        r = R * (1 - 0.88 * Math.pow(t, 1.55));
      } else {
        r = R;
      }
      pts.push(new THREE.Vector2(Math.max(r, R * 0.035), u));
    }
    const geo = new THREE.LatheGeometry(pts, 48);
    // 尾锥上翘：旋转后世界垂直方向 = lathe 局部 −Z
    const pos = geo.attributes.position, up = 0.36 * R;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y > L - tailLen) {
        const t = (y - (L - tailLen)) / tailLen;
        pos.setZ(i, pos.getZ(i) - up * t * t);
      }
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    return geo;
  }

  // u 角度 ↔ 机身高度的换算：世界 y = −r·cos(2πu) → fracOfR = y/r
  function uAt(fracOfR) {
    const c = Math.max(-1, Math.min(1, -fracOfR));
    return Math.acos(c) / (2 * Math.PI);
  }

  /**
   * 机身涂装贴图：舷窗（数量 = fuselage.rows）/ 舱门 / 驾驶舱风挡 / cheatline / 机腹
   * 2048×1024（规格书为 512 高；实测 512 时 0.25 m 舷窗不足 3 px，看不清，
   * 故纵向翻倍以便"窗数一眼可读"）。
   */
  function liveryCanvas(geo, lv) {
    const W = 2048, H = 1024;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    const fus = geo.fuselage, L = fus.length, D = fus.dia;
    const rows = fus.rows, pitch = fus.pitch_m;
    const yOf = function (a) { return a / L * H; };       // 轴向 m → canvas y（v=0 在机头）
    const xOf = function (u) { return u * W; };

    const css = function (c) { return '#' + c.getHexString(); };
    const accent = css(lv.accent), base = css(lv.base), belly = css(lv.belly);

    // 基底 + 机腹染色的浅灰
    g.fillStyle = base;
    g.fillRect(0, 0, W, H);
    const uBelly = uAt(-0.55);
    g.fillStyle = belly;
    g.fillRect(0, 0, xOf(uBelly), H);
    g.fillRect(xOf(1 - uBelly), 0, W, H);

    const cabinA = fus.nose_len + D * 0.85, cabinB = L - fus.tail_len - D * 0.30;
    const cabinLen = cabinB - cabinA;

    // cheatline：机窗下方细线（窄体）/ 贯穿粗条（支线）/ 垂尾色块（宽体）
    const uWinLow = uAt(0.06), uWinHigh = uAt(0.36);
    if (geo.class === 'regional') {
      g.fillStyle = accent;
      g.fillRect(xOf(uAt(0.10)), 0, xOf(uAt(0.30)) - xOf(uAt(0.10)), H);
      g.fillRect(xOf(1 - uAt(0.30)), 0, xOf(uAt(0.30)) - xOf(uAt(0.10)), H);
    } else {
      g.fillStyle = accent;
      const w = W * 0.006;
      g.fillRect(xOf(uWinLow) - w, 0, w * 2, H);
      g.fillRect(xOf(1 - uWinLow) - w, 0, w * 2, H);
    }

    // 驾驶舱风挡（鼻部深色带）
    g.fillStyle = 'rgba(14,22,36,0.92)';
    const ckA = yOf(fus.nose_len * 0.30), ckB = yOf(fus.nose_len * 0.72);
    [[uAt(0.50), uAt(0.05)], [uAt(-0.05), uAt(-0.50)]].forEach(function (band) {
      const x0 = xOf(Math.min(band[0], band[1])), x1 = xOf(Math.max(band[0], band[1]));
      g.fillRect(x0, ckA, x1 - x0, ckB - ckA);
    });

    // 舷窗：数量 = 客舱排数
    const uW = uAt(0.20);
    const winDx = 0.27 / (Math.PI * D) * W;          // 周向 0.27 m
    const winDy = Math.max(0.50 * pitch / L * H, 4); // 纵向 0.5×排距
    const winR = Math.min(winDx, winDy) * 0.28;
    const winH = Math.max(winDy * 0.62, 3);
    g.fillStyle = 'rgba(16,26,42,0.92)';
    [uW, 1 - uW].forEach(function (uc) {
      const cx = xOf(uc);
      for (let i = 0; i < rows; i++) {
        const a = cabinA + (cabinLen * (i + 0.5) / rows);
        const cy = yOf(a);
        g.beginPath();
        g.moveTo(cx - winDx / 2 + winR, cy - winH / 2);
        g.lineTo(cx + winDx / 2 - winR, cy - winH / 2);
        g.quadraticCurveTo(cx + winDx / 2, cy - winH / 2, cx + winDx / 2, cy - winH / 2 + winR);
        g.lineTo(cx + winDx / 2, cy + winH / 2 - winR);
        g.quadraticCurveTo(cx + winDx / 2, cy + winH / 2, cx + winDx / 2 - winR, cy + winH / 2);
        g.lineTo(cx - winDx / 2 + winR, cy + winH / 2);
        g.quadraticCurveTo(cx - winDx / 2, cy + winH / 2, cx - winDx / 2, cy + winH / 2 - winR);
        g.lineTo(cx - winDx / 2, cy - winH / 2 + winR);
        g.quadraticCurveTo(cx - winDx / 2, cy - winH / 2, cx - winDx / 2 + winR, cy - winH / 2);
        g.fill();
      }
    });

    // 舱门：3–5 个描边矩形，前后各一 + 中间均布
    const nDoor = geo.class === 'wide' ? 5 : (geo.class === 'narrow' ? 4 : 3);
    g.strokeStyle = 'rgba(60,78,104,0.85)';
    g.lineWidth = Math.max(W * 0.0016, 2);
    const uDoor0 = uAt(-0.30), uDoor1 = uAt(0.52);
    [uDoor0, 1 - uDoor1].forEach(function (u0, idx) {
      const u1 = idx === 0 ? uDoor1 : 1 - uDoor0;
      for (let i = 0; i < nDoor; i++) {
        const a = cabinA + cabinLen * (i + 0.5) / nDoor;
        const dy = (1.83 / L) * H, dx = (u1 - u0) * W;
        g.strokeRect(xOf(u0), yOf(a) - dy / 2, dx, dy);
      }
    });

    return { canvas: cv, width: W, height: H };
  }

  /* ───────────────────── 发动机（§3B.4）───────────────────── */

  function engineMesh(eng, M) {
    const g = new THREE.Group();
    const r = Math.max(eng.dia / 2, 0.3), len = eng.dia * 1.85;
    // 短舱前段（涂装基色）/ 后段（金属灰）双拼
    const front = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.97, len * 0.46, 28, 1, true), M.nacF);
    front.rotation.x = -Math.PI / 2;
    front.position.z = len * 0.27;
    g.add(front);
    const rear = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.97, r * 0.72, len * 0.54, 28, 1, true), M.nacR);
    rear.rotation.x = -Math.PI / 2;
    rear.position.z = -len * 0.23;
    g.add(rear);
    // 唇口强调色
    const lip = new THREE.Mesh(new THREE.TorusGeometry(r, r * 0.085, 10, 32), M.accent);
    lip.position.z = len * 0.5;
    g.add(lip);
    // 进气内腔（可见的"洞"）
    const duct = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.88, r * 0.80, len * 0.40, 28, 1, true), M.dark);
    duct.rotation.x = -Math.PI / 2;
    duct.position.z = len * 0.28;
    g.add(duct);
    // 风扇整流锥 + 盘面
    const spinner = new THREE.Mesh(new THREE.ConeGeometry(r * 0.26, r * 0.78, 20), M.dark);
    spinner.rotation.x = Math.PI / 2;          // 锥尖朝 +Z（迎风），此前朝后是反的
    spinner.position.z = len * 0.40;
    g.add(spinner);
    const fan = new THREE.Mesh(new THREE.CircleGeometry(r * 0.86, 28), M.fan);
    fan.position.z = len * 0.13;
    g.add(fan);
    // 尾喷收口 + 中央排气锥
    const plug = new THREE.Mesh(new THREE.ConeGeometry(r * 0.34, r * 1.1, 18), M.dark);
    plug.rotation.x = -Math.PI / 2;            // 锥尖朝 −Z（尾喷），同上
    plug.position.z = -len * 0.62;
    g.add(plug);
    // 吊挂
    const pyl = new THREE.Mesh(new THREE.BoxGeometry(r * 0.38, eng.dia * 0.9, len * 0.46), M.wing);
    pyl.position.set(0, r + eng.dia * 0.40, -len * 0.04);
    g.add(pyl);
    g.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return g;
  }

  /* ───────────────────── 整机 ───────────────────── */

  function build(geo, mission, liveryHex) {
    const lv = PlaneStage.livery(mission, liveryHex);
    const root = new THREE.Group();

    const M = {
      skin: new THREE.MeshPhysicalMaterial({
        map: null, color: 0xffffff, metalness: 0.25, roughness: 0.34,
        clearcoat: 0.6, clearcoatRoughness: 0.22
      }),
      wing: new THREE.MeshPhysicalMaterial({
        color: lv.base, metalness: 0.22, roughness: 0.38, clearcoat: 0.5,
        clearcoatRoughness: 0.25, side: THREE.DoubleSide
      }),
      accent: new THREE.MeshPhysicalMaterial({
        color: lv.accent, metalness: 0.30, roughness: 0.28, clearcoat: 0.7,
        clearcoatRoughness: 0.18, side: THREE.DoubleSide
      }),
      nacF: new THREE.MeshPhysicalMaterial({ color: lv.base, metalness: 0.35, roughness: 0.30, clearcoat: 0.5 }),
      nacR: new THREE.MeshStandardMaterial({ color: 0xB9C2CF, metalness: 0.85, roughness: 0.32 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x131B2A, metalness: 0.6, roughness: 0.42, side: THREE.DoubleSide }),
      fan: new THREE.MeshStandardMaterial({ color: 0x2A3446, metalness: 0.9, roughness: 0.25 })
    };

    const fus = geo.fuselage, wing = geo.wing, ht = geo.htail, vt = geo.vtail;
    const L = fus.length, D = fus.dia;

    // 机身 + 涂装贴图
    const lc = liveryCanvas(geo, lv);
    const tex = new THREE.CanvasTexture(lc.canvas);
    tex.flipY = false;                 // v=0 对应 canvas 顶（机头）
    tex.anisotropy = 8;
    if ('encoding' in tex) tex.encoding = THREE.sRGBEncoding;
    M.skin.map = tex;
    const fmesh = new THREE.Mesh(fuselageGeometry(L, D, fus.nose_len, fus.tail_len), M.skin);
    fmesh.rotation.x = Math.PI / 2;
    fmesh.position.z = -L / 2;
    fmesh.castShadow = true; fmesh.receiveShadow = true;
    fmesh.userData.part = 'fuselage';
    root.add(fmesh);

    // APU 尾锥
    const apu = new THREE.Mesh(new THREE.ConeGeometry(D * 0.20, D * 0.62, 16), M.dark);
    apu.rotation.x = -Math.PI / 2;
    apu.position.set(0, D * 0.06, -L / 2 + D * 0.10);
    root.add(apu);

    // 主翼
    const halfSpan = wing.span / 2;
    const rootLeZ = L / 2 - (wing.root_le_x_frac || 0.42) * L;
    const wcfg = {
      halfSpan: halfSpan, rootChord: wing.root_chord, tipChord: wing.tip_chord,
      tanSweep: Math.tan(wing.sweep_deg * Math.PI / 180),
      dihedral: wing.dihedral_deg, tipStyle: geo.class === 'wide' ? 'raked' : 'plain'
    };
    const wings = new THREE.Group();
    [1, -1].forEach(function (sgn) {
      const m = new THREE.Mesh(stallion(wcfg), M.wing);
      m.scale.x = sgn;
      m.castShadow = true; m.receiveShadow = true;
      wings.add(m);
      const tip = tipDevice(geo.class === 'regional' ? 'fence'
                            : (geo.class === 'narrow' ? 'sharklet' : 'raked'), wcfg, M.accent);
      tip.scale.x = sgn;
      tip.position.z = 0;
      const w = new THREE.Group();
      w.add(m); w.add(tip);
      w.position.set(0, wing.root_z, rootLeZ);
      wings.add(w);
    });
    wings.userData.part = 'wing';
    root.add(wings);

    // 翼身整流罩
    const fair = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), M.skin);
    fair.scale.set(D * 0.60, D * 0.22, wing.root_chord * 0.44);
    fair.position.set(0, wing.root_z + D * 0.02, rootLeZ - wing.root_chord * 0.50);
    fair.castShadow = true;
    root.add(fair);

    // 平尾
    const htLeZ = -L / 2 + L * 0.055;
    const hcfg = {
      halfSpan: ht.span / 2, rootChord: ht.span / 2 * 0.58, tipChord: ht.span / 2 * 0.30,
      tanSweep: Math.tan(ht.sweep_deg * Math.PI / 180), dihedral: 0, tipStyle: 'plain'
    };
    [1, -1].forEach(function (sgn) {
      const m = new THREE.Mesh(stallion(hcfg), M.wing);
      m.scale.x = sgn;
      m.position.set(0, D * 0.10, htLeZ);
      m.castShadow = true;
      root.add(m);
    });

    // 垂尾（水平面绕机身轴立起）
    const vcfg = {
      halfSpan: vt.height, rootChord: vt.height * 0.66, tipChord: vt.height * 0.34,
      tanSweep: Math.tan(vt.sweep_deg * Math.PI / 180), dihedral: 0, tipStyle: 'plain'
    };
    const vmesh = new THREE.Mesh(stallion(vcfg), M.accent);
    vmesh.rotation.z = Math.PI / 2;
    vmesh.position.set(0, D * 0.26, htLeZ + L * 0.012);
    vmesh.castShadow = true;
    root.add(vmesh);

    // 发动机
    const eng = geo.engines;
    const yEng = eng.y_frac * halfSpan;
    const zEng = rootLeZ - yEng * wcfg.tanSweep + eng.dia * 0.85;
    [1, -1].forEach(function (sgn) {
      const e = engineMesh(eng, M);
      e.position.set(sgn * yEng, wing.root_z - eng.dia * 0.28, zEng);
      e.userData.part = 'engine';
      root.add(e);
    });

    root.userData.geo = geo;
    root.userData.materials = M;
    return root;
  }

  function disposeTree(obj) {
    obj.traverse(function (o) {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        ms.forEach(function (m) {
          if (m.map) m.map.dispose();
          m.dispose();
        });
      }
    });
  }

  return { build: build, disposeTree: disposeTree };
})();
