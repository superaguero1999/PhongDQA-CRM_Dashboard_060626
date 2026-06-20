const ErrorRateService = (() => {
  const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  // Chuan hoa ten san pham de so khop: trim, collapse spaces, lowercase, bo dau, d-stroke->d
  function normName(s) {
    if (!s) return '';
    return String(s).trim()
      .replace(/\s+/g, ' ')
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .replace(/đ/g, 'd');
  }

  // Chuyen ve so de sap xep — ho tro 2 format:
  //   "Y2501"  -> Y + 2-digit year + 2-digit month  (format chuan moi)
  //   "Jan/25" -> MMM/YY  (fallback cho du lieu cu)
  function monthToNum(m) {
    if (!m) return 0;
    const s = String(m).trim();
    if (/^Y\d{4}$/.test(s)) {
      const yr = parseInt(s.slice(1, 3), 10);
      const mo = parseInt(s.slice(3, 5), 10);
      return (2000 + yr) * 12 + mo;
    }
    const parts = s.split('/');
    if (parts.length === 2) {
      const idx = MONTH_NAMES.indexOf(parts[0]);
      const yr  = parseInt(parts[1], 10);
      if (idx >= 0 && !isNaN(yr)) return (2000 + yr) * 12 + (idx + 1);
    }
    return 0;
  }

  function sortMonths(months) {
    return [...months].sort((a, b) => monthToNum(a) - monthToNum(b));
  }

  function getUniqueMonths(saleout) {
    return sortMonths([...new Set(saleout.map(r => r.month).filter(Boolean))]);
  }

  function getUniqueProducts(saleout) {
    return [...new Set(saleout.map(r => r.short_name).filter(Boolean))];
  }

  // Loc du lieu theo filters = { months: [], shortNames: [] }
  // Mang rong = khong loc (hien tat ca)
  function _applyFilters(errors, saleout, filters) {
    const { months = [], shortNames = [] } = filters || {};
    let fe = errors;
    let fs = saleout;
    if (months.length > 0) {
      const mSet = new Set(months);
      fe = fe.filter(r => mSet.has(r.month));
      fs = fs.filter(r => mSet.has(r.month));
    }
    if (shortNames.length > 0) {
      const nSet = new Set(shortNames.map(normName));
      fe = fe.filter(r => nSet.has(normName(r.product_shortname)));
      fs = fs.filter(r => nSet.has(normName(r.short_name)));
    }
    return { fe, fs };
  }

  // Ty le loi theo san pham
  function calcByProduct(errors, saleout, filters) {
    const { fe, fs } = _applyFilters(errors, saleout, filters);

    // Map: normalized name -> original display name (tu saleout)
    const normToOrig = new Map();
    for (const r of fs) {
      const k = normName(r.short_name);
      if (k && !normToOrig.has(k)) normToOrig.set(k, r.short_name);
    }
    const saleProds = new Set(normToOrig.keys());

    const errMap = new Map();
    for (const r of fe) {
      const k = normName(r.product_shortname);
      if (!k || !saleProds.has(k)) continue;
      errMap.set(k, (errMap.get(k) || 0) + 1);
    }

    const saleMap = new Map();
    for (const r of fs) {
      const k = normName(r.short_name);
      if (!k) continue;
      saleMap.set(k, (saleMap.get(k) || 0) + (Number(r.value) || 0));
    }

    return [...saleProds].sort().map(p => {
      const errCount  = errMap.get(p)  || 0;
      const saleTotal = saleMap.get(p) || 0;
      const rate = saleTotal > 0 ? (errCount / saleTotal * 100) : null;
      return { short_name: normToOrig.get(p) || p, errors: errCount, sale: saleTotal, rate };
    });
  }

  // Ty le loi theo thang -- TLL% tinh LUY KE
  function calcByMonth(errors, saleout, filters) {
    const { fe, fs } = _applyFilters(errors, saleout, filters);

    const saleProds = new Set(fs.map(r => normName(r.short_name)).filter(Boolean));

    const errMap = new Map();
    for (const r of fe) {
      const k = r.month;
      if (!k || !saleProds.has(normName(r.product_shortname))) continue;
      errMap.set(k, (errMap.get(k) || 0) + 1);
    }

    const saleMap = new Map();
    for (const r of fs) {
      const k = r.month;
      if (!k) continue;
      saleMap.set(k, (saleMap.get(k) || 0) + (Number(r.value) || 0));
    }

    const allMonths = sortMonths([...new Set(fs.map(r => r.month).filter(Boolean))]);

    let cumErr = 0, cumSale = 0;
    return allMonths.map(m => {
      const monthErr  = errMap.get(m)  || 0;
      const monthSale = saleMap.get(m) || 0;
      cumErr  += monthErr;
      cumSale += monthSale;
      const rate = (monthErr === 0 && monthSale === 0)
        ? null
        : (cumSale > 0 ? (cumErr / cumSale * 100) : null);
      return { month: m, errors: monthErr, sale: monthSale, rate };
    });
  }

  function fmtRate(rate) {
    if (rate === null || rate === undefined) return 'N/A';
    return rate.toFixed(2) + '%';
  }

  return { normName, monthToNum, sortMonths, getUniqueMonths, getUniqueProducts, calcByProduct, calcByMonth, fmtRate };
})();