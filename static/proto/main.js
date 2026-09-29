/* G7 样机主控 —— 三轨共用同一套相机参数与设计输入，保证"同机位"可比。
 *
 * URL 参数：
 *   variant=v1|a|b   轨道（v1=现状基线，a=底模手术，b=参数化放样）
 *   pax/range/mach   设计输入（默认 180 座 / 5500 km / M0.78）
 *   az/el/dist       相机（方位角/仰角/距离，米）——三页传同一组值即同机位
 *   livery=#rrggbb   涂装主色（省略则按 mission 哈希生成）
 *   dims=0           关闭 §3A.4 计算标注
 */
(function () {
  'use strict';

  const q = new URLSearchParams(location.search);
  const variant = (q.get('variant') || 'b').toLowerCase();
  const mission = {
    pax: parseInt(q.get('pax') || '180', 10),
    range_km: parseFloat(q.get('range') || '5500'),
    mach: parseFloat(q.get('mach') || '0.78')
  };
  const az = q.get('az') !== null ? parseFloat(q.get('az')) : 38;
  const el = q.get('el') !== null ? parseFloat(q.get('el')) : 16;
  const distParam = q.get('dist') !== null ? parseFloat(q.get('dist')) : 0;
  const liveryHex = q.get('livery') || '';
  const showDims = q.get('dims') !== '0';

  const TAGS = { v1: 'v1 现状基线', a: 'Track A · 底模手术', b: 'Track B · 参数化放样' };
  document.getElementById('tag').textContent = TAGS[variant] || variant;

  const view = document.getElementById('view');
  const canvas = document.createElement('canvas');
  view.appendChild(canvas);

  function fail(msg) {
    document.getElementById('err').textContent = String(msg);
    window.__protoError = String(msg);
    window.__protoReady = true;
  }

  function frameRadius(geo) {
    const L = geo.fuselage.length, span = geo.wing.span;
    return Math.sqrt(Math.pow(L / 2, 2) + Math.pow(span / 2, 2));
  }

  fetch('/api/design', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(mission)
  }).then(function (r) { return r.json(); }).then(function (res) {
    if (res.error) { fail(res.error); return; }
    const geo = res.geometry;
    const dist = distParam || Math.max(frameRadius(geo) * 2.55, 46);

    if (variant === 'v1') {
      // 现状基线：完全沿用 three-plane.js 的现有渲染（无阴影/无环境反射/无标注）
      PlaneView.init(canvas);
      PlaneView.setAircraft(res.geometry, { grow: false });
      PlaneView.setCamera(az, el, dist);
      window.__protoReady = true;
      window.__protoInfo = { variant: variant, dist: dist, design: res.mission };
      return;
    }

    const st = PlaneStage.stage(canvas, {});
    st.fitTo(geo.fuselage.length, geo.wing.span);

    let root = null;
    const emit = function () {
      if (root) { st.content.remove(root); (variant === 'a' ? PlaneDonor : TrackB).disposeTree(root); }
      root = variant === 'a' ? PlaneDonor.build(geo, res.mission, liveryHex, null, res.class)
                             : TrackB.build(geo, res.mission, liveryHex);
      if (!root) { fail('构建失败（' + variant + '）'); return; }
      st.content.add(root);
      if (showDims) st.content.add(PlaneStage.dimensions(geo,
        variant === 'a' ? PlaneDonor.anchors(geo, res.class) : null));
    };

    const finish = function () {
      st.cameraAt(az, el, dist);
      emit();
      (function loop() { requestAnimationFrame(loop); st.render(); })();
      // 等一帧确保 CSS2D 标注已定位
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          window.__protoReady = true;
          window.__protoInfo = { variant: variant, dist: dist, design: res.mission };
        });
      });
    };

    if (variant === 'a') {
      PlaneDonor.load(PlaneDonor.DONOR_URL).then(finish, function (e) {
        fail('供体载入失败：' + (e && e.message ? e.message : e));
      });
    } else {
      finish();
    }
  }).catch(fail);
})();
