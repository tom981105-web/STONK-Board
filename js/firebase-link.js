// js/firebase-link.js
// Market Board ↔ Market Battle 실시간 연동 (읽기 전용)
// - 첫 화면: 방 코드 입력 게이트. 코드를 넣으면 그 방의 시세·뉴스를 실시간으로 본다.
// - 방 데이터가 바뀔 때마다 MarketStorage.importBattleSnapshot 으로 흘려보내고
//   현재 페이지를 다시 그린다. (수집/콘텐츠 변환 로직은 storage.js 가 이미 담당)
(function () {
  "use strict";

  // ★ Market Battle 과 동일한 Firebase 프로젝트 설정 (같은 DB 를 공유해야 연동됨)
  const firebaseConfig = {
    apiKey: "AIzaSyARFa-vzKVmIdxP5xDRXVzasL2ui94eZ-w",
    authDomain: "market-6e66a.firebaseapp.com",
    databaseURL: "https://market-6e66a-default-rtdb.firebaseio.com",
    projectId: "market-6e66a",
    storageBucket: "market-6e66a.firebasestorage.app",
    messagingSenderId: "402312269082",
    appId: "1:402312269082:web:cf304afc54057ea162b0a3",
  };

  const SDK = [
    "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js",
    "https://www.gstatic.com/firebasejs/10.12.2/firebase-database-compat.js",
    "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js",
  ];
  const ROOM_KEY = "mb-board-room"; // 연결한 방 코드 (페이지 간 공유)
  const DEMO_KEY = "mb-board-demo"; // 연결 없이 둘러보기 모드
  const isAdmin = (location.pathname.split("/").pop() || "").startsWith("admin");

  let db = null;
  let activeRef = null;
  let activeCode = "";
  let lastTick = -1;
  let gotData = false;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error("load fail: " + src));
      document.head.appendChild(s);
    });
  }

  async function initFirebase() {
    if (window.firebase && window.firebase.database) return true;
    try {
      for (const src of SDK) await loadScript(src);
      if (!window.firebase.apps.length) window.firebase.initializeApp(firebaseConfig);
      db = window.firebase.database();
      return true;
    } catch (e) {
      console.error("[board-link] Firebase 로드 실패:", e);
      gateError("Firebase에 연결할 수 없습니다. 네트워크를 확인하세요.");
      return false;
    }
  }

  // ===== 게이트(첫 화면) =====
  function buildGate() {
    if (document.getElementById("boardGate")) return;
    const gate = document.createElement("div");
    gate.id = "boardGate";
    gate.className = "board-gate";
    gate.innerHTML = `
      <div class="gate-card">
        <div class="gate-brand"><span class="gate-mark">S</span></div>
        <h1 class="gate-title">STONK <span>Board</span></h1>
        <p class="gate-sub">STONK Battle 방 코드를 입력하면<br />그 시장의 <b>실시간 뉴스·공시·루머·시세</b>를 봅니다.</p>
        <input id="gateCode" class="gate-input" maxlength="6" placeholder="방 코드 6자리" autocomplete="off" spellcheck="false" />
        <button id="gateConnect" class="gate-btn primary" type="button">연결하기</button>
        <p id="gateMsg" class="gate-msg"></p>
        <p class="gate-foot">가상 데이터 정보 포털 · 실제 투자와 무관</p>
      </div>
    `;
    document.body.appendChild(gate);

    const input = gate.querySelector("#gateCode");
    input.addEventListener("input", () => {
      input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") gate.querySelector("#gateConnect").click();
    });
    gate.querySelector("#gateConnect").addEventListener("click", () => {
      const code = input.value.trim().toUpperCase();
      if (code.length !== 6) {
        gateError("방 코드 6자리를 입력하세요.");
        return;
      }
      connect(code);
    });
  }

  function showGate(prefill) {
    const gate = document.getElementById("boardGate");
    if (!gate) return;
    gate.classList.remove("hidden");
    const input = document.getElementById("gateCode");
    if (input && prefill) input.value = prefill;
    if (input) setTimeout(() => input.focus(), 50);
  }
  function hideGate() {
    const gate = document.getElementById("boardGate");
    if (gate) gate.classList.add("hidden");
  }
  function gateError(text) {
    const msg = document.getElementById("gateMsg");
    if (msg) msg.textContent = text || "";
    const btn = document.getElementById("gateConnect");
    if (btn) btn.textContent = "연결하기";
  }
  function gateBusy(text) {
    const msg = document.getElementById("gateMsg");
    if (msg) msg.textContent = text || "";
  }

  // ===== 연결됨 상태칩 (작게) =====
  function buildChip() {
    if (document.getElementById("blChip")) return;
    const chip = document.createElement("div");
    chip.id = "blChip";
    chip.className = "bl-chip hidden";
    chip.innerHTML = `
      <span class="bl-dot on"></span>
      <span id="blChipText" class="bl-chip-text">연결됨</span>
      <button id="blChipExit" class="bl-chip-exit" type="button">해제</button>
    `;
    document.body.appendChild(chip);
    chip.querySelector("#blChipExit").addEventListener("click", disconnect);
  }
  function setChip(text, show) {
    const chip = document.getElementById("blChip");
    if (!chip) return;
    chip.classList.toggle("hidden", !show);
    const t = document.getElementById("blChipText");
    if (t && text) t.textContent = text;
  }

  // ===== 사이트 간 이동 링크(roomCode 유지) =====
  function updateSiteNav(code) {
    const SC = window.SiteConfig;
    if (!SC) return;
    SC.setLastRoomCode(code);
    const set = (id, url) => {
      const el = document.getElementById(id);
      if (el) { el.href = url; el.hidden = false; }
    };
    set("nbNavHome", SC.buildHomeUrl(code));
    set("nbNavBattle", SC.buildBattleUrl(code));
    set("nbNavWiki", SC.buildWikiUrl(code, ""));
    set("nbNavArcade", SC.buildArcadeUrl(code));
    set("nbNavGacha", SC.buildGachaUrl(code));
    // 관리자 페이지 링크는 '관리자'에게만 노출. (같은 도메인 Firebase 인증 세션으로 판별)
    const adminEl = document.getElementById("nbNavAdmin");
    if (adminEl) adminEl.href = SC.buildAdminUrl(code);
    revealAdminNavIfAdmin("nbNavAdmin");
  }

  // 같은 origin(github.io)에서 공유되는 Firebase Auth 세션으로 관리자 여부를 판별해 관리자 링크를 노출
  const ADMIN_UID = "yaV8N60yIiUggaWNpNF2VhkCwxb2";
  const ADMIN_EMAIL = "tomem@naver.com";
  let adminNavBound = false;
  function revealAdminNavIfAdmin(elId) {
    if (adminNavBound) return; adminNavBound = true;
    try {
      if (!window.firebase || !window.firebase.auth) return;
      window.firebase.auth().onAuthStateChanged((u) => {
        const el = document.getElementById(elId);
        if (!el) return;
        let isAdm = !!u && (u.uid === ADMIN_UID || String((u.email || "")).toLowerCase() === ADMIN_EMAIL);
        if (isAdm) { el.hidden = false; return; }
        if (u && window.firebase.database) {
          window.firebase.database().ref("admins/" + u.uid).once("value").then((s) => { if (s.val() === true) el.hidden = false; }).catch(() => {});
        } else { el.hidden = true; }
      });
    } catch (e) {}
  }

  // ===== 연결 / 해제 =====
  async function connect(code) {
    gateBusy(`${code} 연결 중...`);
    const ok = await initFirebase();
    if (!ok) return;

    if (activeRef) activeRef.off();
    activeCode = code;
    lastTick = -1;
    gotData = false;
    localStorage.setItem(ROOM_KEY, code);
    localStorage.removeItem(DEMO_KEY);
    updateSiteNav(code);

    activeRef = db.ref("rooms/" + code);
    activeRef.on(
      "value",
      (snap) => onRoom(snap.val()),
      (err) => {
        console.error("[board-link] 구독 오류:", err);
        gateError("구독 오류 (DB 규칙을 확인하세요).");
      }
    );

    // 일정 시간 내 데이터가 없으면 방 없음 안내
    setTimeout(() => {
      if (activeCode === code && !gotData) {
        gateError(`'${code}' 방을 찾을 수 없습니다. 코드를 확인하세요.`);
      }
    }, 4000);
  }

  function disconnect() {
    if (activeRef) activeRef.off();
    activeRef = null;
    activeCode = "";
    lastTick = -1;
    gotData = false;
    localStorage.removeItem(ROOM_KEY);
    localStorage.removeItem(DEMO_KEY);
    try {
      window.MarketStorage && window.MarketStorage.clearBattleSnapshot();
    } catch (e) {}
    if (window.BoardLive) window.BoardLive.reset();
    const ex = document.getElementById("nbDisconnect");
    if (ex) ex.hidden = true;
    setChip("", false);
    showGate("");
    gateError("");
  }

  function onRoom(room) {
    if (!room || !room.stocks) {
      // 방은 있으나 아직 게임 전이거나, 방이 없음
      if (room) {
        gotData = true;
        hideGate();
        setChip(`${activeCode} · 게임 대기 중`, true);
      }
      return;
    }
    gotData = true;
    hideGate();

    const stockCount = Object.keys(room.stocks).length;
    const statusLabel =
      room.status === "playing" ? "진행 중" : room.status === "ended" ? "종료됨" : room.status || "";
    // board 는 읽기 중심 — 연결칩에 roomCode·종목수·읽기전용 표기(시장 보정은 battle/admin)
    setChip(`${activeCode} · ${statusLabel} · ${stockCount}종목 · 읽기전용`, true);

    // 뉴스룸(index): 라이브 데이터로 직접 렌더 (정확한 값, 매 업데이트 반영)
    if (window.BoardLive) {
      window.BoardLive.onConnected();
      window.BoardLive.render(room);
      lastTick = room.marketTick || 0;
      return;
    }

    // 레거시 페이지(storage/main.js): 스냅샷 반영 후 재렌더
    const tick = room.marketTick || 0;
    if (tick === lastTick) return;
    lastTick = tick;
    try {
      window.MarketStorage && window.MarketStorage.importBattleSnapshot({ roomCode: activeCode, roomData: room });
    } catch (e) {
      console.error("[board-link] 스냅샷 반영 실패:", e);
      return;
    }
    refresh();
  }

  // 현재 페이지 다시 그리기 (관리자 페이지는 입력 방해를 막기 위해 자동 재렌더 제외)
  function refresh() {
    if (isAdmin) {
      if (window.MarketBoardApp && window.MarketBoardApp.refreshBattleStatus) {
        window.MarketBoardApp.refreshBattleStatus();
      }
      return;
    }
    if (window.MarketBoardApp && window.MarketBoardApp.refresh) {
      window.MarketBoardApp.refresh();
    }
  }

  // ===== 시작 =====
  document.addEventListener("DOMContentLoaded", () => {
    buildChip();
    // URL ?room= / ?roomCode= 가 있으면 최우선으로 연결 (분리 배포 사이트 간 이동 대응)
    let urlRoom = "";
    try { urlRoom = window.SiteConfig ? window.SiteConfig.getUrlRoomCode() : ""; } catch (e) {}
    // 단일 방 운영: 방 코드 개념을 없앴으므로 항상 고정 방(MAIN)에 연결한다.
    const saved = urlRoom || localStorage.getItem(ROOM_KEY) || "MAIN";
    // 데모(둘러보기) 모드 제거 — 끼어 있던 기존 플래그도 정리해 게이트가 정상 동작하게 한다
    try { localStorage.removeItem(DEMO_KEY); } catch (e) {}

    // 관리자 페이지는 게이트로 막지 않는다 (저장된 방이 있으면 연결만)
    if (isAdmin) {
      if (saved) connect(saved);
      return;
    }
    buildGate();

    if (saved) {
      hideGate();
      connect(saved);
    } else {
      // 첫 진입: 게이트 노출, 남은 스냅샷 정리
      showGate("");
      try {
        if (window.MarketStorage && window.MarketStorage.getBattleSnapshot()) {
          window.MarketStorage.clearBattleSnapshot();
          refresh();
        }
      } catch (e) {}
    }
  });

  window.MarketBoardLink = {
    connect,
    disconnect,
    showGate: () => showGate(activeCode),
    get code() { return activeCode; },
  };
})();
