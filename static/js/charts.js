/* 翼生 WingBorn —— ECharts 图表：重量收敛曲线 / 真机对比散点 */

const Charts = (function () {
  'use strict';

  const AXIS = '#8296B4', LINE = '#22304C', TEXT = '#E6EDF7';
  const PRIMARY = '#4FC3F7', ACCENT = '#FFB300', OK = '#4ADE80';
  const FONT = '"Segoe UI", "Microsoft YaHei", sans-serif';

  const baseGrid = { left: 52, right: 22, top: 22, bottom: 26 };
  const baseTooltip = {
    backgroundColor: '#0d1526', borderColor: LINE, borderWidth: 1,
    textStyle: { color: TEXT, fontSize: 12 }, confine: true
  };

  const instances = {};

  function get(el) {
    if (!el) return null;
    const key = el.id || (el.id = 'chart-' + Math.random().toString(36).slice(2));
    if (instances[key] && instances[key].getDom() !== el) { instances[key].dispose(); delete instances[key]; }
    if (!instances[key]) instances[key] = echarts.init(el, null, { renderer: 'canvas' });
    return instances[key];
  }

  /* ─────────────── 重量迭代收敛曲线（逐点动画） ─────────────── */
  let convTimer = null;

  function drawConvergence(el, convergence, animate) {
    const ch = get(el);
    if (!ch) return;
    if (convTimer) { clearTimeout(convTimer); convTimer = null; }
    if (!convergence || !convergence.length) { ch.clear(); return; }

    const xs = convergence.map(function (p) { return p.i; });
    const ys = convergence.map(function (p) { return p.w0 / 1000; });   // t
    const last = convergence[convergence.length - 1];

    ch.setOption({
      animation: false,
      grid: baseGrid,
      tooltip: Object.assign({ trigger: 'axis' }, baseTooltip, {
        formatter: function (ps) {
          const p = ps[0];
          return '第 ' + p.data[0] + ' 次迭代<br/>W₀ = <b>' + p.data[1].toFixed(1) + ' t</b>';
        }
      }),
      xAxis: {
        type: 'value', name: '迭代', nameTextStyle: { color: AXIS, fontSize: 10 },
        min: 0, max: Math.max(xs[xs.length - 1], 4),
        axisLine: { lineStyle: { color: LINE } },
        axisLabel: { color: AXIS, fontSize: 10 },
        splitLine: { lineStyle: { color: '#16203200' } }
      },
      yAxis: {
        type: 'value', name: 'W₀ / t', nameTextStyle: { color: AXIS, fontSize: 10 },
        scale: true,
        axisLine: { lineStyle: { color: LINE } },
        axisLabel: { color: AXIS, fontSize: 10, formatter: '{value}' },
        splitLine: { lineStyle: { color: '#162032' } }
      },
      series: [{
        type: 'line', smooth: true, symbolSize: 7,
        lineStyle: { color: PRIMARY, width: 2.4, shadowColor: '#4fc3f780', shadowBlur: 10 },
        itemStyle: { color: PRIMARY, borderColor: '#0B1220', borderWidth: 2 },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: '#4fc3f73d' }, { offset: 1, color: '#4fc3f700' }])
        },
        markPoint: {
          symbol: 'circle', symbolSize: 11,
          itemStyle: { color: OK, borderColor: '#0B1220', borderWidth: 2 },
          label: {
            show: true, color: OK, fontSize: 10, position: 'top',
            formatter: '收敛 ' + (last.w0 / 1000).toFixed(1) + ' t'
          },
          data: [{ coord: [last.i, last.w0 / 1000] }]
        },
        data: []
      }]
    }, true);

    if (!animate) {
      ch.setOption({ series: [{ data: convergence.map(function (p) { return [p.i, p.w0 / 1000]; }) }] });
      return;
    }
    // 逐点追加，250 ms/点
    const pts = convergence.map(function (p) { return [p.i, p.w0 / 1000]; });
    let k = 0;
    (function tick() {
      if (k >= pts.length) return;
      ch.setOption({ series: [{ data: pts.slice(0, ++k) }] });
      convTimer = setTimeout(tick, 250);
    })();
  }

  /* ─────────────── 我的设计 vs 14 架真机（双对数散点） ─────────────── */
  function drawCompare(el, result, fleet) {
    const ch = get(el);
    if (!ch || !result || !fleet) return;
    const mine = {
      name: '我的设计',
      value: [result.weights.mtow_kg, result.geometry.span_m],
      cls: result.class
    };
    // 只标注最近邻的 3 架（正是要传达的信息），其余真机保持无标签散点，
    // 避免窄体簇标签互相压字——悬浮仍可查看全部机型。
    const highlight = {};
    (result.benchmarks.top || []).forEach(function (b) { highlight[b.name] = true; });

    const groups = { regional: [], narrow: [], wide: [] };
    fleet.forEach(function (a) {
      (groups[a.class] || groups.regional).push({
        name: a.name, value: [a.mtow_kg, a.span_m], cls: a.class,
        near: !!highlight[a.name]
      });
    });
    const clsName = { regional: '支线', narrow: '窄体', wide: '宽体' };
    const clsColor = { regional: '#4FC3F7', narrow: '#FFB300', wide: '#A78BFA' };

    // 图上不再放真机标签：最近邻三架在 (MTOW, 翼展) 投影上几乎重合，标签必然叠字。
    // 图负责表达"落在真机群的什么位置"，精确数字由弹层里的近邻列表给出。
    const series = Object.keys(groups).map(function (k) {
      return {
        name: clsName[k], type: 'scatter',
        itemStyle: { color: 'transparent', borderColor: clsColor[k], borderWidth: 2 },
        label: { show: false },
        data: groups[k].map(function (d) {
          return { name: d.name, value: d.value, symbolSize: d.near ? 14 : 9 };
        })
      };
    });
    series.push({
      name: '我的设计', type: 'scatter', symbolSize: 19, z: 20,
      itemStyle: { color: PRIMARY, borderColor: '#ffffff', borderWidth: 2,
                   shadowColor: '#4fc3f7cc', shadowBlur: 18 },
      label: {
        show: true, position: 'top', color: PRIMARY, fontSize: 12, fontWeight: 'bold',
        formatter: '我的设计 ' + (mine.value[0] / 1000).toFixed(1) + ' t'
      },
      data: [mine]
    });

    ch.setOption({
      animation: true, animationDuration: 600,
      grid: { left: 68, right: 96, top: 46, bottom: 46 },
      legend: {
        top: 6, textStyle: { color: AXIS, fontSize: 11 }, itemWidth: 10, itemHeight: 10
      },
      tooltip: Object.assign({}, baseTooltip, {
        formatter: function (p) {
          return '<b>' + p.data.name + '</b><br/>MTOW ' +
                 p.data.value[0].toLocaleString() + ' kg<br/>翼展 ' +
                 p.data.value[1].toFixed(1) + ' m';
        }
      }),
      xAxis: {
        type: 'log', name: 'MTOW / kg', nameLocation: 'middle', nameGap: 28,
        nameTextStyle: { color: AXIS, fontSize: 11 },
        axisLine: { lineStyle: { color: LINE } },
        axisLabel: { color: AXIS, fontSize: 10, formatter: function (v) { return v / 1000 + 't'; } },
        splitLine: { lineStyle: { color: '#18233A' } }, minorSplitLine: { show: false }
      },
      yAxis: {
        type: 'log', name: '翼展 / m', nameLocation: 'middle', nameGap: 40,
        nameTextStyle: { color: AXIS, fontSize: 11 },
        axisLine: { lineStyle: { color: LINE } },
        axisLabel: { color: AXIS, fontSize: 10 },
        splitLine: { lineStyle: { color: '#18233A' } }, minorSplitLine: { show: false }
      },
      series: series
    }, true);
  }

  /* ─────────────── 机型库散点（x=航程 y=旅客，气泡=MTOW） ─────────────── */
  function drawFleet(el, fleet, picked) {
    const ch = get(el);
    if (!ch || !fleet) return;
    const clsColor = { regional: '#4FC3F7', narrow: '#FFB300', wide: '#A78BFA' };
    const clsName = { regional: '支线', narrow: '窄体', wide: '宽体' };
    const groups = { regional: [], narrow: [], wide: [] };
    fleet.forEach(function (a) {
      (groups[a.class] || groups.regional).push({
        name: a.name, value: [a.range_km, a.pax, a.mtow_kg],
        symbolSize: 8 + Math.sqrt(a.mtow_kg) / 22,
        itemStyle: {
          color: clsColor[a.class] + (picked && picked.name === a.name ? 'ff' : '66'),
          borderColor: picked && picked.name === a.name ? '#fff' : 'transparent',
          borderWidth: 2
        }
      });
    });
    ch.setOption({
      animationDuration: 400,
      grid: { left: 56, right: 92, top: 40, bottom: 44 },
      legend: { top: 4, textStyle: { color: AXIS, fontSize: 11 }, itemWidth: 10, itemHeight: 10 },
      tooltip: Object.assign({}, baseTooltip, {
        formatter: function (p) {
          return '<b>' + p.data.name + '</b><br/>航程 ' + p.data.value[0].toLocaleString() +
                 ' km<br/>旅客 ' + p.data.value[1] + '<br/>MTOW ' +
                 p.data.value[2].toLocaleString() + ' kg';
        }
      }),
      xAxis: {
        type: 'value', name: '航程 / km', nameLocation: 'middle', nameGap: 26,
        nameTextStyle: { color: AXIS, fontSize: 11 },
        axisLine: { lineStyle: { color: LINE } }, axisLabel: { color: AXIS, fontSize: 10 },
        splitLine: { lineStyle: { color: '#18233A' } }
      },
      yAxis: {
        type: 'value', name: '旅客数', nameLocation: 'middle', nameGap: 36,
        nameTextStyle: { color: AXIS, fontSize: 11 },
        axisLine: { lineStyle: { color: LINE } }, axisLabel: { color: AXIS, fontSize: 10 },
        splitLine: { lineStyle: { color: '#18233A' } }
      },
      series: Object.keys(groups).map(function (k) {
        return {
          name: clsName[k], type: 'scatter',
          label: {
            show: true, position: 'right', color: '#9FB2CE', fontSize: 10,
            formatter: function (p) { return p.data.name; }
          },
          labelLayout: { hideOverlap: true, moveOverlap: 'shiftY' },
          data: groups[k]
        };
      })
    }, true);
  }

  function resizeAll() {
    Object.keys(instances).forEach(function (k) { instances[k].resize(); });
  }

  return {
    drawConvergence: drawConvergence,
    drawCompare: drawCompare,
    drawFleet: drawFleet,
    resizeAll: resizeAll
  };
})();
