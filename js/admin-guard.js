// js/admin-guard.js
// 관리자 페이지(admin.html) 접근 제한 — tomem@naver.com 만 허용.
// Firebase 이메일/비밀번호 로그인으로 본인 확인 후 관리자 이메일일 때만 페이지를 연다.
(function () {
  "use strict";

  const ADMIN_UID = "yaV8N60yIiUggaWNpNF2VhkCwxb2";
  const ADMIN_EMAIL = "tomem@naver.com";
  const isAdminUser = (u) => u && (u.uid === ADMIN_UID || (u.email || "").toLowerCase() === ADMIN_EMAIL);
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
    "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js",
  ];

  let auth = null;

  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = src; s.onload = res; s.onerror = () => rej(new Error("load " + src));
      document.head.appendChild(s);
    });
  }

  function buildOverlay() {
    const ov = document.createElement("div");
    ov.id = "adminGuard";
    ov.className = "admin-guard";
    ov.innerHTML = `
      <div class="ag-card">
        <span class="ag-mark">MB</span>
        <h1 class="ag-title">관리자 인증</h1>
        <p class="ag-sub">관리자 계정으로 로그인해야 이 페이지를 볼 수 있어요.</p>
        <input id="agEmail" class="ag-input" type="email" placeholder="관리자 이메일" autocomplete="username" />
        <input id="agPw" class="ag-input" type="password" placeholder="비밀번호" autocomplete="current-password" />
        <button id="agLogin" class="ag-btn" type="button">로그인</button>
        <p id="agMsg" class="ag-msg"></p>
        <a href="index.html" class="ag-back">← 시장 정보 화면으로</a>
      </div>`;
    document.body.appendChild(ov);
    const pw = ov.querySelector("#agPw");
    pw.addEventListener("keydown", (e) => { if (e.key === "Enter") ov.querySelector("#agLogin").click(); });
    ov.querySelector("#agLogin").addEventListener("click", login);
  }
  function setMsg(t) { const m = document.getElementById("agMsg"); if (m) m.textContent = t || ""; }
  function allow() { const ov = document.getElementById("adminGuard"); if (ov) ov.remove(); }
  function block() { if (!document.getElementById("adminGuard")) buildOverlay(); }

  async function login() {
    const email = document.getElementById("agEmail").value.trim();
    const pw = document.getElementById("agPw").value;
    if (!email || !pw) { setMsg("이메일과 비밀번호를 입력하세요."); return; }
    setMsg("확인 중...");
    try {
      const cred = await auth.signInWithEmailAndPassword(email, pw);
      if (!isAdminUser(cred.user)) {
        await auth.signOut();
        setMsg("관리자 계정이 아닙니다. 접근 권한이 없습니다.");
      }
      // 관리자면 onAuthStateChanged 가 allow() 호출
    } catch (e) {
      setMsg("로그인 실패: 이메일/비밀번호를 확인하세요.");
    }
  }

  async function init() {
    block(); // 우선 화면을 가린다
    try {
      for (const src of SDK) if (!(window.firebase && window.firebase.auth)) await loadScript(src);
      if (!window.firebase.apps.length) window.firebase.initializeApp(firebaseConfig);
      auth = window.firebase.auth();
      auth.onAuthStateChanged((user) => {
        if (isAdminUser(user)) allow();
        else block();
      });
    } catch (e) {
      setMsg("인증 모듈을 불러오지 못했습니다. 네트워크를 확인하세요.");
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
