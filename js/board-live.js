// js/board-live.js
// Market Board 뉴스룸: 연결된 Market Battle 방의 "실제 값"만으로 화면을 그린다.
// 시세는 battle 그대로, 그 위에 거래할 때 들려오는 정보(뉴스/공시/루머/애널리스트/체결속보)를 합성한다.
(function () {
  "use strict";

  // ----- 기업 프로필 (data.js 의 마켓배틀 종목 메타데이터) -----
  const PROFILES = {};
  (function buildProfiles() {
    const list = (window.MarketData && window.MarketData.companies) || [];
    list.forEach((c) => { if (c && c.name) PROFILES[c.name] = c; });
  })();

  function profileForName(name) {
    const adapter = window.MarketAdminAdapter;
    const admin = adapter?.getAdminCompanyByName ? adapter.getAdminCompanyByName(name) : null;
    return admin || PROFILES[name] || null;
  }
  // ----- 상태 -----
  const state = {
    selectedId: null,
    sort: "change",
    filter: "all",
    feed: [], // 누적 정보 피드 (최신순)
    seen: new Set(), // 중복 방지 키
    hist: {}, // 종목별 가격 기록 (스파크라인)
    lastTick: -1,
    room: null,
    startedAt: 0,
  };
  const FEED_MAX = 90;
  const HIST_MAX = 60;

  // ----- 포맷 -----
  const won = (n) => Math.round(n || 0).toLocaleString("ko-KR") + "원";
  const num = (n) => Math.round(n || 0).toLocaleString("ko-KR");
  function short(n) {
    n = n || 0;
    if (n >= 1e12) return (n / 1e12).toFixed(2) + "조";
    if (n >= 1e8) return (n / 1e8).toFixed(1) + "억";
    if (n >= 1e4) return Math.round(n / 1e4).toLocaleString("ko-KR") + "만";
    return num(n);
  }
  const dir = (r) => (r > 0 ? "up" : r < 0 ? "down" : "flat");
  const arrow = (r) => (r > 0 ? "▲" : r < 0 ? "▼" : "—");
  const sign = (r) => (r > 0 ? "+" : "");
  function esc(s) {
    return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  const $ = (id) => document.getElementById(id);

  // ----- 종목 정규화 -----
  function stocksArray(room) {
    return Object.entries(room.stocks || {}).map(([id, s]) => {
      const base = s.basePrice || s.previousPrice || s.price;
      const cr = Number.isFinite(Number(s.changeRate))
        ? Number(s.changeRate)
        : base ? +(((s.price - base) / base) * 100).toFixed(2) : 0;
      return {
        id,
        name: s.name || id,
        type: s.type || "stock",
        role: s.role || "",
        bsector: s.sector || "", // 본게임이 보낸 업종
        price: s.price || 0,
        base,
        changeRate: cr,
        diff: (s.price || 0) - base,
        volume: s.volume || 0,
        value: s.value || 0,
        high: s.high || s.price || 0,
        low: s.low || s.price || 0,
        open: s.open || base,
        news: s.news || "",
        profile: profileForName(s.name) || null,
      };
    });
  }
  // 업종 소속 일반주(equity) 판정 — 지수 계산 기준
  const SPECIAL_TYPES = ["etf", "inverse", "leverage", "bond", "commodity", "reit", "spac", "preferred"];
  function isEq(t) { return !SPECIAL_TYPES.includes(t); }
  const TYPE_LABEL = { preferred: "우선주", etf: "ETF", reit: "리츠", spac: "SPAC", inverse: "인버스", leverage: "레버리지", bond: "채권ETF", commodity: "원자재" };
  const TYPE_CLS = { inverse: "inv", leverage: "lev", preferred: "etf", etf: "etf", reit: "etf", spac: "etf", bond: "etf", commodity: "etf" };
  function typeTag(t, id, role) {
    if (String(id).startsWith("ipo")) return '<span class="nb-tag new">신규</span>';
    if (TYPE_LABEL[t]) return `<span class="nb-tag ${TYPE_CLS[t] || "etf"}">${TYPE_LABEL[t]}</span>`;
    if (role === "leader") return '<span class="nb-tag lead">대장주</span>';
    return "";
  }
  function sectorOf(s) {
    if (TYPE_LABEL[s.type]) return TYPE_LABEL[s.type];
    return s.bsector || s.profile?.sector || "기타";
  }

  // ----- 피드 합성 -----
  function pushItem(item) {
    if (state.seen.has(item.key)) return;
    state.seen.add(item.key);
    state.feed.unshift(item);
    if (state.feed.length > FEED_MAX) {
      const removed = state.feed.splice(FEED_MAX);
      removed.forEach((r) => state.seen.delete(r.key));
    }
  }

  function pushAdminNews(stocks, now) {
    const adapter = window.MarketAdminAdapter;
    const list = adapter?.loadAdminNews ? adapter.loadAdminNews() : [];
    if (!list.length) return;
    list.forEach((item) => {
      const target = stocks.find((s) =>
        (item.targetCompanyId && String(s.id) === String(item.targetCompanyId)) ||
        (item.company && s.name === item.company) ||
        (item.sector && sectorOf(s) === item.sector)
      );
      const stockName = target?.name || item.company || "";
      const time = Date.parse(item.createdAt || item.date || "") || now;
      pushItem({
        kind: "news",
        key: "admin:" + (item.id || item.title),
        time,
        title: item.breaking ? "[BREAKING] " + item.title : item.title,
        stock: stockName,
      });
    });
  }

  function analystComment(s) {
    const p = s.profile;
    const sec = sectorOf(s);
    if (s.changeRate >= 8) return `${s.name} 강세 지속, ${sec} 투자심리 개선. 단기 과열 여부는 확인 필요.`;
    if (s.changeRate <= -8) return `${s.name} 약세 확대, ${sec} 비중 축소 의견. 저가 매수는 신중.`;
    if (p && p.growthLabel === "매우 높음") return `${s.name} 성장 기대 유효하나 기대가 가격에 선반영된 구간.`;
    return `${s.name} 방향성 제한적. 거래대금 흐름과 수급을 더 지켜볼 구간.`;
  }
  function rumorText(s) {
    const sec = sectorOf(s);
    if (sec === "바이오") return `${s.name}, 임상/공급 관련 미확인 정보가 돌고 있다는 얘기.`;
    if (sec === "게임" || sec === "미디어") return `${s.name}, 신작·흥행 관련 소문이 커뮤니티에서 확산 중.`;
    if (sec === "모빌리티" || sec === "에너지") return `${s.name}, 대형 수주설이 거론된다는 미확인 정보.`;
    return `${s.name}, 체결창에 사전 정보 보유설이 떠돈다는 루머.`;
  }

  // Phase 4(선택 B): 연결된 방의 rooms/{code}/news·disclosures(admin 작성)를 index 피드에 소규모 노출
  function pushRoomAdminContent(room, stocks, now) {
    const news = room.news ? Object.values(room.news) : [];
    news.forEach((n) => {
      if (!n || !n.title) return;
      const target = stocks.find((s) => n.targetCompanyId && String(s.id) === String(n.targetCompanyId));
      pushItem({
        kind: "news",
        key: "rn:" + (n.id || n.title),
        time: Date.parse(n.createdAt || "") || now,
        title: "[속보] " + n.title,
        stock: target?.name || n.company || "",
      });
    });
    const disc = room.disclosures ? Object.values(room.disclosures) : [];
    disc.forEach((d) => {
      if (!d || !d.title || d.hidden || d.deleted) return;
      const target = stocks.find((s) => d.targetCompanyId && String(s.id) === String(d.targetCompanyId));
      pushItem({
        kind: "disclosure",
        key: "rd:" + (d.id || d.title),
        time: Date.parse(d.createdAt || d.updatedAt || "") || now,
        title: "[공시] " + (d.type ? d.type + " · " : "") + d.title,
        stock: target?.name || "",
      });
    });
  }

  function synthFeed(room, stocks, now) {
    pushAdminNews(stocks, now);
    pushRoomAdminContent(room, stocks, now);
    // 1) 시장 뉴스
    if (room.latestNews && room.latestNews.text) {
      pushItem({ kind: "news", key: "ln:" + room.latestNews.time, time: room.latestNews.time || now,
        title: room.latestNews.text, stock: "" });
    }
    // 2) 종목별 뉴스 / 상·하한가 / 급등락 / 거래량
    stocks.forEach((s) => {
      if (s.news) {
        pushItem({ kind: "news", key: `n:${s.id}:${s.news}`, time: now, title: `${s.name} — ${s.news}`, stock: s.name });
      }
      if (s.changeRate >= 29) {
        pushItem({ kind: "disclosure", key: `up30:${s.id}`, time: now, title: `${s.name} 상한가 근접·도달 (${sign(s.changeRate)}${s.changeRate.toFixed(1)}%)`, stock: s.name });
      } else if (s.changeRate <= -29) {
        pushItem({ kind: "disclosure", key: `dn30:${s.id}`, time: now, title: `${s.name} 하한가 근접·도달 (${s.changeRate.toFixed(1)}%)`, stock: s.name });
      }
      // 급등/급락 (15% 단위 버킷으로 한 번씩)
      const bucket = Math.trunc(s.changeRate / 15);
      if (Math.abs(s.changeRate) >= 15) {
        pushItem({ kind: s.changeRate > 0 ? "analyst" : "analyst", key: `mv:${s.id}:${bucket}`, time: now,
          title: analystComment(s), stock: s.name });
      }
      // 루머: 변동성 큰 종목에 가끔 (12% 버킷)
      if (Math.abs(s.changeRate) >= 12) {
        pushItem({ kind: "rumor", key: `rm:${s.id}:${Math.trunc(s.changeRate / 12)}`, time: now, title: rumorText(s), stock: s.name });
      }
    });
    // 3) 체결 속보 (봇/플레이어 큰 거래)
    const trades = [];
    (room.botFeed ? Object.values(room.botFeed) : []).forEach((t) => trades.push(t));
    Object.values(room.logs || {}).forEach((t) => trades.push(t));
    trades
      .filter((t) => t && (t.qty || 0) * (t.price || 0) >= 3_000_000) // 300만원 이상 체결만 속보
      .sort((a, b) => (b.time || 0) - (a.time || 0))
      .slice(0, 5)
      .forEach((t) => {
        const side = t.type === "buy" ? "매수" : "매도";
        pushItem({ kind: "flow", key: `fl:${t.time}:${t.nickname}:${t.stockName}:${t.qty}`, time: t.time || now,
          title: `${t.nickname} ${esc(t.stockName)} ${num(t.qty)}주 ${side} @ ${num(t.price)} (${short(t.qty * t.price)}원)`, stock: t.stockName });
      });
    // 3-2) 거래 집중(폭발) / 한산 — 종목 성격 반영
    const byValue = [...stocks].sort((a, b) => b.value - a.value);
    const hot = byValue[0];
    if (hot && hot.value > 0) {
      pushItem({ kind: "disclosure", key: `hot:${hot.id}:${Math.trunc(hot.value / 3e8)}`, time: now,
        title: `${hot.name} 거래 폭발 — 거래대금 시장 1위, 매수·매도 공방 치열`, stock: hot.name });
    }
    const calmList = byValue.filter((s) => isEq(s.type));
    const calm = calmList[calmList.length - 1];
    if (calm && calm !== hot) {
      pushItem({ kind: "analyst", key: `calm:${calm.id}:${Math.trunc(now / 90000)}`, time: now,
        title: `${calm.name} 거래 한산, 뚜렷한 방향 없이 관망세가 이어지는 중`, stock: calm.name });
    }
    // 4) 공모주 청약/상장
    const ipo = room.ipo;
    if (ipo && ipo.status === "subscribing") {
      pushItem({ kind: "disclosure", key: `ipo:${ipo.stockId}`, time: ipo.startedAt || now,
        title: `공모주 청약: '${ipo.name}' 공모가 ${num(ipo.offerPrice)}원 청약 진행 중`, stock: ipo.name });
    }
  }

  // ----- 렌더 -----
  function render(room) {
    if (!room || !room.stocks) return;
    state.room = room;
    state.startedAt = room.startedAt || state.startedAt || Date.now();
    const stocks = stocksArray(room);
    const now = room.marketTick || Date.now();
    const newTick = now !== state.lastTick;

    if (newTick) {
      state.lastTick = now;
      stocks.forEach((s) => {
        const h = state.hist[s.id] || (state.hist[s.id] = []);
        h.push(s.price);
        if (h.length > HIST_MAX) h.shift();
      });
      synthFeed(room, stocks, Date.now());
    }
    if (!state.selectedId || !room.stocks[state.selectedId]) {
      // 기본 선택: 등락 절댓값이 가장 큰 종목
      state.selectedId = [...stocks].sort((a, b) => Math.abs(b.changeRate) - Math.abs(a.changeRate))[0]?.id || stocks[0]?.id;
    }

    renderSummary(stocks);
    renderStockList(stocks);
    renderDetail(stocks);
    renderFeed();
    renderRank(room, stocks);
    renderIpo(room);
    renderSectors(stocks);
    renderClock();
  }

  function renderClock() {
    const el = $("nbClock");
    if (!el) return;
    const sec = Math.max(0, Math.floor((Date.now() - state.startedAt) / 1000));
    const m = String(Math.floor(sec / 60)).padStart(2, "0");
    const s = String(sec % 60).padStart(2, "0");
    el.textContent = `진행 ${m}:${s}`;
  }

  function renderSummary(stocks) {
    const norm = stocks.filter((s) => isEq(s.type));
    const idxPct = norm.length ? norm.reduce((a, s) => a + s.changeRate, 0) / norm.length : 0;
    // 조스피(JOSPI): 기준 1000 에서 시장 평균 등락률만큼 움직이는 지수 레벨
    const jospi = 1000 * (1 + idxPct / 100);
    const points = jospi - 1000;
    const up = stocks.filter((s) => s.changeRate > 0).length;
    const down = stocks.filter((s) => s.changeRate < 0).length;
    const totalValue = stocks.reduce((a, s) => a + s.value, 0);
    const top = [...stocks].sort((a, b) => b.changeRate - a.changeRate)[0];
    const bot = [...stocks].sort((a, b) => a.changeRate - b.changeRate)[0];
    const idxCls = dir(idxPct);

    $("nbIndex").innerHTML = `<span class="nbi-k">조스피</span>
      <b class="nbi-lv ${idxCls}">${jospi.toFixed(2)}</b>
      <span class="nbi-chg ${idxCls}">${arrow(idxPct)} ${sign(points)}${points.toFixed(2)} (${sign(idxPct)}${idxPct.toFixed(2)}%)</span>`;

    $("nbSummary").innerHTML = `
      <div class="nb-sum-cell"><span>상승 / 하락</span><b><i class="up">${up}</i> · <i class="down">${down}</i></b></div>
      <div class="nb-sum-cell"><span>총 거래대금</span><b>${short(totalValue)}원</b></div>
      <div class="nb-sum-cell"><span>상승 1위</span><b class="up">${top ? esc(top.name) + " " + sign(top.changeRate) + top.changeRate.toFixed(1) + "%" : "-"}</b></div>
      <div class="nb-sum-cell"><span>하락 1위</span><b class="down">${bot ? esc(bot.name) + " " + bot.changeRate.toFixed(1) + "%" : "-"}</b></div>
    `;
  }

  function renderStockList(stocks) {
    const sorted = [...stocks].sort((a, b) =>
      state.sort === "value" ? b.value - a.value : b.changeRate - a.changeRate
    );
    $("nbStockList").innerHTML = sorted
      .map((s) => {
        const c = dir(s.changeRate);
        return `<li class="nb-stock ${s.id === state.selectedId ? "sel" : ""}" data-id="${s.id}">
          <div class="nb-s-top"><span class="nb-s-name">${esc(s.name)} ${typeTag(s.type, s.id, s.role)}</span>
            <span class="nb-s-price ${c}">${num(s.price)}</span></div>
          <div class="nb-s-bot"><span class="nb-s-sec">${esc(sectorOf(s))}</span>
            <span class="nb-s-rate ${c}">${arrow(s.changeRate)} ${sign(s.changeRate)}${s.changeRate.toFixed(2)}%</span></div>
        </li>`;
      })
      .join("");
  }

  function renderDetail(stocks) {
    const s = stocks.find((x) => x.id === state.selectedId);
    if (!s) return;
    const c = dir(s.changeRate);
    $("nbDetailHead").innerHTML = `
      <div class="nb-d-name">${esc(s.name)} ${typeTag(s.type, s.id, s.role)}<span class="nb-d-sec">${esc(sectorOf(s))}</span></div>
      <div class="nb-d-price ${c}">${num(s.price)}<span class="nb-d-unit">원</span></div>
      <div class="nb-d-change ${c}">${arrow(s.changeRate)} ${sign(s.diff)}${num(s.diff)} (${sign(s.changeRate)}${s.changeRate.toFixed(2)}%)</div>
    `;
    drawSpark(s);
    $("nbStats").innerHTML = `
      <div class="nb-stat"><span>시가</span><b>${num(s.open)}</b></div>
      <div class="nb-stat"><span>고가</span><b class="up">${num(s.high)}</b></div>
      <div class="nb-stat"><span>저가</span><b class="down">${num(s.low)}</b></div>
      <div class="nb-stat"><span>거래량</span><b>${num(s.volume)}주</b></div>
      <div class="nb-stat"><span>거래대금</span><b>${short(s.value)}원</b></div>
    `;
    if (s.profile) {
      const p = s.profile;
      $("nbProfile").innerHTML = `
        <div class="nb-prof-row"><span>대표</span><b>${esc(p.ceo || "-")}</b><span>리스크</span><b>${esc(p.risk || "-")}</b><span>성장성</span><b>${esc(p.growthLabel || "-")}</b></div>
        <p class="nb-prof-biz">${esc(p.business || "")}</p>
        <p class="nb-prof-desc">${esc(p.description || "")}</p>`;
    } else {
      $("nbProfile").innerHTML = `<p class="nb-prof-desc muted">${s.type === "inverse" ? "시장 지수를 반대로 추종하는 가상 ETF." : s.type === "leverage" ? "시장 지수를 2배로 추종하는 가상 ETF." : "신규 상장 종목 — 아직 알려진 정보가 적습니다."}</p>`;
    }
    // 관련 정보
    renderFeedInto("nbRelNews", state.feed.filter((f) => f.stock === s.name).slice(0, 12));
  }

  function drawSpark(s) {
    const canvas = $("nbSpark");
    if (!canvas) return;
    const hist = state.hist[s.id] || [s.price];
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 600, h = canvas.clientHeight || 90;
    canvas.width = w * dpr; canvas.height = h * dpr;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (hist.length < 2) return;
    let hi = Math.max(...hist), lo = Math.min(...hist);
    if (hi === lo) { hi += 1; lo -= 1; }
    const pad = (hi - lo) * 0.15; hi += pad; lo -= pad;
    const up = s.changeRate >= 0;
    const col = up ? "#f23645" : "#1f6feb";
    const x = (i) => (w / (hist.length - 1)) * i;
    const y = (p) => h * (1 - (p - lo) / (hi - lo));
    // 면적
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, up ? "rgba(242,54,69,0.18)" : "rgba(31,111,235,0.18)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.beginPath(); ctx.moveTo(0, h);
    hist.forEach((p, i) => ctx.lineTo(x(i), y(p)));
    ctx.lineTo(w, h); ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
    // 라인
    ctx.beginPath();
    hist.forEach((p, i) => (i ? ctx.lineTo(x(i), y(p)) : ctx.moveTo(x(i), y(p))));
    ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.lineJoin = "round"; ctx.stroke();
  }

  const KIND_META = {
    news: { tag: "뉴스", cls: "k-news", icon: "📰" },
    disclosure: { tag: "공시", cls: "k-disc", icon: "📢" },
    rumor: { tag: "루머", cls: "k-rumor", icon: "💬" },
    analyst: { tag: "애널리스트", cls: "k-analyst", icon: "📊" },
    flow: { tag: "체결속보", cls: "k-flow", icon: "⚡" },
  };
  function timeStr(t) {
    return new Date(t).toLocaleTimeString("ko-KR", { hour12: false });
  }
  function feedItemHTML(f) {
    const m = KIND_META[f.kind] || KIND_META.news;
    return `<li class="nb-feed-item">
      <span class="nb-feed-tag ${m.cls}">${m.icon} ${m.tag}</span>
      <span class="nb-feed-title">${esc(f.title)}</span>
      <span class="nb-feed-time">${timeStr(f.time)}</span>
    </li>`;
  }
  function renderFeed() {
    const items = state.filter === "all" ? state.feed : state.feed.filter((f) => f.kind === state.filter);
    const box = $("nbFeed");
    if (!box) return;
    box.innerHTML = items.length
      ? items.slice(0, 60).map(feedItemHTML).join("")
      : `<li class="nb-feed-empty">아직 들어온 정보가 없습니다. 잠시만요…</li>`;
  }
  function renderFeedInto(id, items) {
    const box = $(id);
    if (!box) return;
    box.innerHTML = items.length ? items.map(feedItemHTML).join("") : `<li class="nb-feed-empty">관련 정보 대기 중</li>`;
  }

  function renderRank(room, stocks) {
    const priceById = {};
    stocks.forEach((s) => (priceById[s.id] = s.price));
    const players = Object.entries(room.players || {}).map(([uid, p]) => {
      let total = p.cash || 0;
      const h = p.holdings || {};
      for (const [sid, q] of Object.entries(h)) total += (priceById[sid] || 0) * q;
      return { nickname: p.nickname || uid, total, connected: p.connected !== false };
    }).sort((a, b) => b.total - a.total);
    const START = 10_000_000;
    $("nbRank").innerHTML = players.length
      ? players.map((p, i) => {
          const rate = (((p.total - START) / START) * 100).toFixed(2);
          const c = p.total >= START ? "up" : "down";
          return `<li><span class="nb-rk-pos">${i + 1}</span><span class="nb-rk-name">${esc(p.nickname)}${p.connected ? "" : " <i class='muted'>(오프)</i>"}</span>
            <b>${short(p.total)}원</b><span class="${c}">${rate >= 0 ? "+" : ""}${rate}%</span></li>`;
        }).join("")
      : `<li class="nb-feed-empty">참가자 정보 대기 중</li>`;
  }

  function renderIpo(room) {
    const ipo = room.ipo;
    const box = $("nbIpo");
    if (!box) return;
    if (!ipo || ipo.status !== "subscribing") {
      box.innerHTML = `<p class="nb-feed-empty">현재 진행 중인 공모주가 없습니다.</p>`;
      return;
    }
    const left = Math.max(0, Math.ceil(((ipo.endsAt || 0) - Date.now()) / 1000));
    const playerDemand = Object.values(ipo.applies || {}).reduce((a, b) => a + (b || 0), 0);
    const ratio = ((ipo.botDemand || 0) + playerDemand) / (ipo.totalShares || 1);
    box.innerHTML = `
      <div class="nb-ipo-name">${esc(ipo.name)}</div>
      <div class="nb-ipo-grid">
        <div><span>공모가</span><b>${num(ipo.offerPrice)}원</b></div>
        <div><span>공모물량</span><b>${short(ipo.totalShares)}주</b></div>
        <div><span>경쟁률</span><b>${ratio.toFixed(1)} : 1</b></div>
        <div><span>마감</span><b class="${left <= 5 ? "down" : ""}">${left}초</b></div>
      </div>
      <p class="nb-ipo-note">청약은 Market Battle 게임 화면에서 진행됩니다.</p>`;
  }

  function renderSectors(stocks) {
    const map = {};
    stocks.forEach((s) => {
      const sec = sectorOf(s);
      (map[sec] || (map[sec] = [])).push(s.changeRate);
    });
    const rows = Object.entries(map)
      .map(([sec, arr]) => ({ sec, avg: arr.reduce((a, b) => a + b, 0) / arr.length, n: arr.length }))
      .sort((a, b) => b.avg - a.avg);
    $("nbSectors").innerHTML = rows
      .map((r) => {
        const c = dir(r.avg);
        return `<div class="nb-sector ${c}"><span>${esc(r.sec)}</span><b>${arrow(r.avg)} ${sign(r.avg)}${r.avg.toFixed(1)}%</b></div>`;
      })
      .join("");
  }

  // ----- 이벤트 -----
  document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("nbStockList")?.addEventListener("click", (e) => {
      const li = e.target.closest(".nb-stock");
      if (!li) return;
      state.selectedId = li.dataset.id;
      if (state.room) renderDetail(stocksArray(state.room));
      renderStockList(stocksArray(state.room || { stocks: {} }));
    });
    document.querySelectorAll(".nb-sort-btn").forEach((b) =>
      b.addEventListener("click", () => {
        state.sort = b.dataset.sort;
        document.querySelectorAll(".nb-sort-btn").forEach((x) => x.classList.toggle("is-active", x === b));
        if (state.room) renderStockList(stocksArray(state.room));
      })
    );
    document.querySelectorAll(".nb-filter").forEach((b) =>
      b.addEventListener("click", () => {
        state.filter = b.dataset.f;
        document.querySelectorAll(".nb-filter").forEach((x) => x.classList.toggle("is-active", x === b));
        renderFeed();
      })
    );
    document.getElementById("nbDisconnect")?.addEventListener("click", () => {
      window.MarketBoardLink && window.MarketBoardLink.disconnect();
    });
    // 시계는 1초마다 갱신
    setInterval(renderClock, 1000);
  });

  window.addEventListener("marketadmin:update", () => {
    if (state.room) render(state.room);
  });

  window.BoardLive = {
    render,
    reset() {
      state.feed = []; state.seen = new Set(); state.hist = {}; state.lastTick = -1; state.selectedId = null; state.room = null;
    },
    onConnected() {
      const ex = document.getElementById("nbDisconnect");
      if (ex) ex.hidden = false;
    },
  };
})();
