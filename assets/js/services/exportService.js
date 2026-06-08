const ExportService = (() => {
  function _ts() {
    const d = new Date();
    return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  }

  function _download(wb, filename) {
    XLSX.writeFile(wb, filename);
  }

  // ── TLL: 2 sheets — theo SP & theo tháng ──────────────────────────────────
  function exportTLL(errorData, saleoutData, filters, datasetLabel) {
    const byProduct = ErrorRateService.calcByProduct(errorData, saleoutData, filters);
    const byMonth   = ErrorRateService.calcByMonth  (errorData, saleoutData, filters);

    if (!byProduct.length && !byMonth.length) {
      alert('Chưa có dữ liệu TLL để xuất.');
      return;
    }

    const wb = XLSX.utils.book_new();

    const ws1 = XLSX.utils.aoa_to_sheet([
      ['Sản phẩm', 'Số lỗi', 'Bán ra', 'TLL%'],
      ...byProduct.map(r => [
        r.short_name,
        r.errors,
        r.sale,
        r.rate !== null ? parseFloat(r.rate.toFixed(4)) : '',
      ]),
    ]);
    XLSX.utils.book_append_sheet(wb, ws1, 'TLL theo SP');

    const ws2 = XLSX.utils.aoa_to_sheet([
      ['Tháng', 'Lỗi trong tháng', 'Bán ra trong tháng', 'TLL% lũy kế'],
      ...byMonth.map(r => [
        r.month,
        r.errors,
        r.sale,
        r.rate !== null ? parseFloat(r.rate.toFixed(4)) : '',
      ]),
    ]);
    XLSX.utils.book_append_sheet(wb, ws2, 'TLL theo tháng');

    _download(wb, `TLL_${datasetLabel}_${_ts()}.xlsx`);
  }

  // ── Sale Out: matrix sản phẩm × tháng ─────────────────────────────────────
  function exportSaleOut(saleoutData, datasetLabel) {
    if (!saleoutData || !saleoutData.length) {
      alert('Chưa có dữ liệu Sale Out để xuất.');
      return;
    }

    const months   = ErrorRateService.getUniqueMonths(saleoutData);
    const products = ErrorRateService.getUniqueProducts(saleoutData);

    const lookup = {};
    for (const r of saleoutData) {
      const k = `${r.short_name}__${r.month}`;
      lookup[k] = (lookup[k] || 0) + (Number(r.value) || 0);
    }

    const header = ['Sản phẩm', ...months, 'Tổng'];
    const rows = products.map(p => {
      const vals = months.map(m => lookup[`${p}__${m}`] || 0);
      return [p, ...vals, vals.reduce((s, v) => s + v, 0)];
    });
    const totalsRow = [
      'Tổng',
      ...months.map((_, mi) => rows.reduce((s, r) => s + (r[mi + 1] || 0), 0)),
    ];
    totalsRow.push(totalsRow.slice(1).reduce((s, v) => s + v, 0));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ...rows, totalsRow]), 'Sale Out');
    _download(wb, `SaleOut_${datasetLabel}_${_ts()}.xlsx`);
  }

  // ── Pivot table ───────────────────────────────────────────────────────────
  function exportPivot(pivotResult, datasetLabel) {
    if (!pivotResult || !pivotResult.rowKeys || !pivotResult.rowKeys.length) {
      alert('Chưa có dữ liệu Pivot để xuất.\nHãy cấu hình Rows, Columns và Values trước.');
      return;
    }

    const { rowKeys, colKeys, cells, grandTotals, valueConfigs } = pivotResult;
    const multiVal = valueConfigs.length > 1;

    const headerRow = [''];
    colKeys.forEach(ck => {
      if (multiVal) valueConfigs.forEach(vc => headerRow.push(`${ck} / ${vc.field}`));
      else headerRow.push(ck);
    });
    if (multiVal) valueConfigs.forEach(vc => headerRow.push(`Tổng / ${vc.field}`));
    else headerRow.push('Tổng');

    const dataRows = rowKeys.map(rk => {
      const row = [rk];
      colKeys.forEach(ck => {
        const cell = cells[`${rk}|||${ck}`] || [];
        if (multiVal) valueConfigs.forEach((_, vi) => row.push(cell[vi] ?? ''));
        else row.push(cell[0] ?? '');
      });
      const rowTotals = grandTotals.rows[rk] || [];
      if (multiVal) valueConfigs.forEach((_, vi) => row.push(rowTotals[vi] ?? ''));
      else row.push(rowTotals[0] ?? '');
      return row;
    });

    const totalsRow = ['Tổng'];
    colKeys.forEach(ck => {
      const ct = grandTotals.cols[ck] || [];
      if (multiVal) valueConfigs.forEach((_, vi) => totalsRow.push(ct[vi] ?? ''));
      else totalsRow.push(ct[0] ?? '');
    });
    if (multiVal) valueConfigs.forEach((_, vi) => totalsRow.push(grandTotals.grand[vi] ?? ''));
    else totalsRow.push(grandTotals.grand[0] ?? '');

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headerRow, ...dataRows, totalsRow]), 'Pivot');
    _download(wb, `Pivot_${datasetLabel}_${_ts()}.xlsx`);
  }

  // ── Raw data (toàn bộ records) ────────────────────────────────────────────
  function exportRawData(allData, datasetLabel) {
    if (!allData || !allData.length) {
      alert('Chưa có dữ liệu để xuất.');
      return;
    }

    const fields = APP_CONFIG.fieldDefinitions;
    const header = fields.map(f => f.label);
    const rows   = allData.map(r => fields.map(f => r[f.key] ?? ''));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ...rows]), 'Data');
    _download(wb, `Data_${datasetLabel}_${_ts()}.xlsx`);
  }

  return { exportTLL, exportSaleOut, exportPivot, exportRawData };
})();
