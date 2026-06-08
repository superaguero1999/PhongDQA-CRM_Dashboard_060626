const PivotBuilder = (() => {
  // State hiện tại của pivot config
  let _config = {
    rows: [],     // [fieldKey, ...]
    cols: [],     // [fieldKey, ...]
    values: [],   // [{ field, agg }, ...]
    filters: [],  // [{ field, op, value }, ...]
  };
  let _onChange = null;

  function getConfig() { return JSON.parse(JSON.stringify(_config)); }

  function setConfig(cfg) {
    _config = cfg;
    renderZones();
    if (_onChange) _onChange(_config);
  }

  function fieldLabel(key) {
    const f = APP_CONFIG.fieldDefinitions.find(d => d.key === key);
    return f ? f.label : key;
  }

  function aggLabel(agg) {
    const a = APP_CONFIG.aggregations.find(d => d.key === agg);
    return a ? a.label : agg;
  }

  // Render danh sách fields bên trái
  function renderFieldList() {
    const container = document.getElementById('pivot-field-list');
    if (!container) return;
    container.innerHTML = APP_CONFIG.fieldDefinitions.map(f => `
      <div class="field-chip flex items-center justify-between px-2 py-1.5 rounded bg-gray-100 hover:bg-blue-100 cursor-grab text-sm text-gray-700 select-none"
           draggable="true" data-field="${f.key}">
        <span>${f.label}</span>
        <span class="text-xs text-gray-400">${f.type}</span>
      </div>
    `).join('');

    container.querySelectorAll('[draggable]').forEach(el => {
      el.addEventListener('dragstart', e => {
        e.dataTransfer.setData('text/plain', el.dataset.field);
        e.dataTransfer.effectAllowed = 'copy';
      });
    });
  }

  // Render zones (Rows / Cols / Values / Filters) trong editor mode
  function renderZones() {
    if (!AuthService.isEditor()) return;

    renderZone('pivot-zone-rows', _config.rows, 'rows');
    renderZone('pivot-zone-cols', _config.cols, 'cols');
    renderValueZone();
    renderFilterZone();
  }

  function renderZone(containerId, fields, zoneName) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = fields.map((fk, i) => `
      <span class="zone-tag inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 text-xs font-medium">
        ${fieldLabel(fk)}
        <button class="remove-tag ml-1 text-blue-500 hover:text-red-500 font-bold leading-none" data-zone="${zoneName}" data-index="${i}" title="Xóa">×</button>
      </span>
    `).join('') || '<span class="text-xs text-gray-400 italic">Kéo trường vào đây...</span>';

    el.querySelectorAll('.remove-tag').forEach(btn => {
      btn.addEventListener('click', () => {
        _config[zoneName].splice(parseInt(btn.dataset.index), 1);
        renderZones();
        if (_onChange) _onChange(_config);
      });
    });

    // Drop target
    el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('ring-2', 'ring-blue-400'); });
    el.addEventListener('dragleave', () => el.classList.remove('ring-2', 'ring-blue-400'));
    el.addEventListener('drop', e => {
      e.preventDefault();
      el.classList.remove('ring-2', 'ring-blue-400');
      const field = e.dataTransfer.getData('text/plain');
      if (field && !_config[zoneName].includes(field)) {
        _config[zoneName].push(field);
        renderZones();
        if (_onChange) _onChange(_config);
      }
    });
  }

  function renderValueZone() {
    const el = document.getElementById('pivot-zone-values');
    if (!el) return;
    el.innerHTML = _config.values.map((v, i) => `
      <span class="zone-tag inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 text-green-800 text-xs font-medium">
        ${fieldLabel(v.field)}
        <select class="agg-select bg-transparent text-green-700 text-xs border-0 focus:outline-none cursor-pointer" data-index="${i}">
          ${APP_CONFIG.aggregations.map(a => `<option value="${a.key}" ${a.key === v.agg ? 'selected' : ''}>${a.key.toUpperCase()}</option>`).join('')}
        </select>
        <button class="remove-tag text-green-500 hover:text-red-500 font-bold leading-none" data-index="${i}" title="Xóa">×</button>
      </span>
    `).join('') || '<span class="text-xs text-gray-400 italic">Kéo trường số vào đây...</span>';

    el.querySelectorAll('.remove-tag').forEach(btn => {
      btn.addEventListener('click', () => {
        _config.values.splice(parseInt(btn.dataset.index), 1);
        renderZones();
        if (_onChange) _onChange(_config);
      });
    });
    el.querySelectorAll('.agg-select').forEach(sel => {
      sel.addEventListener('change', () => {
        _config.values[parseInt(sel.dataset.index)].agg = sel.value;
        if (_onChange) _onChange(_config);
      });
    });

    el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('ring-2', 'ring-green-400'); });
    el.addEventListener('dragleave', () => el.classList.remove('ring-2', 'ring-green-400'));
    el.addEventListener('drop', e => {
      e.preventDefault();
      el.classList.remove('ring-2', 'ring-green-400');
      const field = e.dataTransfer.getData('text/plain');
      if (field && !_config.values.find(v => v.field === field)) {
        _config.values.push({ field, agg: 'sum' });
        renderZones();
        if (_onChange) _onChange(_config);
      }
    });
  }

  function renderFilterZone() {
    const el = document.getElementById('pivot-zone-filters');
    if (!el) return;
    el.innerHTML = _config.filters.map((f, i) => `
      <span class="zone-tag inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 text-xs font-medium">
        ${fieldLabel(f.field)}
        <select class="filter-op bg-transparent text-purple-700 text-xs border-0 focus:outline-none" data-index="${i}">
          <option value="eq" ${f.op === 'eq' ? 'selected' : ''}>=</option>
          <option value="neq" ${f.op === 'neq' ? 'selected' : ''}>≠</option>
          <option value="contains" ${f.op === 'contains' ? 'selected' : ''}>có chứa</option>
        </select>
        <input class="filter-val bg-white border border-purple-300 rounded px-1 text-xs w-20" data-index="${i}" value="${f.value || ''}">
        <button class="remove-tag text-purple-500 hover:text-red-500 font-bold leading-none" data-index="${i}">×</button>
      </span>
    `).join('') || '<span class="text-xs text-gray-400 italic">Kéo trường vào đây để lọc...</span>';

    el.querySelectorAll('.remove-tag').forEach(btn => {
      btn.addEventListener('click', () => {
        _config.filters.splice(parseInt(btn.dataset.index), 1);
        renderZones();
        if (_onChange) _onChange(_config);
      });
    });
    el.querySelectorAll('.filter-op').forEach(sel => {
      sel.addEventListener('change', () => {
        _config.filters[parseInt(sel.dataset.index)].op = sel.value;
        if (_onChange) _onChange(_config);
      });
    });
    el.querySelectorAll('.filter-val').forEach(inp => {
      inp.addEventListener('input', () => {
        _config.filters[parseInt(inp.dataset.index)].value = inp.value;
        if (_onChange) _onChange(_config);
      });
    });

    el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('ring-2', 'ring-purple-400'); });
    el.addEventListener('dragleave', () => el.classList.remove('ring-2', 'ring-purple-400'));
    el.addEventListener('drop', e => {
      e.preventDefault();
      el.classList.remove('ring-2', 'ring-purple-400');
      const field = e.dataTransfer.getData('text/plain');
      if (field && !_config.filters.find(f => f.field === field)) {
        _config.filters.push({ field, op: 'eq', value: '' });
        renderZones();
        if (_onChange) _onChange(_config);
      }
    });
  }

  // Render viewer mode: checkbox per field để toggle hiển thị column
  function renderViewerControls(pivotResult) {
    const container = document.getElementById('viewer-field-toggles');
    if (!container) return;
    const { rowKeys, colKeys } = pivotResult;
    container.innerHTML = `
      <div class="text-xs font-semibold text-gray-500 uppercase mb-2">Ẩn/hiện cột</div>
      ${colKeys.map((ck, i) => `
        <label class="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" class="col-toggle accent-blue-600" data-col-index="${i}" checked>
          <span class="text-sm text-gray-700">${ck}</span>
        </label>
      `).join('')}
    `;
    container.querySelectorAll('.col-toggle').forEach(cb => {
      cb.addEventListener('change', () => {
        const colIdx = parseInt(cb.dataset.colIndex);
        document.querySelectorAll(`.pivot-col-${colIdx}`).forEach(td => {
          td.style.display = cb.checked ? '' : 'none';
        });
      });
    });
  }

  function init(onChange) {
    _onChange = onChange;
    renderFieldList();
    renderZones();
  }

  return { init, getConfig, setConfig, renderZones, renderViewerControls };
})();
