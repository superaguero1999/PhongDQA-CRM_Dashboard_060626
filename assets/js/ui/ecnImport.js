const EcnImport = (() => {
  const MONTH_NAMES_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const MONTH_PATTERN = /^Y\d{4}$|^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\/\d{2}$/i;

  let _workbook = null;
  let _parsedRecords = [];
  let _onComplete = null;
  let _currentStep = 1;

  // ── Date helpers ────────────────────────────────────────────────────────
  function _cellDateStr(c) {
    if (!c) return '';
    let dt = null;
    if (c instanceof Date && !isNaN(c)) {
      dt = c;
    } else if (typeof c === 'number' && Number.isFinite(c) && c > 40000) {
      // Math.round tránh lỗi float thập phân (45529.9999 → 45530 → đúng ngày)
      dt = new Date(Math.round(c - 25569) * 86400 * 1000);
    }
    if (dt) {
      const d = String(dt.getDate()).padStart(2, '0');
      const m = String(dt.getMonth() + 1).padStart(2, '0');
      return `${d}/${m}/${dt.getFullYear()}`;
    }
    return String(c).trim();
  }

  // ── Month helpers (giống saleOutImport.js) ──────────────────────────────
  function _cellStr(c) {
    if (c instanceof Date) {
      return `${MONTH_NAMES_SHORT[c.getMonth()]}/${String(c.getFullYear()).slice(2)}`;
    }
    if (typeof c === 'number' && Number.isFinite(c)) {
      const s = String(Math.round(c));
      if (/^\d{4}$/.test(s)) {
        const mm = parseInt(s.slice(2), 10);
        if (mm >= 1 && mm <= 12) return 'Y' + s;
      }
    }
    return String(c || '').trim();
  }

  function _toYYMM(monthStr) {
    if (/^Y\d{4}$/.test(monthStr)) return monthStr;
    const parts = monthStr.split('/');
    if (parts.length !== 2) return monthStr;
    const idx = MONTH_NAMES_SHORT.indexOf(parts[0]);
    if (idx < 0) return monthStr;
    return `Y${parts[1]}${String(idx + 1).padStart(2, '0')}`;
  }

  // ── Normalise string dùng cho fuzzy match ─────────────────────────────────
  function _norm(s) {
    return String(s || '').toLowerCase()
      .normalize('NFD').replace(/\p{M}/gu, '')
      .replace(/đ/g, 'd').replace(/\s+/g, ' ').trim();
  }

  // ── Auto-detect column indices từ header row ──────────────────────────────
  const COL_CANDIDATES = {
    model_code:    ['ma sp', 'model code', 'model', 'ma san pham', 'product code', 'product_code'],
    ecn_code:      ['ma ecn', 'ecn code', 'ecn_code', 'ecn ma', 'ma ecn', 'ecn'],
    ecn_name:      ['ten ecn', 'ecn name', 'ecn_name', 'noi dung ecn', 'noi dung', 'ten ecn'],
    applied_month: ['thang ap dung', 'thang ap dung', 'applied month', 'month', 'ap dung'],
    actual_date:   ['thoi gian ap dung thuc te', 'thoi gian thuc te', 'ngay ap dung', 'actual date', 'applied date', 'thoi gian ap dung', 'thoi gian'],
  };

  function _detectCols(headerRow) {
    const result = { model_code: -1, ecn_code: -1, ecn_name: -1, applied_month: -1, actual_date: -1 };
    const used = new Set();
    for (const field of Object.keys(result)) {
      const candidates = COL_CANDIDATES[field];
      let bestIdx = -1, bestScore = 0;
      headerRow.forEach((h, i) => {
        if (used.has(i)) return;
        const hn = _norm(h);
        for (const cand of candidates) {
          let score = 0;
          if (hn === cand) score = 3;
          else if (hn.includes(cand)) score = 2;
          else if (cand.includes(hn) && hn.length > 2) score = 1;
          if (score > bestScore) { bestScore = score; bestIdx = i; }
        }
      });
      if (bestIdx >= 0 && bestScore > 0) {
        result[field] = bestIdx;
        used.add(bestIdx);
      }
    }
    return result;
  }

  // ── Parse file Excel ───────────────────────────────────────────────────────
  function _parseFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => {
        try {
          _workbook = XLSX.read(e.target.result, { type: 'array', cellDates: true });
          resolve(_workbook.SheetNames);
        } catch (err) { reject(err); }
      };
      reader.onerror = () => reject(new Error('Không đọc được file'));
      reader.readAsArrayBuffer(file);
    });
  }

  // ── Parse sheet → ECN records ──────────────────────────────────────────────
  function _parseSheet(sheetName) {
    const sheet = _workbook.Sheets[sheetName];
    const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    if (!raw.length) throw new Error('Sheet rỗng');

    // Tìm header row: hàng đầu tiên có >= 2 ô không rỗng trong 15 hàng đầu
    let headerRowIdx = -1;
    for (let r = 0; r < Math.min(15, raw.length); r++) {
      const nonEmpty = raw[r].filter(c => String(c || '').trim().length > 0).length;
      if (nonEmpty >= 2) { headerRowIdx = r; break; }
    }
    if (headerRowIdx < 0) throw new Error('Không tìm thấy hàng header');

    const headerRow = raw[headerRowIdx].map(c => String(c || '').trim());
    const cols = _detectCols(headerRow);

    if (cols.model_code < 0) throw new Error('Không tìm thấy cột "Mã SP" (model_code)');
    if (cols.ecn_code < 0)   throw new Error('Không tìm thấy cột "Mã ECN" (ecn_code)');
    if (cols.applied_month < 0) throw new Error('Không tìm thấy cột "Tháng áp dụng" (applied_month)');

    const records = [];
    for (let r = headerRowIdx + 1; r < raw.length; r++) {
      const row = raw[r];
      const modelCode = String(row[cols.model_code] || '').trim();
      const ecnCode   = String(row[cols.ecn_code]   || '').trim();
      if (!modelCode || !ecnCode) continue;

      let appliedMonth = _cellStr(row[cols.applied_month]);
      if (!appliedMonth) continue;
      // Convert về format chuẩn Y2501
      if (MONTH_PATTERN.test(appliedMonth)) appliedMonth = _toYYMM(appliedMonth);

      const ecnName    = cols.ecn_name   >= 0 ? String(row[cols.ecn_name]   || '').trim() : '';
      const actualDate = cols.actual_date >= 0 ? _cellDateStr(row[cols.actual_date]) : '';
      records.push({ model_code: modelCode, ecn_code: ecnCode, ecn_name: ecnName, applied_month: appliedMonth, actual_date: actualDate });
    }

    if (!records.length) throw new Error('Không có dòng dữ liệu hợp lệ. Kiểm tra lại file Excel.');
    return records;
  }

  // ── UI helpers ──────────────────────────────────────────────────────────────
  function _el(id) { return document.getElementById(id); }

  function _goToStep(step) {
    _currentStep = step;
    [1, 2, 3].forEach(s => {
      const el = _el(`ecn-import-step-${s}`);
      if (el) el.style.display = s === step ? '' : 'none';
      const dot = _el(`ecn-step-dot-${s}`);
      if (dot) {
        dot.className = `w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold ${
          s < step  ? 'bg-purple-600 text-white' :
          s === step ? 'bg-purple-600 text-white ring-4 ring-purple-200' :
          'bg-gray-200 text-gray-500'
        }`;
      }
    });
    const backBtn = _el('ecn-import-back-btn');
    if (backBtn) backBtn.style.display = step > 1 && step < 3 ? '' : 'none';
    const nextBtn = _el('ecn-import-next-btn');
    if (nextBtn) {
      if (step === 1) { nextBtn.style.display = ''; nextBtn.textContent = 'Tiếp theo →'; nextBtn.disabled = true; }
      if (step === 2) { nextBtn.style.display = ''; nextBtn.textContent = '🚀 Bắt đầu Import'; nextBtn.disabled = false; }
      if (step === 3) { nextBtn.style.display = 'none'; }
    }
  }

  function _renderPreview() {
    const stats = _el('ecn-preview-stats');
    const products = [...new Set(_parsedRecords.map(r => r.model_code))];
    const months   = [...new Set(_parsedRecords.map(r => r.applied_month))].sort();
    if (stats) {
      stats.innerHTML = `
        <div class="flex gap-3 flex-wrap mb-3">
          <span class="inline-flex items-center gap-1 px-3 py-1 bg-purple-50 text-purple-700 rounded-full text-xs font-medium">
            🔧 ${products.length} sản phẩm
          </span>
          <span class="inline-flex items-center gap-1 px-3 py-1 bg-amber-50 text-amber-700 rounded-full text-xs font-medium">
            📅 ${months.length} tháng (${months[0]} → ${months[months.length - 1]})
          </span>
          <span class="inline-flex items-center gap-1 px-3 py-1 bg-gray-100 text-gray-600 rounded-full text-xs font-medium">
            📋 ${_parsedRecords.length} ECN records
          </span>
        </div>`;
    }

    const tbl = _el('ecn-preview-table');
    if (!tbl) return;
    const preview = _parsedRecords.slice(0, 10);
    tbl.innerHTML = `
      <thead class="bg-gray-50 sticky top-0">
        <tr>
          <th class="px-3 py-2 text-left text-xs font-semibold text-gray-500 border-b">Mã SP</th>
          <th class="px-3 py-2 text-left text-xs font-semibold text-gray-500 border-b">Mã ECN</th>
          <th class="px-3 py-2 text-left text-xs font-semibold text-gray-500 border-b">Tên ECN</th>
          <th class="px-3 py-2 text-left text-xs font-semibold text-gray-500 border-b">Tháng áp dụng</th>
          <th class="px-3 py-2 text-left text-xs font-semibold text-gray-500 border-b">Thời gian áp dụng thực tế</th>
        </tr>
      </thead>
      <tbody>
        ${preview.map((r, i) => `
          <tr class="${i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}">
            <td class="px-3 py-1.5 text-xs font-medium text-gray-700">${r.model_code}</td>
            <td class="px-3 py-1.5 text-xs text-purple-700 font-semibold">${r.ecn_code}</td>
            <td class="px-3 py-1.5 text-xs text-gray-600">${r.ecn_name || '—'}</td>
            <td class="px-3 py-1.5 text-xs text-amber-700 font-medium">${r.applied_month}</td>
            <td class="px-3 py-1.5 text-xs text-gray-500">${r.actual_date || '—'}</td>
          </tr>`).join('')}
        ${_parsedRecords.length > 10 ? `
          <tr><td colspan="5" class="px-3 py-2 text-xs text-gray-400 italic">
            ... và ${_parsedRecords.length - 10} dòng khác
          </td></tr>` : ''}
      </tbody>`;
  }

  async function _doImport() {
    const bar    = _el('ecn-import-progress-bar');
    const txt    = _el('ecn-import-progress-text');
    const doneBtn = _el('ecn-import-done-btn');
    try {
      const result = await EcnService.batchUpsert(_parsedRecords, {
        batchSize: 100,
        onProgress: (done, total) => {
          const pct = Math.round(done / total * 100);
          if (bar) bar.style.width = pct + '%';
          if (txt) txt.textContent = `${done} / ${total} records (${pct}%)`;
        },
      });
      if (txt) txt.textContent = `✓ Hoàn tất: ${result.added} thêm mới, ${result.updated} cập nhật`;
      if (bar) bar.style.width = '100%';
      if (doneBtn) doneBtn.style.display = '';
      if (_onComplete) _onComplete(_parsedRecords);
    } catch (err) {
      if (txt) txt.textContent = '✕ Lỗi: ' + err.message;
      console.error('[EcnImport]', err);
    }
  }

  // ── Init ────────────────────────────────────────────────────────────────────
  function init() {
    const modal = _el('ecn-import-modal');
    if (!modal) return;

    _el('ecn-import-close-btn')?.addEventListener('click', () => modal.classList.add('hidden'));

    const dropzone  = _el('ecn-import-dropzone');
    const fileInput = _el('ecn-import-file-input');

    dropzone?.addEventListener('click', () => fileInput?.click());
    dropzone?.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('border-purple-400', 'bg-purple-50'); });
    dropzone?.addEventListener('dragleave', () => dropzone.classList.remove('border-purple-400', 'bg-purple-50'));
    dropzone?.addEventListener('drop', e => {
      e.preventDefault();
      dropzone.classList.remove('border-purple-400', 'bg-purple-50');
      const file = e.dataTransfer?.files?.[0];
      if (file) _handleFile(file);
    });
    fileInput?.addEventListener('change', () => {
      if (fileInput.files?.[0]) _handleFile(fileInput.files[0]);
    });

    _el('ecn-import-back-btn')?.addEventListener('click', () => _goToStep(1));

    _el('ecn-import-next-btn')?.addEventListener('click', async () => {
      if (_currentStep === 1) {
        if (_parsedRecords.length === 0) return;
        _renderPreview();
        _goToStep(2);
      } else if (_currentStep === 2) {
        _goToStep(3);
        await _doImport();
      }
    });

    _el('ecn-import-done-btn')?.addEventListener('click', () => modal.classList.add('hidden'));
  }

  function _handleFile(file) {
    const namEl = _el('ecn-import-file-name');
    if (namEl) namEl.textContent = file.name;
    _parsedRecords = [];

    _parseFile(file).then(sheetNames => {
      if (sheetNames.length === 1) {
        _tryParseSheet(sheetNames[0]);
        const nextBtn = _el('ecn-import-next-btn');
        if (nextBtn) nextBtn.disabled = _parsedRecords.length === 0;
        const sl = _el('ecn-sheet-list');
        if (sl) sl.style.display = 'none';
      } else {
        const sl = _el('ecn-sheet-list');
        const slItems = _el('ecn-sheet-list-items');
        if (sl) sl.style.display = '';
        if (slItems) {
          slItems.innerHTML = sheetNames.map(name => `
            <button class="ecn-sheet-btn text-sm px-4 py-2 border border-gray-300 rounded-lg
                           hover:bg-purple-50 hover:border-purple-400 transition-colors text-left"
                    data-sheet="${name}">${name}</button>`).join('');
          slItems.querySelectorAll('.ecn-sheet-btn').forEach(btn => {
            btn.addEventListener('click', () => {
              slItems.querySelectorAll('.ecn-sheet-btn').forEach(b => b.classList.remove('bg-purple-50', 'border-purple-500'));
              btn.classList.add('bg-purple-50', 'border-purple-500');
              _tryParseSheet(btn.dataset.sheet);
              const nextBtn = _el('ecn-import-next-btn');
              if (nextBtn) nextBtn.disabled = _parsedRecords.length === 0;
            });
          });
        }
      }
    }).catch(err => alert('Lỗi đọc file: ' + err.message));
  }

  function _tryParseSheet(sheetName) {
    try {
      _parsedRecords = _parseSheet(sheetName);
    } catch (err) {
      alert('Lỗi parse sheet: ' + err.message);
      _parsedRecords = [];
    }
  }

  function open(onComplete) {
    _onComplete = onComplete;
    _workbook = null;
    _parsedRecords = [];
    const modal = _el('ecn-import-modal');
    if (!modal) return;
    _el('ecn-import-file-input') && (_el('ecn-import-file-input').value = '');
    _el('ecn-import-file-name') && (_el('ecn-import-file-name').textContent = '');
    _el('ecn-sheet-list') && (_el('ecn-sheet-list').style.display = 'none');
    _el('ecn-import-done-btn') && (_el('ecn-import-done-btn').style.display = 'none');
    _el('ecn-import-progress-bar') && (_el('ecn-import-progress-bar').style.width = '0%');
    _el('ecn-import-progress-text') && (_el('ecn-import-progress-text').textContent = '');
    _goToStep(1);
    modal.classList.remove('hidden');
  }

  return { init, open };
})();
