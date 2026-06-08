const PivotEngine = (() => {
  // Aggregate một mảng số
  function aggregate(values, method) {
    const nums = values.map(v => parseFloat(v)).filter(n => !isNaN(n));
    if (!nums.length) return method === 'count' ? values.length : null;
    switch (method) {
      case 'count': return values.length;
      case 'sum':   return nums.reduce((a, b) => a + b, 0);
      case 'avg':   return nums.reduce((a, b) => a + b, 0) / nums.length;
      case 'min':   return Math.min(...nums);
      case 'max':   return Math.max(...nums);
      default:      return values.length;
    }
  }

  // Format số hiển thị
  function fmt(val, decimals = 2) {
    if (val === null || val === undefined) return '';
    const n = parseFloat(val);
    if (isNaN(n)) return val;
    return n % 1 === 0 ? n.toLocaleString() : n.toFixed(decimals);
  }

  /*
    config = {
      rows: ['channel'],          // fields làm row header
      cols: ['month'],            // fields làm col header
      values: [{ field: 'error_rate', agg: 'avg' }],
      filters: [{ field: 'region', op: 'eq', value: 'HN' }]
    }
    data = array of row objects
    Returns: { rowKeys, colKeys, cells, grandTotals }
  */
  function compute(data, config) {
    // 1. Áp filter
    let filtered = data;
    for (const f of (config.filters || [])) {
      filtered = filtered.filter(row => {
        const v = (row[f.field] || '').toString().trim();
        switch (f.op) {
          case 'eq':       return v === f.value;
          case 'neq':      return v !== f.value;
          case 'contains': return v.toLowerCase().includes(f.value.toLowerCase());
          default:         return true;
        }
      });
    }

    // 2. Thu thập unique row keys và col keys
    const rowKeySet = new Set();
    const colKeySet = new Set();

    for (const row of filtered) {
      const rk = (config.rows || []).map(f => row[f] || '—').join(' › ');
      const ck = (config.cols || []).map(f => row[f] || '—').join(' › ');
      rowKeySet.add(rk);
      colKeySet.add(ck);
    }

    const rowKeys = [...rowKeySet].sort();
    const colKeys = [...colKeySet].sort();

    // 3. Nhóm data theo (rowKey, colKey)
    const buckets = {};
    for (const row of filtered) {
      const rk = (config.rows || []).map(f => row[f] || '—').join(' › ');
      const ck = (config.cols || []).map(f => row[f] || '—').join(' › ');
      const bk = `${rk}|||${ck}`;
      if (!buckets[bk]) buckets[bk] = [];
      buckets[bk].push(row);
    }

    // 4. Tính cells
    const valueConfigs = config.values || [{ field: 'qty_sold', agg: 'count' }];
    const cells = {};
    const grandTotals = { rows: {}, cols: {}, grand: {} };

    for (const rk of rowKeys) {
      for (const ck of colKeys) {
        const bk = `${rk}|||${ck}`;
        const rows = buckets[bk] || [];
        cells[`${rk}|||${ck}`] = valueConfigs.map(vc => {
          const vals = rows.map(r => r[vc.field]);
          return aggregate(vals, vc.agg);
        });
      }
    }

    // Grand totals per row
    for (const rk of rowKeys) {
      grandTotals.rows[rk] = valueConfigs.map((vc, vi) => {
        const vals = colKeys.flatMap(ck => {
          const bk = `${rk}|||${ck}`;
          return (buckets[bk] || []).map(r => r[vc.field]);
        });
        return aggregate(vals, vc.agg);
      });
    }

    // Grand totals per col
    for (const ck of colKeys) {
      grandTotals.cols[ck] = valueConfigs.map((vc, vi) => {
        const vals = rowKeys.flatMap(rk => {
          const bk = `${rk}|||${ck}`;
          return (buckets[bk] || []).map(r => r[vc.field]);
        });
        return aggregate(vals, vc.agg);
      });
    }

    // Overall grand total
    grandTotals.grand = valueConfigs.map((vc) => {
      return aggregate(filtered.map(r => r[vc.field]), vc.agg);
    });

    // 5. Tính % total nếu cần
    for (const vc of valueConfigs) {
      if (vc.agg === 'pct') {
        const grandVal = aggregate(filtered.map(r => r[vc.field]), 'sum');
        // Recalculate as percentage
        for (const rk of rowKeys) {
          for (const ck of colKeys) {
            const bk = `${rk}|||${ck}`;
            const rows = buckets[bk] || [];
            const val = aggregate(rows.map(r => r[vc.field]), 'sum');
            const vi = valueConfigs.indexOf(vc);
            if (cells[`${rk}|||${ck}`]) {
              cells[`${rk}|||${ck}`][vi] = grandVal ? (val / grandVal * 100) : 0;
            }
          }
        }
      }
    }

    return { rowKeys, colKeys, cells, grandTotals, valueConfigs, filteredCount: filtered.length };
  }

  // Chuyển pivot result → datasets cho Chart.js
  function toChartData(pivotResult, chartType) {
    const { rowKeys, colKeys, cells, valueConfigs } = pivotResult;
    if (!rowKeys.length) return { labels: [], datasets: [] };

    const colors = APP_CONFIG.chartColors;

    if (['pie', 'doughnut'].includes(chartType)) {
      // Pie: 1 series, labels = rowKeys, giá trị = tổng theo row
      const vals = rowKeys.map(rk => {
        return colKeys.reduce((sum, ck) => {
          const cell = cells[`${rk}|||${ck}`];
          return sum + (cell && cell[0] != null ? parseFloat(cell[0]) || 0 : 0);
        }, 0);
      });
      return {
        labels: rowKeys,
        datasets: [{
          label: valueConfigs[0]?.field || 'Value',
          data: vals,
          backgroundColor: rowKeys.map((_, i) => colors[i % colors.length]),
        }],
      };
    }

    // Bar / Line: series = colKeys, labels = rowKeys
    const datasets = colKeys.map((ck, i) => ({
      label: ck,
      data: rowKeys.map(rk => {
        const cell = cells[`${rk}|||${ck}`];
        return cell && cell[0] != null ? parseFloat(cell[0]) || 0 : 0;
      }),
      backgroundColor: colors[i % colors.length] + '99',
      borderColor: colors[i % colors.length],
      borderWidth: 2,
      fill: chartType === 'area',
    }));

    return { labels: rowKeys, datasets };
  }

  return { compute, toChartData, fmt };
})();
