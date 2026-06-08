const ExcelService = (() => {
  // Chuẩn hóa text để fuzzy match: lowercase, bỏ dấu, bỏ space
  function normalize(s) {
    if (!s) return '';
    return s.toString()
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')  // bỏ dấu
      .replace(/[^a-z0-9]/g, '');                        // bỏ ký tự đặc biệt
  }

  // Parse file ArrayBuffer → workbook
  function parseWorkbook(arrayBuffer) {
    return XLSX.read(arrayBuffer, { type: 'array', cellText: true, cellDates: true });
  }

  // Lấy tên các sheets
  function getSheetNames(workbook) {
    return workbook.SheetNames;
  }

  // Detect hàng header (hàng đầu tiên có nhiều ô text nhất trong 10 hàng đầu)
  function detectHeaderRow(worksheet) {
    const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
    let bestRow = range.s.r;
    let bestScore = 0;
    for (let r = range.s.r; r <= Math.min(range.s.r + 9, range.e.r); r++) {
      let score = 0;
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cell = worksheet[XLSX.utils.encode_cell({ r, c })];
        if (cell && cell.v && typeof cell.v === 'string' && cell.v.trim()) score++;
      }
      if (score > bestScore) { bestScore = score; bestRow = r; }
    }
    return bestRow;
  }

  // Trích xuất headers từ hàng header
  function extractHeaders(worksheet, headerRow) {
    const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
    const headers = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = worksheet[XLSX.utils.encode_cell({ r: headerRow, c })];
      const text = cell ? (cell.w || String(cell.v || '')).trim() : '';
      headers.push({ col: c, text, key: normalize(text) });
    }
    return headers.filter(h => h.text);
  }

  // Auto-map Excel headers → field definitions bằng fuzzy matching
  function autoMapFields(excelHeaders, fieldDefs) {
    const mapping = {};  // fieldKey → colIndex
    const usedCols = new Set();

    for (const field of fieldDefs) {
      let bestCol = null;
      let bestScore = 0;
      const needles = [normalize(field.label), ...field.candidates.map(normalize)];

      for (const header of excelHeaders) {
        if (usedCols.has(header.col)) continue;
        for (const needle of needles) {
          if (header.key === needle || header.key.includes(needle) || needle.includes(header.key)) {
            const score = needle === header.key ? 3 : needle.includes(header.key) ? 2 : 1;
            if (score > bestScore) { bestScore = score; bestCol = header.col; }
          }
        }
      }
      if (bestCol !== null) {
        mapping[field.key] = bestCol;
        usedCols.add(bestCol);
      }
    }
    return mapping;
  }

  // Lấy giá trị 1 cell dưới dạng string
  function getCellValue(worksheet, row, col) {
    const cell = worksheet[XLSX.utils.encode_cell({ r: row, c: col })];
    if (!cell) return '';
    if (cell.t === 'd') {
      // Date cell
      const d = cell.v;
      if (d instanceof Date) return d.toISOString().split('T')[0];
    }
    return (cell.w !== undefined ? cell.w : String(cell.v ?? '')).trim();
  }

  // Parse toàn bộ rows từ 1 sheet với mapping
  function parseRows(worksheet, headerRow, colMapping) {
    const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
    const rows = [];
    for (let r = headerRow + 1; r <= range.e.r; r++) {
      const obj = {};
      let hasData = false;
      for (const [fieldKey, col] of Object.entries(colMapping)) {
        const val = getCellValue(worksheet, r, col);
        obj[fieldKey] = val;
        if (val) hasData = true;
      }
      if (hasData) rows.push(obj);
    }
    return rows;
  }

  // Tạo row key từ record dựa trên rowKeyFields config
  function buildRowKey(record) {
    return APP_CONFIG.rowKeyFields.map(f => (record[f] || '').toString().trim()).join('__');
  }

  return { parseWorkbook, getSheetNames, detectHeaderRow, extractHeaders, autoMapFields, parseRows, buildRowKey, normalize };
})();
