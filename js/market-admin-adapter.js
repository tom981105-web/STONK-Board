(function () {
  "use strict";

  const VERSION = "1.4.0";
  const STORAGE_KEY = "market-admin-data-v1";
  const PATHS = {
    companies: "marketAdmin/companies",
    news: "marketAdmin/news",
    sectors: "marketAdmin/sectors",
    wikiDocs: "marketAdmin/wikiDocs",
    meta: "marketAdmin/meta",
  };
  const FIREBASE_CONFIG = {
    apiKey: "AIzaSyARFa-vzKVmIdxP5xDRXVzasL2ui94eZ-w",
    authDomain: "market-6e66a.firebaseapp.com",
    databaseURL: "https://market-6e66a-default-rtdb.firebaseio.com",
    projectId: "market-6e66a",
    storageBucket: "market-6e66a.firebasestorage.app",
    messagingSenderId: "402312269082",
    appId: "1:402312269082:web:cf304afc54057ea162b0a3",
  };
  const FIREBASE_SDK = [
    "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js",
    "https://www.gstatic.com/firebasejs/10.12.2/firebase-database-compat.js",
  ];
  const COLLECTIONS = ["companies", "news", "sectors", "wikiDocs"];
  const KR = {
    low: "\uB0AE\uC74C",
    normal: "\uBCF4\uD1B5",
    high: "\uB192\uC74C",
    veryHigh: "\uB9E4\uC6B0 \uB192\uC74C",
    listingNormal: "\uC815\uC0C1",
    neutral: "\uC911\uB9BD",
    up: "\uC0C1\uC2B9",
    down: "\uD558\uB77D",
    mixed: "\uD63C\uC870",
    volatility: "\uBCC0\uB3D9\uC131",
    etc: "\uAE30\uD0C0",
    adminSector: "Market Admin",
    market: "\uC2DC\uC7A5",
    building: "\uD83C\uDFE2",
  };

  const state = {
    data: emptyDataset(),
    loaded: false,
    loading: null,
    source: "none",
    firebaseReady: false,
    firebaseFailed: false,
    lastError: "",
    lastLoadedAt: null,
    lastLogKey: "",
    counts: countMap(emptyDataset()),
  };

  function emptyDataset() {
    return { companies: [], news: [], sectors: [], wikiDocs: [], meta: {} };
  }

  function asArray(value) {
    if (Array.isArray(value)) return value.filter(Boolean);
    if (value && typeof value === "object") {
      return Object.entries(value).map(([key, item]) => {
        if (item && typeof item === "object" && !Array.isArray(item)) return { id: item.id || key, ...item };
        return item;
      }).filter(Boolean);
    }
    return [];
  }

  function toTags(value) {
    if (Array.isArray(value)) return value.map((tag) => String(tag).trim()).filter(Boolean);
    return String(value || "").split(",").map((tag) => tag.trim()).filter(Boolean);
  }

  function cleanString(value) {
    return String(value == null ? "" : value).trim();
  }

  function numberOr(fallback, value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, Number(value) || 0));
  }

  function hash(value) {
    let h = 2166136261;
    const text = String(value || "x");
    for (let i = 0; i < text.length; i += 1) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function slug(value) {
    const text = cleanString(value)
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^\w\u3131-\u318E\uAC00-\uD7A3-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    return text || "item-" + Math.random().toString(36).slice(2, 8);
  }

  function tickerFromName(name, id) {
    const fromId = cleanString(id).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
    if (fromId.length >= 3) return fromId;
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let n = hash(name || id);
    let out = "";
    for (let i = 0; i < 4; i += 1) {
      out += letters[n % 26];
      n = Math.floor(n / 26) + 11;
    }
    return out;
  }

  function labelFromScore(score) {
    const value = Number(score);
    if (!Number.isFinite(value)) return KR.normal;
    if (value >= 85) return KR.veryHigh;
    if (value >= 65) return KR.high;
    if (value >= 40) return KR.normal;
    return KR.low;
  }

  function normalizeRisk(value, volatility) {
    const text = cleanString(value);
    if (text && Number.isNaN(Number(text))) return text;
    return labelFromScore(text ? Number(text) : volatility);
  }

  function dateMs(value) {
    if (value == null || value === "") return null;
    if (typeof value === "object") {
      if (typeof value.seconds === "number") return value.seconds * 1000;
      if (typeof value._seconds === "number") return value._seconds * 1000;
    }
    if (typeof value === "number") return value < 1e12 ? value * 1000 : value;
    const parsed = Date.parse(String(value));
    return Number.isNaN(parsed) ? null : parsed;
  }

  function isoDate(value) {
    const ms = dateMs(value);
    const date = new Date(ms || Date.now());
    return date.toISOString().slice(0, 10);
  }

  function isoDateTime(value) {
    const ms = dateMs(value);
    return new Date(ms || Date.now()).toISOString();
  }

  function directionFromEffect(effect) {
    const value = cleanString(effect).toLowerCase();
    if (value === "up") return KR.up;
    if (value === "down") return KR.down;
    if (value === "volatility") return KR.volatility;
    if (value === "mixed") return KR.mixed;
    return KR.neutral;
  }

  function priorityValue(value) {
    const text = cleanString(value).toLowerCase();
    if (text === "breaking") return 1000;
    return numberOr(0, value);
  }

  function findCompany(companies, id) {
    const key = cleanString(id);
    if (!key) return null;
    return (companies || []).find((company) => company.id === key) || null;
  }

  function normalizeDataset(input) {
    const base = emptyDataset();
    const source = input && typeof input === "object" ? (input.marketAdmin || input.data || input) : {};
    base.companies = asArray(source.companies).map(normalizeAdminCompany).filter((item) => item.id && item.name);
    base.sectors = asArray(source.sectors).map(normalizeAdminSector).filter((item) => item.id && item.name);
    base.wikiDocs = asArray(source.wikiDocs).map(normalizeAdminWikiDoc).filter((item) => item.id && item.title);
    base.news = asArray(source.news)
      .map((item) => normalizeAdminNews(item, base.companies))
      .filter((item) => item.id && item.title && isVisibleNews(item));
    base.meta = source.meta && typeof source.meta === "object" ? { ...source.meta } : {};
    return base;
  }

  function normalizeAdminCompany(company) {
    const source = company && typeof company === "object" ? company : {};
    const id = slug(source.id || source.name || source.ticker || "company");
    const name = cleanString(source.name || id);
    const sector = cleanString(source.sector || source.industry || KR.etc);
    const growth = clamp(numberOr(50, source.growth), 0, 100);
    const volatility = clamp(numberOr(40, source.volatility), 0, 100);
    const price = numberOr(numberOr(10000, source.basePrice), source.currentPrice);
    const basePrice = numberOr(price, source.basePrice);
    const oneLine = cleanString(source.oneLine || source.summary || source.business);
    const description = cleanString(source.description || source.desc || oneLine);
    const risk = normalizeRisk(source.risk, volatility);
    const heat = Math.round(clamp(42 + growth * 0.42 - volatility * 0.08, 0, 100));
    const warningScore = Math.round(clamp(24 + volatility * 0.58 + (risk === KR.veryHigh ? 15 : risk === KR.high ? 9 : 0), 0, 100));
    return {
      ...source,
      id,
      name,
      ticker: cleanString(source.ticker || tickerFromName(name, id)),
      sector,
      ceo: cleanString(source.ceo || ""),
      business: cleanString(source.business || oneLine || description),
      risk,
      growth,
      growthLabel: cleanString(source.growthLabel || labelFromScore(growth)),
      dividendLabel: cleanString(source.dividendLabel || KR.normal),
      listingStatus: cleanString(source.listingStatus || source.status || KR.listingNormal),
      status: cleanString(source.status || source.listingStatus || KR.listingNormal),
      description,
      hidden: source.hidden || {
        growth,
        debt: Math.round(clamp(70 - growth * 0.35 + volatility * 0.25, 5, 95)),
        cashFlow: Math.round(clamp(90 - volatility * 0.5, 5, 95)),
        reputation: Math.round(clamp(45 + growth * 0.25, 5, 95)),
        innovation: Math.round(clamp(growth + 5, 5, 98)),
        legalRisk: Math.round(clamp(volatility * 0.5, 5, 95)),
        management: Math.round(clamp(55 + growth * 0.2 - volatility * 0.1, 5, 95)),
      },
      basePrice,
      currentPrice: price,
      price,
      oneLine,
      logoEmoji: cleanString(source.logoEmoji || ""),
      tags: toTags(source.tags),
      wikiId: cleanString(source.wikiId || ""),
      heat: numberOr(heat, source.heat),
      warningScore: numberOr(warningScore, source.warningScore),
      publicSignal: cleanString(source.publicSignal || oneLine || "Market Admin"),
      sectorMood: cleanString(source.sectorMood || source.status || KR.neutral),
      engineHint: cleanString(source.engineHint || oneLine || description || "Market Admin master data"),
      source: "market-admin",
    };
  }

  function normalizeAdminNews(news, companies) {
    const source = news && typeof news === "object" ? news : {};
    const id = slug(source.id || source.title || "news");
    const company = findCompany(companies || state.data.companies, source.targetCompanyId || source.relatedCompanyId);
    const sector = cleanString(source.targetSector || source.relatedSector || company?.sector || "");
    const effect = cleanString(source.effect || "mixed").toLowerCase();
    const body = cleanString(source.body || source.content || source.summary || "");
    const createdAt = source.createdAt || source.publishedAt || source.date || Date.now();
    const priorityScore = priorityValue(source.priority);
    return {
      ...source,
      id,
      source: "admin",
      adminSource: "market-admin",
      kind: "news",
      title: cleanString(source.title || id),
      body,
      content: body,
      summary: cleanString(source.summary || body || source.title || ""),
      type: cleanString(source.type || "market"),
      targetCompanyId: cleanString(source.targetCompanyId || source.relatedCompanyId || ""),
      targetSector: sector,
      relatedCompanyId: cleanString(source.relatedCompanyId || source.targetCompanyId || ""),
      relatedSector: sector,
      company: cleanString(source.company || company?.name || ""),
      ticker: cleanString(source.ticker || company?.ticker || ""),
      sector,
      effect,
      direction: directionFromEffect(effect),
      impact: numberOr(0, source.impact),
      impactStrength: String(source.impact || ""),
      duration: numberOr(0, source.duration),
      visibility: cleanString(source.visibility || "visible").toLowerCase(),
      priority: source.priority == null ? 0 : source.priority,
      priorityValue: priorityScore,
      breaking: cleanString(source.priority).toLowerCase() === "breaking" || priorityScore >= 1000,
      createdAt: isoDateTime(createdAt),
      date: isoDate(createdAt),
      tags: toTags(source.tags),
      relatedWikiIds: toTags(source.relatedWikiIds),
    };
  }

  function normalizeAdminSector(sector) {
    const source = sector && typeof sector === "object" ? sector : {};
    const name = cleanString(source.name || source.id || KR.etc);
    const id = slug(source.id || name);
    const sensitivity = clamp(numberOr(50, source.marketSensitivity), 0, 100);
    const volatility = clamp(numberOr(40, source.defaultVolatility), 0, 100);
    const direction = sensitivity > 60 ? KR.up : sensitivity < 40 ? KR.down : KR.neutral;
    return {
      ...source,
      id,
      name,
      description: cleanString(source.description || source.blurb || ""),
      blurb: cleanString(source.blurb || source.description || ""),
      marketSensitivity: sensitivity,
      defaultVolatility: volatility,
      tags: toTags(source.tags),
      wikiId: cleanString(source.wikiId || ""),
      icon: cleanString(source.icon || source.logoEmoji || KR.building),
      mood: cleanString(source.mood || KR.adminSector),
      direction,
      capitalFlow: Math.round(sensitivity),
      expectedImpact: cleanString(source.expectedImpact || source.description || "Market Admin sector master data"),
      source: "market-admin",
    };
  }

  function normalizeAdminWikiDoc(doc) {
    const source = doc && typeof doc === "object" ? doc : {};
    const id = slug(source.id || source.title || "wiki");
    const updatedAt = source.updatedAt || source.modifiedAt || Date.now();
    return {
      ...source,
      id,
      title: cleanString(source.title || id),
      category: cleanString(source.category || "guide"),
      summary: cleanString(source.summary || ""),
      content: cleanString(source.content || ""),
      relatedCompanyIds: toTags(source.relatedCompanyIds),
      relatedSectors: toTags(source.relatedSectors),
      relatedNewsIds: toTags(source.relatedNewsIds),
      tags: toTags(source.tags),
      updatedAt: isoDateTime(updatedAt),
      source: "market-admin",
    };
  }

  function isVisibleNews(news) {
    const visibility = cleanString(news.visibility || "visible").toLowerCase();
    if (visibility === "hidden" || visibility === "draft") return false;
    if (visibility === "scheduled") {
      const scheduled = dateMs(news.scheduledAt || news.createdAt);
      return scheduled != null && scheduled <= Date.now();
    }
    return true;
  }

  function countMap(dataset) {
    return {
      companies: dataset.companies.length,
      news: dataset.news.length,
      sectors: dataset.sectors.length,
      wikiDocs: dataset.wikiDocs.length,
    };
  }

  function hasAny(dataset) {
    const counts = countMap(dataset);
    return COLLECTIONS.some((key) => counts[key] > 0);
  }

  function mergeWithFallback(primary, fallback) {
    const next = emptyDataset();
    next.companies = primary.companies.length ? primary.companies : fallback.companies.slice();
    next.sectors = primary.sectors.length ? primary.sectors : fallback.sectors.slice();
    next.wikiDocs = primary.wikiDocs.length ? primary.wikiDocs : fallback.wikiDocs.slice();
    const newsSource = primary.news.length ? primary.news : fallback.news;
    next.news = newsSource.map((item) => normalizeAdminNews(item, next.companies)).filter(isVisibleNews);
    next.meta = { ...fallback.meta, ...primary.meta };
    return next;
  }

  function setData(dataset, source, options = {}) {
    state.data = dataset;
    state.loaded = true;
    state.source = source;
    state.counts = countMap(dataset);
    state.lastLoadedAt = new Date().toISOString();
    if (!options.silent) emit("marketadmin:update");
  }

  function readLocalDataset() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? normalizeDataset(JSON.parse(raw)) : emptyDataset();
    } catch (error) {
      state.lastError = "localStorage parse failed";
      return emptyDataset();
    }
  }

  function shouldSkipFirebase(options) {
    const force = options.forceFirebase || new URLSearchParams(location.search).get("firebase") === "1";
    return location.protocol === "file:" && !force && !(window.firebase && window.firebase.database);
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        if (window.firebase) { resolve(); return; }
        existing.addEventListener("load", resolve, { once: true });
        existing.addEventListener("error", () => reject(new Error("load fail")), { once: true });
        return;
      }
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error("load fail"));
      document.head.appendChild(script);
    });
  }

  async function initFirebase() {
    if (window.firebase && window.firebase.database) {
      if (!window.firebase.apps.length) window.firebase.initializeApp(FIREBASE_CONFIG);
      state.firebaseReady = true;
      return true;
    }
    for (const src of FIREBASE_SDK) await loadScript(src);
    if (!window.firebase || !window.firebase.database) throw new Error("Firebase SDK unavailable");
    if (!window.firebase.apps.length) window.firebase.initializeApp(FIREBASE_CONFIG);
    state.firebaseReady = true;
    return true;
  }

  async function readFirebaseDataset() {
    await initFirebase();
    const db = window.firebase.database();
    const snaps = await Promise.all([
      db.ref(PATHS.companies).once("value"),
      db.ref(PATHS.news).once("value"),
      db.ref(PATHS.sectors).once("value"),
      db.ref(PATHS.wikiDocs).once("value"),
      db.ref(PATHS.meta).once("value"),
    ]);
    return normalizeDataset({
      companies: snaps[0].val(),
      news: snaps[1].val(),
      sectors: snaps[2].val(),
      wikiDocs: snaps[3].val(),
      meta: snaps[4].val(),
    });
  }

  async function loadMarketAdminData(options = {}) {
    if (state.loading && !options.force) return state.loading;
    state.loading = (async () => {
      const local = readLocalDataset();
      if (hasAny(local)) setData(local, "localStorage", { silent: true });
      if (shouldSkipFirebase(options)) {
        state.firebaseFailed = false;
        emit("marketadmin:update");
        return state.data;
      }
      try {
        const remote = await readFirebaseDataset();
        if (hasAny(remote)) {
          const merged = mergeWithFallback(remote, local);
          const source = COLLECTIONS.every((key) => remote[key].length > 0) ? "firebase" : "mixed";
          setData(merged, source, { silent: true });
        } else if (!state.loaded && hasAny(local)) {
          setData(local, "localStorage", { silent: true });
        }
        state.firebaseFailed = false;
      } catch (error) {
        state.firebaseReady = false;
        state.firebaseFailed = true;
        state.lastError = error && error.message ? error.message : "Firebase read failed";
        if (!state.loaded && hasAny(local)) setData(local, "localStorage", { silent: true });
      }
      emit("marketadmin:update");
      return state.data;
    })().finally(() => {
      state.loading = null;
    });
    return state.loading;
  }

  function normalizeKey(value) {
    return cleanString(value).toLocaleLowerCase("ko-KR");
  }

  function getAdminCompanyById(id) {
    return state.data.companies.find((company) => company.id === id) || null;
  }

  function getAdminCompanyByName(name) {
    const key = normalizeKey(name);
    return state.data.companies.find((company) => normalizeKey(company.name) === key || normalizeKey(company.ticker) === key) || null;
  }

  function getAdminSectorMeta(name) {
    const key = normalizeKey(name);
    return state.data.sectors.find((sector) => normalizeKey(sector.name) === key || normalizeKey(sector.id) === key) || null;
  }

  function getAdminSectorMetaMap() {
    const map = {};
    state.data.sectors.forEach((sector) => { map[sector.name] = sector; });
    return map;
  }

  function getWikiDocById(id) {
    const key = cleanString(id);
    if (!key) return null;
    return state.data.wikiDocs.find((doc) => doc.id === key) || null;
  }

  function getWikiDocForCompany(companyId, wikiId) {
    if (wikiId) {
      const linked = getWikiDocById(wikiId);
      if (linked) return linked;
    }
    const key = cleanString(companyId);
    return state.data.wikiDocs.find((doc) => (doc.relatedCompanyIds || []).includes(key)) || null;
  }

  function mergeBoardCompany(existing, admin) {
    const merged = { ...(existing || {}), ...admin };
    if (existing) {
      ["heat", "warningScore", "sectorFlow", "publicSignal", "sectorMood"].forEach((key) => {
        if (existing[key] != null) merged[key] = existing[key];
      });
      if (existing.engineHint && !admin.oneLine) merged.engineHint = existing.engineHint;
      if (existing.battle) {
        merged.battle = existing.battle;
        merged.price = existing.price;
        merged.currentPrice = existing.currentPrice || admin.currentPrice;
      }
    }
    merged.description = admin.description || existing?.description || admin.oneLine || "";
    merged.business = admin.business || admin.oneLine || existing?.business || "";
    merged.engineHint = admin.engineHint || existing?.engineHint || admin.oneLine || admin.description || "";
    return merged;
  }

  function mergeBoardCompanies(existing, adminCompanies) {
    const existingList = asArray(existing);
    const used = new Set();
    const next = adminCompanies.map((admin) => {
      const match = existingList.find((item) => normalizeKey(item.id) === normalizeKey(admin.id) || normalizeKey(item.name) === normalizeKey(admin.name) || normalizeKey(item.ticker) === normalizeKey(admin.ticker));
      if (match) used.add(match);
      return mergeBoardCompany(match, admin);
    });
    existingList.forEach((item) => {
      const isBattle = item && (item.battle || String(item.id || "").startsWith("battle-stock-"));
      if (isBattle && !used.has(item)) next.push(item);
    });
    return next;
  }

  function mergeBoardNews(existing, adminNews) {
    if (!adminNews.length) return existing || [];
    const seen = new Set();
    return adminNews.concat(existing || []).filter((item) => {
      const key = normalizeKey(item.id || item.title);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort((a, b) => (numberOr(0, b.priorityValue ?? b.priority) - numberOr(0, a.priorityValue ?? a.priority)) || (dateMs(b.createdAt || b.date) || 0) - (dateMs(a.createdAt || a.date) || 0));
  }

  function deriveSectorsFromCompanies(companies) {
    const names = Array.from(new Set((companies || []).map((company) => company.sector).filter(Boolean)));
    return names.map((name) => normalizeAdminSector({ id: slug(name), name, description: "" }));
  }

  function mergeBoardSectors(existing, adminSectors, companies) {
    const source = adminSectors.length ? adminSectors : deriveSectorsFromCompanies(companies);
    if (!source.length) return existing || [];
    const existingMap = new Map((existing || []).map((sector) => [normalizeKey(sector.name), sector]));
    return source.map((sector) => ({ ...(existingMap.get(normalizeKey(sector.name)) || {}), ...sector }));
  }

  function applyToBoardData(data) {
    if (!data || typeof data !== "object") return data;
    const companies = loadAdminCompanies();
    const news = loadAdminNews();
    const sectors = loadAdminSectors();
    if (!companies.length && !news.length && !sectors.length) return data;
    const next = { ...data };
    if (companies.length) next.companies = mergeBoardCompanies(data.companies || [], companies);
    if (news.length) next.news = mergeBoardNews(data.news || [], news);
    if (sectors.length || companies.length) next.sectors = mergeBoardSectors(data.sectors || [], sectors, next.companies || data.companies || []);
    if (next.roundSummary) {
      next.roundSummary = {
        ...next.roundSummary,
        keyCounts: { ...(next.roundSummary.keyCounts || {}), news: (next.news || []).length },
        topSignals: (next.news || []).slice(0, 3).map((item) => item.title),
      };
    }
    next.adminDataStatus = getAdminDataStatus();
    return next;
  }

  function loadAdminCompanies() { return state.data.companies.slice(); }
  function loadAdminNews() { return state.data.news.slice(); }
  function loadAdminSectors() { return state.data.sectors.slice(); }
  function loadAdminWikiDocs() { return state.data.wikiDocs.slice(); }
  function hasAdminMasterData() { return hasAny(state.data); }

  function getAdminDataStatus() {
    return {
      version: VERSION,
      loaded: state.loaded,
      source: state.source,
      counts: { ...state.counts },
      firebaseReady: state.firebaseReady,
      firebaseFailed: state.firebaseFailed,
      fallback: state.source === "localStorage" || state.firebaseFailed,
      lastError: state.lastError,
      lastLoadedAt: state.lastLoadedAt,
      localStorageKey: STORAGE_KEY,
      firebasePaths: {
        companies: "/" + PATHS.companies,
        news: "/" + PATHS.news,
        sectors: "/" + PATHS.sectors,
        wikiDocs: "/" + PATHS.wikiDocs,
        meta: "/" + PATHS.meta,
      },
    };
  }

  function emit(name) {
    const detail = getAdminDataStatus();
    const logKey = [detail.source, detail.firebaseFailed, detail.counts.companies, detail.counts.news, detail.counts.sectors, detail.counts.wikiDocs].join(":");
    if (logKey !== state.lastLogKey && window.console && console.info) {
      console.info("[MarketAdminAdapter]", detail);
      state.lastLogKey = logKey;
    }
    window.dispatchEvent(new CustomEvent(name, { detail }));
  }

  const local = readLocalDataset();
  if (hasAny(local)) setData(local, "localStorage", { silent: true });

  window.MarketAdminAdapter = {
    VERSION,
    STORAGE_KEY,
    PATHS,
    loadMarketAdminData,
    loadAdminCompanies,
    loadAdminNews,
    loadAdminSectors,
    loadAdminWikiDocs,
    normalizeAdminCompany,
    normalizeAdminNews,
    normalizeAdminSector,
    normalizeAdminWikiDoc,
    hasAdminMasterData,
    getAdminDataStatus,
    applyToBoardData,
    getAdminCompanyById,
    getAdminCompanyByName,
    getAdminSectorMeta,
    getAdminSectorMetaMap,
    getWikiDocById,
    getWikiDocForCompany,
  };

  setTimeout(() => { void loadMarketAdminData(); }, 0);
})();