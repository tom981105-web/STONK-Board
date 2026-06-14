(function () {
  const pageName = getPageName();
  const contentKinds = ["news", "rumors", "disclosures", "reports"];
  let boardDomReady = false;

  document.addEventListener("DOMContentLoaded", () => {
    boardDomReady = true;
    setupNavigation(pageName);
    setupUtilityActions();
    renderCurrentPage(pageName);
  });

  window.addEventListener("marketadmin:update", () => {
    if (boardDomReady) renderCurrentPage(pageName);
  });

  // 실시간 연동(firebase-link.js)에서 호출하는 재렌더 훅
  window.MarketBoardApp = {
    refresh() {
      try {
        renderCurrentPage(pageName);
      } catch (e) {
        console.error("[board] refresh 실패:", e);
      }
    },
    refreshBattleStatus() {
      try {
        if (pageName === "admin") renderBattleSyncStatus(getData());
      } catch (e) {
        console.error("[board] battle status refresh 실패:", e);
      }
    },
  };

  function getPageName() {
    const file = window.location.pathname.split("/").pop() || "index.html";
    return file.replace(".html", "") || "index";
  }

  function getData() {
    const state = window.MarketStorage.ensureRound((roundNumber, options) => window.MarketEngine.generateRound(roundNumber, options));
    const payload = state.currentPayload;
    const custom = window.MarketStorage.getCustomItems();

    const data = {
      ...payload,
      season: state.currentSeason || window.MarketStorage.getSeason(),
      roundState: state,
      roundLogs: window.MarketStorage.getRoundLogs(),
      allRoundLogs: window.MarketStorage.getAllRoundLogs(),
      customItems: custom,
      battleSnapshot: payload.battleSnapshot || window.MarketStorage.getBattleSnapshot(),
      news: mergeCustom(payload.news, custom, "news"),
      rumors: mergeCustom(payload.rumors, custom, "rumors"),
      disclosures: mergeCustom(payload.disclosures, custom, "disclosures"),
      reports: mergeCustom(payload.reports, custom, "reports")
    };

    return window.MarketAdminAdapter?.applyToBoardData
      ? window.MarketAdminAdapter.applyToBoardData(data)
      : data;
  }

  function setupNavigation(page) {
    document.querySelectorAll("[data-nav]").forEach((link) => {
      if (link.dataset.nav === page) link.classList.add("is-active");
    });

    const toggle = document.querySelector(".menu-toggle");
    const nav = document.querySelector("#site-nav");
    if (!toggle || !nav) return;

    toggle.addEventListener("click", () => {
      const isOpen = nav.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", String(isOpen));
    });
  }

  function setupUtilityActions() {
    ensureToastRegion();
    const queued = sessionStorage.getItem("market-board-toast");
    if (queued) {
      sessionStorage.removeItem("market-board-toast");
      showToast(queued);
    }

    if (!document.querySelector("#scrollTopButton")) {
      const button = document.createElement("button");
      button.id = "scrollTopButton";
      button.className = "scroll-top";
      button.type = "button";
      button.textContent = "위로";
      button.setAttribute("aria-label", "맨 위로 이동");
      document.body.append(button);
      button.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
      window.addEventListener("scroll", () => {
        button.classList.toggle("is-visible", window.scrollY > 520);
      }, { passive: true });
    }
  }

  function renderCurrentPage(page) {
    const data = getData();
    if (page === "index") renderIndexPage(data);
    if (page === "companies") renderCompaniesPage(data);
    if (page === "calendar") renderCalendarPage(data);
    if (page === "rumors") renderRumorsPage(data);
    if (page === "disclosures") renderDisclosuresPage(data);
    if (page === "reports") renderReportsPage(data);
    if (page === "admin") renderAdminPage(data);
  }

  function renderIndexPage(data) {
    setText("#todayLabel", formatKoreanDate(new Date()));
    const today = document.querySelector("#todayLabel");
    if (today) today.dateTime = new Date().toISOString();

    renderHomeDashboard(data);
    renderFeaturedPanel(data);
    renderWatchList(data);
    renderKeyIssues(data);
    renderRoundSummary(data);
    renderMarketMap(data);
    renderSignalChart(data);
    renderInfoLog(data);
    setupNewsArchive(data);
    renderList("#sectorList", data.sectors.slice(0, 8), createSectorCard);
  }

  function renderHomeDashboard(data) {
    const items = [
      ["현재 라운드", `${data.roundNumber}R`, "round"],
      ["시장 심리", data.market.sentiment, statusClass(data.market.sentiment)],
      ["유동성", `${data.market.liquidity}점`, scoreTone(data.market.liquidity, true)],
      ["변동성", `${data.market.volatility}점`, scoreTone(data.market.volatility, false)],
      ["IPO 온도", `${data.market.ipoTemperature}점`, scoreTone(data.market.ipoTemperature, true)],
      ["상장폐지 공포", `${data.market.delistingFear}점`, scoreTone(data.market.delistingFear, false)]
    ];

    renderList("#marketDashboard", items, ([label, value, tone]) => `
      <article class="dashboard-tile ${escapeHTML(tone)}">
        <span>${escapeHTML(label)}</span>
        <strong>${escapeHTML(value)}</strong>
      </article>
    `);
  }

  function renderKeyIssues(data) {
    const issues = pickDecisionIssues(data.news);
    renderList("#keyIssues", issues, (item, index) => `
      <article class="issue-card ${kindClass("news")}">
        <div class="issue-rank">${index + 1}</div>
        <div>
          <div class="card-top tight">
            ${statusBadge(item.direction)}
            ${sourceBadge(item.source)}
          </div>
          <h3>${escapeHTML(item.title)}</h3>
          <p>${escapeHTML(item.summary)}</p>
          <p class="counter-line">반대 해석: ${escapeHTML(counterPoint(item))}</p>
          <details>
            <summary>확인할 변수</summary>
            ${tagRow([item.company, item.type, confidenceLabel(item), impactLabel(item)])}
            <p class="signal-line">${escapeHTML(item.signal || "추가 신호 없음")}</p>
            <p class="signal-line">질문: ${escapeHTML(decisionQuestion(item))}</p>
          </details>
        </div>
      </article>
    `);
  }

  function renderRoundSummary(data) {
    const target = document.querySelector("#roundSummary");
    if (!target) return;

    const latestLogs = data.roundLogs.slice(0, 3);
    target.innerHTML = `
      <article class="brief-card">
        <p class="eyebrow">오늘 봐야 할 핵심 요약</p>
        <h2>${escapeHTML(softHeadline(data.roundSummary.headline))}</h2>
        <p>${escapeHTML(softLead(data.roundSummary.lead))}</p>
        <p class="ambiguity-note">이 화면은 방향 예측이 아니라 판단 재료입니다. 같은 뉴스도 수급, 선반영, 루머 신뢰도에 따라 반대로 해석될 수 있습니다.</p>
      </article>
      <div class="round-log-strip calm">
        ${latestLogs.map((log) => `
          <article>
            <span>${log.roundNumber}R</span>
            <strong>${escapeHTML(log.shock?.label ? `${log.shock.label} 해석` : log.sentiment || "라운드")}</strong>
            <p>${escapeHTML(log.topNews?.[0] || log.message || "저장된 라운드")}</p>
          </article>
        `).join("")}
      </div>
    `;
  }

  function renderFeaturedPanel(data) {
    const featured = [...data.companies].sort((a, b) => conflictScore(b) - conflictScore(a))[0];
    if (!featured) return;
    const spread = Math.round((featured.heat || 0) - (featured.warningScore || 0));
    setText("#featuredName", featured.name);
    setText("#featuredBadge", `${featured.ticker} · ${featured.sector}`);
    setText("#featuredScore", formatNumber(virtualIndex(featured)));
    setText("#featuredChange", `${spread >= 0 ? "+" : ""}${spread} 신호차 · ${observationLabel(featured)}`);
    setText("#featuredNarrative", `${featured.description} 지금은 ${featured.engineHint}라서 한 방향으로 단정하기보다 뉴스, 공시, 루머가 서로 맞물리는지 확인해야 합니다.`);
  }

  function renderWatchList(data) {
    const companies = [...data.companies].sort((a, b) => conflictScore(b) - conflictScore(a)).slice(0, 8);
    renderList("#watchList", companies, (company, index) => {
      const delta = Math.round((company.heat || 0) - (company.warningScore || 0));
      return `
        <article class="watch-item ${index === 0 ? "is-selected" : ""}">
          <div>
            <strong>${escapeHTML(company.name)}</strong>
            <span>${escapeHTML(company.sector)} · ${escapeHTML(company.ticker)}</span>
          </div>
          <div class="watch-score ${delta >= 0 ? "is-positive" : "is-negative"}">
            <strong>${formatNumber(virtualIndex(company))}</strong>
            <span>${delta >= 0 ? "+" : ""}${delta}</span>
          </div>
        </article>
      `;
    });
  }

  function renderSignalChart(data) {
    const points = [...data.companies, ...data.companies, ...data.companies].slice(0, 36);
    renderList("#signalChart", points, (company, index) => {
      const conflict = conflictScore(company);
      const height = 18 + (conflict % 58);
      const isRisk = (company.warningScore || 0) > (company.heat || 0);
      return `<span class="${isRisk ? "is-risk" : "is-hope"}" style="--bar-height:${height}px" title="${escapeHTML(company.name)} ${conflict}"></span>`;
    });
  }

  function renderInfoLog(data) {
    const logs = [
      ...data.news.slice(0, 3).map((item) => ({ ...item, label: "뉴스" })),
      ...data.rumors.slice(0, 2).map((item) => ({ ...item, label: "루머" })),
      ...data.disclosures.slice(0, 2).map((item) => ({ ...item, label: "공시" }))
    ].slice(0, 7);

    renderList("#infoLog", logs, (item) => `
      <article>
        <time>${formatShortDate(item.date)}</time>
        <span>${escapeHTML(item.label)}</span>
        <strong>${escapeHTML(interpretationLabel(item.direction))}</strong>
        <p>${escapeHTML(item.title)}</p>
      </article>
    `);
  }

  function setupNewsArchive(data) {
    const search = document.querySelector("#newsSearch");
    const direction = document.querySelector("#newsDirection");
    const source = document.querySelector("#newsSource");
    const archive = data.news.slice(3);

    const update = () => {
      const keyword = normalize(search?.value || "");
      const directionValue = direction?.value || "all";
      const sourceValue = source?.value || "all";
      const filtered = archive.filter((item) =>
        matchesKeyword(item, keyword) &&
        matchesValue(item.direction, directionValue) &&
        matchesValue(item.source || "auto", sourceValue)
      );

      renderList("#newsList", filtered, createContentCard("news"));
      setText("#hiddenNewsCount", `${filtered.length}개 뉴스 표시`);
      setHidden("#newsEmpty", filtered.length > 0);
    };

    if (search) search.oninput = update;
    if (direction) direction.onchange = update;
    if (source) source.onchange = update;
    update();
  }

  function renderCompaniesPage(data) {
    const conflicted = data.companies.slice().sort((a, b) => conflictScore(b) - conflictScore(a))[0];
    renderPageBrief("기업정보", `${data.companies.length}개 기업 중 ${conflicted?.name || "일부 기업"}은 관심과 위험 신호가 동시에 보여 추가 확인이 필요합니다.`);

    const searchInput = document.querySelector("#companySearch");
    const sectorFilter = document.querySelector("#sectorFilter");
    const statusFilter = document.querySelector("#statusFilter");
    fillSelect(sectorFilter, unique(data.companies.map((company) => company.sector)), "전체 업종");
    fillSelect(statusFilter, unique(data.companies.map((company) => company.listingStatus)), "전체 상태");

    const update = () => {
      const keyword = normalize(searchInput?.value || "");
      const sector = sectorFilter?.value || "all";
      const status = statusFilter?.value || "all";
      const filtered = data.companies.filter((company) => {
        const text = normalize([company.name, company.ticker, company.sector, company.ceo, company.business, company.description].join(" "));
        return (sector === "all" || company.sector === sector) &&
          (status === "all" || company.listingStatus === status) &&
          text.includes(keyword);
      });

      renderList("#companyList", filtered, createCompanyCard);
      setText("#companyCount", `${filtered.length}개 기업`);
      setHidden("#companyEmpty", filtered.length > 0);
    };

    searchInput?.addEventListener("input", update);
    sectorFilter?.addEventListener("change", update);
    statusFilter?.addEventListener("change", update);
    update();
  }

  function renderCalendarPage(data) {
    const events = [...data.events].sort(compareByDate);
    renderPageBrief("일정표", `${data.roundNumber}R 기준 ${events.length}개 이벤트가 저장되어 있습니다. 강제 생성 이벤트도 이 일정에 반영됩니다.`);
    renderCalendarGrid(events);
    renderList("#eventList", events, createEventCard);
    setText("#eventCount", `${events.length}개 이벤트`);
    setText("#calendarRoundLabel", `${data.roundNumber}R 저장 이벤트`);
  }

  function renderCalendarGrid(events) {
    const target = document.querySelector("#calendarGrid");
    if (!target) return;

    if (!events.length) {
      target.innerHTML = `<article class="calendar-day calendar-empty"><p>저장된 이벤트가 없습니다.</p></article>`;
      setText("#calendarRangeLabel", "라운드 일정 없음");
      return;
    }

    const firstDate = parseLocalDate(events[0].date);
    const lastDate = parseLocalDate(events[events.length - 1].date);
    const start = startOfCalendarWeek(firstDate);
    const daySpan = Math.max(14, Math.ceil((daysBetween(start, lastDate) + 1) / 7) * 7);
    const maxCells = Math.min(daySpan, 35);
    const todayKey = toLocalDateKey(new Date());

    const cells = Array.from({ length: maxCells }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      const dateKey = toLocalDateKey(date);
      const dayEvents = events.filter((item) => item.date === dateKey);
      const isWeekend = date.getDay() === 0 || date.getDay() === 6;
      const classes = [
        "calendar-day",
        dayEvents.length ? "has-event" : "is-quiet",
        dateKey === todayKey ? "is-today" : "",
        isWeekend ? "is-weekend" : ""
      ].filter(Boolean).join(" ");

      return `
        <article class="${classes}">
          <div class="calendar-day-head">
            <span>${date.getDate()}</span>
            <em>${formatMonthDay(dateKey)}</em>
          </div>
          <div class="calendar-chip-list">
            ${dayEvents.slice(0, 3).map(createCalendarChip).join("")}
            ${dayEvents.length > 3 ? `<span class="calendar-more">+${dayEvents.length - 3}</span>` : ""}
          </div>
        </article>
      `;
    });

    const end = new Date(start);
    end.setDate(start.getDate() + maxCells - 1);
    setText("#calendarRangeLabel", `${formatMonthDay(toLocalDateKey(start))} - ${formatMonthDay(toLocalDateKey(end))}`);
    target.innerHTML = cells.join("");
  }

  function createCalendarChip(item) {
    return `
      <div class="calendar-event-chip ${statusClass(item.direction)}" title="${escapeHTML(item.title)}">
        <strong>${escapeHTML(item.type)}</strong>
        <span>${escapeHTML(item.company)}</span>
      </div>
    `;
  }

  function compareByDate(a, b) {
    return String(a.date || "").localeCompare(String(b.date || ""));
  }

  function renderRumorsPage(data) {
    renderPageBrief("루머게시판", `현재 루머 ${data.rumors.length}건 중 신뢰도 높음은 ${data.rumors.filter((item) => item.credibility === "높음").length}건입니다.`);
    const filter = document.querySelector("#rumorFilter");
    const update = () => {
      const value = filter?.value || "all";
      const filtered = value === "all" ? data.rumors : data.rumors.filter((item) => item.credibility === value);
      renderList("#rumorList", filtered, createContentCard("rumors"));
      setText("#rumorCount", `${filtered.length}건`);
    };

    filter?.addEventListener("change", update);
    update();
  }

  function renderDisclosuresPage(data) {
    renderPageBrief("공시센터", `현재 공시 ${data.disclosures.length}건이 저장되어 있습니다. 거래정지와 상장폐지 심사 같은 고위험 공시를 먼저 확인하세요.`);
    const filter = document.querySelector("#disclosureFilter");
    fillSelect(filter, unique(data.disclosures.map((item) => item.type)), "전체 유형");

    const update = () => {
      const value = filter?.value || "all";
      const filtered = value === "all" ? data.disclosures : data.disclosures.filter((item) => item.type === value);
      renderList("#disclosureList", filtered, createContentCard("disclosures"));
      setText("#disclosureCount", `${filtered.length}건`);
    };

    filter?.addEventListener("change", update);
    update();
  }

  function renderReportsPage(data) {
    renderPageBrief("애널리스트 리포트", `현재 리포트 ${data.reports.length}건이 있습니다. 리포트는 결론보다 리스크 문장을 함께 읽는 쪽이 중요합니다.`);
    const ratingFilter = document.querySelector("#ratingFilter");
    const sectorFilter = document.querySelector("#reportSectorFilter");
    fillSelect(ratingFilter, unique(data.reports.map((item) => item.rating || item.type)).map((value) => ({ value, label: displayTagValue(value) })), "전체 관점");
    fillSelect(sectorFilter, unique(data.reports.map((item) => item.sector)), "전체 업종");

    const update = () => {
      const rating = ratingFilter?.value || "all";
      const sector = sectorFilter?.value || "all";
      const filtered = data.reports.filter((item) => {
        const ratingOK = rating === "all" || item.rating === rating || item.type === rating;
        const sectorOK = sector === "all" || item.sector === sector;
        return ratingOK && sectorOK;
      });

      renderList("#reportList", filtered, createContentCard("reports"));
      setText("#reportCount", `${filtered.length}건`);
    };

    ratingFilter?.addEventListener("change", update);
    sectorFilter?.addEventListener("change", update);
    update();
  }

  function renderAdminPage(data) {
    renderAdminDashboard(data);
    renderAdminStatus(data);
    setupRoundControls();
    setupBattleSyncControls(data);
    setupForcedEventForm(data);
    setupAdminForm(data);
    setupSeasonForm(data);
    setupMarketStateForm(data);
    setupBackupControls();
    renderRoundLogList(data.roundLogs);
    renderContentEditor(data);
    renderAdminList(data.customItems);
  }

  function renderAdminDashboard(data) {
    const recentForced = [...data.news, ...data.rumors, ...data.disclosures, ...data.reports].find((item) => item.source === "forced");
    const dashboard = [
      ["현재 시즌", `${data.season.number} · ${data.season.name}`],
      ["현재 라운드", `${data.roundNumber}R`],
      ["뉴스 수", data.news.length],
      ["루머 수", data.rumors.length],
      ["공시 수", data.disclosures.length],
      ["리포트 수", data.reports.length],
      ["일정 수", data.events.length],
      ["본게임 연동", data.battleSnapshot ? `${data.battleSnapshot.stockCount || 0}종목` : "대기"],
      ["최근 시장 충격", data.shock?.label || "없음"],
      ["최근 강제 이벤트", recentForced?.title || "없음"]
    ];
    renderList("#adminDashboard", dashboard, ([label, value]) => statCard(label, value));
  }

  function renderAdminStatus(data) {
    const target = document.querySelector("#adminStatus");
    if (!target) return;
    const state = data.roundState || {};
    const latestLog = data.roundLogs?.[0];
    target.innerHTML = `
      <div>
        <span class="mini-tag">최근 작업</span>
        <strong>${escapeHTML(state.lastMessage || latestLog?.message || "라운드 데이터 대기 중")}</strong>
      </div>
      <time datetime="${escapeHTML(state.updatedAt || latestLog?.updatedAt || "")}">
        ${escapeHTML(formatShortDateTime(state.updatedAt || latestLog?.updatedAt || new Date().toISOString()))}
      </time>
    `;
  }

  function setupRoundControls() {
    bindClick("#nextRound", () => {
      window.MarketStorage.advanceRound((roundNumber, options) => window.MarketEngine.generateRound(roundNumber, options));
      showToast("새 라운드가 생성됐습니다.");
      renderCurrentPage("admin");
    });

    document.querySelectorAll("[data-shock]").forEach((button) => {
      if (button.dataset.bound === "true") return;
      button.dataset.bound = "true";
      button.addEventListener("click", () => {
        const shock = window.MarketEngine.shockPresets[button.dataset.shock];
        window.MarketStorage.advanceRound((roundNumber, options) => window.MarketEngine.generateRound(roundNumber, options), { shock });
        showToast(`${shock.label} 충격 라운드가 생성됐습니다.`, "warning");
        renderCurrentPage("admin");
      });
    });

    bindClick("#resetAllData", () => {
      if (!window.confirm("Market Board의 localStorage 데이터를 모두 초기화할까요? 이 작업은 되돌릴 수 없습니다.")) return;
      window.MarketStorage.resetAllData();
      window.location.reload();
    });

    bindClick("#clearCustom", () => {
      if (!window.confirm("수동 등록 콘텐츠를 모두 삭제할까요?")) return;
      window.MarketStorage.clearCustomItems();
      showToast("수동 콘텐츠를 삭제했습니다.", "warning");
      renderCurrentPage("admin");
    });
  }

  function setupBattleSyncControls(data) {
    renderBattleSyncStatus(data);

    const applyBattleSnapshotText = (text, successMessage) => {
      const raw = String(text || "").trim();
      if (!raw) {
        showToast("가져올 본게임 데이터가 비어 있습니다.", "warning");
        return false;
      }

      try {
        window.MarketStorage.importBattleSnapshot(JSON.parse(raw));
        showToast(successMessage || "본게임 시장 데이터를 포털에 반영했습니다.");
        renderCurrentPage("admin");
        return true;
      } catch (error) {
        window.alert("시장 데이터를 읽지 못했습니다. 본게임에서 포털로 복사 버튼을 다시 누른 뒤 가져와 주세요.");
        return false;
      }
    };

    bindClick("#pasteBattleSnapshot", async () => {
      if (!navigator.clipboard?.readText) {
        document.querySelector(".advanced-import-panel")?.setAttribute("open", "open");
        document.querySelector("#battleSnapshotInput")?.focus();
        showToast("브라우저가 클립보드 읽기를 막았습니다. 직접 붙여넣기로 반영해 주세요.", "warning");
        return;
      }

      try {
        const text = await navigator.clipboard.readText();
        applyBattleSnapshotText(text, "복사한 본게임 시장을 포털에 반영했습니다.");
      } catch (error) {
        document.querySelector(".advanced-import-panel")?.setAttribute("open", "open");
        document.querySelector("#battleSnapshotInput")?.focus();
        showToast("클립보드를 읽지 못했습니다. 직접 붙여넣기로 반영해 주세요.", "warning");
      }
    });

    bindClick("#importBattleSnapshot", () => {
      const input = document.querySelector("#battleSnapshotInput");
      if (applyBattleSnapshotText(input?.value, "입력한 본게임 시장 데이터를 반영했습니다.") && input) input.value = "";
    });

    const fileInput = document.querySelector("#battleSnapshotFile");
    if (fileInput && fileInput.dataset.bound !== "true") {
      fileInput.dataset.bound = "true";
      fileInput.addEventListener("change", () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          const text = String(reader.result || "");
          const textarea = document.querySelector("#battleSnapshotInput");
          if (textarea) textarea.value = text;
          applyBattleSnapshotText(text, "파일의 본게임 시장 데이터를 반영했습니다.");
        };
        reader.readAsText(file);
      });
    }

    bindClick("#clearBattleSnapshot", () => {
      if (!window.confirm("본게임에서 가져온 뉴스/루머/공시/리포트/일정을 비울까요?")) return;
      window.MarketStorage.clearBattleSnapshot();
      showToast("본게임에서 가져온 데이터를 비웠습니다.", "warning");
      renderCurrentPage("admin");
    });
  }

  function renderBattleSyncStatus(data) {
    const badge = document.querySelector("#battleSyncBadge");
    const target = document.querySelector("#battleSyncStatus");
    if (!target) return;

    const snapshot = data.battleSnapshot;
    if (!snapshot) {
      if (badge) badge.textContent = "연동 대기";
      target.innerHTML = `
        <article>
          <span class="mini-tag">Market Battle</span>
          <strong>본게임 시장을 아직 가져오지 않았습니다.</strong>
          <p>게임 화면에서 포털로 복사한 뒤 이곳에서 가져오면 현재 종목 흐름이 정보 포털에 반영됩니다.</p>
        </article>
      `;
      return;
    }

    if (badge) badge.textContent = `${snapshot.stockCount || 0}종목 반영`;
    target.innerHTML = `
      <article>
        <span class="mini-tag">${escapeHTML(snapshot.roomCode || "방 코드 없음")}</span>
        <strong>${escapeHTML(snapshot.summary || "본게임 시장 반영됨")}</strong>
        <p>${escapeHTML(formatShortDateTime(snapshot.importedAt || new Date().toISOString()))} 기준 · 참가자 ${escapeHTML(snapshot.playerCount || 0)}명 · 체결 로그 ${escapeHTML(snapshot.logCount || 0)}건 · 봇 힌트 ${escapeHTML(snapshot.botCount || 0)}건</p>
      </article>
    `;
  }

  function setupForcedEventForm(data) {
    const form = document.querySelector("#forceEventForm");
    const companySelect = document.querySelector("#forceCompany");
    fillSelect(companySelect, data.companies.map((company) => ({ value: company.id, label: `${company.name} / ${company.ticker}` })), "기업 선택", false);

    if (!form || form.dataset.bound === "true") return;
    form.dataset.bound = "true";
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const formData = new FormData(form);
      const companyId = String(formData.get("company") || "");
      const eventKind = String(formData.get("eventKind") || "good");

      window.MarketStorage.updateCurrentPayload((payload) => {
        const item = window.MarketEngine.createForcedCompanyEvent(payload, companyId, eventKind);
        const eventItem = window.MarketEngine.eventFromForcedItem(item, payload.events.length);
        getPayloadList(payload, item.kind).unshift(item);
        payload.events.unshift(eventItem);
      }, { action: "forced-event", message: "특정 기업 이벤트 강제 생성" });

      form.reset();
      showToast("강제 기업 이벤트를 현재 라운드에 추가했습니다.");
      renderCurrentPage("admin");
    });
  }

  function setupAdminForm(data) {
    const form = document.querySelector("#customForm");
    const companySelect = document.querySelector("#customCompany");
    fillSelect(companySelect, data.companies.map((company) => company.name), "기업 선택", false);

    if (!form || form.dataset.bound === "true") return;
    form.dataset.bound = "true";
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const formData = new FormData(form);
      const company = data.companies.find((item) => item.name === formData.get("company")) || data.companies[0];
      const kind = formData.get("kind");
      const typeValue = String(formData.get("type") || "").trim();
      const item = {
        id: `admin-${Date.now()}`,
        source: "admin",
        kind,
        date: toISODate(new Date()),
        company: company.name,
        ticker: company.ticker,
        sector: company.sector,
        title: String(formData.get("title") || "").trim(),
        direction: formData.get("direction"),
        impactStrength: formData.get("impactStrength") || "중간",
        type: typeValue || defaultType(kind),
        summary: String(formData.get("summary") || "").trim(),
        body: String(formData.get("body") || "").trim(),
        confidence: "관리자 입력",
        signal: "플레이어 운영자가 직접 추가한 정보"
      };

      if (kind === "rumors") {
        item.credibility = formData.get("credibility");
        item.truthHint = "관리자 입력 루머입니다.";
      }

      if (kind === "reports") {
        item.rating = typeValue || "관망";
        item.stance = item.direction === "상승" ? "긍정" : item.direction === "하락" ? "부정" : "중립";
        item.analyst = "관리자 입력";
        item.horizon = "운영자 지정";
        item.riskNote = "수동 입력 리포트";
      }

      if (!item.title || !item.summary) return;
      window.MarketStorage.saveCustomItem(item);
      form.reset();
      showToast("수동 콘텐츠를 저장했습니다.");
      renderCurrentPage("admin");
    });
  }

  function setupSeasonForm(data) {
    const form = document.querySelector("#seasonForm");
    if (!form) return;
    form.elements.number.value = data.season.number || 1;
    form.elements.name.value = data.season.name || "";
    form.elements.startDate.value = data.season.startDate || "";
    form.elements.memo.value = data.season.memo || "";

    if (form.dataset.bound === "true") return;
    form.dataset.bound = "true";
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const formData = new FormData(form);
      window.MarketStorage.saveSeason({
        number: formData.get("number"),
        name: formData.get("name"),
        startDate: formData.get("startDate"),
        memo: formData.get("memo")
      });
      showToast("시즌 설정을 저장했습니다.");
      renderCurrentPage("admin");
    });
  }

  function setupMarketStateForm(data) {
    const form = document.querySelector("#marketStateForm");
    if (!form) return;
    form.elements.sentiment.value = data.market.sentiment || "중립";
    form.elements.liquidity.value = data.market.liquidity || 50;
    form.elements.volatility.value = data.market.volatility || 50;
    form.elements.ipoTemperature.value = data.market.ipoTemperature || 50;
    form.elements.delistingFear.value = data.market.delistingFear || 50;

    if (form.dataset.bound === "true") return;
    form.dataset.bound = "true";
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const formData = new FormData(form);
      window.MarketStorage.updateMarketState({
        sentiment: formData.get("sentiment"),
        liquidity: formData.get("liquidity"),
        volatility: formData.get("volatility"),
        ipoTemperature: formData.get("ipoTemperature"),
        delistingFear: formData.get("delistingFear")
      });
      showToast("시장 상태를 저장했습니다.");
      renderCurrentPage("admin");
    });
  }

  function setupBackupControls() {
    bindClick("#exportBackup", () => {
      const backup = window.MarketStorage.exportAllData();
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `market-board-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast("JSON 백업 파일을 생성했습니다.");
    });

    const importInput = document.querySelector("#importBackup");
    if (importInput && importInput.dataset.bound !== "true") {
      importInput.dataset.bound = "true";
      importInput.addEventListener("change", () => {
        const file = importInput.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          try {
            window.MarketStorage.importAllData(JSON.parse(String(reader.result)));
            queueToast("백업 데이터를 불러왔습니다.");
            window.location.reload();
          } catch (error) {
            window.alert("백업 파일을 불러오지 못했습니다.");
          }
        };
        reader.readAsText(file);
      });
    }
  }

  function renderRoundLogList(logs) {
    const target = document.querySelector("#roundLogList");
    if (!target) return;

    const recent = logs.slice(0, 5);
    const older = logs.slice(5);
    target.innerHTML = `
      ${recent.map(createRoundLogItem).join("")}
      ${older.length ? `
        <details class="history-more">
          <summary>이전 라운드 ${older.length}개 더 보기</summary>
          ${older.map(createRoundLogItem).join("")}
        </details>
      ` : ""}
    `;
    setHidden("#roundLogEmpty", logs.length > 0);
  }

  function renderContentEditor(data) {
    const filter = document.querySelector("#contentEditFilter");
    const search = document.querySelector("#contentEditSearch");
    const source = document.querySelector("#contentEditSource");
    const direction = document.querySelector("#contentEditDirection");
    fillSelect(filter, [
      { value: "news", label: "뉴스" },
      { value: "rumors", label: "루머" },
      { value: "disclosures", label: "공시" },
      { value: "reports", label: "리포트" }
    ], "전체 콘텐츠");

    const update = () => {
      const value = filter?.value || "all";
      const keyword = normalize(search?.value || "");
      const sourceValue = source?.value || "all";
      const directionValue = direction?.value || "all";
      const items = getEditableItems(data).filter((item) =>
        matchesValue(item.kind, value) &&
        matchesKeyword(item, keyword) &&
        matchesValue(item.source || "auto", sourceValue) &&
        matchesValue(item.direction, directionValue)
      );
      renderList("#contentEditorList", items, createEditItem);
      bindEditorButtons();
      setText("#contentEditorCount", `${items.length}건`);
      setHidden("#contentEditorEmpty", items.length > 0);
    };

    if (filter) filter.onchange = update;
    if (search) search.oninput = update;
    if (source) source.onchange = update;
    if (direction) direction.onchange = update;
    update();
  }

  function renderAdminList(items) {
    renderList("#customList", items.slice(0, 12), createAdminItem);
    setHidden("#customEmpty", items.length > 0);

    document.querySelectorAll("[data-delete-custom]").forEach((button) => {
      button.addEventListener("click", () => {
        window.MarketStorage.deleteCustomItem(button.dataset.deleteCustom);
        showToast("수동 입력을 삭제했습니다.", "warning");
        renderCurrentPage("admin");
      });
    });
  }

  function renderPageBrief(title, text) {
    const target = document.querySelector("#pageBrief");
    if (!target) return;
    target.innerHTML = `
      <article class="brief-card">
        <p class="eyebrow">오늘 봐야 할 핵심 요약</p>
        <h2>${escapeHTML(title)}</h2>
        <p>${escapeHTML(text)}</p>
      </article>
    `;
  }

  function renderMarketMap(data) {
    const container = document.querySelector("#marketMap");
    if (!container) return;
    const observed = [...data.companies].sort((a, b) => conflictScore(b) - conflictScore(a)).slice(0, 8);
    container.innerHTML = observed.map((company) => `
      <div class="heat-tile ${heatClass(conflictScore(company))}" style="--heat:${conflictScore(company)}%">
        <strong>${escapeHTML(company.ticker)}</strong>
        <span>${escapeHTML(company.name)}</span>
        <em>${escapeHTML(observationLabel(company))}</em>
      </div>
    `).join("");
  }

  function createContentCard(kind) {
    return (item) => `
      <article class="info-card ${kindClass(kind)}">
        <div class="card-top">
          <div class="badge-row">
            ${statusBadge(item.direction)}
            ${sourceBadge(item.source)}
            <span class="kind-badge">${escapeHTML(kindLabel(kind))}</span>
          </div>
          <time datetime="${escapeHTML(item.date)}">${formatShortDate(item.date)}</time>
        </div>
        <h3>${escapeHTML(item.title)}</h3>
        <p class="card-summary">${escapeHTML(item.summary)}</p>
        <p class="counter-line">반대 해석: ${escapeHTML(counterPoint(item))}</p>
        <details>
          <summary>판단 재료</summary>
          ${item.body ? `<p>${escapeHTML(item.body)}</p>` : ""}
          ${kind === "reports" ? createReportMeta(item) : ""}
          <p class="signal-line">${escapeHTML(item.signal || item.truthHint || item.riskNote || "추가 신호 없음")}</p>
          <p class="signal-line">질문: ${escapeHTML(decisionQuestion(item))}</p>
          ${tagRow([item.company, item.type || item.rating, confidenceLabel(item), impactLabel(item)])}
        </details>
      </article>
    `;
  }

  function createSectorCard(item) {
    return `
      <article class="sector-card">
        <div class="card-top">
          <span class="mini-tag">${escapeHTML(item.name)}</span>
          ${statusBadge(item.direction)}
        </div>
        <h3>${escapeHTML(item.mood)}</h3>
        <div class="flow-bar" aria-label="${escapeHTML(item.name)} 자금 흐름"><span style="width:${item.capitalFlow}%"></span></div>
        <details>
          <summary>예상 영향</summary>
          <p>${escapeHTML(item.expectedImpact)}</p>
        </details>
      </article>
    `;
  }

  function createCompanyCard(company) {
    return `
      <article class="company-card">
        <div class="company-head">
          <div>
            <span class="ticker">${escapeHTML(company.ticker)}</span>
            <h3>${escapeHTML(company.name)}</h3>
          </div>
          <span class="type-pill">${escapeHTML(company.listingStatus)}</span>
        </div>
        <p class="card-summary">${escapeHTML(company.description)}</p>
        ${company.battle ? createBattleCompanySnapshot(company.battle) : ""}
        <details>
          <summary>기업 세부 정보</summary>
          <dl class="metric-list">
            <div><dt>업종</dt><dd>${escapeHTML(company.sector)}</dd></div>
            <div><dt>CEO</dt><dd>${escapeHTML(company.ceo)}</dd></div>
            <div><dt>위험도</dt><dd class="${riskClass(company.risk)}">${escapeHTML(company.risk)}</dd></div>
            <div><dt>성장성</dt><dd>${escapeHTML(company.growthLabel)}</dd></div>
            <div><dt>배당성향</dt><dd>${escapeHTML(company.dividendLabel)}</dd></div>
            <div><dt>관찰도</dt><dd>${escapeHTML(observationLabel(company))}</dd></div>
          </dl>
          <p class="signal-line">${escapeHTML(company.engineHint)}</p>
          ${tagRow([company.business, company.publicSignal, company.sectorMood])}
        </details>
      </article>
    `;
  }

  function createBattleCompanySnapshot(battle) {
    const direction = Number(battle.changeRate || 0) > 0 ? "status-up" : Number(battle.changeRate || 0) < 0 ? "status-down" : "status-neutral";
    const sign = Number(battle.changeRate || 0) > 0 ? "+" : "";
    return `
      <div class="battle-company-snapshot">
        <div>
          <span>본게임 현재가</span>
          <strong>${formatNumber(battle.price)}원</strong>
        </div>
        <div>
          <span>등락률</span>
          <strong class="${direction}">${sign}${Number(battle.changeRate || 0).toFixed(2)}%</strong>
        </div>
        <div>
          <span>거래량</span>
          <strong>${formatNumber(battle.volume)}주</strong>
        </div>
      </div>
    `;
  }

  function createEventCard(item) {
    return `
      <article class="event-card">
        <div class="event-date">
          <strong>${formatMonthDay(item.date)}</strong>
          <span>${escapeHTML(item.day)}요일</span>
        </div>
        <div class="event-body">
          <div class="card-top">
            <span class="type-pill">${escapeHTML(item.type)}</span>
            ${statusBadge(item.direction)}
          </div>
          <h3>${escapeHTML(item.title)}</h3>
          <details>
            <summary>일정 설명</summary>
            <p>${escapeHTML(item.summary)}</p>
            ${tagRow([item.company])}
          </details>
        </div>
      </article>
    `;
  }

  function createAdminItem(item) {
    return `
      <article class="admin-item compact-admin-item">
        <div>
          <span class="mini-tag">${escapeHTML(kindLabel(item.kind))}</span>
          <h3>${escapeHTML(item.title)}</h3>
          <p>${escapeHTML(item.summary)}</p>
        </div>
        <button class="ghost-button" type="button" data-delete-custom="${escapeHTML(item.id)}">삭제</button>
      </article>
    `;
  }

  function createRoundLogItem(log) {
    const content = log.content || {};
    return `
      <details class="round-history-item">
        <summary>
          <span>${log.roundNumber}R</span>
          <strong>${escapeHTML(log.shock?.label || log.message || `${log.sentiment} 장세`)}</strong>
          <em>${formatShortDateTime(log.generatedAt)}</em>
        </summary>
        <p>${escapeHTML(log.summaryText || log.topNews?.[0] || "라운드 요약이 저장됐습니다.")}</p>
        ${log.forcedEvents?.length ? `<p class="signal-line">강제 이벤트: ${escapeHTML(log.forcedEvents.map((item) => item.title).join(", "))}</p>` : ""}
        <div class="history-content-grid">
          ${historyList("뉴스", content.news)}
          ${historyList("루머", content.rumors)}
          ${historyList("공시", content.disclosures)}
          ${historyList("리포트", content.reports)}
        </div>
      </details>
    `;
  }

  function createEditItem(item) {
    return `
      <details class="edit-card">
        <summary>
          <span class="kind-badge">${escapeHTML(kindLabel(item.kind))}</span>
          <strong>${escapeHTML(item.title)}</strong>
          ${statusBadge(item.direction)}
        </summary>
        <form data-edit-form data-kind="${escapeHTML(item.kind)}" data-id="${escapeHTML(item.id)}" class="edit-form">
          <label class="input-group full-span"><span>제목</span><input name="title" value="${escapeAttr(item.title)}"></label>
          <label class="input-group full-span"><span>요약</span><textarea name="summary" rows="3">${escapeHTML(item.summary || "")}</textarea></label>
          <label class="input-group full-span"><span>본문</span><textarea name="body" rows="4">${escapeHTML(item.body || item.signal || item.truthHint || item.riskNote || "")}</textarea></label>
          <label class="input-group"><span>표면 신호</span>
            <select name="direction">
              ${["상승", "하락", "중립", "혼조", "루머"].map((value) => `<option value="${value}" ${value === item.direction ? "selected" : ""}>${interpretationLabel(value)}</option>`).join("")}
            </select>
          </label>
          <label class="input-group"><span>민감도</span>
            <select name="impactStrength">
              ${["낮음", "중간", "높음", "매우 높음"].map((value) => `<option value="${value}" ${value === (item.impactStrength || "중간") ? "selected" : ""}>${sensitivityLabel(value)}</option>`).join("")}
            </select>
          </label>
          <div class="button-row full-span">
            <button class="primary-button" type="submit">수정 저장</button>
            <button class="danger-button" type="button" data-delete-content data-kind="${escapeHTML(item.kind)}" data-id="${escapeHTML(item.id)}">삭제</button>
          </div>
        </form>
      </details>
    `;
  }

  function bindEditorButtons() {
    document.querySelectorAll("[data-edit-form]").forEach((form) => {
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const formData = new FormData(form);
        window.MarketStorage.updateContentItem(form.dataset.kind, form.dataset.id, {
          title: formData.get("title"),
          summary: formData.get("summary"),
          body: formData.get("body"),
          direction: formData.get("direction"),
          impactStrength: formData.get("impactStrength")
        });
        showToast("콘텐츠 수정 사항을 저장했습니다.");
        renderCurrentPage("admin");
      });
    });

    document.querySelectorAll("[data-delete-content]").forEach((button) => {
      button.addEventListener("click", () => {
        if (!window.confirm("이 콘텐츠를 삭제할까요?")) return;
        window.MarketStorage.deleteContentItem(button.dataset.kind, button.dataset.id);
        showToast("콘텐츠를 삭제했습니다.", "warning");
        renderCurrentPage("admin");
      });
    });
  }

  function createReportMeta(item) {
    return `
      <dl class="report-meta">
        <div><dt>애널리스트</dt><dd>${escapeHTML(item.analyst || "관리자 입력")}</dd></div>
        <div><dt>시계열</dt><dd>${escapeHTML(item.horizon || "중기")}</dd></div>
        <div><dt>리스크</dt><dd>${escapeHTML(item.riskNote || "확인 필요")}</dd></div>
      </dl>
    `;
  }

  function historyList(label, items = []) {
    return `
      <div>
        <h4>${escapeHTML(label)}</h4>
        <ul>
          ${(items || []).slice(0, 6).map((item) => `<li>${escapeHTML(item.title)}</li>`).join("") || "<li>없음</li>"}
        </ul>
      </div>
    `;
  }

  function statCard(label, value) {
    return `
      <article class="stat-card">
        <span>${escapeHTML(label)}</span>
        <strong>${escapeHTML(value)}</strong>
      </article>
    `;
  }

  function getEditableItems(data) {
    return [
      ...data.news.map((item) => ({ ...item, kind: item.kind || "news" })),
      ...data.rumors.map((item) => ({ ...item, kind: item.kind || "rumors" })),
      ...data.disclosures.map((item) => ({ ...item, kind: item.kind || "disclosures" })),
      ...data.reports.map((item) => ({ ...item, kind: item.kind || "reports" }))
    ];
  }

  function getPayloadList(payload, kind) {
    if (kind === "news") return payload.news;
    if (kind === "rumors") return payload.rumors;
    if (kind === "disclosures") return payload.disclosures;
    if (kind === "reports") return payload.reports;
    return payload.news;
  }

  function statusBadge(value) {
    return `<span class="status-badge ${statusClass(value)}">${escapeHTML(interpretationLabel(value))}</span>`;
  }

  function sourceBadge(source) {
    return `<span class="source-badge ${escapeHTML(source || "auto")}">${escapeHTML(sourceLabel(source))}</span>`;
  }

  function tagRow(values) {
    return `<div class="tag-row">${values.filter(Boolean).map((value) => `<span class="mini-tag">${escapeHTML(displayTagValue(value))}</span>`).join("")}</div>`;
  }

  function statusClass(value) {
    if (["상승", "호재", "탐욕", "비중확대", "중립상향", "긍정"].includes(value)) return "status-up";
    if (["하락", "악재", "공포", "비중축소", "부정"].includes(value)) return "status-down";
    if (["루머", "혼조"].includes(value)) return "status-rumor";
    return "status-neutral";
  }

  function kindClass(kind) {
    return `kind-${kind}`;
  }

  function heatClass(value) {
    if (value > 68) return "heat-hot";
    if (value < 36) return "heat-cold";
    return "heat-mid";
  }

  function scoreTone(value, highIsGood) {
    const number = Number(value);
    if (number >= 70) return highIsGood ? "tone-good" : "tone-risk";
    if (number <= 35) return highIsGood ? "tone-risk" : "tone-good";
    return "tone-watch";
  }

  function riskClass(value) {
    if (String(value).includes("높음")) return "risk-high";
    if (value === "낮음") return "risk-low";
    return "risk-medium";
  }

  function impactLabel(item) {
    return `민감도 ${sensitivityLabel(item.impactStrength || item.uncertainty || "중간")}`;
  }

  function softHeadline(text) {
    const value = String(text || "라운드 관찰 요약");
    if (value.includes("해석 분화") || value.includes("결론 보류")) return value;
    if (value.includes("반영")) return value.replace("반영", "해석 분화");
    if (value.includes("장세")) return `${value}, 결론 보류`;
    return `${value} 관찰`;
  }

  function softLead(text) {
    const value = String(text || "서로 충돌하는 단서를 함께 확인해야 합니다.");
    if (value.includes("갈릴") || value.includes("충돌") || value.includes("반대로")) return value;
    return `${value} 다만 이 정보만으로 방향을 확정하기는 어렵습니다.`;
  }

  function pickDecisionIssues(news) {
    return [...news]
      .sort((a, b) => decisionWeight(b) - decisionWeight(a))
      .slice(0, 3);
  }

  function decisionWeight(item) {
    const directionWeight = item.direction === "혼조" || item.direction === "루머" ? 34 : item.direction === "중립" ? 22 : 14;
    const sourceWeight = item.source === "shock" ? 24 : item.source === "forced" ? 18 : item.source === "admin" ? 12 : 8;
    const confidenceWeight = item.confidence === "보통" ? 16 : item.confidence === "낮음" ? 12 : 6;
    return directionWeight + sourceWeight + confidenceWeight + String(item.title || "").length % 13;
  }

  function interpretationLabel(value) {
    return {
      상승: "긍정 단서",
      하락: "부담 단서",
      중립: "확인 대기",
      혼조: "해석 분산",
      루머: "미확인",
      호재: "우호 단서",
      악재: "부담 단서",
      탐욕: "위험선호",
      공포: "위험회피",
      비중확대: "긍정 관점",
      중립상향: "관점 개선",
      비중축소: "보수 관점",
      긍정: "긍정 관점",
      부정: "보수 관점"
    }[value] || value || "확인 대기";
  }

  function sensitivityLabel(value) {
    return {
      낮음: "낮음",
      중간: "보통",
      보통: "보통",
      높음: "높음",
      "매우 높음": "매우 높음"
    }[value] || value || "보통";
  }

  function confidenceLabel(item) {
    const value = item.credibility || item.confidence || "보통";
    return `정보 선명도 ${sensitivityLabel(value)}`;
  }

  function displayTagValue(value) {
    if (typeof value !== "string") return value;
    if (["상승", "하락", "중립", "혼조", "루머", "호재", "악재", "비중확대", "중립상향", "비중축소", "긍정", "부정"].includes(value)) {
      return interpretationLabel(value);
    }
    return value;
  }

  function counterPoint(item) {
    if (item.counterSignal) return item.counterSignal;
    if (item.direction === "상승") return "이미 기대가 가격에 먼저 반영됐거나 차익실현이 나올 수 있습니다.";
    if (item.direction === "하락") return "악재가 공개되며 불확실성이 줄어드는 해소 반응이 나올 수 있습니다.";
    if (item.direction === "루머") return "루머가 틀리거나, 맞더라도 시장이 이미 알고 있었을 수 있습니다.";
    if (item.direction === "혼조") return "같은 재료를 보는 투자자들의 시간대가 서로 다를 수 있습니다.";
    return "다른 공시, 수급, 일정과 같이 봐야 의미가 생깁니다.";
  }

  function decisionQuestion(item) {
    if (item.decisionQuestion) return item.decisionQuestion;
    if (item.type?.includes("실적")) return "이 재료가 숫자로 확인되기 전 기대만 먼저 움직인 것은 아닌가?";
    if (item.type?.includes("루머") || item.kind === "rumors") return "출처가 겹치는가, 아니면 같은 말이 반복 유통되는가?";
    if (item.type?.includes("공시") || item.kind === "disclosures") return "공시 자체보다 이후 일정과 조건이 더 중요한가?";
    if (item.kind === "reports") return "리포트의 결론보다 리스크 문장이 내 판단과 충돌하지 않는가?";
    return "이 뉴스가 새 정보인지, 이미 모두가 예상한 정보인지 먼저 구분했는가?";
  }

  function conflictScore(company) {
    const heat = Number(company.heat || 0);
    const warning = Number(company.warningScore || 0);
    const bothHigh = Math.min(heat, warning);
    const unstableMiddle = 100 - Math.abs(heat - 50);
    return Math.round(Math.max(bothHigh, unstableMiddle * 0.72));
  }

  function observationLabel(company) {
    const score = conflictScore(company);
    if (score > 68) return "충돌 큼";
    if (score > 48) return "확인 필요";
    return "관찰 낮음";
  }

  function sentimentText(value) {
    if (value === "탐욕") return "호재에 빠르게 반응하지만 차익실현도 날카롭습니다.";
    if (value === "공포") return "악재가 먼저 보이지만 선반영 이후 반등도 가능합니다.";
    return "확인된 자료와 수급 힌트가 함께 필요한 중립 장세입니다.";
  }

  function liquidityText(value) {
    if (value > 68) return "대기 자금이 많아 작은 재료도 크게 번질 수 있습니다.";
    if (value < 36) return "자금이 마른 상태라 좋은 뉴스도 제한적으로 반영될 수 있습니다.";
    return "자금은 남아 있지만 업종 선택이 까다롭습니다.";
  }

  function volatilityText(value) {
    if (value > 68) return "뉴스보다 포지션 정리가 가격을 흔들 수 있습니다.";
    if (value < 36) return "반응은 느리지만 방향성이 생기면 오래 갈 수 있습니다.";
    return "상승과 하락 해석이 동시에 나오는 구간입니다.";
  }

  function renderList(selector, items, template) {
    const target = document.querySelector(selector);
    if (!target) return;
    target.innerHTML = items.map(template).join("");
  }

  function matchesKeyword(item, keyword) {
    if (!keyword) return true;
    const text = normalize([
      item.title,
      item.summary,
      item.body,
      item.company,
      item.ticker,
      item.sector,
      item.type,
      item.rating,
      item.analyst
    ].filter(Boolean).join(" "));
    return text.includes(keyword);
  }

  function matchesValue(value, selected) {
    return selected === "all" || String(value || "") === selected;
  }

  function fillSelect(select, values, allLabel, includeAll = true) {
    if (!select || select.dataset.filled === "true") return;
    const normalized = values.map((item) => typeof item === "object" ? item : { value: item, label: item });
    const options = includeAll ? [`<option value="all">${escapeHTML(allLabel)}</option>`] : [`<option value="">${escapeHTML(allLabel)}</option>`];
    normalized.forEach((item) => {
      options.push(`<option value="${escapeHTML(item.value)}">${escapeHTML(item.label)}</option>`);
    });
    select.innerHTML = options.join("");
    select.dataset.filled = "true";
  }

  function mergeCustom(generated, custom, kind) {
    return [
      ...custom.filter((item) => item.kind === kind),
      ...generated
    ];
  }

  function defaultType(kind) {
    return {
      news: "관리자 뉴스",
      rumors: "관리자 루머",
      disclosures: "관리자 공시",
      reports: "관망"
    }[kind] || "관리자 입력";
  }

  function kindLabel(kind) {
    return {
      news: "뉴스",
      rumors: "루머",
      disclosures: "공시",
      reports: "리포트"
    }[kind] || kind;
  }

  function sourceLabel(source) {
    if (source === "admin") return "수동";
    if (source === "battle") return "본게임";
    if (source === "forced") return "강제";
    if (source === "shock") return "충격";
    return "자동";
  }

  function bindClick(selector, handler) {
    const target = document.querySelector(selector);
    if (!target || target.dataset.bound === "true") return;
    target.dataset.bound = "true";
    target.addEventListener("click", handler);
  }

  function ensureToastRegion() {
    if (document.querySelector("#toastRegion")) return;
    const region = document.createElement("div");
    region.id = "toastRegion";
    region.className = "toast-region";
    region.setAttribute("aria-live", "polite");
    region.setAttribute("aria-atomic", "true");
    document.body.append(region);
  }

  function showToast(message, tone = "success") {
    ensureToastRegion();
    const region = document.querySelector("#toastRegion");
    if (!region) return;
    const toast = document.createElement("div");
    toast.className = `toast toast-${tone}`;
    toast.textContent = message;
    region.append(toast);
    window.setTimeout(() => {
      toast.classList.add("is-hiding");
      window.setTimeout(() => toast.remove(), 260);
    }, 2200);
  }

  function queueToast(message) {
    sessionStorage.setItem("market-board-toast", message);
  }

  function setText(selector, text) {
    const target = document.querySelector(selector);
    if (target) target.textContent = text;
  }

  function setHidden(selector, visible) {
    const target = document.querySelector(selector);
    if (target) target.hidden = visible;
  }

  function unique(values) {
    return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko"));
  }

  function normalize(value) {
    return value.trim().toLocaleLowerCase("ko-KR");
  }

  function formatKoreanDate(date) {
    return new Intl.DateTimeFormat("ko-KR", {
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "long"
    }).format(date);
  }

  function formatShortDate(dateText) {
    const date = new Date(`${dateText}T00:00:00`);
    return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric" }).format(date);
  }

  function formatMonthDay(dateText) {
    const date = new Date(`${dateText}T00:00:00`);
    return new Intl.DateTimeFormat("ko-KR", { month: "2-digit", day: "2-digit" }).format(date);
  }

  function parseLocalDate(dateText) {
    const [year, month, day] = String(dateText || "").split("-").map(Number);
    if (!year || !month || !day) {
      const fallback = new Date();
      fallback.setHours(0, 0, 0, 0);
      return fallback;
    }
    return new Date(year, month - 1, day);
  }

  function toLocalDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function startOfCalendarWeek(date) {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const mondayOffset = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - mondayOffset);
    return start;
  }

  function daysBetween(start, end) {
    const oneDay = 24 * 60 * 60 * 1000;
    return Math.max(0, Math.round((end - start) / oneDay));
  }

  function formatShortDateTime(dateText) {
    return new Intl.DateTimeFormat("ko-KR", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(dateText));
  }

  function formatNumber(value) {
    return new Intl.NumberFormat("ko-KR").format(Number(value) || 0);
  }

  function virtualIndex(company) {
    const base = 18000 + stringScore(company.ticker) * 37;
    const heatBonus = Number(company.heat || 0) * 420;
    const riskDiscount = Number(company.warningScore || 0) * 160;
    return Math.max(1200, Math.round(base + heatBonus - riskDiscount));
  }

  function stringScore(value) {
    return String(value || "").split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
  }

  function toISODate(date) {
    return date.toISOString().slice(0, 10);
  }

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => {
      const map = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      };
      return map[char];
    });
  }

  function escapeAttr(value) {
    return escapeHTML(value).replace(/`/g, "&#096;");
  }
})();
