/* 翼生 WingBorn · 主视图机体渲染（Track A：A320 底模 + 顶点级参数化变形）
 *
 * 06 §3A 落地版。对外 API 与旧参数化渲染保持一致（init / setAircraft /
 * showPlaceholder / resetView / setSpin），另加涂装、标注、就绪与错误回调。
 *
 * 渲染层：plane-stage.js（场景/环境光/地面/标注）
 * 几何层：plane-donor.js（供体载入 + 连续权重场变形，06 §3A.2b）
 */
const PlaneView = (function () {
  'use strict';

  const GROW_MS = 900;                 // 生长动画时长

  let stage = null;
  let root = null, dimsGroup = null, placeholder = null;
  let currentResult = null, currentGeo = null;
  let growState = null;                // { t0 }
  let rafId = null;
  let labelsOn = true;
  let liveryHex = '';
  let spinning = true;
  let spinCb = null, readyCb = null;
  let donorReady = false, donorError = '';
  let pending = null;                  // 供体就绪前收到的渲染请求

  /* ───────────────────────── 空状态占位机 ───────────────────────── */

  function buildPlaceholder() {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0x2C3E5C, wireframe: true,
                                              transparent: true, opacity: .5 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 1.9, 36, 14, 1, true), mat);
    body.rotation.x = Math.PI / 2;
    g.add(body);
    const w = new THREE.Mesh(new THREE.BoxGeometry(34, 0.35, 5.2), mat);
    w.position.set(0, -0.6, 0.5);
    g.add(w);
    const t = new THREE.Mesh(new THREE.BoxGeometry(13, 0.3, 3.4), mat);
    t.position.set(0, 0.8, -15.5);
    g.add(t);
    const v = new THREE.Mesh(new THREE.BoxGeometry(0.3, 6.5, 4.4), mat);
    v.position.set(0, 15 - 11, -15.5);
    g.add(v);
    return g;
  }

  /* ───────────────────────── 取景 ───────────────────────── */

  function frameRadius(geo) {
    const L = geo.fuselage.length, span = geo.wing.span;
    return Math.sqrt(Math.pow(L / 2, 2) + Math.pow(span / 2, 2));
  }

  function frameCamera(geo, opts) {
    opts = opts || {};
    const dist = Math.max(frameRadius(geo) * 2.28, 42);
    if (opts.keepAngles && stage.camera.position.length() > 0) {
      const d = stage.camera.position.clone().normalize().multiplyScalar(dist);
      stage.camera.position.copy(d);
      stage.controls.target.set(0, 0, 0);
      stage.controls.update();
    } else {
      stage.cameraAt(38, 16, dist);
    }
  }

  /* ───────────────────────── 生长动画 ───────────────────────── */

  const ease = function (x) { return 1 - Math.pow(1 - x, 3); };
  const seg = function (t, a, b) {
    return Math.max(0, Math.min(1, (t - a) / (b - a)));
  };

  function growthParams(t) {
    return {
      len: ease(seg(t, 0.00, 0.55)),
      span: ease(seg(t, 0.28, 0.78)),
      eng: ease(seg(t, 0.62, 1.00))
    };
  }

  function stepGrowth() {
    const t = Math.min(1, (performance.now() - growState.t0) / GROW_MS);
    PlaneDonor.deform(currentGeo, growthParams(t), currentResult.class);
    if (t >= 1) growState = null;
  }

  /* ───────────────────────── 机体切换 ───────────────────────── */

  function clearAircraft() {
    if (root) { stage.content.remove(root); root = null; }
    if (dimsGroup) { stage.content.remove(dimsGroup); disposeLabels(dimsGroup); dimsGroup = null; }
  }

  function disposeLabels(g) {
    g.traverse(function (o) {
      if (o.isCSS2DObject && o.element && o.element.parentNode) {
        o.element.parentNode.removeChild(o.element);
      }
    });
  }

  function apply(result, opts) {
    opts = opts || {};
    const geo = result.geometry;
    currentResult = result;
    currentGeo = geo;
    if (opts.liveryHex !== undefined) liveryHex = opts.liveryHex;

    clearAircraft();
    if (placeholder) placeholder.visible = false;

    root = PlaneDonor.build(geo, result.mission, liveryHex, null, result.class);
    if (!root) return;
    stage.content.add(root);

    // §3A.4 计算标注（数值直接取引擎输出，随滑杆实时重算）
    // 锚点取自底模手术的同源映射——机体不居中，不能按参数公式猜位置
    dimsGroup = PlaneStage.dimensions(geo, PlaneDonor.anchors(geo, result.class));
    dimsGroup.visible = labelsOn;
    stage.content.add(dimsGroup);

    stage.fitTo(geo.fuselage.length, geo.wing.span);

    if (opts.grow) {
      growState = { t0: performance.now() };
      PlaneDonor.deform(geo, growthParams(0), result.class);
    } else {
      growState = null;
      PlaneDonor.deform(geo, null, result.class);
    }
    if (opts.reframe !== false) frameCamera(geo, { keepAngles: !!opts.keepAngles });
  }

  /* ───────────────────────── 对外接口 ───────────────────────── */

  function init(canvas) {
    if (stage) return;
    stage = PlaneStage.stage(canvas, {});
    stage.controls.autoRotate = true;
    stage.controls.autoRotateSpeed = 0.4;
    // 空闲缓转：用户一拖就停（保留手动开关）
    stage.controls.addEventListener('start', function () {
      if (stage.controls.autoRotate) setSpin(false);
    });

    placeholder = buildPlaceholder();
    stage.content.add(placeholder);

    (function loop() {
      rafId = requestAnimationFrame(loop);
      if (growState && currentGeo) stepGrowth();
      stage.render();
    })();

    PlaneDonor.load(PlaneDonor.DONOR_URL).then(function () {
      donorReady = true;
      if (pending) { const p = pending; pending = null; apply(p.result, p.opts); }
      if (readyCb) readyCb('');
    }, function (e) {
      donorError = (e && e.message) ? e.message : String(e);
      if (readyCb) readyCb(donorError);
    });
  }

  function setAircraft(result, opts) {
    if (!donorReady) { pending = { result: result, opts: opts || {} }; return; }
    if (donorError) return;
    apply(result, opts || {});
  }

  function showPlaceholder() {
    clearAircraft();
    currentResult = currentGeo = null;
    if (placeholder) placeholder.visible = true;
  }

  function resetView() {
    if (currentGeo) frameCamera(currentGeo, {});
    else stage.cameraAt(38, 16, 70);
  }

  function setCamera(az, el, dist) {
    stage.cameraAt(az, el, dist);
  }

  function setSpin(on) {
    spinning = !!on;
    stage.controls.autoRotate = spinning;
    if (spinCb) spinCb(spinning);
  }

  function setLabels(on) {
    labelsOn = !!on;
    if (dimsGroup) dimsGroup.visible = labelsOn;
  }

  function setLivery(hex) {
    liveryHex = hex || '';
    if (currentResult && donorReady) apply(currentResult, { reframe: false });
  }

  function isReady() { return donorReady; }
  function error() { return donorError; }
  function onReady(fn) { readyCb = fn; if (donorReady || donorError) fn(donorError); }
  function setSpinCallback(fn) { spinCb = fn; }

  return {
    init: init,
    setAircraft: setAircraft,
    showPlaceholder: showPlaceholder,
    resetView: resetView,
    setCamera: setCamera,
    setSpin: setSpin,
    setLabels: setLabels,
    setLivery: setLivery,
    isReady: isReady,
    error: error,
    onReady: onReady,
    setSpinCallback: setSpinCallback
  };
})();
