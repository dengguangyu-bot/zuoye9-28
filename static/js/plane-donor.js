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
  const DONOR_URL = './static/models/A320_nologo.glb';
  const DONOR_URL_WIDE = './static/models/A350_nologo.glb';

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
    // 翼尖：展向最外 3% 的顶点平均位置（尺寸标注的引出线从这里拉出）
    const halfSpan = (zh - zl) / 2;
    let tx = 0, ty = 0, tn = 0;
    for (let i = 0; i < p.length; i += 3) {
      if (Math.abs(p[i + 2] - zc) > halfSpan * 0.97) { tx += p[i]; ty += p[i + 1]; tn++; }
    }
    return {
      xNose: xh, xTail: xl, L: L, yc: yc, zc: zc, R: R,
      yMin: yl, yMax: yh, zMin: zl, zMax: zh,
      halfSpan: halfSpan,
      tipX: tn ? tx / tn : xl + L * 0.4, tipY: tn ? ty / tn : yc,
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

  /* 变形的两个基础映射——deform 与 anchors 共用同一份公式，标注才能与网格严格对位 */

  // ① 机身长：smoothstep 高原只作用于 25%–75% 段（客舱插段，A321 之于 A320 的做法）
  function mapLen(m, dL, x) {
    return x - dL * smoothstep(0.25, 0.75, (m.xNose - x) / m.L);
  }

  // ② 翼展：机身处不缩放，向 30% 半展平滑过渡到满缩比（防翼根撕裂）
  function mapSpan(m, spanK, z) {
    const w = smoothstep(0.04, 0.30, Math.abs(z - m.zc) / m.halfSpan);
    return m.zc + (z - m.zc) * (1 + (spanK - 1) * w);
  }

  // 短舱锚点（供体系，取 +z 一侧）：原位 p0 → 经①②搬运后的位置 p1
  function engineAnchor(m, dL, spanK) {
    const y = m.yEngBottom + m.nacR;
    return {
      x0: m.xEng, z0: m.zEng, y: y,
      x1: mapLen(m, dL, m.xEng),
      z1: mapSpan(m, spanK, m.zEng)     // 供体镜像对称（zc≈0），与 ④ 的 |z| 约定一致
    };
  }

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
    // 生长：设计态下机体从机头到机尾占 [xNose−Ltar, xNose]，绕其中心做长度缩放
    const growLen = 0.5 + 0.5 * gLen;
    const cx = m.xNose - Ltar / 2;

    const ea = engineAnchor(m, dL, spanK);

    for (let i = 0; i < src.length; i += 3) {
      const sx = src[i], sy = src[i + 1], sz = src[i + 2];
      let x = mapLen(m, dL, sx), y = sy, z = mapSpan(m, spanK, sz);

      // ③ 机身径：仅机身核心区径向缩放，向整流罩外平滑消失
      let dy = y - m.yc, dz = z - m.zc;
      const r0 = Math.hypot(dy, dz);
      const wDia = smoothstep(m.R * 1.30, m.R * 0.92, r0);
      if (wDia > 0) {
        const k = 1 + (diaK - 1) * wDia;
        y = m.yc + dy * k;
        z = m.zc + dz * k;
      }

      // ④ 发动机：权重在**原始坐标**里判定（①②已把短舱搬走，用搬运后的坐标会
      //    脱离权重场——250 座起短舱不再缩放、反而误伤锚点原位的机翼顶点）；
      //    短舱体随锚点刚性平移后绕簇轴等比缩放，不再被②的展向拉伸压扁
      const dxE = sx - ea.x0;
      const dzE = Math.abs(sz) - ea.z0;
      const wEng = smoothstep(m.nacR * 1.9, m.nacR * 1.0, Math.hypot(dxE, dzE * 0.9));
      if (wEng > 0) {
        const s = Math.sign(sz) || 1;
        const xr = ea.x1 + dxE * engK;
        const yr = ea.y + (sy - ea.y) * engK;
        const zr = s * (ea.z1 + dzE * engK);
        x += (xr - x) * wEng;
        y += (yr - y) * wEng;
        z += (zr - z) * wEng;
      }

      // ⑤ 生长缩放：绕设计态机体中心沿长轴收缩/展开
      x = cx + (x - cx) * growLen;

      dst[i] = x; dst[i + 1] = y; dst[i + 2] = z;
    }
    d.geo.attributes.position.needsUpdate = true;
    d.geo.computeVertexNormals();
    return d.geo;
  }

  /**
   * 尺寸标注锚点（**显示系**：展 X / 高 Y / 长 Z，机头 +Z），设计态（无生长）。
   * 用与 deform 相同的映射解析推出，保证标注落在变形后的网格上，而不是按
   * "机身居中于原点"的假设去猜——底模手术是机头固定、尾部后退，机体并不居中。
   * 显示系 = 供体系绕 Y 轴 −90°：(x, y, z)供体 → (−z, y, x)显示。
   */
  function anchors(geo, cls) {
    const d = donorFor(cls);
    if (!d) return null;
    const m = d.metrics;
    const dL = geo.fuselage.length - m.L;
    const spanK = geo.wing.span / (m.halfSpan * 2);
    const ea = engineAnchor(m, dL, spanK);
    return {
      nose: [0, m.yc, m.xNose],
      tail: [0, m.yc, mapLen(m, dL, m.xTail)],
      axisY: m.yc,
      fusR: geo.fuselage.dia / 2,
      // 右翼尖（显示 +X）；左翼尖为其镜像
      tip: [mapSpan(m, spanK, m.zc + m.halfSpan) - m.zc, m.tipY, mapLen(m, dL, m.tipX)],
      // 右侧短舱中心（显示 +X）
      eng: [ea.z1, ea.y, ea.x1],
      engR: geo.engines.dia / 2
    };
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
    anchors: anchors,        // 尺寸标注锚点（与 deform 同源公式）
    build: build,
    disposeTree: disposeTree,
    isLoaded: isLoaded,
    metrics: metrics
  };
})();
