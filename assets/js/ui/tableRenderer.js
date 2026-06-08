const TableRenderer = (() => {
  function render(pivotResult, containerId, title) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const { rowKeys, colKeys, cells, grandTotals, valueConfigs } = pivotResult;

    if (!rowKeys.length || !colKeys.length || !valueConfigs.length) {
      container.innerHTML = `
        <div class="flex flex-col items-center justify-center py-16 text-gray-400">
          <svg class="w-12 h-12 mb-3 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3 10h18M3 6h18M3 14h18M3 18h18"/>
          </svg>
          <p class="text-sm">Chưa có dữ liệu. Kéo các trường vào Rows, Columns và Values để tạo bảng.</p>
        </div>`;
      return;
    }

    const multiVal = valueConfigs.length > 1;

    // Header row(s)
    let thead = '<thead class="sticky top-0 z-10">';
    thead += '<tr class="bg-gray-100">';
    thead += `<th class="border border-gray-300 px-3 py-2 text-left text-xs font-semibold text-gray-500 min-w-32 sticky left-0 bg-gray-100 z-20 italic">${title || ''}</th>`;
    colKeys.forEach((ck, ci) => {
      const span = multiVal ? valueConfigs.length : 1;
      thead += `<th class="border border-gray-300 px-3 py-2 text-center text-xs font-semibold text-gray-700 pivot-col-${ci}" colspan="${span}">${ck}</th>`;
    });
    thead += `<th class="border border-gray-300 px-3 py-2 text-center text-xs font-semibold text-blue-700 bg-blue-50" colspan="${multiVal ? valueConfigs.length : 1}">Tổng</th>`;
    thead += '</tr>';

    if (multiVal) {
      thead += '<tr class="bg-gray-50">';
      thead += `<th class="border border-gray-300 px-3 py-2 sticky left-0 bg-gray-50 z-20"></th>`;
      [...colKeys, '__total__'].forEach((ck, ci) => {
        valueConfigs.forEach((vc, vi) => {
          const isTotal = ck === '__total__';
          thead += `<th class="border border-gray-300 px-2 py-1 text-center text-xs text-gray-500 ${isTotal ? 'bg-blue-50' : `pivot-col-${ci}`}">${vc.field}</th>`;
        });
      });
      thead += '</tr>';
    }
    thead += '</thead>';

    // Body
    let tbody = '<tbody>';
    rowKeys.forEach((rk, ri) => {
      tbody += `<tr class="${ri % 2 === 0 ? 'bg-white' : 'bg-gray-50'} hover:bg-blue-50 transition-colors">`;
      tbody += `<td class="border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 sticky left-0 ${ri % 2 === 0 ? 'bg-white' : 'bg-gray-50'} z-10">${rk}</td>`;
      colKeys.forEach((ck, ci) => {
        const cell = cells[`${rk}|||${ck}`] || [];
        valueConfigs.forEach((vc, vi) => {
          const val = cell[vi];
          tbody += `<td class="border border-gray-300 px-3 py-2 text-sm text-right text-gray-700 pivot-col-${ci}">${PivotEngine.fmt(val)}</td>`;
        });
      });
      // Row grand total
      const rowTotals = grandTotals.rows[rk] || [];
      valueConfigs.forEach((vc, vi) => {
        tbody += `<td class="border border-gray-300 px-3 py-2 text-sm text-right font-semibold text-blue-700 bg-blue-50">${PivotEngine.fmt(rowTotals[vi])}</td>`;
      });
      tbody += '</tr>';
    });

    // Column totals row
    tbody += '<tr class="bg-blue-50 font-semibold">';
    tbody += `<td class="border border-gray-300 px-3 py-2 text-sm text-blue-700 sticky left-0 bg-blue-50 z-10">Tổng</td>`;
    colKeys.forEach((ck, ci) => {
      const colTotals = grandTotals.cols[ck] || [];
      valueConfigs.forEach((vc, vi) => {
        tbody += `<td class="border border-gray-300 px-3 py-2 text-sm text-right text-blue-700 pivot-col-${ci}">${PivotEngine.fmt(colTotals[vi])}</td>`;
      });
    });
    // Grand total
    valueConfigs.forEach((vc, vi) => {
      tbody += `<td class="border border-gray-300 px-3 py-2 text-sm text-right text-blue-800 font-bold bg-blue-100">${PivotEngine.fmt(grandTotals.grand[vi])}</td>`;
    });
    tbody += '</tr>';
    tbody += '</tbody>';

    container.innerHTML = `
      <div class="overflow-auto max-h-[60vh] rounded-lg border border-gray-200 shadow-sm">
        <table class="border-collapse text-sm w-full">
          ${thead}
          ${tbody}
        </table>
      </div>
      <div class="mt-2 text-xs text-gray-400 text-right">${pivotResult.filteredCount} records · ${rowKeys.length} rows × ${colKeys.length} cols</div>
    `;
  }

  return { render };
})();
