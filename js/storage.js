(function () {
  const KEYS = {
    roundState: "market-board-round-state-v4",
    roundLogs: "market-board-round-logs-v4",
    customItems: "market-board-admin-content-v4",
    season: "market-board-season-v4",
    battleSnapshot: "market-board-battle-snapshot-v1"
  };

  const LEGACY_KEYS = {
    roundState: "market-board-round-state-v3",
    roundLogs: "market-board-round-logs-v3",
    customItems: "market-board-admin-content-v3"
  };

  function ensureRound(createRound) {
    migrateLegacyData();
    const season = getSeason();
    const state = getRoundState();
    if (state?.currentPayload) {
      const shouldNormalize =
        !state.currentPayload.season ||
        !state.currentPayload.market?.ipoTemperature ||
        !state.currentPayload.roundSummary?.keyCounts ||
        hasBaseCompanyGap(state.currentPayload);
      const normalized = normalizePayload(state.currentPayload, season);
      if (shouldNormalize) {
        saveRoundPayload(normalized, { action: "normalize", message: "라운드 데이터 호환성 정리" });
        return getRoundState();
      }
      return state;
    }

    const payload = normalizePayload(createRound(1), season);
    return saveRoundPayload(payload, {
      action: "bootstrap",
      message: "초기 라운드 자동 생성"
    });
  }

  function advanceRound(createRound, options = {}) {
    const previous = getRoundState();
    const season = getSeason();
    const nextRound = previous?.currentRound ? previous.currentRound + 1 : 1;
    const payload = normalizePayload(createRound(nextRound, options), season);
    return saveRoundPayload(payload, {
      action: options.shock ? "shock" : "next-round",
      message: options.shock ? `시장 충격 발생: ${options.shock.label}` : "새 라운드 진행"
    });
  }

  function getSeason() {
    const saved = readJSON(KEYS.season, null);
    if (saved) return saved;

    const season = {
      id: "season-1",
      number: 1,
      name: "Capital Season",
      startDate: new Date().toISOString().slice(0, 10),
      memo: "Market Battle 운영 시즌"
    };
    writeJSON(KEYS.season, season);
    return season;
  }

  function saveSeason(nextSeason) {
    const current = getSeason();
    const season = {
      ...current,
      ...nextSeason,
      number: Number(nextSeason.number || current.number || 1),
      id: `season-${Number(nextSeason.number || current.number || 1)}`,
      updatedAt: new Date().toISOString()
    };
    writeJSON(KEYS.season, season);

    const state = getRoundState();
    if (state?.currentPayload) {
      updateCurrentPayload((payload) => {
        payload.season = season;
      }, { action: "season-update", message: "시즌 정보 수정" });
    }
    return season;
  }

  function getRoundState() {
    return readJSON(KEYS.roundState, null);
  }

  function getCurrentPayload() {
    return getRoundState()?.currentPayload || null;
  }

  function saveRoundPayload(payload, meta = {}) {
    const season = getSeason();
    const normalized = normalizePayload(payload, season);
    const state = {
      currentSeason: season,
      currentRound: normalized.roundNumber,
      currentRoundId: normalized.roundId,
      updatedAt: new Date().toISOString(),
      lastAction: meta.action || "save",
      lastMessage: meta.message || "",
      currentPayload: normalized
    };

    writeJSON(KEYS.roundState, state);
    upsertRoundLog(normalized, meta);
    return state;
  }

  function updateCurrentPayload(mutator, meta = {}) {
    const state = getRoundState();
    if (!state?.currentPayload) return null;

    const nextPayload = clone(state.currentPayload);
    mutator(nextPayload);
    nextPayload.updatedAt = new Date().toISOString();
    return saveRoundPayload(nextPayload, meta);
  }

  function updateMarketState(patch) {
    return updateCurrentPayload((payload) => {
      payload.market = {
        ...payload.market,
        ...patch,
        liquidity: numberOr(payload.market?.liquidity, patch.liquidity),
        volatility: numberOr(payload.market?.volatility, patch.volatility),
        ipoTemperature: numberOr(payload.market?.ipoTemperature, patch.ipoTemperature),
        delistingFear: numberOr(payload.market?.delistingFear, patch.delistingFear)
      };
      payload.roundSummary = payload.roundSummary || {};
      payload.roundSummary.headline = `라운드 ${payload.roundNumber}: ${payload.market.sentiment} 장세`;
      payload.roundSummary.lead = `유동성 ${payload.market.liquidity}점, 변동성 ${payload.market.volatility}점, IPO 온도 ${payload.market.ipoTemperature}점, 상장폐지 공포 ${payload.market.delistingFear}점으로 수동 조정됐습니다.`;
    }, { action: "market-adjust", message: "시장 상태 수동 조정" });
  }

  function updateContentItem(kind, id, patch) {
    const customItems = getCustomItems();
    const customIndex = customItems.findIndex((item) => item.id === id);

    if (customIndex >= 0) {
      customItems[customIndex] = {
        ...customItems[customIndex],
        ...patch,
        editedAt: new Date().toISOString()
      };
      writeJSON(KEYS.customItems, customItems);
      return updateCurrentPayload((payload) => {
        payload.updatedAt = new Date().toISOString();
      }, { action: "content-edit", message: "수동 콘텐츠 수정" });
    }

    return updateCurrentPayload((payload) => {
      const list = getPayloadList(payload, kind);
      const index = list.findIndex((item) => item.id === id);
      if (index >= 0) {
        list[index] = {
          ...list[index],
          ...patch,
          edited: true,
          editedAt: new Date().toISOString()
        };
      }
      refreshRoundCounts(payload);
    }, { action: "content-edit", message: "생성 콘텐츠 수정" });
  }

  function deleteContentItem(kind, id) {
    const customItems = getCustomItems();
    if (customItems.some((item) => item.id === id)) {
      writeJSON(KEYS.customItems, customItems.filter((item) => item.id !== id));
      return updateCurrentPayload((payload) => {
        payload.updatedAt = new Date().toISOString();
      }, { action: "content-delete", message: "수동 콘텐츠 삭제" });
    }

    return updateCurrentPayload((payload) => {
      const list = getPayloadList(payload, kind);
      const next = list.filter((item) => item.id !== id);
      setPayloadList(payload, kind, next);
      payload.events = (payload.events || []).filter((event) => !event.id.includes(id));
      refreshRoundCounts(payload);
    }, { action: "content-delete", message: "생성 콘텐츠 삭제" });
  }

  function getBattleSnapshot() {
    return readJSON(KEYS.battleSnapshot, null);
  }

  function importBattleSnapshot(input) {
    const snapshot = normalizeBattleSnapshot(input);
    writeJSON(KEYS.battleSnapshot, snapshot);
    return updateCurrentPayload((payload) => {
      applyBattleSnapshotToPayload(payload, snapshot);
    }, {
      action: "battle-sync",
      message: `본게임 스냅샷 반영: ${snapshot.roomCode || "방 데이터"} · ${snapshot.stocks.length}종목`
    });
  }

  function clearBattleSnapshot() {
    localStorage.removeItem(KEYS.battleSnapshot);
    return updateCurrentPayload((payload) => {
      payload.battleSnapshot = null;
      payload.news = removeBattleItems(payload.news);
      payload.rumors = removeBattleItems(payload.rumors);
      payload.disclosures = removeBattleItems(payload.disclosures);
      payload.reports = removeBattleItems(payload.reports);
      payload.events = removeBattleItems(payload.events);
      payload.companies = (payload.companies || []).filter((company) => !String(company.id || "").startsWith("battle-stock-")).map((company) => {
        if (!company.battle) return company;
        const { battle, ...rest } = company;
        return rest;
      });
      refreshRoundCounts(payload);
    }, { action: "battle-clear", message: "본게임 연동 데이터 제거" });
  }

  function applyBattleSnapshotToPayload(payload, snapshot) {
    const content = createBattleContent(snapshot);
    payload.battleSnapshot = {
      roomCode: snapshot.roomCode,
      status: snapshot.status,
      importedAt: snapshot.importedAt,
      marketTick: snapshot.marketTick,
      stockCount: snapshot.stocks.length,
      playerCount: snapshot.players.length,
      logCount: snapshot.logs.length,
      botCount: snapshot.botFeed.length,
      summary: snapshot.summary
    };
    payload.market = {
      ...payload.market,
      ...deriveBattleMarket(snapshot),
      linkedRoomCode: snapshot.roomCode || "",
      linkedAt: snapshot.importedAt
    };
    payload.companies = mergeBattleStocks(payload.companies || [], snapshot.stocks);
    // Phase 3: admin 작성 항목이 있으면 그것을 우선 사용, 없으면 engine 생성본을 fallback 으로 유지
    const adminNews = createAdminNewsItems(snapshot);
    const adminDisclosures = createAdminDisclosureItems(snapshot);
    payload.news = mergeBattleItems(payload.news, adminNews.length ? adminNews : content.news);
    payload.rumors = mergeBattleItems(payload.rumors, content.rumors);
    payload.disclosures = mergeBattleItems(payload.disclosures, adminDisclosures.length ? adminDisclosures : content.disclosures);
    payload.reports = mergeBattleItems(payload.reports, content.reports);
    payload.events = mergeBattleItems(payload.events, content.events);
    payload.roundSummary = {
      ...payload.roundSummary,
      headline: `라운드 ${payload.roundNumber || 1}: 본게임 시장 스냅샷 반영`,
      lead: `${snapshot.summary}. 체결, 호가, 뉴스가 섞여 있어 방향보다 충돌하는 단서를 먼저 봐야 합니다.`
    };
    refreshRoundCounts(payload);
  }

  function normalizeBattleSnapshot(input) {
    const raw = typeof input === "string" ? JSON.parse(input) : input;
    const { roomCode, room } = unwrapBattleRoom(raw);
    if (!room?.stocks) throw new Error("Market Battle room snapshot requires stocks.");

    const stocks = Object.entries(room.stocks || {}).map(([id, stock]) => normalizeBattleStock(id, stock));
    const logs = Object.values(room.logs || {}).filter(Boolean).map(normalizeBattleLog).sort((a, b) => b.time - a.time);
    const botFeed = asArray(room.botFeed).map(normalizeBattleLog).sort((a, b) => b.time - a.time);
    const players = Object.entries(room.players || {}).map(([id, player]) => ({
      id,
      nickname: player.nickname || id,
      cash: numberOr(0, player.cash),
      totalAsset: numberOr(0, player.totalAsset),
      holdings: player.holdings || {},
      connected: player.connected !== false
    }));

    // Phase 3: STONK Admin 이 rooms/{code}/news, /disclosures 에 직접 쓴 항목 (있으면 우선)
    const adminNews = asArray(room.news).filter(Boolean);
    const adminDisclosures = asArray(room.disclosures).filter((d) => d && !d.hidden && !d.deleted);

    return {
      roomCode: roomCode || room.roomCode || room.code || "",
      status: room.status || "unknown",
      importedAt: new Date().toISOString(),
      startedAt: room.startedAt || null,
      marketTick: room.marketTick || Date.now(),
      latestNews: room.latestNews || null,
      stocks,
      logs,
      botFeed,
      players,
      adminNews,
      adminDisclosures,
      summary: makeBattleSnapshotSummary(stocks, logs, botFeed, players)
    };
  }

  // ----- STONK Admin 작성 뉴스/공시 → board 콘텐츠 아이템 (source:"battle" 로 묶어 교체 관리) -----
  function createAdminNewsItems(snapshot) {
    const fallbackDate = toISODate(new Date());
    return (snapshot.adminNews || []).map((n) => {
      const stock = n.targetCompanyId ? snapshot.stocks.find((s) => s.id === n.targetCompanyId) : null;
      const dir = { up: "상승", down: "하락", mixed: "혼조", volatility: "변동성" }[n.effect] || "혼조";
      return battleItem("news", stock, {
        id: "admin-" + (n.id || Math.random().toString(36).slice(2)),
        date: String(n.createdAt || "").slice(0, 10) || fallbackDate,
        type: "관리자 뉴스",
        direction: dir,
        title: n.title || "(제목 없음)",
        summary: n.body || n.text || n.title || "본게임 운영자가 등록한 뉴스입니다.",
        body: n.body || n.text || "",
        signal: "STONK Admin 에서 직접 작성한 뉴스",
        counterSignal: "운영자가 의도적으로 배포한 정보이므로 반영 시점을 확인하세요."
      });
    });
  }

  function createAdminDisclosureItems(snapshot) {
    const fallbackDate = toISODate(new Date());
    return (snapshot.adminDisclosures || []).map((d) => {
      const stock = d.targetCompanyId ? snapshot.stocks.find((s) => s.id === d.targetCompanyId) : null;
      return battleItem("disclosures", stock, {
        id: "admin-" + (d.id || Math.random().toString(36).slice(2)),
        date: String(d.createdAt || d.updatedAt || "").slice(0, 10) || fallbackDate,
        type: d.type || "공시",
        direction: "중립",
        title: d.title || "(제목 없음)",
        summary: d.body || d.title || "본게임 운영자가 등록한 공시입니다.",
        body: d.body || "",
        signal: "STONK Admin 에서 직접 등록한 공시",
        counterSignal: "운영자 공시도 다른 재료와 함께 해석해야 합니다."
      });
    });
  }

  function unwrapBattleRoom(input) {
    if (input?.roomData?.stocks) return { roomCode: input.roomCode || input.code || "", room: input.roomData };
    if (input?.room?.stocks) return { roomCode: input.roomCode || input.code || "", room: input.room };
    if (input?.stocks) return { roomCode: input.roomCode || input.code || "", room: input };
    if (input?.rooms) {
      const found = Object.entries(input.rooms).find(([, room]) => room?.stocks);
      if (found) return { roomCode: found[0], room: found[1] };
    }
    if (input?.data?.roomState?.stocks) return { roomCode: input.data.roomCode || "", room: input.data.roomState };
    throw new Error("Market Battle room snapshot not found.");
  }

  function normalizeBattleStock(id, stock) {
    const price = numberOr(0, stock.price);
    const basePrice = numberOr(price, stock.basePrice || stock.previousPrice || stock.open);
    const high = numberOr(price, stock.high);
    const low = numberOr(price, stock.low);
    const known = findBaseCompany(stock.name);
    const changeRate = Number.isFinite(Number(stock.changeRate))
      ? Number(stock.changeRate)
      : basePrice ? Number((((price - basePrice) / basePrice) * 100).toFixed(2)) : 0;
    const type = stock.type || (String(id).startsWith("ipo") ? "ipo" : "normal");

    return {
      id: String(id),
      name: stock.name || String(id),
      type,
      typeLabel: battleStockTypeLabel(type, id),
      ticker: known?.ticker || tickerFromName(stock.name || id, type, id),
      sector: known?.sector || battleSectorFromStock(stock.name || id, type),
      price,
      previousPrice: numberOr(basePrice, stock.previousPrice),
      basePrice,
      open: numberOr(basePrice, stock.open),
      high,
      low,
      changeRate,
      rangeRate: basePrice ? Number((((high - low) / basePrice) * 100).toFixed(2)) : 0,
      volume: numberOr(0, stock.volume),
      value: numberOr(0, stock.value),
      pressure: numberOr(0, stock.pressure),
      trend: numberOr(0, stock.trend),
      news: stock.news || ""
    };
  }

  function normalizeBattleLog(log) {
    return {
      type: log.type || "trade",
      nickname: log.nickname || "시장참가자",
      stockName: log.stockName || log.name || "",
      qty: numberOr(0, log.qty),
      price: numberOr(0, log.price),
      time: numberOr(Date.now(), log.time),
      bot: Boolean(log.bot)
    };
  }

  function deriveBattleMarket(snapshot) {
    const normalStocks = snapshot.stocks.filter((stock) => stock.type === "normal" || stock.type === "ipo");
    const targetStocks = normalStocks.length ? normalStocks : snapshot.stocks;
    const avgChange = average(targetStocks.map((stock) => stock.changeRate));
    const avgAbsChange = average(targetStocks.map((stock) => Math.abs(stock.changeRate)));
    const avgRange = average(targetStocks.map((stock) => stock.rangeRate));
    const totalVolume = targetStocks.reduce((sum, stock) => sum + stock.volume, 0);
    const totalValue = targetStocks.reduce((sum, stock) => sum + stock.value, 0);
    const risingCount = targetStocks.filter((stock) => stock.changeRate > 0).length;
    const fallingCount = targetStocks.filter((stock) => stock.changeRate < 0).length;
    const ipoCount = snapshot.stocks.filter((stock) => stock.type === "ipo" || stock.id.startsWith("ipo")).length;
    const botInfluence = snapshot.botFeed.length + snapshot.logs.filter((log) => log.bot).length;
    const institutionLogs = [...snapshot.botFeed, ...snapshot.logs].filter((log) => ["기관", "외국인", "큰손", "수상한세력"].includes(log.nickname)).length;

    const liquidity = clamp(28 + Math.log10(totalVolume + 10) * 13 + Math.log10(totalValue + 10) * 4, 12, 96);
    const volatility = clamp(18 + avgAbsChange * 4.5 + avgRange * 1.6, 10, 98);
    const whalePower = clamp(35 + botInfluence * 4 + Math.abs(average(snapshot.stocks.map((stock) => stock.pressure))) * 2, 10, 95);
    const institutionPower = clamp(42 + institutionLogs * 7, 12, 92);
    const ipoTemperature = clamp(34 + ipoCount * 16 + Math.max(0, avgChange) * 3 + liquidity * 0.18, 10, 96);
    const delistingFear = clamp(24 + fallingCount * 5 + volatility * 0.22 + targetStocks.filter((stock) => stock.changeRate < -18).length * 12, 8, 92);
    const fearGreedScore = clamp(50 + avgChange * 4 + (risingCount - fallingCount) * 3 + liquidity * 0.15 - volatility * 0.12, 0, 100);
    const sentiment = fearGreedScore > 66 ? "탐욕" : fearGreedScore < 36 ? "공포" : "중립";

    return {
      sentiment,
      liquidity: Math.round(liquidity),
      volatility: Math.round(volatility),
      institutionPower: Math.round(institutionPower),
      whalePower: Math.round(whalePower),
      rumorReliability: clamp(42 + snapshot.botFeed.length * 2 + snapshot.logs.length * 0.3, 15, 88),
      ipoTemperature: Math.round(ipoTemperature),
      delistingFear: Math.round(delistingFear),
      fearGreedScore: Math.round(fearGreedScore),
      inflationStatus: "본게임 수급 기준",
      flowNote: `본게임 평균 등락률 ${formatPercent(avgChange)}, 총 거래량 ${formatNumber(totalVolume)}주가 반영됐습니다`,
      description: "Market Battle 본게임 방 데이터에서 계산한 시장 상태입니다. 체결량, 봇 수급, 플레이어 압력이 섞여 있어 단일 뉴스보다 수급 충돌을 우선 확인해야 합니다."
    };
  }

  function createBattleContent(snapshot) {
    const now = toISODate(new Date());
    const topMovers = [...snapshot.stocks].sort((a, b) => Math.abs(b.changeRate) - Math.abs(a.changeRate)).slice(0, 4);
    const topVolume = [...snapshot.stocks].sort((a, b) => b.volume - a.volume).slice(0, 3);
    const battleNews = createBattleNews(snapshot, topMovers, topVolume, now);
    const battleRumors = createBattleRumors(snapshot, topMovers, topVolume, now);
    const battleDisclosures = createBattleDisclosures(snapshot, topMovers, now);
    const battleReports = createBattleReports(snapshot, topMovers, now);
    const battleEvents = createBattleEvents([...battleDisclosures, ...battleNews, ...battleRumors].slice(0, 8));

    return {
      news: battleNews,
      rumors: battleRumors,
      disclosures: battleDisclosures,
      reports: battleReports,
      events: battleEvents
    };
  }

  function createBattleNews(snapshot, topMovers, topVolume, date) {
    const items = [];
    const latestText = snapshot.latestNews?.text || "";
    if (latestText) {
      const stock = stockFromText(snapshot.stocks, latestText) || topMovers[0] || snapshot.stocks[0];
      items.push(battleItem("news", stock, {
        id: "latest-news",
        date,
        type: "본게임 속보",
        title: latestText,
        summary: "본게임에서 발생한 최신 뉴스입니다. 이미 가격에 반영됐는지, 뒤늦게 따라붙는 수급인지 구분해야 합니다.",
        signal: "latestNews 필드에서 가져온 실시간 속보",
        counterSignal: "속보가 사실이어도 먼저 움직인 체결이 있으면 발표 후 반대 흐름이 나올 수 있습니다."
      }));
    }

    topMovers.forEach((stock, index) => {
      items.push(battleItem("news", stock, {
        id: `mover-${stock.id}`,
        date,
        type: "가격 변동",
        title: `${stock.name}, 기준가 대비 ${formatPercent(stock.changeRate)} 변동`,
        summary: `현재가 ${formatKRW(stock.price)}, 고저 변동폭 ${formatPercent(stock.rangeRate)}입니다. 방향보다 변동이 생긴 이유를 다른 정보와 대조해야 합니다.`,
        signal: index === 0 ? "라운드 내 변동성이 가장 큰 종목군" : "상대적으로 큰 가격 이동",
        counterSignal: "가격이 먼저 움직인 뒤 이유가 붙는 상황일 수 있습니다."
      }));
    });

    topVolume.forEach((stock) => {
      items.push(battleItem("news", stock, {
        id: `volume-${stock.id}`,
        date,
        type: "체결",
        title: `${stock.name}, 거래량 ${formatNumber(stock.volume)}주로 수급 주목`,
        summary: `거래대금은 ${formatKRW(stock.value)} 수준입니다. 플레이어 매매와 봇 유동성이 섞였을 가능성이 있습니다.`,
        signal: "본게임 volume/value 필드 기반 수급 힌트",
        counterSignal: "거래량 증가는 매집이 아니라 분산 매도일 수도 있습니다."
      }));
    });

    const botNames = snapshot.botFeed.map((log) => log.nickname).filter(Boolean).slice(0, 4);
    if (botNames.length && snapshot.botFeed[0]) {
      const stock = stockFromName(snapshot.stocks, snapshot.botFeed[0].stockName) || topVolume[0] || snapshot.stocks[0];
      items.push(battleItem("news", stock, {
        id: "bot-feed",
        date,
        type: "봇 수급",
        title: `봇 체결 로그 증가, ${stock.name} 포함 수급 해석 난도 상승`,
        summary: `${botNames.join(", ")} 체결이 관측됐습니다. 실제 플레이어 판단과 시장 유동성 공급을 분리해서 봐야 합니다.`,
        signal: "botFeed 필드 기반 체결 힌트",
        counterSignal: "봇 체결은 방향 의지가 아니라 시장 배경 거래량일 수 있습니다."
      }));
    }

    return uniqueBattleItems(items).slice(0, 12);
  }

  function createBattleRumors(snapshot, topMovers, topVolume, date) {
    const candidates = [...topMovers, ...topVolume].filter(Boolean);
    return uniqueBattleItems(candidates.slice(0, 6).map((stock, index) => battleItem("rumors", stock, {
      id: `rumor-${stock.id}`,
      date,
      type: "체결 루머",
      direction: "루머",
      title: `${stock.name}, 체결 로그에서 사전 정보설 확산`,
      summary: `등락률 ${formatPercent(stock.changeRate)}, 거래량 ${formatNumber(stock.volume)}주가 근거로 언급됩니다. 하지만 봇 거래와 추격 매수가 섞였을 수 있습니다.`,
      credibility: index < 2 ? "보통" : "낮음",
      truthHint: "체결 패턴만으로는 사실 여부를 확정할 수 없습니다.",
      signal: "가격 변동과 거래량이 동시에 커진 종목",
      counterSignal: "루머가 맞아도 이미 선반영됐다면 반응은 제한될 수 있습니다."
    }))).slice(0, 6);
  }

  function createBattleDisclosures(snapshot, topMovers, date) {
    const items = [];
    snapshot.stocks.filter((stock) => stock.type !== "normal").forEach((stock) => {
      items.push(battleItem("disclosures", stock, {
        id: `type-${stock.id}`,
        date,
        type: stock.type === "ipo" ? "신규상장" : "ETF 추종 점검",
        direction: "중립",
        title: `${stock.name}, ${stock.typeLabel} 상태 점검`,
        summary: `${stock.typeLabel} 종목은 개별 기업 뉴스보다 시장 전체 방향과 추적오차를 함께 봐야 합니다.`,
        signal: "본게임 종목 type 필드 기반",
        counterSignal: "지수형 상품은 개별 호재와 반대로 움직일 수 있습니다."
      }));
    });

    topMovers.filter((stock) => Math.abs(stock.changeRate) >= 18).forEach((stock) => {
      items.push(battleItem("disclosures", stock, {
        id: `heat-${stock.id}`,
        date,
        type: "체결 과열",
        direction: "혼조",
        title: `${stock.name}, 단기 변동성 확대 점검`,
        summary: `기준가 대비 ${formatPercent(stock.changeRate)} 움직이며 단기 과열 또는 과매도 점검 대상에 올랐습니다.`,
        signal: "가격제한폭 근처 움직임에 대한 운영용 공시",
        counterSignal: "과열 경고는 부담이지만 속도 조절 후 불확실성 해소로 해석될 수도 있습니다."
      }));
    });

    return uniqueBattleItems(items).slice(0, 8);
  }

  function createBattleReports(snapshot, topMovers, date) {
    const ranking = [...snapshot.players].sort((a, b) => b.totalAsset - a.totalAsset);
    const leader = ranking[0];
    const items = topMovers.slice(0, 4).map((stock) => battleItem("reports", stock, {
      id: `report-${stock.id}`,
      date,
      type: "관망",
      rating: "관망",
      stance: "중립",
      title: `${stock.name}: 본게임 체결은 힌트이지 결론이 아니다`,
      summary: `현재가, 거래량, 체결 로그가 동시에 움직였습니다. 매수/매도 압력과 봇 유동성을 나눠서 봐야 합니다.`,
      analyst: "Market Board Bridge",
      horizon: "현재 방",
      riskNote: "실시간 수급 왜곡 가능성",
      signal: "본게임 스냅샷 기반 애널리스트 코멘트",
      counterSignal: "라운드 순위 경쟁 때문에 기업 가치와 무관한 매매가 섞일 수 있습니다."
    }));

    if (leader) {
      const stock = topMovers[0] || snapshot.stocks[0];
      items.unshift(battleItem("reports", stock, {
        id: "ranking-pressure",
        date,
        type: "관망",
        rating: "관망",
        stance: "중립",
        title: `상위권 자산 ${formatKRW(leader.totalAsset)}, 방어 매매 가능성 점검`,
        summary: `${leader.nickname} 계정이 선두권입니다. 후반 라운드에는 수익률보다 순위 방어 목적의 거래가 나올 수 있습니다.`,
        analyst: "Market Board Bridge",
        horizon: "라운드 말",
        riskNote: "순위 심리 변수",
        signal: "players 총자산 기반 랭킹 힌트",
        counterSignal: "상위권 움직임을 따라가는 전략은 출구가 좁아질 수 있습니다."
      }));
    }

    return uniqueBattleItems(items).slice(0, 6);
  }

  function createBattleEvents(items) {
    const days = ["일", "월", "화", "수", "목", "금", "토"];
    return items.map((item, index) => {
      const date = new Date();
      date.setDate(date.getDate() + index + 1);
      const type = battleEventType(item);
      const titleType = type.endsWith("점검") ? type : `${type} 점검`;
      return {
        id: `battle-event-${item.id}`,
        source: "battle",
        date: toISODate(date),
        day: days[date.getDay()],
        type,
        company: item.company,
        direction: item.direction,
        title: `${item.company} ${titleType}`,
        summary: `${item.title} 항목이 본게임 시장 연동 일정으로 반영됐습니다.`
      };
    });
  }

  function battleItem(kind, stock, config) {
    const direction = config.direction || "혼조";
    return {
      id: `battle-${kind}-${config.id}`,
      source: "battle",
      kind,
      date: config.date,
      company: stock?.name || "Market Battle",
      ticker: stock?.ticker || "MB",
      sector: stock?.sector || "본게임",
      direction,
      type: config.type,
      title: config.title,
      summary: config.summary,
      body: config.body || config.summary,
      confidence: config.confidence || "본게임 스냅샷",
      impactStrength: config.impactStrength || impactFromStock(stock),
      signal: config.signal || "Market Battle 방 데이터에서 변환된 힌트",
      counterSignal: config.counterSignal || "체결과 뉴스가 동시에 움직이면 방향 해석이 갈릴 수 있습니다.",
      decisionQuestion: config.decisionQuestion || "이 움직임이 기업 재료인지, 순위 경쟁과 수급 압력인지 구분했는가?",
      credibility: config.credibility,
      truthHint: config.truthHint,
      rating: config.rating,
      stance: config.stance,
      analyst: config.analyst,
      horizon: config.horizon,
      riskNote: config.riskNote
    };
  }

  function mergeBattleStocks(companies, stocks) {
    const next = [...companies];
    stocks.forEach((stock) => {
      const index = next.findIndex((company) => normalizeText(company.name) === normalizeText(stock.name) || normalizeText(company.ticker) === normalizeText(stock.ticker));
      const existing = index >= 0 ? next[index] : null;
      const battleData = {
        stockId: stock.id,
        type: stock.typeLabel,
        price: stock.price,
        basePrice: stock.basePrice,
        changeRate: stock.changeRate,
        volume: stock.volume,
        value: stock.value,
        pressure: stock.pressure,
        trend: stock.trend,
        news: stock.news
      };
      const company = {
        ...(existing || createBattleCompany(stock)),
        ticker: existing?.ticker || stock.ticker,
        sector: existing?.sector || stock.sector,
        listingStatus: stock.type === "normal" ? (existing?.listingStatus || "본게임 종목") : stock.typeLabel,
        heat: Math.round(clamp(45 + stock.changeRate * 1.8 + Math.log10(stock.volume + 10) * 7, 0, 100)),
        warningScore: Math.round(clamp(35 + Math.abs(stock.changeRate) * 1.4 + stock.rangeRate * 1.5, 0, 100)),
        publicSignal: "본게임 연동",
        sectorMood: stock.typeLabel,
        engineHint: `본게임 현재가 ${formatKRW(stock.price)}, 등락률 ${formatPercent(stock.changeRate)}, 거래량 ${formatNumber(stock.volume)}주. 체결 방향만으로 결론을 내리기 어렵습니다.`,
        battle: battleData
      };
      if (index >= 0) next[index] = company;
      else next.push(company);
    });
    return next;
  }

  function createBattleCompany(stock) {
    return {
      id: `battle-stock-${stock.id}`,
      name: stock.name,
      ticker: stock.ticker,
      sector: stock.sector,
      ceo: "본게임 데이터",
      business: stock.typeLabel,
      risk: Math.abs(stock.changeRate) > 18 ? "높음" : "보통",
      growthLabel: stock.changeRate > 0 ? "확인 필요" : "관망",
      dividendLabel: "없음",
      listingStatus: stock.typeLabel,
      description: `${stock.name}은 Market Battle 본게임 스냅샷에서 가져온 시장 종목입니다. 현재 가격과 수급은 방 데이터에 따라 갱신됩니다.`,
      hidden: { growth: 55, debt: 45, cashFlow: 50, reputation: 50, innovation: 50, legalRisk: 35, management: 50 }
    };
  }

  function mergeBattleItems(existing = [], incoming = []) {
    return [...incoming, ...removeBattleItems(existing)].slice(0, 120);
  }

  function removeBattleItems(items = []) {
    return items.filter((item) => item?.source !== "battle");
  }

  function uniqueBattleItems(items) {
    const seen = new Set();
    return items.filter((item) => {
      if (!item?.title || seen.has(item.title)) return false;
      seen.add(item.title);
      return true;
    });
  }

  function battleEventType(item) {
    if (String(item.type).includes("신규상장")) return "신규상장";
    if (String(item.type).includes("ETF")) return "ETF 추종 점검";
    if (String(item.type).includes("체결")) return "체결 과열";
    if (String(item.type).includes("가격")) return "호가 변동 점검";
    if (String(item.type).includes("루머")) return "대형 시장 이벤트";
    return item.type || "대형 시장 이벤트";
  }

  function makeBattleSnapshotSummary(stocks, logs, botFeed, players) {
    const avgChange = average(stocks.map((stock) => stock.changeRate));
    const top = [...stocks].sort((a, b) => Math.abs(b.changeRate) - Math.abs(a.changeRate))[0];
    const tradeCount = logs.length + botFeed.length;
    return `${stocks.length}개 종목, ${players.length}명 참가, 체결 힌트 ${tradeCount}건이 들어왔고 평균 등락률은 ${formatPercent(avgChange)}입니다. 핵심 관찰 종목은 ${top?.name || "없음"}입니다`;
  }

  function findBaseCompany(name) {
    return (window.MarketData?.companies || []).find((company) => normalizeText(company.name) === normalizeText(name));
  }

  function stockFromText(stocks, text) {
    return stocks.find((stock) => text.includes(stock.name));
  }

  function stockFromName(stocks, name) {
    return stocks.find((stock) => normalizeText(stock.name) === normalizeText(name));
  }

  function battleStockTypeLabel(type, id) {
    if (type === "inverse") return "인버스";
    if (type === "leverage") return "레버리지";
    if (type === "ipo" || String(id).startsWith("ipo")) return "신규상장";
    return "본게임 종목";
  }

  function battleSectorFromStock(name, type) {
    if (type === "inverse" || type === "leverage") return "시장지수";
    const text = String(name);
    if (text.includes("항공")) return "항공";
    if (text.includes("식품")) return "식품";
    if (text.includes("바이오") || text.includes("제약")) return "바이오";
    if (text.includes("게임")) return "게임";
    if (text.includes("에너지")) return "에너지";
    if (text.includes("금융")) return "금융";
    if (text.includes("모빌") || text.includes("로보")) return "모빌리티";
    if (text.includes("반도체") || text.includes("전자") || text.includes("테크")) return "AI·전자";
    if (text.includes("소프트")) return "소프트웨어";
    if (text.includes("엔터")) return "미디어";
    if (text.includes("물산") || text.includes("유통")) return "물류";
    return "본게임";
  }

  function tickerFromName(name, type, id) {
    if (type === "inverse") return "INVS";
    if (type === "leverage") return "LEV2";
    const base = String(name || id).replace(/[^A-Za-z0-9가-힣]/g, "");
    const chars = [...base].slice(0, 4);
    return chars.map((char) => {
      const code = char.charCodeAt(0).toString(36).toUpperCase();
      return code.slice(-1);
    }).join("").padEnd(4, "X").slice(0, 4);
  }

  function impactFromStock(stock) {
    const value = Math.abs(stock?.changeRate || 0) + (stock?.rangeRate || 0) * 0.4;
    if (value > 24) return "매우 높음";
    if (value > 12) return "높음";
    if (value < 4) return "낮음";
    return "중간";
  }

  function average(values) {
    const nums = values.map(Number).filter(Number.isFinite);
    return nums.length ? nums.reduce((sum, value) => sum + value, 0) / nums.length : 0;
  }

  function asArray(value) {
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object") return Object.values(value);
    return [];
  }

  function normalizeText(value) {
    return String(value || "").trim().toLocaleLowerCase("ko-KR");
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, Number(value) || 0));
  }

  function toISODate(date) {
    return date.toISOString().slice(0, 10);
  }

  function formatNumber(value) {
    return new Intl.NumberFormat("ko-KR").format(Math.round(Number(value) || 0));
  }

  function formatKRW(value) {
    return `${formatNumber(value)}원`;
  }

  function formatPercent(value) {
    const number = Number(value) || 0;
    const sign = number > 0 ? "+" : "";
    return `${sign}${number.toFixed(2)}%`;
  }

  function upsertRoundLog(payload, meta = {}) {
    const logs = getAllRoundLogs();
    const summary = createLogSummary(payload, meta);
    const withoutCurrent = logs.filter((item) => item.roundId !== payload.roundId);
    writeJSON(KEYS.roundLogs, [summary, ...withoutCurrent].slice(0, 120));
  }

  function getRoundLogs(options = {}) {
    const logs = getAllRoundLogs();
    if (options.allSeasons) return logs;
    const season = getSeason();
    return logs.filter((log) => (log.season?.id || "season-1") === season.id);
  }

  function getAllRoundLogs() {
    return readJSON(KEYS.roundLogs, []);
  }

  function getCustomItems() {
    return readJSON(KEYS.customItems, []);
  }

  function saveCustomItem(item) {
    const items = getCustomItems();
    writeJSON(KEYS.customItems, [item, ...items].slice(0, 200));
  }

  function deleteCustomItem(id) {
    writeJSON(KEYS.customItems, getCustomItems().filter((item) => item.id !== id));
  }

  function clearCustomItems() {
    localStorage.removeItem(KEYS.customItems);
  }

  function exportAllData() {
    return {
      version: 4,
      exportedAt: new Date().toISOString(),
      keys: {
        season: KEYS.season,
        roundState: KEYS.roundState,
        roundLogs: KEYS.roundLogs,
        customItems: KEYS.customItems
      },
      data: {
        season: getSeason(),
        roundState: getRoundState(),
        roundLogs: getAllRoundLogs(),
        customItems: getCustomItems(),
        battleSnapshot: getBattleSnapshot()
      }
    };
  }

  function importAllData(backup) {
    if (!backup?.data) throw new Error("Invalid Market Board backup");
    if (backup.data.season) writeJSON(KEYS.season, backup.data.season);
    if (backup.data.roundState) writeJSON(KEYS.roundState, backup.data.roundState);
    if (backup.data.roundLogs) writeJSON(KEYS.roundLogs, backup.data.roundLogs);
    if (backup.data.customItems) writeJSON(KEYS.customItems, backup.data.customItems);
    if (backup.data.battleSnapshot) writeJSON(KEYS.battleSnapshot, backup.data.battleSnapshot);
  }

  function resetAllData() {
    Object.values(KEYS).forEach((key) => localStorage.removeItem(key));
  }

  function createLogSummary(payload, meta) {
    const season = payload.season || getSeason();
    return {
      season,
      roundNumber: payload.roundNumber,
      roundId: payload.roundId,
      generatedAt: payload.generatedAt,
      updatedAt: payload.updatedAt || payload.generatedAt,
      action: meta.action || payload.action || "round",
      message: meta.message || payload.roundSummary?.headline || "",
      shock: payload.shock || null,
      forcedEvents: collectForcedEvents(payload),
      summaryText: buildRoundSummaryText(payload),
      sentiment: payload.market?.sentiment,
      fearGreedScore: payload.market?.fearGreedScore,
      ipoTemperature: payload.market?.ipoTemperature,
      delistingFear: payload.market?.delistingFear,
      newsCount: payload.news?.length || 0,
      rumorCount: payload.rumors?.length || 0,
      disclosureCount: payload.disclosures?.length || 0,
      reportCount: payload.reports?.length || 0,
      eventCount: payload.events?.length || 0,
      topNews: payload.news?.slice(0, 3).map((item) => item.title) || [],
      content: {
        news: summarizeContent(payload.news),
        rumors: summarizeContent(payload.rumors),
        disclosures: summarizeContent(payload.disclosures),
        reports: summarizeContent(payload.reports),
        events: summarizeContent(payload.events)
      }
    };
  }

  function normalizePayload(payload, season) {
    const next = clone(payload);
    next.season = next.season || season;
    next.roundSummary = next.roundSummary || {
      headline: `라운드 ${next.roundNumber || 1}`,
      lead: "라운드 정보가 저장됐습니다.",
      keyCounts: {},
      topSignals: []
    };
    next.market = normalizeMarket(next.market || {});
    next.news = next.news || [];
    next.rumors = next.rumors || [];
    next.disclosures = next.disclosures || [];
    next.reports = next.reports || [];
    next.events = next.events || [];
    next.companies = mergeBaseCompanies(next.companies);
    refreshRoundCounts(next);
    return next;
  }

  function hasBaseCompanyGap(payload) {
    const baseCount = window.MarketData?.companies?.length || 0;
    const savedCount = payload?.companies?.length || 0;
    return baseCount > 0 && savedCount < baseCount;
  }

  function mergeBaseCompanies(savedCompanies = []) {
    const baseCompanies = window.MarketData?.companies || [];
    if (!baseCompanies.length) return savedCompanies;
    const seen = new Set(savedCompanies.map((company) => company.id));
    const missing = baseCompanies.filter((company) => !seen.has(company.id));
    return [...savedCompanies, ...missing];
  }

  function normalizeMarket(market) {
    const liquidity = numberOr(50, market.liquidity);
    const volatility = numberOr(50, market.volatility);
    const creditStress = numberOr(40, market.creditStress);
    return {
      ...market,
      sentiment: market.sentiment || "중립",
      liquidity,
      volatility,
      ipoTemperature: numberOr(Math.round((liquidity + numberOr(50, market.whalePower)) / 2), market.ipoTemperature),
      delistingFear: numberOr(Math.round((volatility + creditStress) / 2), market.delistingFear)
    };
  }

  function refreshRoundCounts(payload) {
    payload.roundSummary = payload.roundSummary || {};
    payload.roundSummary.keyCounts = {
      news: payload.news?.length || 0,
      rumors: payload.rumors?.length || 0,
      disclosures: payload.disclosures?.length || 0,
      reports: payload.reports?.length || 0
    };
    payload.roundSummary.topSignals = payload.news?.slice(0, 3).map((item) => item.title) || [];
  }

  function collectForcedEvents(payload) {
    const lists = [payload.news, payload.rumors, payload.disclosures, payload.reports].flat().filter(Boolean);
    return lists
      .filter((item) => item.source === "forced")
      .slice(0, 10)
      .map((item) => ({
        id: item.id,
        title: item.title,
        company: item.company,
        type: item.type,
        direction: item.direction
      }));
  }

  function buildRoundSummaryText(payload) {
    const shock = payload.shock?.label ? `${payload.shock.label} 충격이 반영됐고 ` : "";
    const market = payload.market || {};
    return `${shock}시장 심리는 ${market.sentiment || "중립"}, 유동성 ${market.liquidity || 0}점, 변동성 ${market.volatility || 0}점입니다. 가장 크게 논쟁되는 재료는 ${payload.news?.[0]?.title || "아직 없습니다"}.`;
  }

  function summarizeContent(items = []) {
    return items.slice(0, 40).map((item) => ({
      id: item.id,
      title: item.title,
      company: item.company,
      type: item.type || item.rating,
      direction: item.direction,
      source: item.source
    }));
  }

  function getPayloadList(payload, kind) {
    const map = {
      news: payload.news,
      rumors: payload.rumors,
      disclosures: payload.disclosures,
      reports: payload.reports
    };
    return map[kind] || [];
  }

  function setPayloadList(payload, kind, list) {
    if (kind === "news") payload.news = list;
    if (kind === "rumors") payload.rumors = list;
    if (kind === "disclosures") payload.disclosures = list;
    if (kind === "reports") payload.reports = list;
  }

  function migrateLegacyData() {
    if (!localStorage.getItem(KEYS.roundState) && localStorage.getItem(LEGACY_KEYS.roundState)) {
      writeJSON(KEYS.roundState, readJSON(LEGACY_KEYS.roundState, null));
    }
    if (!localStorage.getItem(KEYS.roundLogs) && localStorage.getItem(LEGACY_KEYS.roundLogs)) {
      const legacyLogs = readJSON(LEGACY_KEYS.roundLogs, []);
      writeJSON(KEYS.roundLogs, legacyLogs.map((log) => ({ season: getSeason(), ...log })));
    }
    if (!localStorage.getItem(KEYS.customItems) && localStorage.getItem(LEGACY_KEYS.customItems)) {
      writeJSON(KEYS.customItems, readJSON(LEGACY_KEYS.customItems, []));
    }
  }

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function clone(value) {
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function numberOr(fallback, value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  window.MarketStorage = {
    ensureRound,
    advanceRound,
    getSeason,
    saveSeason,
    getRoundState,
    getCurrentPayload,
    getBattleSnapshot,
    importBattleSnapshot,
    clearBattleSnapshot,
    saveRoundPayload,
    updateCurrentPayload,
    updateMarketState,
    updateContentItem,
    deleteContentItem,
    getRoundLogs,
    getAllRoundLogs,
    getCustomItems,
    saveCustomItem,
    deleteCustomItem,
    clearCustomItems,
    exportAllData,
    importAllData,
    resetAllData
  };
})();
