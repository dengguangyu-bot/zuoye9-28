/* WingBorn GitHub Pages adapter.
 *
 * GitHub Pages serves only static files. This file mirrors the Flask API in the
 * browser so the same Vue app can run without Python: calculation happens in
 * JavaScript, and the hangar is stored in localStorage.
 */
(function () {
  'use strict';

  const STORE_KEY = 'wingborn.static.designs.v1';
  const VERSION = '1.0.0+g7-static';
  const G = 9.81;
  const A_CRUISE = 295.0;
  const CLASS_BOUNDS = [125, 260];
  const CLASS_PARAMS = {
    regional: {
      label: '支线', k_ld: 5.0, tsfc: 16.50, we_w0_base: 0.5880,
      we_w0_ref_kg: 40000.0, size_exp: -0.180, ws: 510.0, tw: 0.33,
      ar: 8.8, pitch_m: 0.76, rows_factor: 1.00, taper: 0.32
    },
    narrow: {
      label: '窄体', k_ld: 5.7, tsfc: 17.80, we_w0_base: 0.5210,
      we_w0_ref_kg: 80000.0, size_exp: -0.180, ws: 620.0, tw: 0.31,
      ar: 9.5, pitch_m: 0.79, rows_factor: 1.00, taper: 0.24
    },
    wide: {
      label: '宽体', k_ld: 6.1, tsfc: 13.00, we_w0_base: 0.5450,
      we_w0_ref_kg: 250000.0, size_exp: -0.180, ws: 660.0, tw: 0.27,
      ar: 10.5, pitch_m: 0.84, rows_factor: 1.10, taper: 0.20
    }
  };

  const AIRCRAFT = [
    { name: 'ARJ21-700', cls: 'regional', pax: 78, range_km: 2225, mach: 0.78, mtow_kg: 40500, oew_kg: 24800, s_m2: 79.9, span_m: 27.3, length_m: 33.5, dia_m: 3.2, thrust_kn: 137.0 },
    { name: 'CRJ900', cls: 'regional', pax: 90, range_km: 2871, mach: 0.78, mtow_kg: 38330, oew_kg: 21500, s_m2: 77.4, span_m: 24.9, length_m: 36.4, dia_m: 2.7, thrust_kn: 121.0 },
    { name: 'E190', cls: 'regional', pax: 100, range_km: 4500, mach: 0.78, mtow_kg: 51800, oew_kg: 29000, s_m2: 92.3, span_m: 28.7, length_m: 36.2, dia_m: 3.1, thrust_kn: 160.0 },
    { name: 'E195-E2', cls: 'regional', pax: 135, range_km: 4800, mach: 0.78, mtow_kg: 61500, oew_kg: 35100, s_m2: 100.0, span_m: 35.1, length_m: 41.5, dia_m: 3.1, thrust_kn: 205.0 },
    { name: 'A220-300', cls: 'regional', pax: 130, range_km: 6200, mach: 0.78, mtow_kg: 67600, oew_kg: 37100, s_m2: 115.8, span_m: 35.1, length_m: 38.7, dia_m: 3.4, thrust_kn: 207.0 },
    { name: '737-800', cls: 'narrow', pax: 162, range_km: 5765, mach: 0.785, mtow_kg: 79010, oew_kg: 41400, s_m2: 125.0, span_m: 35.8, length_m: 39.5, dia_m: 3.8, thrust_kn: 243.0 },
    { name: 'A320ceo', cls: 'narrow', pax: 150, range_km: 6100, mach: 0.78, mtow_kg: 78000, oew_kg: 42400, s_m2: 122.6, span_m: 34.1, length_m: 37.6, dia_m: 4.0, thrust_kn: 222.0 },
    { name: 'C919', cls: 'narrow', pax: 158, range_km: 4500, mach: 0.785, mtow_kg: 72500, oew_kg: 42000, s_m2: 122.6, span_m: 35.8, length_m: 38.9, dia_m: 4.0, thrust_kn: 260.0 },
    { name: 'A321neo', cls: 'narrow', pax: 200, range_km: 6300, mach: 0.78, mtow_kg: 93500, oew_kg: 50100, s_m2: 122.6, span_m: 35.8, length_m: 44.5, dia_m: 4.0, thrust_kn: 286.0 },
    { name: '757-200', cls: 'narrow', pax: 200, range_km: 7222, mach: 0.80, mtow_kg: 115660, oew_kg: 64500, s_m2: 185.0, span_m: 38.0, length_m: 47.3, dia_m: 3.8, thrust_kn: 364.0 },
    { name: 'A330-300', cls: 'wide', pax: 277, range_km: 11750, mach: 0.82, mtow_kg: 233000, oew_kg: 124500, s_m2: 361.1, span_m: 60.3, length_m: 63.7, dia_m: 5.6, thrust_kn: 623.0 },
    { name: '787-9', cls: 'wide', pax: 293, range_km: 14140, mach: 0.85, mtow_kg: 254000, oew_kg: 128800, s_m2: 360.5, span_m: 60.1, length_m: 62.8, dia_m: 5.7, thrust_kn: 668.0 },
    { name: 'A350-900', cls: 'wide', pax: 325, range_km: 15000, mach: 0.85, mtow_kg: 280000, oew_kg: 142400, s_m2: 442.5, span_m: 64.8, length_m: 66.8, dia_m: 6.0, thrust_kn: 747.0 },
    { name: '777-300ER', cls: 'wide', pax: 396, range_km: 13650, mach: 0.84, mtow_kg: 351530, oew_kg: 167800, s_m2: 464.5, span_m: 64.8, length_m: 73.9, dia_m: 6.2, thrust_kn: 1023.0 }
  ];

  function round(x, n) {
    const k = Math.pow(10, n || 0);
    return Math.round((x + Number.EPSILON) * k) / k;
  }

  function classify(pax) {
    if (pax <= CLASS_BOUNDS[0]) return 'regional';
    if (pax <= CLASS_BOUNDS[1]) return 'narrow';
    return 'wide';
  }

  function abreastOf(cls, pax) {
    if (cls === 'regional') return pax < 90 ? 4 : 5;
    if (cls === 'narrow') return 6;
    if (pax <= 280) return 8;
    if (pax <= 340) return 9;
    return 10;
  }

  function inputError(message) {
    const e = new Error(message);
    e.kind = 'input';
    return e;
  }

  function infeasible(message) {
    const e = new Error(message);
    e.kind = 'infeasible';
    return e;
  }

  function validate(pax, rangeKm, mach) {
    const p = Number(pax);
    if (!Number.isInteger(p)) throw inputError('旅客数必须是整数');
    if (p < 30 || p > 900) throw inputError('旅客数请在 30–900 之间');
    const r = Number(rangeKm);
    const m = Number(mach);
    if (!Number.isFinite(r) || !Number.isFinite(m)) throw inputError('航程与马赫数必须是数字');
    if (r < 500 || r > 16000) throw inputError('航程请在 500–16000 km 之间');
    if (m < 0.40 || m > 0.95) throw inputError('巡航马赫数请在 0.40–0.95 之间');
    return { pax: p, range_km: r, mach: m };
  }

  function payloadAndCrew(pax) {
    return {
      payload: pax * 95.0,
      crew: 180.0 + 75.0 * Math.ceil(pax / 50)
    };
  }

  function fuelFraction(rangeKm, mach, cp) {
    const v = mach * A_CRUISE;
    const ld = Math.min(Math.max(cp.k_ld * Math.sqrt(cp.ar), 14.0), 20.5);
    const tsfcSi = cp.tsfc * 1e-6;
    const hM = v * ld / (G * tsfcSi);
    const rEff = rangeKm + Math.max(1200.0, 0.10 * rangeKm);
    const fFuel = 1.0 - 0.975 * Math.exp(-rEff / (hM / 1000.0));
    return { fFuel, ld, hKm: hM / 1000.0, rEff, reserveKm: rEff - rangeKm, vCruiseMs: v };
  }

  function sizeAircraft(pax0, range0, mach0) {
    const v = validate(pax0, range0, mach0);
    const cls = classify(v.pax);
    const cp = CLASS_PARAMS[cls];
    const fixed = payloadAndCrew(v.pax);
    const wFixed = fixed.payload + fixed.crew;
    const fuel = fuelFraction(v.range_km, v.mach, cp);
    const sizeExp = cp.size_exp;
    const denom0 = 1.0 - fuel.fFuel - cp.we_w0_base;
    let w0 = denom0 > 0.05 ? wFixed / denom0 : 3.2 * wFixed;
    const convergence = [{ i: 0, w0: round(w0, 1) }];
    let weOverW0 = null;
    let converged = false;
    for (let i = 1; i <= 50; i++) {
      weOverW0 = cp.we_w0_base * Math.pow(w0 / cp.we_w0_ref_kg, sizeExp);
      const denom = 1.0 - fuel.fFuel - weOverW0;
      if (denom <= 0.0) {
        throw infeasible('该航程超出' + cp.label + '座级技术上限，请缩短航程或减少旅客');
      }
      const raw = wFixed / denom;
      let step = 0.5 * (raw - w0);
      const limit = 0.30 * w0;
      if (step > limit) step = limit;
      if (step < -limit) step = -limit;
      w0 += step;
      convergence.push({ i, w0: round(w0, 1) });
      if (Math.abs(step) < 1.0) {
        converged = true;
        break;
      }
    }
    if (!converged) throw infeasible('重量迭代未收敛，请调整需求');
    if (fuel.fFuel + weOverW0 > 0.93) {
      throw infeasible('该航程超出' + cp.label + '座级技术上限，请缩短航程或减少旅客');
    }
    return {
      class: cls,
      class_label: cp.label,
      mission: { pax: v.pax, range_km: round(v.range_km, 1), mach: round(v.mach, 3) },
      convergence,
      iterations: convergence.length - 1,
      weights: {
        mtow_kg: round(w0, 1),
        oew_kg: round(weOverW0 * w0, 1),
        fuel_kg: round(fuel.fFuel * w0, 1),
        payload_kg: round(fixed.payload, 1),
        crew_kg: round(fixed.crew, 1),
        we_over_w0: round(weOverW0, 4),
        fuel_fraction: round(fuel.fFuel, 4)
      },
      factors: {
        ld: round(fuel.ld, 2),
        h_km: round(fuel.hKm, 1),
        r_eff_km: round(fuel.rEff, 1),
        reserve_km: round(fuel.reserveKm, 1),
        v_cruise_ms: round(fuel.vCruiseMs, 1),
        ar: cp.ar,
        ws: cp.ws,
        tw: cp.tw,
        tsfc: cp.tsfc,
        k_ld: cp.k_ld,
        we_w0_base: cp.we_w0_base,
        size_exp: sizeExp
      }
    };
  }

  function layout(weights, pax, mach, cls) {
    const cp = CLASS_PARAMS[cls];
    const w0 = weights.mtow_kg;
    const abreast = abreastOf(cls, pax);
    const dFus = 0.52 * abreast + 1.1;
    const rows = Math.ceil(pax * cp.rows_factor / abreast);
    const lFus = rows * cp.pitch_m + 3.5 + 3.3 * dFus;
    const sWing = w0 / cp.ws;
    const span = Math.sqrt(cp.ar * sWing);
    const cRoot = 2.0 * sWing / (span * (1.0 + cp.taper));
    const cTip = cRoot * cp.taper;
    const cMac = (2.0 / 3.0) * cRoot * (1.0 + cp.taper + cp.taper * cp.taper) / (1.0 + cp.taper);
    const sweep = Math.min(Math.max(25.0 + (mach - 0.78) * 100.0, 10.0), 38.0);
    const armH = 0.46 * lFus;
    const armV = 0.47 * lFus;
    const sHtail = 1.05 * sWing * cMac / armH;
    const sVtail = 0.08 * sWing * span / armV;
    const htailSpan = Math.sqrt(4.5 * sHtail);
    const vtailHeight = Math.sqrt(1.8 * sVtail);
    const tailSweep = Math.min(Math.max(30.0 + (mach - 0.78) * 60.0, 10.0), 38.0);
    const thrustTotal = cp.tw * w0 * 9.81 / 1000.0;
    const thrustEach = thrustTotal / 2.0;
    const dEng = 1.5 + thrustEach / 200.0;
    const yEng = 0.35 * (span / 2.0);
    const wingRootLeX = 0.42 * lFus;
    const wingLeAtY = wingRootLeX + yEng * Math.tan(sweep * Math.PI / 180);
    const engX = wingLeAtY - 0.90 * dEng;
    return {
      fuselage: {
        length: round(lFus, 2),
        dia: round(dFus, 2),
        nose_len: round(1.3 * dFus, 2),
        tail_len: round(2.6 * dFus, 2),
        rows,
        abreast,
        pitch_m: cp.pitch_m
      },
      wing: {
        area_m2: round(sWing, 1),
        span: round(span, 2),
        root_chord: round(cRoot, 2),
        tip_chord: round(cTip, 2),
        taper: cp.taper,
        mac: round(cMac, 2),
        sweep_deg: round(sweep, 1),
        dihedral_deg: 5.0,
        thickness_ratio: 0.11,
        aspect_ratio: cp.ar,
        loading_kg_m2: round(cp.ws, 1),
        root_z: round(-0.35 * dFus, 2),
        root_le_x_frac: 0.42
      },
      htail: {
        area_m2: round(sHtail, 1),
        arm: round(armH, 2),
        span: round(htailSpan, 2),
        sweep_deg: round(tailSweep, 1),
        volume_coeff: 1.05
      },
      vtail: {
        area_m2: round(sVtail, 1),
        arm: round(armV, 2),
        height: round(vtailHeight, 2),
        sweep_deg: round(tailSweep, 1),
        volume_coeff: 0.08
      },
      engines: {
        count: 2,
        thrust_kn: round(thrustEach, 1),
        thrust_total_kn: round(thrustTotal, 1),
        dia: round(dEng, 2),
        x_frac: round(engX / lFus, 4),
        y_frac: 0.35,
        mount: '翼吊'
      },
      wing_area_m2: round(sWing, 1),
      span_m: round(span, 2),
      length_m: round(lFus, 2),
      fuselage_dia_m: round(dFus, 2),
      thrust_total_kn: round(thrustTotal, 1)
    };
  }

  function performance(weights, geometry, mission, factors) {
    const ws = geometry.wing.loading_kg_m2;
    const tw = factors.tw;
    const reserveRatio = factors.reserve_km / factors.r_eff_km;
    const tripFuelKg = weights.fuel_fraction * weights.mtow_kg / (1.0 + reserveRatio);
    return {
      takeoff_field_m: round(1.50 * ws / (1.64 * tw), 1),
      landing_field_m: round(8.0 * (0.85 * ws) / 2.8, 1),
      trip_fuel_kg: round(tripFuelKg, 1),
      fuel_per_pax_100km_l: round((tripFuelKg / 0.8) / (mission.pax * mission.range_km) * 100.0, 2),
      fuel_per_pax_km_g: round(tripFuelKg / (mission.pax * mission.range_km) * 1000.0, 1),
      cruise_speed_kmh: round(mission.mach * 295.0 * 3.6, 1),
      cruise_alt_km: 11.0,
      thrust_to_weight: tw
    };
  }

  function nearestAircraft(pax, rangeKm, mtowKg, k) {
    const lp = Math.log(pax), lr = Math.log(rangeKm), lm = Math.log(mtowKg);
    return AIRCRAFT.map(function (a) {
      const d2 = Math.pow(Math.log(a.pax) - lp, 2) +
                 Math.pow(Math.log(a.range_km) - lr, 2) +
                 Math.pow(Math.log(a.mtow_kg) - lm, 2);
      const dev = (mtowKg - a.mtow_kg) / a.mtow_kg * 100.0;
      return {
        name: a.name,
        class: a.cls,
        pax: a.pax,
        range_km: a.range_km,
        mtow_kg: a.mtow_kg,
        span_m: a.span_m,
        length_m: a.length_m,
        wing_area_m2: a.s_m2,
        distance: round(Math.sqrt(d2), 4),
        mtow_dev: dev,
        mtow_dev_str: (dev >= 0 ? '+' : '') + dev.toFixed(1) + '%'
      };
    }).sort(function (a, b) {
      return a.distance - b.distance;
    }).slice(0, k || 3);
  }

  function design(pax, rangeKm, mach) {
    const sized = sizeAircraft(pax, rangeKm, mach);
    const mission = sized.mission;
    const geo = layout(sized.weights, mission.pax, mission.mach, sized.class);
    const perf = performance(sized.weights, geo, mission, sized.factors);
    const bench = nearestAircraft(mission.pax, mission.range_km, sized.weights.mtow_kg, 3);
    const nearest = bench[0] || null;
    return {
      mission,
      class: sized.class,
      class_label: sized.class_label,
      convergence: sized.convergence,
      iterations: sized.iterations,
      weights: sized.weights,
      factors: sized.factors,
      geometry: geo,
      performance: perf,
      benchmarks: {
        nearest: nearest ? nearest.name : null,
        nearest_dev: nearest ? nearest.mtow_dev_str : null,
        nearest_detail: nearest,
        top: bench
      }
    };
  }

  function aircraftRows(cls) {
    const rows = AIRCRAFT.filter(function (a) { return !cls || a.cls === cls; });
    return rows.map(function (a, i) {
      return {
        id: i + 1,
        name: a.name,
        class: a.cls,
        pax: a.pax,
        range_km: a.range_km,
        mach: a.mach,
        mtow_kg: a.mtow_kg,
        oew_kg: a.oew_kg,
        wing_area_m2: a.s_m2,
        span_m: a.span_m,
        length_m: a.length_m,
        fuselage_dia_m: a.dia_m,
        thrust_kn: a.thrust_kn
      };
    });
  }

  function loadDesigns() {
    try {
      const rows = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
      return Array.isArray(rows) ? rows : [];
    } catch (_e) {
      return [];
    }
  }

  function saveDesigns(rows) {
    localStorage.setItem(STORE_KEY, JSON.stringify(rows));
  }

  function json(body, status) {
    return Promise.resolve(new Response(JSON.stringify(body), {
      status: status || 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    }));
  }

  const realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : input.url;
    const req = new URL(url, window.location.href);
    const path = req.pathname.replace(/\/+$/, '');
    const method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    if (!/(^|\/)api(\/|$)/.test(path)) {
      return realFetch(input, init);
    }
    const api = path.slice(path.lastIndexOf('/api'));

    if (api === '/api/health' && method === 'GET') {
      return json({ status: 'ok', version: VERSION, aircraft: AIRCRAFT.length, classes: Object.keys(CLASS_PARAMS).sort() });
    }
    if (api === '/api/aircraft' && method === 'GET') {
      const cls = req.searchParams.get('class');
      const rows = aircraftRows(cls);
      return json({ count: rows.length, aircraft: rows });
    }
    if (api === '/api/design' && method === 'POST') {
      let body = {};
      try {
        body = JSON.parse((init && init.body) || '{}');
        return json(design(body.pax, body.range_km, body.mach));
      } catch (e) {
        return json({ error: e.message || '设计失败' }, 400);
      }
    }
    if (api === '/api/designs' && method === 'GET') {
      const rows = loadDesigns().slice().sort(function (a, b) { return b.id - a.id; });
      const list = rows.map(function (r) {
        return { id: r.id, name: r.name, author: r.author, mission: r.mission, created_at: r.created_at };
      });
      return json({ count: list.length, designs: list });
    }
    if (api === '/api/designs' && method === 'POST') {
      let body;
      try { body = JSON.parse((init && init.body) || '{}'); } catch (_e) { body = {}; }
      const name = String(body.name || '').trim();
      if (!name) return json({ error: '请填写设计名称' }, 400);
      if (!body.mission || !body.result) return json({ error: '缺少 mission / result 数据' }, 400);
      const rows = loadDesigns();
      const id = rows.reduce(function (m, r) { return Math.max(m, Number(r.id) || 0); }, 0) + 1;
      const author = String(body.author || '匿名总师').trim() || '匿名总师';
      rows.push({ id, name, author, mission: body.mission, result: body.result, created_at: new Date().toISOString().slice(0, 19).replace('T', ' ') });
      saveDesigns(rows);
      return json({ id, name, author }, 201);
    }
    const m = /^\/api\/designs\/(\d+)$/.exec(api);
    if (m && method === 'GET') {
      const id = Number(m[1]);
      const row = loadDesigns().find(function (r) { return Number(r.id) === id; });
      return row ? json(row) : json({ error: '设计不存在' }, 404);
    }
    if (m && method === 'DELETE') {
      const id = Number(m[1]);
      const rows = loadDesigns();
      const kept = rows.filter(function (r) { return Number(r.id) !== id; });
      saveDesigns(kept);
      return Promise.resolve(new Response('', { status: kept.length === rows.length ? 404 : 204 }));
    }
    return json({ error: '接口不存在' }, 404);
  };
})();
