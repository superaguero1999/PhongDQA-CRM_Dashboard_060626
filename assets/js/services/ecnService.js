const EcnService = (() => {
  let _namespace = 'spm1';

  // ── Helpers ────────────────────────────────────────────────────────────────
  const _nc = () => _namespace === 'spm2' ? APP_CONFIG.nocodb2 : APP_CONFIG.nocodb;

  const _store = () => _namespace === 'spm2'
    ? { getAll: StorageService.getEcn2All, putMany: StorageService.putEcn2Many, clearAndPut: StorageService.clearAndPutEcn2Many }
    : { getAll: StorageService.getEcnAll,  putMany: StorageService.putEcnMany,  clearAndPut: StorageService.clearAndPutEcnMany };

  const _key = r => `${r.model_code}|${r.applied_month}|${r.ecn_code}`;

  function _headers() {
    return { 'Content-Type': 'application/json', 'xc-token': _nc().token };
  }

  function _isConfigured() {
    const nc = _nc();
    return !!(nc && nc.baseUrl && nc.token && nc.ecnTableId);
  }

  function _apiUrl() {
    const nc = _nc();
    return `${nc.baseUrl}/api/v2/tables/${nc.ecnTableId}/records`;
  }

  // Chỉ gửi các field NocoDB cần — bỏ _key nếu NocoDB không có cột đó, giữ lại nếu có
  function _toNcRecord(r, includeId = false) {
    const obj = {
      _key:          r._key,
      model_code:    r.model_code,
      ecn_code:      r.ecn_code,
      ecn_name:      r.ecn_name,
      applied_month: r.applied_month,
      actual_date:   r.actual_date || '',
    };
    if (includeId && r.Id) obj.Id = r.Id;
    return obj;
  }

  function setNamespace(ns) { _namespace = ns; }

  // ── Fetch all ECN records ──────────────────────────────────────────────────
  async function fetchAll() {
    if (_isConfigured()) {
      try {
        const records = [];
        let offset = 0;
        const limit = 1000;
        while (true) {
          const res = await fetch(`${_apiUrl()}?limit=${limit}&offset=${offset}`, { headers: _headers() });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json = await res.json();
          const list = json.list || [];
          list.forEach(r => records.push(_normalise(r)));
          if (records.length >= (json.pageInfo?.totalRows || 0) || list.length < limit) break;
          offset += limit;
        }
        await _store().clearAndPut(records);
        return records;
      } catch (e) {
        console.warn('[EcnService] NocoDB fetch failed, falling back to IndexedDB:', e.message);
      }
    }
    return (await _store().getAll()) || [];
  }

  // ── Normalise a raw NocoDB or imported record ──────────────────────────────
  function _normalise(r) {
    return {
      _key:          _key(r),
      model_code:    String(r.model_code  || '').trim(),
      ecn_code:      String(r.ecn_code    || '').trim(),
      ecn_name:      String(r.ecn_name     || '').trim(),
      applied_month: String(r.applied_month || '').trim(),
      actual_date:   String(r.actual_date  || '').trim(),
      ...(r.Id ? { Id: r.Id } : {}),
    };
  }

  // ── Batch upsert to IndexedDB (+ NocoDB if configured) ────────────────────
  async function batchUpsert(records, { batchSize = 100, onProgress } = {}) {
    const keyed = records.map(r => _normalise({ ...r, _key: _key(r) }));

    // Dedup với data đang có trong IndexedDB
    const existing = await _store().getAll();
    const existingSet = new Set(existing.map(r => r._key));
    const toAdd = keyed.filter(r => !existingSet.has(r._key));
    const toUpdate = keyed.filter(r => existingSet.has(r._key));
    const merged = [...existing.filter(r => !keyed.find(n => n._key === r._key)), ...keyed];
    await _store().clearAndPut(merged);

    if (_isConfigured()) {
      try {
        const total = toAdd.length + toUpdate.length;
        let done = 0;
        for (let i = 0; i < toAdd.length; i += batchSize) {
          const batch = toAdd.slice(i, i + batchSize).map(r => _toNcRecord(r, false));
          await fetch(_apiUrl(), { method: 'POST', headers: _headers(), body: JSON.stringify(batch) });
          done += Math.min(batchSize, toAdd.length - i);
          onProgress?.(done, total);
        }
        // Update existing (need NocoDB Id — skip if not present)
        const withId = toUpdate.filter(r => r.Id);
        for (let i = 0; i < withId.length; i += batchSize) {
          const batch = withId.slice(i, i + batchSize).map(r => _toNcRecord(r, true));
          await fetch(_apiUrl(), { method: 'PATCH', headers: _headers(), body: JSON.stringify(batch) });
          done += Math.min(batchSize, withId.length - i);
          onProgress?.(done, total);
        }
      } catch (e) {
        console.warn('[EcnService] NocoDB upsert failed (data saved locally):', e.message);
      }
    }

    onProgress?.(keyed.length, keyed.length);
    return { added: toAdd.length, updated: toUpdate.length };
  }

  // ── Delete all ECN records for current namespace ───────────────────────────
  async function deleteAll() {
    await _store().clearAndPut([]);
  }

  // ── Build fast lookup map ──────────────────────────────────────────────────
  // Returns: { model_code: { applied_month: [ecn_records] } }
  function buildEcnMap(records) {
    const map = {};
    for (const r of records) {
      if (!r.model_code || !r.applied_month) continue;
      if (!map[r.model_code]) map[r.model_code] = {};
      if (!map[r.model_code][r.applied_month]) map[r.model_code][r.applied_month] = [];
      map[r.model_code][r.applied_month].push(r);
    }
    return map;
  }

  return { setNamespace, fetchAll, batchUpsert, deleteAll, buildEcnMap };
})();
