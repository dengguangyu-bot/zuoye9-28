/* 翼生 WingBorn —— Vue 3 应用：状态机、页签、API 调用、动线编排 */

(function () {
  'use strict';

  const { createApp } = Vue;

  const API = {
    design: function (m) {
      return fetch('/api/design', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(m)
      }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); });
    },
    aircraft: function () {
      return fetch('/api/aircraft').then(function (r) { return r.json(); });
    },
    designs: function () {
      return fetch('/api/designs').then(function (r) { return r.json(); });
    },
    save: function (payload) {
      return fetch('/api/designs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); });
    },
    remove: function (id) {
      return fetch('/api/designs/' + id, { method: 'DELETE' });
    }
  };

  // 预设任务均落在真机设计包线内，对标偏差小（可信度时刻）
  const PRESETS = [
    { label: '支线 90 座', pax: 90, range_km: 2500, mach: 0.78 },
    { label: '干线 180 座', pax: 180, range_km: 5500, mach: 0.78 },
    { label: '中程 200 座', pax: 200, range_km: 6000, mach: 0.78 },
    { label: '远程 300 座', pax: 300, range_km: 12000, mach: 0.82 },
    { label: '彩蛋 850 座', pax: 850, range_km: 15000, mach: 0.85 }
  ];

  const TABS = [
    { key: 'bench', label: '工作台' },
    { key: 'hangar', label: '机库' },
    { key: 'fleet', label: '机型库' }
  ];

  createApp({
    data: function () {
      return {
        tabs: TABS,
        tab: 'bench',
        state: 'empty',                 // empty | running | done | error
        mission: { pax: 180, range_km: 5500, mach: 0.78 },
        presets: PRESETS,
        result: null,
        error: '',
        statusText: '',
        litGroups: [],
        spinning: false,
        designs: [],
        fleet: [],
        fleetClass: 'all',
        fleetFilters: [
          { key: 'all', label: '全部' },
          { key: 'regional', label: '支线' },
          { key: 'narrow', label: '窄体' },
          { key: 'wide', label: '宽体' }
        ],
        picked: null,
        showCompare: false,
        showSave: false,
        saveForm: { name: '', author: '' },
        liveryHex: '',            // 当前涂装主色（保存进 result.livery）
        labelsOn: true,           // §3A.4 计算标注开关
        donorError: '',           // 底模载入失败提示（不得白屏）
        pendingDelete: null,
        toast: '',
        _toastTimer: null,
        _slideTimer: null,
        _seqTimers: []
      };
    },

    computed: {
      filteredFleet: function () {
        if (this.fleetClass === 'all') return this.fleet;
        return this.fleet.filter(function (a) { return a.class === this.fleetClass; }, this);
      },
      cardGroups: function () {
        const r = this.result;
        if (!r) return [];
        const w = r.weights, g = r.geometry, p = r.performance, f = r.factors;
        return [
          { key: 'weight', title: '重量', rows: [
            { label: '最大起飞重量 MTOW', value: this.fmt(w.mtow_kg) + ' kg', accent: true },
            { label: '使用空重 OEW', value: this.fmt(w.oew_kg) + ' kg' },
            { label: '燃油重量', value: this.fmt(w.fuel_kg) + ' kg' },
            { label: '商载', value: this.fmt(w.payload_kg) + ' kg' },
            { label: '空重分数 We/W₀', value: w.we_over_w0.toFixed(3) },
            { label: '燃油分数', value: w.fuel_fraction.toFixed(3) }
          ]},
          { key: 'geometry', title: '几何', rows: [
            { label: '机身长', value: g.fuselage.length.toFixed(1) + ' m', accent: true },
            { label: '机身直径', value: g.fuselage.dia.toFixed(2) + ' m' },
            { label: '翼展', value: g.wing.span.toFixed(1) + ' m', accent: true },
            { label: '机翼面积', value: g.wing.area_m2.toFixed(1) + ' m²' },
            { label: '展弦比 / 后掠', value: g.wing.aspect_ratio + ' / ' + g.wing.sweep_deg + '°' },
            { label: '平尾 / 垂尾面积', value: g.htail.area_m2 + ' / ' + g.vtail.area_m2 + ' m²' }
          ]},
          { key: 'power', title: '动力', rows: [
            { label: '发动机', value: g.engines.count + ' × ' + g.engines.mount, accent: true },
            { label: '单台推力', value: g.engines.thrust_kn + ' kN', accent: true },
            { label: '总推力', value: g.engines.thrust_total_kn + ' kN' },
            { label: '推重比 T/W', value: f.tw },
            { label: '短舱直径', value: g.engines.dia.toFixed(2) + ' m' }
          ]},
          { key: 'perf', title: '性能', rows: [
            { label: '起飞场长', value: this.fmt(p.takeoff_field_m) + ' m', accent: true },
            { label: '着陆距离', value: this.fmt(p.landing_field_m) + ' m' },
            { label: '巡航速度', value: p.cruise_speed_kmh.toFixed(0) + ' km/h' },
            { label: '巡航高度', value: p.cruise_alt_km + ' km' },
            { label: '每客百公里油耗', value: p.fuel_per_pax_100km_l.toFixed(2) + ' L', accent: true },
            { label: '任务燃油', value: this.fmt(p.trip_fuel_kg) + ' kg' }
          ]}
        ];
      }
    },

    watch: {
      // 页签切换：v-show 隐藏期间 ECharts 以 0 尺寸初始化，需重算
      tab: function (v) {
        const self = this;
        this.$nextTick(function () {
          if (v === 'fleet' && self.$refs.fleetChart) {
            Charts.drawFleet(self.$refs.fleetChart, self.fleet, self.picked);
          }
          Charts.resizeAll();
        });
      },
      picked: function (p) {
        if (this.$refs.fleetChart) Charts.drawFleet(this.$refs.fleetChart, this.fleet, p);
      },
      fleetClass: function () {
        this.$nextTick(function () { Charts.resizeAll(); });
      }
    },

    mounted: function () {
      const self = this;
      PlaneView.init(this.$refs.canvas);
      PlaneView.showPlaceholder();
      // 空闲缓转被拖拽中断时同步按钮状态
      PlaneView.setSpinCallback(function (on) { self.spinning = on; });
      // 底模载入失败要有明确提示，不许白屏
      PlaneView.onReady(function (err) {
        if (err) {
          self.donorError = err;
          self.state = 'error';
          self.error = '机体底模载入失败：' + err + '（卡片与对比图仍可用；刷新页面重试）';
        }
      });
      this.liveryHex = PlaneStage.livery(this.mission).hex;
      this.loadFleet();
      this.loadDesigns();
      window.addEventListener('resize', function () { Charts.resizeAll(); });
    },

    methods: {
      /* ── 工具 ── */
      fmt: function (v) {
        if (v === null || v === undefined) return '—';
        return Math.round(v).toLocaleString('en-US');
      },
      clsLabel: function (c) {
        return { regional: '支线', narrow: '窄体', wide: '宽体' }[c] || c;
      },
      devClass: function (s) {
        if (!s) return '';
        const n = Math.abs(parseFloat(s));
        return n <= 10 ? 'accent' : 'dim';
      },
      toastMsg: function (m) {
        this.toast = m;
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(function () { this.toast = ''; }.bind(this), 2200);
      },
      clearSeq: function () {
        this._seqTimers.forEach(clearTimeout);
        this._seqTimers = [];
      },
      later: function (fn, ms) {
        this._seqTimers.push(setTimeout(fn, ms));
      },

      /* ── 设计动线 ── */
      applyPreset: function (p) {
        this.mission = { pax: p.pax, range_km: p.range_km, mach: p.mach };
        this.runDesign();
      },

      runDesign: function () {
        const self = this;
        this.clearSeq();
        this.error = '';
        this.result = null;
        this.litGroups = [];
        this.state = 'running';
        this.statusText = '正在求解重量方程…';

        API.design(this.mission).then(function (res) {
          if (!res.ok) {
            self.state = 'error';
            self.error = res.body.error || '设计失败';
            self.statusText = '';
            return;
          }
          self.animateResult(res.body, true);
        }).catch(function () {
          self.state = 'error';
          self.error = '无法连接本地服务，请确认 python app.py 正在运行';
          self.statusText = '';
        });
      },

      // 迭代动画 → 3D 生长 → 卡片依次点亮
      animateResult: function (r, grow) {
        const self = this;
        this.result = r;
        this.liveryHex = (r.livery && r.livery.hex) ? r.livery.hex
                                                    : PlaneStage.livery(r.mission).hex;
        const conv = r.convergence;

        // 1) 收敛曲线逐帧 + 迭代计数文字（魔法时刻：看软件"思考"）
        Charts.drawConvergence(this.$refs.convChart, conv, true);
        conv.forEach(function (p, i) {
          self.later(function () {
            self.statusText = '第 ' + p.i + ' 次迭代  W₀ = ' +
                              (p.w0 / 1000).toFixed(1) + ' t' +
                              (i === conv.length - 1 ? '  ✓ 收敛' : '');
          }, i * 250);
        });

        const tConv = conv.length * 250;

        // 2) 3D 机体（生长动画）
        this.later(function () {
          PlaneView.setAircraft(r, { grow: !!grow, liveryHex: self.liveryHex });
          self.statusText = '几何布局完成 · 翼展 ' + r.geometry.wing.span.toFixed(1) + ' m';
        }, grow ? tConv * 0.45 : 0);

        // 3) 卡片四组依次点亮（0.3 s 间隔，对应设计流程叙事顺序）
        const keys = ['weight', 'geometry', 'power', 'perf'];
        const tCard = (grow ? tConv * 0.45 : 0) + (grow ? 900 : 0);
        keys.forEach(function (k, i) {
          self.later(function () { self.litGroups = keys.slice(0, i + 1); }, tCard + i * 300);
        });

        // 4) 完成
        this.later(function () {
          self.state = 'done';
          self.statusText = '第 ' + r.iterations + ' 次迭代收敛  W₀ = ' +
                            (r.weights.mtow_kg / 1000).toFixed(1) + ' t  ✓';
        }, tCard + keys.length * 300);
      },

      // 滑杆实时模式：防抖 150 ms → 重算 → 3D 变形
      onSlider: function () {
        const self = this;
        clearTimeout(this._slideTimer);
        this._slideTimer = setTimeout(function () {
          if (self.state === 'running') return;
          API.design(self.mission).then(function (res) {
            if (!res.ok) {
              self.state = 'error';
              self.error = res.body.error || '该需求不可行';
              return;
            }
            self.error = '';
            self.result = res.body;
            self.litGroups = ['weight', 'geometry', 'power', 'perf'];
            self.state = 'done';
            self.statusText = '实时变形中  W₀ = ' +
                              (res.body.weights.mtow_kg / 1000).toFixed(1) + ' t';
            PlaneView.setAircraft(res.body, { grow: false, reframe: false,
                                     keepAngles: true, liveryHex: self.liveryHex });
            Charts.drawConvergence(self.$refs.convChart, res.body.convergence, false);
          });
        }, 150);
      },

      /* ── 3D 控制 ── */
      resetView: function () { PlaneView.resetView(); },
      toggleSpin: function () {
        this.spinning = !this.spinning;
        PlaneView.setSpin(this.spinning);
      },
      toggleLabels: function () {
        this.labelsOn = !this.labelsOn;
        PlaneView.setLabels(this.labelsOn);
      },
      onLiveryChange: function () {
        PlaneView.setLivery(this.liveryHex);
      },

      /* ── 对比 ── */
      openCompare: function () {
        const self = this;
        this.showCompare = true;
        this.$nextTick(function () {
          Charts.drawCompare(self.$refs.cmpChart, self.result, self.fleet);
        });
      },

      /* ── 机库 ── */
      loadDesigns: function () {
        const self = this;
        API.designs().then(function (d) {
          const list = d.designs || [];
          // 列表接口不含 result_json，涂装在 result_json 里，故逐个取完整记录
          return Promise.all(list.map(function (it) {
            return fetch('/api/designs/' + it.id)
              .then(function (r) { return r.json(); })
              .then(function (full) {
                const lv = PlaneStage.livery(full.mission,
                                             (full.result.livery || {}).hex || '');
                return { id: it.id, name: it.name, author: it.author,
                         mission: it.mission, livery: lv,
                         thumb: PlaneStage.planformCanvas(full.result.geometry, lv)
                                          .toDataURL('image/png') };
              })
              .catch(function () {
                return { id: it.id, name: it.name, author: it.author,
                         mission: it.mission, livery: PlaneStage.livery(it.mission),
                         thumb: '' };
              });
          }));
        }).then(function (rows) { self.designs = rows; });
      },
      openSave: function () {
        this.saveForm.name = this.result
          ? (this.result.mission.pax + '座 · ' + this.result.mission.range_km + 'km 方案') : '';
        this.saveForm.author = '';
        this.showSave = true;
      },
      doSave: function () {
        const self = this;
        if (!this.saveForm.name.trim()) { this.toastMsg('请填写设计名称'); return; }
        const payload = Object.assign({}, this.result, { livery: { hex: this.liveryHex } });
        API.save({
          name: this.saveForm.name, author: this.saveForm.author,
          mission: this.result.mission, result: payload
        }).then(function (res) {
          if (!res.ok) { self.toastMsg(res.body.error || '保存失败'); return; }
          self.showSave = false;
          self.toastMsg('已存入机库');
          self.loadDesigns();
        });
      },
      recall: function (d) {
        const self = this;
        fetch('/api/designs/' + d.id).then(function (r) { return r.json(); }).then(function (full) {
          self.tab = 'bench';
          self.mission = {
            pax: full.mission.pax, range_km: full.mission.range_km, mach: full.mission.mach
          };
          self.$nextTick(function () { self.animateResult(full.result, true); });
        });
      },
      askDelete: function (d) { this.pendingDelete = d; },
      doDelete: function () {
        const self = this;
        const d = this.pendingDelete;
        API.remove(d.id).then(function (r) {
          self.pendingDelete = null;
          if (r.status === 204) { self.toastMsg('已删除'); self.loadDesigns(); }
          else { self.toastMsg('删除失败'); }
        });
      },

      /* ── 机型库 ── */
      loadFleet: function () {
        const self = this;
        API.aircraft().then(function (d) {
          self.fleet = d.aircraft || [];
          self.$nextTick(function () {
            if (self.$refs.fleetChart) Charts.drawFleet(self.$refs.fleetChart, self.fleet, null);
          });
        });
      },

      /* ── 导出报告 ── */
      exportReport: function () {
        const r = this.result;
        if (!r) return;
        const w = r.weights, g = r.geometry, p = r.performance, f = r.factors;
        const L = [];
        L.push('# 翼生 WingBorn 总体设计方案');
        L.push('');
        L.push('> 由「翼生 WingBorn」概念设计工坊生成 · 输入需求，翼由此生');
        L.push('');
        L.push('## 1. 任务需求');
        L.push('');
        L.push('| 项目 | 值 |');
        L.push('|---|---|');
        L.push('| 旅客数 | ' + r.mission.pax + ' 人 |');
        L.push('| 航程 | ' + r.mission.range_km + ' km |');
        L.push('| 巡航马赫 | M' + r.mission.mach.toFixed(2) + ' |');
        L.push('| 座级 | ' + r.class_label + ' |');
        L.push('');
        L.push('## 2. 重量');
        L.push('');
        L.push('| 项目 | 值 |');
        L.push('|---|---|');
        L.push('| 最大起飞重量 MTOW | ' + this.fmt(w.mtow_kg) + ' kg |');
        L.push('| 使用空重 OEW | ' + this.fmt(w.oew_kg) + ' kg |');
        L.push('| 燃油重量 | ' + this.fmt(w.fuel_kg) + ' kg |');
        L.push('| 商载 | ' + this.fmt(w.payload_kg) + ' kg |');
        L.push('| 空重分数 We/W₀ | ' + w.we_over_w0 + ' |');
        L.push('| 燃油分数 | ' + w.fuel_fraction + ' |');
        L.push('| 迭代次数 | ' + r.iterations + ' |');
        L.push('');
        L.push('### 重量迭代收敛序列');
        L.push('');
        L.push('| 迭代 | W₀ / kg |');
        L.push('|---|---|');
        r.convergence.forEach(function (c) { L.push('| ' + c.i + ' | ' + c.w0 + ' |'); });
        L.push('');
        L.push('## 3. 几何');
        L.push('');
        L.push('| 项目 | 值 |');
        L.push('|---|---|');
        L.push('| 机身长 | ' + g.fuselage.length + ' m |');
        L.push('| 机身直径 | ' + g.fuselage.dia + ' m |');
        L.push('| 翼展 | ' + g.wing.span + ' m |');
        L.push('| 机翼面积 | ' + g.wing.area_m2 + ' m² |');
        L.push('| 展弦比 | ' + g.wing.aspect_ratio + ' |');
        L.push('| 后掠角 | ' + g.wing.sweep_deg + '° |');
        L.push('| 平尾面积 | ' + g.htail.area_m2 + ' m² |');
        L.push('| 垂尾面积 | ' + g.vtail.area_m2 + ' m² |');
        L.push('');
        L.push('## 4. 动力与性能');
        L.push('');
        L.push('| 项目 | 值 |');
        L.push('|---|---|');
        L.push('| 发动机 | ' + g.engines.count + ' × ' + g.engines.thrust_kn + ' kN |');
        L.push('| 推重比 | ' + f.tw + ' |');
        L.push('| 起飞场长 | ' + this.fmt(p.takeoff_field_m) + ' m |');
        L.push('| 着陆距离 | ' + this.fmt(p.landing_field_m) + ' m |');
        L.push('| 巡航速度 | ' + p.cruise_speed_kmh.toFixed(0) + ' km/h @ ' + p.cruise_alt_km + ' km |');
        L.push('| 每客百公里油耗 | ' + p.fuel_per_pax_100km_l + ' L |');
        L.push('');
        L.push('## 5. 真机对标');
        L.push('');
        L.push('最近真机：**' + r.benchmarks.nearest + '**（MTOW 偏差 ' + r.benchmarks.nearest_dev + '）');
        L.push('');
        L.push('| 机型 | 级别 | 旅客 | 航程 km | MTOW kg | 偏差 |');
        L.push('|---|---|---|---|---|---|');
        r.benchmarks.top.forEach(function (b) {
          L.push('| ' + b.name + ' | ' + b.class + ' | ' + b.pax + ' | ' + b.range_km +
                 ' | ' + b.mtow_kg + ' | ' + b.mtow_dev_str + ' |');
        });
        L.push('');
        L.push('---');
        L.push('');
        L.push('*本方案为概念设计精度（量级正确、趋势正确），非初步/详细设计。*');

        const blob = new Blob([L.join('\n')], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = '翼生方案_' + r.mission.pax + '座_' + r.mission.range_km + 'km.md';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        this.toastMsg('报告已导出');
      }
    }
  }).mount('#app');
})();
