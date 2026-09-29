/* 翼生 WingBorn · 机体渲染 —— A320 底模顶点级网格手术（06 §3A.2b 路径②）
 *
 * 供体：static/models/A320_nologo.glb（amvlab/aircraft-models, CC BY 4.0）
 *
 * 关键事实（由 tools/axis_probe.py + tools/donor_metrics.py 实测，与 06 §3A.2b 的
 * 描述不同——那里说的"长轴=Z、展向=Y、高=X"来自把 AABB 角点过旋转的失真结果）：
 *   节点带旋转四元数 q=[0.5,0.5,-0.5,0.5]，应用后**世界系**为
 *     X = 机身长（机头在 +X）   Y = 高度   Z = 展向
 *   判定依据：Z 两端 3% 截面完全相同（2.60×2.31 薄翼尖）；X.min 端 Y 幅 7.09（垂尾）、
 *   X.max 端收敛（机头）。
 *
 * 变形采用**平滑权重场**而非硬分区：整机仅 4628 顶点（垂尾只有 84 个），
 * 硬分类会在翼根/短舱接缝处撕裂。每顶点权重由位置连续推出，全量重算（非增量修补）。
 *
 * 显示时整体绕 Y 轴 −90°，得到约定系（展 X / 高 Y / 长 Z，机头 +Z）。
 */
const PlaneDonor = (function () {
  'use strict';

  // 按座级选供体：A320 供窄体/支线；宽体换 A350——单通道底模硬撑到 300 座会变成
  // "拉长的 A320"（机身直径放大但机头/驾驶舱窗/舱门仍是单通道布局），失真肉眼可辨。
  // 两个供体的世界轴序一致（均为 X=机身长(机头+X)、Y=高、Z=展向，见 tools/axis_probe.py），
  // 故走完全相同的归一化与变形路径。
  const DONOR_URL = '/static/models/A320_nologo.glb';
  const DONOR_URL_WIDE = '/static/models/A350_nologo.glb';

  let donor = null;            // 默认供体（A320）
  let donorWide = null;        // 宽体供体（A350）；载入失败则退回默认供体

  function donorFor(cls) {
    return (cls === 'wide' && donorWide) ? donorWide : donor;
  }

  /* ───────────────────── 载入与归一化 ───────────────────── */

  function bakeWorldTransform(scene) {
    scene.updateMatrixWorld(true);
    const parts = [];
    scene.traverse(function (o) {
      if (!o.isMesh || !o.geometry) return;
      const g = o.geometry.clone();
      g.applyMatrix4(o.matrixWorld);
      parts.push({ geo: g, mat: o.material });
    });
    if (!parts.length) throw new Error('供体无 mesh');
    // 合并成一个 BufferGeometry（A320 只有一个 primitive，这里做通用处理）
    let n = 0, idxCount = 0;
    parts.forEach(function (p) {
      n += p.geo.attributes.position.count;
      idxCount += p.geo.index ? p.geo.index.count : p.geo.attributes.position.count;
    });
    const pos = new Float32Array(n * 3);
    const uv = new Float32Array(n * 2);
    const idx = new Uint32Array(idxCount);
    const uvAttr = parts[0].geo.attributes.uv;
    let vo = 0, io = 0;
    parts.forEach(function (p) {
      const pa = p.geo.attributes.position;
      const ua = p.geo.attributes.uv || uvAttr;
      pos.set(pa.array.subarray(0, pa.count * 3), vo * 3);
      if (ua) uv.set(ua.array.subarray(0, pa.count * 2), vo * 2);
      const ia = p.geo.index;
      if (ia) {
        for (let i = 0; i < ia.count; i++) idx[io + i] = ia.getX(i) + vo;
        io += ia.count;
      } else {
        for (let i = 0; i < pa.count; i++) idx[io + i] = vo + i;
        io += pa.count;
      }
      vo += pa.count;
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    if (uvAttr) geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    return { geo: geo, mat: parts[0].mat };
  }

  function measure(geo) {
    const p = geo.attributes.position.array;
    let xl = Infinity, xh = -Infinity, yl = Infinity, yh = -Infinity;
    let zl = Infinity, zh = -Infinity, lowY = Infinity, lowX = 0, lowZ = 0;
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i], y = p[i + 1], z = p[i + 2];
      if (x < xl) xl = x; if (x > xh) xh = x;
      if (y < yl) yl = y; if (y > yh) yh = y;
      if (z < zl) zl = z; if (z > zh) zh = z;
      if (y < lowY) { lowY = y; lowX = x; lowZ = Math.abs(z); }
    }
    const L = xh - xl;
    // 机身轴线（Y、Z）与半径：机身中段、靠近轴线的顶点环
    const zc = (zl + zh) / 2;
    let R = (yh - yl) * 0.18, yc = 0;
    for (let k = 0; k < 6; k++) {
      let a = Infinity, b = -Infinity, cnt = 0;
      for (let i = 0; i < p.length; i += 3) {
        const x = p[i], y = p[i + 1], z = p[i + 2];
        if (x > xl + L * 0.38 && x < xl + L * 0.62 && Math.abs(z - zc) < R) {
          if (y < a) a = y; if (y > b) b = y; cnt++;
        }
      }
      if (!cnt) break;
      yc = (a + b) / 2; R = (b - a) / 2;
    }
    return {
      xNose: xh, xTail: xl, L: L, yc: yc, zc: zc, R: R,
      yMin: yl, yMax: yh, zMin: zl, zMax: zh,
      halfSpan: (zh - zl) / 2,
      // 短舱锚点：全局最低点即短舱底部
      xEng: lowX, zEng: lowZ, yEngBottom: lowY,
      nacR: R * 0.55
    };
  }

  function loadOne(url) {
    return new Promise(function (resolve, reject) {
      new THREE.GLTFLoader().load(url, function (gltf) {
        try {
          const merged = bakeWorldTransform(gltf.scene);
          const m = measure(merged.geo);
          resolve({
            geo: merged.geo, mat: merged.mat,
            pristine: Float32Array.from(merged.geo.attributes.position.array),
            n: merged.geo.attributes.position.count, metrics: m
          });
        } catch (e) { reject(e); }
      }, undefined, reject);
    });
  }

  /** 载入默认供体（必须成功）与宽体供体（失败只告警，退回默认）。 */
  function load() {
    return loadOne(DONOR_URL).then(function (d) {
      donor = d;
      return loadOne(DONOR_URL_WIDE).then(function (w) {
        donorWide = w;
        return { default: d.metrics, wide: w.metrics };
      }, function () {
        return { default: d.metrics, wide: null };   // 宽体供体缺失 → 退回 A320
      });
    });
  }

  /* ───────────────────── 变形（全量重算）───────────────────── */

  const smoothstep = function (a, b, x) {
    if (a === b) return x < a ? 0 : 1;
    let t = (x - a) / (b - a);
    t = Math.max(0, Math.min(1, t));
    return t * t * (3 - 2 * t);
  };

  /**
   * 按引擎参数重算全部顶点。geo 为 engine.design() 的 geometry 子字典。
   * grow 为生长动画参数（缺省 1 = 设计态）：
   *   len  机身长度占比（0.5 = 半长）    span 翼展占比（0 = 翼未展开）    eng 发动机占比
   * 顺序：机身长（客舱插段）→ 翼展 → 机身径 → 发动机 → 生长缩放。
   */
  function deform(geo, grow, cls) {
    const d = donorFor(cls);
    if (!d) return null;
    const g = grow || {};
    const gLen = g.len === undefined ? 1 : g.len;
    const gSpan = g.span === undefined ? 1 : g.span;
    const gEng = g.eng === undefined ? 1 : g.eng;

    const m = d.metrics;
    const src = d.pristine;
    const dst = d.geo.attributes.position.array;

    const Ltar = geo.fuselage.length;
    const dTar = geo.fuselage.dia;
    const spanTar = geo.wing.span;

    const dL = Ltar - m.L;                       // 机头固定、尾部后退的量
    const spanK = (spanTar / (m.halfSpan * 2)) * gSpan;
    const diaK = dTar / (m.R * 2);
    const engK = (geo.engines.dia / (m.nacR * 2)) * gEng;
    const halfD = m.halfSpan;
    // 生长：设计态下机体从机头到机尾占 [xNose−Ltar, xNose]，绕其中心做长度缩放
    const growLen = 0.5 + 0.5 * gLen;
    const cx = m.xNose - Ltar / 2;

    for (let i = 0; i < src.length; i += 3) {
      let x = src[i], y = src[i + 1], z = src[i + 2];

      // ① 机身长：smoothstep 高原只作用于 25%–75% 段（客舱插段，A321 之于 A320 的做法）
      const sn = (m.xNose - x) / m.L;             // 0 机头 → 1 尾
      x -= dL * smoothstep(0.25, 0.75, sn);

      // ② 翼展：机身处不缩放，向 30% 半展平滑过渡到满缩比（防翼根撕裂）
      const sf = Math.abs(z - m.zc) / halfD;
      const wSpan = smoothstep(0.04, 0.30, sf);
      z = m.zc + (z - m.zc) * (1 + (spanK - 1) * wSpan);

      // ③ 机身径：仅机身核心区径向缩放，向整流罩外平滑消失
      let dy = y - m.yc, dz = z - m.zc;
      const r0 = Math.hypot(dy, dz);
      const wDia = smoothstep(m.R * 1.30, m.R * 0.92, r0);
      if (wDia > 0) {
        const k = 1 + (diaK - 1) * wDia;
        y = m.yc + dy * k;
        z = m.zc + dz * k;
      }

      // ④ 发动机：短舱簇内绕簇轴等比缩放
      const dxE = x - m.xEng;
      const dzE = Math.abs(z) - m.zEng;
      const dE = Math.hypot(dxE, dzE * 0.9);
      const wEng = smoothstep(m.nacR * 1.9, m.nacR * 1.0, dE);
      if (wEng > 0) {
        const k = 1 + (engK - 1) * wEng;
        x = m.xEng + dxE * k;
        y = m.yEngBottom + m.nacR + (y - (m.yEngBottom + m.nacR)) * k;
        z = Math.sign(z) * (m.zEng + dzE * k);
      }

      // ⑤ 生长缩放：绕设计态机体中心沿长轴收缩/展开
      x = cx + (x - cx) * growLen;

      dst[i] = x; dst[i + 1] = y; dst[i + 2] = z;
    }
    d.geo.attributes.position.needsUpdate = true;
    d.geo.computeVertexNormals();
    return d.geo;
  }

  /* ───────────────────── 材质（§3A.3 tint）───────────────────── */

  const matCache = {};        // key = 供体键 + 涂装色

  function makeMaterial(lv, d, key) {
    const ck = key + '|' + lv.hex;
    if (matCache[ck]) return matCache[ck];
    const src = d.mat;
    const mat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff, metalness: 0.22, roughness: 0.36,
      clearcoat: 0.55, clearcoatRoughness: 0.25
    });
    const map0 = Array.isArray(src) ? src[0].map : src.map;
    if (map0 && map0.image) {
      // 底模贴图烧死航司涂装：先按色相重映射再当基色，tint 才干净
      const cv = PlaneStage.recolorTexture(map0.image, lv.hue);
      const tex = new THREE.CanvasTexture(cv);
      tex.flipY = map0.flipY;
      tex.anisotropy = 8;
      if ('encoding' in tex) tex.encoding = THREE.sRGBEncoding;
      mat.map = tex;
    } else {
      mat.color = lv.base;
    }
    matCache[ck] = mat;
    return mat;
  }

  function build(geo, mission, liveryHex, grow, cls) {
    const d = donorFor(cls);
    if (!d) return null;
    const lv = PlaneStage.livery(mission, liveryHex);
    const g = deform(geo, grow, cls);
    if (!g) return null;
    const mesh = new THREE.Mesh(g, makeMaterial(lv, d, d === donorWide ? 'wide' : 'def'));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const root = new THREE.Group();
    root.add(mesh);
    // 归一化轴序：长(X)→Z、展(Z)→X、高(Y)→Y ⇒ 绕 Y 轴 −90°
    root.rotation.y = -Math.PI / 2;
    root.userData.geo = geo;
    root.userData.donorMetrics = d.metrics;
    return root;
  }

  function disposeTree(obj) {
    obj.traverse(function (o) {
      if (o.material) {
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        ms.forEach(function (mm) { if (mm.map) mm.map.dispose(); mm.dispose(); });
      }
    });
  }

  // 供体几何是共享的（每次 deform 就地重算），不可随场景销毁
  function isLoaded() { return !!donor; }
  function metrics(cls) { const d = donorFor(cls); return d ? d.metrics : null; }

  return {
    DONOR_URL: DONOR_URL,
    DONOR_URL_WIDE: DONOR_URL_WIDE,
    load: load,
    deform: deform,          // 主应用生长动画直接调用（逐帧传生长参数）
    build: build,
    disposeTree: disposeTree,
    isLoaded: isLoaded,
    metrics: metrics
  };
})();
