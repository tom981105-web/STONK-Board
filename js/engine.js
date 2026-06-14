(function () {
  const HISTORY_KEY = "market-board-template-history-v3";
  const TITLE_HISTORY_KEY = "market-board-title-history-v3";

  const shockPresets = {
    "rate-shock": {
      id: "rate-shock",
      label: "금리 충격",
      description: "정책 금리 인상 가능성이 커지며 부채 부담과 할인율이 동시에 높아집니다.",
      market: { interestRate: 0.75, liquidity: -12, volatility: 16, policyPressure: 14, creditStress: 18, inflation: 4 },
      sectors: { "금융": { capitalFlow: 8 }, "건설": { capitalFlow: -18, supplyStress: 10 }, "모빌리티": { capitalFlow: -10 }, "바이오": { capitalFlow: -8 } }
    },
    "liquidity-crisis": {
      id: "liquidity-crisis",
      label: "유동성 위기",
      description: "대기 자금이 빠르게 줄어들어 좋은 뉴스에도 매수세가 따라붙기 어려워집니다.",
      market: { liquidity: -32, volatility: 22, creditStress: 24, institutionPower: -8, whalePower: 10 },
      sectors: { "소프트웨어": { capitalFlow: -8 }, "AI·전자": { capitalFlow: -12 }, "건설": { capitalFlow: -14 }, "금융": { capitalFlow: -10 } }
    },
    "ai-bubble": {
      id: "ai-bubble",
      label: "AI 버블",
      description: "AI 관련 자금이 과열되며 성장 기대와 차익실현 위험이 동시에 커집니다.",
      market: { liquidity: 12, volatility: 17, whalePower: 14, rumorReliability: -4 },
      sectors: { "AI·전자": { capitalFlow: 28, demand: 24, supplyStress: 8 }, "소프트웨어": { capitalFlow: 12, demand: 8 }, "교육": { capitalFlow: 8 } }
    },
    "airline-bad-news": {
      id: "airline-bad-news",
      label: "항공 악재",
      description: "항공유와 노선 규제 우려가 겹치며 항공 업종 신뢰가 낮아집니다.",
      market: { volatility: 10, policyPressure: 12, inflation: 5 },
      sectors: { "항공": { capitalFlow: -30, demand: -18, policy: 24, supplyStress: 28 }, "모빌리티": { capitalFlow: 8, demand: 8 } }
    },
    "energy-shock": {
      id: "energy-shock",
      label: "에너지 쇼크",
      description: "전력망과 원가 변수가 흔들리며 에너지 기업은 주목받고 원가 민감 업종은 압박받습니다.",
      market: { volatility: 18, inflation: 14, liquidity: -4 },
      sectors: { "에너지": { capitalFlow: 18, demand: 20, supplyStress: 18 }, "식품": { supplyStress: 10 }, "항공": { supplyStress: 16 }, "건설": { supplyStress: 10 } }
    },
    "ipo-overheat": {
      id: "ipo-overheat",
      label: "공모주 과열",
      description: "신규상장과 IPO 재료에 단기 자금이 몰려 기존 종목과 신규 후보가 경쟁합니다.",
      market: { liquidity: 16, volatility: 18, whalePower: 12, rumorReliability: 6 },
      sectors: { "교육": { capitalFlow: 18, demand: 14 }, "AI·전자": { capitalFlow: 10 }, "바이오": { capitalFlow: 8 }, "친환경소재": { capitalFlow: 8 } }
    },
    "delisting-fear": {
      id: "delisting-fear",
      label: "상장폐지 공포",
      description: "관리종목과 상장폐지 심사 소문이 퍼지며 취약 기업에 위험 회피가 집중됩니다.",
      market: { liquidity: -14, volatility: 26, policyPressure: 16, rumorReliability: 10, creditStress: 20 },
      sectors: { "바이오": { capitalFlow: -14 }, "모빌리티": { capitalFlow: -12 }, "항공": { capitalFlow: -10 }, "금융": { capitalFlow: 6 } }
    }
  };

  function generateRound(roundNumber, options = {}) {
    const data = window.MarketData;
    const shock = normalizeShock(options.shock);
    const sectorStates = applySectorShock(data.sectorStates, shock);
    const marketBase = applyMarketShock(data.marketState, shock);
    const market = evolveMarket(marketBase, shock, roundNumber);
    const companies = data.companies.map((company) => enrichCompany(company, sectorStates[company.sector], market, shock));
    const context = { data, market, companies, sectorStates, roundNumber, shock };

    const news = generateItems("news", data.newsTemplates, 18, context);
    const rumors = generateItems("rumors", data.rumorTemplates, 14, context);
    const disclosures = generateItems("disclosures", data.disclosureTemplates, 13, context);
    const reports = generateItems("reports", data.reportTemplates, 10, context);

    if (shock) news.unshift(createShockNews(shock, market, roundNumber));

    const events = generateEvents(context, news, disclosures, rumors);
    const sectors = buildSectorSummary(sectorStates, market);
    const roundSummary = createRoundSummary(roundNumber, market, shock, news, rumors, disclosures, reports);

    return {
      roundNumber,
      roundId: `round-${roundNumber}-${Date.now()}-${entropyInt(1000, 9999, ["round", roundNumber])}`,
      generatedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      shock,
      roundSummary,
      market,
      companies,
      sectors,
      news,
      rumors,
      disclosures,
      reports,
      events
    };
  }

  function createForcedCompanyEvent(payload, companyId, eventKind) {
    const company = payload.companies.find((item) => item.id === companyId) || payload.companies[0];
    const now = new Date().toISOString();
    const eventMap = {
      good: { kind: "news", type: "호재", direction: "혼조", title: `${company.name}, 운영자 지정 우호 단서 등장`, summary: `${company.name}에 우호적인 단서가 반영됐지만, 기대 선반영과 차익실현 여부를 함께 봐야 합니다.` },
      bad: { kind: "news", type: "악재", direction: "혼조", title: `${company.name}, 운영자 지정 부담 단서 등장`, summary: `${company.name}에 부담이 되는 정보가 공개됐습니다. 이미 알려진 악재라면 해소 반응도 가능합니다.` },
      rumor: { kind: "rumors", type: "강제 루머", direction: "루머", credibility: "보통", title: `${company.name}, 확인되지 않은 강제 루머 확산`, summary: `${company.name} 관련 루머가 라운드 운영자에 의해 추가됐습니다. 사실 여부는 공개되지 않았습니다.` },
      disclosure: { kind: "disclosures", type: "공시", direction: "중립", title: `${company.name}, 운영자 지정 공시 제출`, summary: `${company.name}이 라운드 운영자 지정 공시를 제출했습니다. 세부 영향은 다른 재료와 함께 해석해야 합니다.` },
      report: { kind: "reports", type: "관망", rating: "관망", direction: "중립", title: `${company.name}: 운영자 지정 애널리스트 코멘트`, summary: `${company.name}에 대한 추가 리포트가 발간됐습니다. 정답이 아니라 판단 힌트입니다.` },
      halt: { kind: "disclosures", type: "거래정지", direction: "혼조", title: `${company.name}, 중요 정보 확인을 위한 거래정지`, summary: `${company.name}이 중요 정보 확인을 이유로 거래정지 이벤트에 들어갔습니다. 불확실성 확대와 해소 기대가 충돌합니다.` },
      ipo: { kind: "disclosures", type: "IPO", direction: "혼조", title: `${company.name}, IPO 관련 일정 부각`, summary: `${company.name} 또는 관계사의 IPO 재료가 강제 반영됐습니다. 공모주 과열 여부가 핵심입니다.` },
      delistingReview: { kind: "disclosures", type: "상장폐지 심사", direction: "혼조", title: `${company.name}, 상장폐지 심사 이벤트 발생`, summary: `${company.name}에 상장폐지 심사 이벤트가 강제 반영됐습니다. 위험 회피와 저가 매수가 충돌할 수 있습니다.` }
    };

    const config = eventMap[eventKind] || eventMap.good;
    const base = {
      id: `forced-${eventKind}-${company.id}-${Date.now()}`,
      source: "forced",
      date: toISODate(new Date()),
      company: company.name,
      ticker: company.ticker,
      sector: company.sector,
      direction: config.direction,
      type: config.type,
      title: config.title,
      summary: config.summary,
      confidence: "운영자 지정",
      signal: "관리자 페이지에서 특정 기업 이벤트로 강제 생성됨",
      counterSignal: "운영자가 지정한 이벤트라도 시장 반응은 라운드 심리와 선반영 정도에 따라 달라질 수 있음",
      decisionQuestion: "이 이벤트가 새 정보인지, 이미 참가자들이 예상한 정보인지 구분했는가?",
      forcedAt: now
    };

    if (config.kind === "rumors") {
      return { ...base, kind: config.kind, credibility: config.credibility, truthHint: "운영자 지정 루머입니다." };
    }

    if (config.kind === "reports") {
      return {
        ...base,
        kind: config.kind,
        rating: config.rating,
        stance: "중립",
        analyst: "라운드 운영자",
        horizon: "운영자 지정",
        riskNote: "강제 생성 리포트"
      };
    }

    return { ...base, kind: config.kind };
  }

  function eventFromForcedItem(item, existingEventsLength) {
    const date = new Date();
    date.setDate(date.getDate() + ((existingEventsLength % 6) + 1));
    const days = ["일", "월", "화", "수", "목", "금", "토"];
    return {
      id: `event-${item.id}`,
      date: toISODate(date),
      day: days[date.getDay()],
      type: item.type,
      company: item.company,
      direction: item.direction,
      title: `${item.company} ${item.type} 강제 이벤트`,
      summary: `${item.title} 항목이 라운드 일정에 반영됐습니다.`
    };
  }

  function normalizeShock(shock) {
    if (!shock) return null;
    if (typeof shock === "string") return shockPresets[shock] || null;
    return shockPresets[shock.id] || shock;
  }

  function applyMarketShock(base, shock) {
    const next = { ...base };
    if (!shock?.market) return next;

    Object.entries(shock.market).forEach(([key, delta]) => {
      if (key === "interestRate") next[key] = Number((next[key] + delta).toFixed(2));
      else next[key] = clamp((next[key] || 0) + delta, 0, 100);
    });

    return next;
  }

  function applySectorShock(base, shock) {
    const next = Object.fromEntries(Object.entries(base).map(([name, state]) => [name, { ...state }]));
    if (!shock?.sectors) return next;

    Object.entries(shock.sectors).forEach(([sector, changes]) => {
      if (!next[sector]) return;
      Object.entries(changes).forEach(([key, delta]) => {
        next[sector][key] = clamp((next[sector][key] || 0) + delta, 0, 100);
      });
    });

    return next;
  }

  function evolveMarket(base, shock, roundNumber) {
    const liquidityShock = layeredNoise(0, 18, ["liquidity", "shock", roundNumber]);
    const volatilityShock = layeredNoise(0, 22, ["volatility", "shock", roundNumber]);
    const policyShock = layeredNoise(0, 14, ["policy", "shock", roundNumber]);
    const whaleImpulse = layeredNoise(0, 20, ["whale", "impulse", roundNumber]);
    const rumorDrift = layeredNoise(0, 16, ["rumor", "drift", roundNumber]);

    const liquidity = clamp(base.liquidity + liquidityShock, 5, 95);
    const volatility = clamp(base.volatility + volatilityShock, 8, 98);
    const policyPressure = clamp(base.policyPressure + policyShock, 5, 95);
    const whalePower = clamp(base.whalePower + whaleImpulse, 5, 95);
    const rumorReliability = clamp(base.rumorReliability + rumorDrift, 5, 95);
    const fearGreedScore = clamp(
      liquidity * 0.33 +
      (100 - volatility) * 0.14 +
      (100 - base.inflation) * 0.1 +
      base.institutionPower * 0.15 +
      whalePower * 0.12 +
      layeredNoise(0, 24, ["sentiment", "stack", roundNumber]),
      0,
      100
    );

    const sentiment = fearGreedScore > 67 ? "탐욕" : fearGreedScore < 37 ? "공포" : "중립";

    return {
      ...base,
      liquidity: Math.round(liquidity),
      volatility: Math.round(volatility),
      policyPressure: Math.round(policyPressure),
      whalePower: Math.round(whalePower),
      rumorReliability: Math.round(rumorReliability),
      fearGreedScore: Math.round(fearGreedScore),
      sentiment,
      inflationStatus: base.inflation > 66 ? "높음" : base.inflation < 42 ? "안정" : "둔화 대기",
      flowNote: createFlowNote(sentiment, liquidity, volatility, whalePower, shock)
    };
  }

  function enrichCompany(company, sector, market, shock) {
    const hidden = company.hidden;
    const sectorFlow = sector.capitalFlow + layeredNoise(0, 18, [company.id, "sector-flow", shock?.id || "normal"]);
    const fundamental =
      hidden.growth * 0.2 +
      (100 - hidden.debt) * 0.16 +
      hidden.cashFlow * 0.2 +
      hidden.reputation * 0.15 +
      hidden.innovation * 0.14 +
      (100 - hidden.legalRisk) * 0.08 +
      hidden.management * 0.07;
    const stress =
      hidden.debt * 0.22 +
      (100 - hidden.cashFlow) * 0.2 +
      hidden.legalRisk * 0.2 +
      market.volatility * 0.16 +
      market.policyPressure * 0.1 +
      layeredNoise(0, 18, [company.id, "stress", shock?.id || "normal"]);
    const opportunity =
      hidden.growth * 0.22 +
      hidden.innovation * 0.2 +
      sector.demand * 0.17 +
      sectorFlow * 0.15 +
      market.liquidity * 0.12 +
      market.institutionPower * 0.07 +
      layeredNoise(0, 19, [company.id, "opportunity", shock?.id || "normal"]);
    const heat = clamp(opportunity - stress * 0.42 + layeredNoise(0, 20, [company.id, "heat"]), 0, 100);
    const warningScore = clamp(stress - fundamental * 0.34 + hidden.legalRisk * 0.16, 0, 100);

    return {
      ...company,
      publicSignal: heat > 70 ? "관심 집중" : heat < 34 ? "방어 필요" : "중립 관찰",
      heat: Math.round(heat),
      warningScore: Math.round(warningScore),
      sectorMood: sector.mood,
      sectorFlow: Math.round(clamp(sectorFlow, 0, 100)),
      engineHint: makeCompanyHint(company, hidden, heat, warningScore)
    };
  }

  function generateItems(kind, templates, count, context) {
    const items = [];
    const usedTypes = new Map();
    let attempts = 0;

    while (items.length < count && attempts < count * 18) {
      attempts += 1;
      const company = pickCompany(context.companies, context.market, kind);
      const template = pickTemplate(kind, templates, company, context.market, usedTypes);
      if (!template) break;

      const score = layeredContentScore(company, context.sectorStates[company.sector], context.market, template, kind);
      if (!passesContentGate(score, kind, attempts, items.length, count)) continue;

      const item = createItem(kind, template, company, context, score);
      if (items.some((existing) => existing.title === item.title)) continue;

      items.push(item);
      usedTypes.set(template.type || template.rating || template.stance, (usedTypes.get(template.type || template.rating || template.stance) || 0) + 1);
      rememberTemplate(kind, template.id);
      rememberTitle(item.title);
    }

    return items;
  }

  function pickCompany(companies, market, kind) {
    return weightedPick(companies, (company) => {
      const heatBias = kind === "rumors" ? Math.abs(company.heat - 50) : company.heat;
      const dangerBias = ["disclosures", "reports"].includes(kind) ? company.warningScore * 0.35 : 0;
      const whaleBias = market.whalePower * entropyUnit([company.id, kind, "whale"]) * 0.4;
      const underdogGate = entropyUnit([company.id, kind, "underdog"]) > 0.82 ? 38 : 0;
      return 8 + heatBias * 0.55 + dangerBias + whaleBias + underdogGate;
    });
  }

  function pickTemplate(kind, templates, company, market, usedTypes) {
    const history = readJSON(HISTORY_KEY, {});
    const recent = new Set(history[kind] || []);
    const titleHistory = new Set(readJSON(TITLE_HISTORY_KEY, []));
    const fresh = templates.filter((template) => !recent.has(template.id));
    const pool = fresh.length > 4 ? fresh : templates;

    return weightedPick(pool, (template) => {
      const typePressure = usedTypes.get(template.type || template.rating || template.stance) || 0;
      const companyFit = templateFitScore(template, company, market);
      const title = template.title.replace("{company}", company.name).replace("{sector}", company.sector);
      const titlePenalty = titleHistory.has(title) ? 0.15 : 1;
      return Math.max(1, companyFit * titlePenalty - typePressure * 18);
    });
  }

  function templateFitScore(template, company, market) {
    let score = 30 + entropyUnit([template.id, company.id, "fit"]) * 40;
    const h = company.hidden;

    if (["유상증자", "차입"].includes(template.type)) score += h.debt * 0.35 + (100 - h.cashFlow) * 0.2;
    if (["배당", "배당 발표", "자사주 매입"].includes(template.type)) score += h.cashFlow * 0.35 + h.management * 0.15;
    if (["상장폐지", "상장폐지 심사", "관리종목", "거래정지"].includes(template.type)) score += company.warningScore * 0.55;
    if (["인수합병", "회사분할"].includes(template.type)) score += h.innovation * 0.18 + h.growth * 0.15;
    if (["IPO", "신규상장"].includes(template.type)) score += market.liquidity * 0.22 + h.growth * 0.13;
    if (template.type === "정책") score += market.policyPressure * 0.3;
    if (template.type === "고래") score += market.whalePower * 0.35;
    if (template.type === "기관") score += market.institutionPower * 0.3;
    if (template.type === "루머검증") score += market.rumorReliability * 0.25;
    if (["소송", "법적리스크"].includes(template.type)) score += h.legalRisk * 0.45;
    if (template.tone === "positive") score += company.heat * 0.12;
    if (template.tone === "negative") score += company.warningScore * 0.18;

    return score;
  }

  function layeredContentScore(company, sector, market, template, kind) {
    const h = company.hidden;
    const base =
      h.growth * 0.12 +
      h.cashFlow * 0.12 +
      h.innovation * 0.11 +
      sector.demand * 0.1 +
      sector.capitalFlow * 0.09 +
      market.liquidity * 0.08 +
      market.institutionPower * 0.06;
    const risk =
      h.debt * 0.1 +
      h.legalRisk * 0.11 +
      market.volatility * 0.09 +
      market.policyPressure * 0.08 +
      sector.supplyStress * 0.07;
    const firstGate = probabilityGate((base + risk) / 160, [company.id, template.id, "first"]);
    const secondGate = probabilityGate((company.heat + market.whalePower) / 180, [company.id, template.id, "second"]);
    const rumorGate = probabilityGate((market.rumorReliability + h.reputation) / 190, [company.id, template.id, "rumor"]);
    const contradictionGate = probabilityGate((market.volatility + market.whalePower + 35) / 210, [company.id, template.id, "contradiction"]);
    const rareEventGate = probabilityGate((company.warningScore + market.policyPressure) / 220, [company.id, template.id, "rare"]);

    return {
      raw: clamp(base - risk * 0.32 + firstGate * 18 + secondGate * 14 + rumorGate * 10 + rareEventGate * 12 + layeredNoise(0, 30, [company.id, template.id, kind]), 0, 100),
      contradiction: contradictionGate > 0.58,
      rare: rareEventGate > 0.72
    };
  }

  function passesContentGate(score, kind, attempts, made, target) {
    if (made < target * 0.35) return true;
    const pressure = made / target;
    const kindBias = kind === "disclosures" ? 0.48 : kind === "reports" ? 0.42 : 0.38;
    const threshold = kindBias + pressure * 0.18;
    return score.raw / 100 + entropyUnit([kind, attempts, "pass"]) * 0.34 > threshold;
  }

  function createItem(kind, template, company, context, score) {
    const date = relativeDate(entropyInt(0, 6, [kind, template.id, company.id, "date"]));
    const direction = inferReaction(template, company, context.market, score);
    const title = uniqueTitle(formatTemplate(template.title, company));
    const base = {
      id: `${kind}-${template.id}-${company.id}-${Date.now()}-${entropyInt(100, 999, [template.id, company.id, "id"])}`,
      source: "auto",
      date,
      company: company.name,
      ticker: company.ticker,
      sector: company.sector,
      direction,
      type: template.type || template.rating || template.stance,
      title,
      summary: formatTemplate(template.body, company),
      confidence: makeConfidence(context.market, company, kind),
      signal: makeSignal(score, direction),
      uncertainty: makeUncertainty(score, context.market, company),
      counterSignal: makeCounterSignal(template, company, context.market, direction),
      decisionQuestion: makeDecisionQuestion(template, kind)
    };

    if (kind === "rumors") {
      const truthScore = clamp(
        context.market.rumorReliability * 0.3 +
        company.hidden.reputation * 0.18 +
        (100 - company.hidden.legalRisk) * 0.12 +
        score.raw * 0.18 +
        layeredNoise(0, 35, [company.id, template.id, "truth"]),
        0,
        100
      );
      return {
        ...base,
        credibility: truthScore > 68 ? "높음" : truthScore < 38 ? "낮음" : "보통",
        truthHint: truthScore > 70 ? "검증 단서가 여러 곳에서 겹칩니다." : truthScore < 35 ? "출처가 약하고 반대 정황도 있습니다." : "일부 정황은 있지만 확정 자료는 없습니다."
      };
    }

    if (kind === "reports") {
      return {
        ...base,
        analyst: pickAnalyst(company, template),
        rating: template.rating,
        stance: template.stance,
        horizon: ["단기", "중기", "라운드 말"][entropyInt(0, 2, [company.id, template.id, "horizon"])],
        riskNote: makeRiskNote(company, context.market)
      };
    }

    return base;
  }

  function inferReaction(template, company, market, score) {
    const crowding = company.heat + market.whalePower * 0.35 + market.volatility * 0.2;
    const exhaustion = probabilityGate(crowding / 170, [company.id, template.id, "exhaust"]);
    const relief = probabilityGate((company.warningScore + market.volatility) / 185, [company.id, template.id, "relief"]);
    const ambiguity = probabilityGate((market.volatility + market.whalePower + Math.abs(company.heat - 50)) / 230, [company.id, template.id, "ambiguity"]);
    const isGood = template.tone === "positive";
    const isBad = template.tone === "negative";

    if (ambiguity > 0.64) return "혼조";
    if (score.contradiction && isGood && exhaustion > 0.46) return "혼조";
    if (score.contradiction && isBad && relief > 0.43) return "혼조";
    if (["루머검증", "고래", "수급"].includes(template.type)) return "혼조";
    if (isGood) return score.raw > 72 && exhaustion < 0.5 ? "상승" : "혼조";
    if (isBad) return score.raw > 76 && relief < 0.42 ? "하락" : "혼조";
    return score.raw > 74 ? "상승" : score.raw < 30 ? "하락" : "중립";
  }

  function createShockNews(shock, market, roundNumber) {
    const direction = "혼조";
    return {
      id: `shock-news-${shock.id}-${roundNumber}-${Date.now()}`,
      source: "shock",
      date: toISODate(new Date()),
      company: "Market Exchange",
      ticker: "MKT",
      sector: "시장 전체",
      direction,
      type: "시장 충격",
      title: `라운드 ${roundNumber} 시장 변수: ${shock.label}`,
      summary: `${shock.description} 단기 방향보다 업종별 선반영 여부가 더 중요합니다.`,
      confidence: "보통",
      signal: `시장 심리 ${market.sentiment}, 변동성 ${market.volatility}점으로 재계산됐지만 종목별 해석은 갈릴 수 있음`,
      uncertainty: "높음",
      counterSignal: "충격 자체가 악재처럼 보여도 이미 기다리던 이벤트라면 반대 해석이 나올 수 있음",
      decisionQuestion: "충격 이후 새로 움직이는 자금과 이미 빠져나간 자금을 구분했는가?"
    };
  }

  function generateEvents(context, news, disclosures, rumors) {
    const eventSeed = [...disclosures.slice(0, 7), ...news.slice(0, 5), ...rumors.slice(0, 4)];
    const days = ["일", "월", "화", "수", "목", "금", "토"];
    const start = new Date();
    start.setHours(0, 0, 0, 0);

    return eventSeed.slice(0, 10).map((item, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index + 1);
      const eventType = eventTypeFromItem(item, context.data.eventTypes);
      return {
        id: `event-${item.id}`,
        date: toISODate(date),
        day: days[date.getDay()],
        type: eventType,
        company: item.company,
        direction: item.direction,
        title: `${item.company} ${eventType} 관측일`,
        summary: `${item.title} 이슈가 일정표에 반영됐습니다. 실제 결과보다 시장이 먼저 움직일 수 있는 구간입니다.`
      };
    });
  }

  function eventTypeFromItem(item, eventTypes) {
    if (eventTypes.includes(item.type)) return item.type;
    if (item.type && item.type.includes("배당")) return "배당";
    if (item.type && item.type.includes("정책")) return "정책 발표";
    if (item.type && item.type.includes("제품")) return "신제품 발표";
    if (item.type && item.type.includes("실적")) return "실적 발표";
    if (item.type && item.type.includes("IPO")) return "IPO";
    if (item.type && item.type.includes("공모주")) return "공모주 청약";
    if (item.type && item.type.includes("거래정지")) return "거래정지";
    if (item.type && item.type.includes("상장폐지")) return "상장폐지 심사";
    if (item.type && item.type.includes("호가")) return "호가 변동 점검";
    if (item.type && item.type.includes("체결")) return "체결 과열";
    if (item.type && item.type.includes("ETF")) return "ETF 추종 점검";
    if (item.type && (item.type.includes("랭킹") || item.type.includes("순위"))) return "라운드 종료 변수";
    return eventTypes[entropyInt(0, eventTypes.length - 1, [item.id, "eventType"])];
  }

  function buildSectorSummary(sectorStates, market) {
    return Object.entries(sectorStates).map(([name, sector]) => {
      const pressure = sector.capitalFlow * 0.26 + sector.demand * 0.24 - sector.supplyStress * 0.14 - market.policyPressure * 0.08 + layeredNoise(0, 18, [name, "sector"]);
      const direction = pressure > 50 ? "상승" : pressure < 31 ? "하락" : "중립";
      return {
        name,
        mood: sector.mood,
        direction,
        capitalFlow: Math.round(clamp(sector.capitalFlow + layeredNoise(0, 9, [name, "flow"]), 0, 100)),
        expectedImpact: sectorImpactText(name, sector, market, direction)
      };
    });
  }

  function createRoundSummary(roundNumber, market, shock, news, rumors, disclosures, reports) {
    const headline = shock
      ? `라운드 ${roundNumber}: ${shock.label} 해석 분화`
      : `라운드 ${roundNumber}: ${market.sentiment} 장세, 결론 보류`;
    const lead = shock
      ? `${shock.description} 같은 재료라도 선반영, 수급, 업종 위치에 따라 결과가 갈릴 수 있습니다.`
      : `${market.flowNote}. 이번 라운드는 한 가지 뉴스보다 서로 충돌하는 단서를 같이 봐야 합니다.`;

    return {
      headline,
      lead,
      keyCounts: {
        news: news.length,
        rumors: rumors.length,
        disclosures: disclosures.length,
        reports: reports.length
      },
      topSignals: news.slice(0, 3).map((item) => item.title)
    };
  }

  function sectorImpactText(name, sector, market, direction) {
    if (direction === "상승") return `${name} 업종은 자금 유입과 수요 지표가 맞물립니다. 다만 기대가 빠르게 쌓이면 호재에도 매물이 나올 수 있습니다.`;
    if (direction === "하락") return `${name} 업종은 정책 부담이나 공급 스트레스가 앞섭니다. 악재가 공개되면 오히려 불확실성 해소로 반등할 여지도 있습니다.`;
    return `${name} 업종은 수요와 정책 변수가 충돌합니다. 시장 심리 ${market.sentiment} 상태에서는 종목별 차별화가 큽니다.`;
  }

  function rememberTemplate(kind, id) {
    const history = readJSON(HISTORY_KEY, {});
    const list = history[kind] || [];
    history[kind] = [id, ...list.filter((value) => value !== id)].slice(0, 42);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  }

  function rememberTitle(title) {
    const history = readJSON(TITLE_HISTORY_KEY, []);
    localStorage.setItem(TITLE_HISTORY_KEY, JSON.stringify([title, ...history.filter((value) => value !== title)].slice(0, 90)));
  }

  function uniqueTitle(title) {
    const history = new Set(readJSON(TITLE_HISTORY_KEY, []));
    if (!history.has(title)) return title;

    const suffixes = ["추가 관측", "해석 분화", "2차 점검", "수급 재확인", "정책 변수 반영"];
    const suffix = suffixes[entropyInt(0, suffixes.length - 1, [title, "suffix"])];
    return `${title} - ${suffix}`;
  }

  function formatTemplate(text, company) {
    return text
      .replaceAll("{company}", company.name)
      .replaceAll("{sector}", company.sector)
      .replaceAll("{ticker}", company.ticker);
  }

  function makeConfidence(market, company, kind) {
    const raw = clamp(market.institutionPower * 0.16 + market.rumorReliability * 0.14 + company.hidden.reputation * 0.18 + (100 - market.volatility) * 0.12 + layeredNoise(0, 28, [company.id, kind, "confidence"]), 0, 100);
    if (raw > 67) return "높음";
    if (raw < 37) return "낮음";
    return "보통";
  }

  function makeSignal(score, direction) {
    if (score.contradiction) return "표면 재료와 실제 수급 해석이 어긋날 가능성";
    if (score.rare) return "희귀 이벤트 가능성이 섞인 신호";
    return "복수 변수에 의해 생성된 힌트";
  }

  function makeUncertainty(score, market, company) {
    const raw = market.volatility * 0.28 + market.whalePower * 0.2 + Math.abs(company.heat - company.warningScore) * 0.12 + (score.contradiction ? 22 : 0) + layeredNoise(0, 18, [company.id, "uncertainty"]);
    if (raw > 68) return "높음";
    if (raw < 36) return "낮음";
    return "보통";
  }

  function makeCounterSignal(template, company, market, direction) {
    if (template.tone === "positive") return "우호적인 재료라도 기대가 먼저 쌓였거나 유동성이 약하면 매물이 나올 수 있습니다.";
    if (template.tone === "negative") return "부담 재료라도 공개 후 불확실성이 줄었다고 해석되면 반대 흐름이 나올 수 있습니다.";
    if (direction === "루머") return "루머의 사실 여부보다 참가자들이 얼마나 믿고 움직이는지가 더 크게 작용할 수 있습니다.";
    if (market.volatility > 66) return "변동성이 높아 기업 재료보다 포지션 정리가 먼저 가격을 흔들 수 있습니다.";
    if (company.warningScore > 70) return "관심이 커져도 재무와 신뢰 할인 때문에 반응이 제한될 수 있습니다.";
    return "단일 기사만으로 결론을 내리기 어렵고 일정, 공시, 수급을 같이 확인해야 합니다.";
  }

  function makeDecisionQuestion(template, kind) {
    if (kind === "rumors") return "출처가 독립적인가, 같은 말이 여러 곳에서 반복되는 것인가?";
    if (kind === "disclosures") return "공시 제목보다 조건, 일정, 자금 흐름이 더 중요하지 않은가?";
    if (kind === "reports") return "애널리스트 결론보다 리스크 문장과 관찰 기간이 내 판단과 맞는가?";
    if (template.type?.includes("실적")) return "좋고 나쁨보다 예상치 대비 차이가 핵심 아닌가?";
    if (template.type?.includes("수급") || template.type?.includes("고래")) return "기업 가치 변화인지 단기 포지션 변화인지 구분했는가?";
    return "이 정보가 새로 나온 사실인지, 이미 모두가 예상하던 이야기인지 확인했는가?";
  }

  function makeRiskNote(company, market) {
    const risk = company.warningScore + market.volatility * 0.25;
    if (risk > 76) return "변동성 확대와 신뢰 할인에 주의";
    if (risk < 42) return "단기 충격보다 확인된 지표가 중요";
    return "수급과 공시 확인이 모두 필요한 구간";
  }

  function makeCompanyHint(company, hidden, heat, warningScore) {
    if (warningScore > 72) return "성장성보다 재무와 법적리스크가 먼저 보이는 상태";
    if (heat > 72 && hidden.cashFlow > 55) return "관심은 높지만 현금흐름이 일부 받쳐주는 상태";
    if (heat > 72) return "기대가 빠르게 쌓여 되돌림 가능성도 커진 상태";
    if (hidden.management > 72 && hidden.reputation > 70) return "평판과 경영진 신뢰가 방어력을 만드는 상태";
    return "한 가지 지표만으로 판단하기 어려운 중립 상태";
  }

  function createFlowNote(sentiment, liquidity, volatility, whalePower, shock) {
    if (shock) return `${shock.label}이 반영되어 업종별 자금 회전이 다시 계산됐습니다.`;
    if (sentiment === "탐욕" && volatility > 65) return "공격적 매수와 차익실현이 동시에 나오는 장세";
    if (sentiment === "공포" && liquidity > 55) return "공포 속에서도 대기 자금이 저가를 노리는 장세";
    if (whalePower > 70) return "고래 영향력이 커져 뉴스보다 체결 흐름이 먼저 움직이는 장세";
    return "업종별 자금 회전이 빠르고 단일 뉴스의 해석이 갈리는 장세";
  }

  function pickAnalyst(company, template) {
    const names = ["라운드리서치 한서윤", "모의증권 박지오", "크레딧랩 윤다온", "시그널하우스 이로운", "마켓서클 강은재"];
    return names[entropyInt(0, names.length - 1, [company.id, template.id, "analyst"])];
  }

  function weightedPick(items, weightFn) {
    const weighted = items.map((item) => ({ item, weight: Math.max(0.01, weightFn(item)) }));
    const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
    let cursor = entropyUnit(["weighted", total, weighted.length]) * total;

    for (const entry of weighted) {
      cursor -= entry.weight;
      if (cursor <= 0) return entry.item;
    }

    return weighted[weighted.length - 1].item;
  }

  function probabilityGate(probability, saltParts) {
    const p1 = entropyUnit([...saltParts, "p1"]);
    const p2 = entropyUnit([...saltParts, "p2"]);
    const p3 = entropyUnit([...saltParts, "p3"]);
    const first = p1 < probability ? 1 : p1 * 0.55;
    const second = p2 < probability * (0.55 + first * 0.45) ? 1 : p2 * 0.45;
    const third = p3 < probability * (0.45 + second * 0.55) ? 1 : p3 * 0.35;
    return first * 0.42 + second * 0.34 + third * 0.24;
  }

  function layeredNoise(center, spread, saltParts) {
    const a = entropyUnit([...saltParts, "a"]) - 0.5;
    const b = entropyUnit([...saltParts, "b"]) - 0.5;
    const c = entropyUnit([...saltParts, "c"]) - 0.5;
    return center + (a * 0.5 + b * 0.32 + c * 0.18) * spread * 2;
  }

  function entropyUnit(saltParts) {
    const salt = saltParts.join("|");
    const cryptoNoise = new Uint32Array(1);
    window.crypto.getRandomValues(cryptoNoise);
    const timing = Math.floor((performance.now() % 100000) * 1000);
    const math = Math.floor(Math.random() * 1000000000);
    let hash = 2166136261;
    const source = `${salt}|${Date.now()}|${timing}|${math}|${cryptoNoise[0]}`;

    for (let i = 0; i < source.length; i += 1) {
      hash ^= source.charCodeAt(i);
      hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }

    return ((hash >>> 0) % 1000000) / 1000000;
  }

  function entropyInt(min, max, saltParts) {
    return Math.floor(entropyUnit(saltParts) * (max - min + 1)) + min;
  }

  function relativeDate(daysAgo) {
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    return toISODate(date);
  }

  function toISODate(date) {
    return date.toISOString().slice(0, 10);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function readJSON(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : fallback;
    } catch (error) {
      return fallback;
    }
  }

  window.MarketEngine = {
    generateRound,
    createForcedCompanyEvent,
    eventFromForcedItem,
    shockPresets
  };
})();
