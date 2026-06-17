// js/home-gate.js — STONK Home 중심 진입 게이트 (PHASE 3, Board/Wiki 공용 / 플레인 IIFE)
// ───────────────────────────────────────────────────────────────────
// Board/Wiki 는 비로그인 공개 읽기를 유지한다. 단:
//   - roomCode 가 없으면 "STONK Home에서 입장해 주세요" 게이트로 안내(자동 이동).
//   - roomCode 가 있으면 기존처럼 읽기 가능 + 좌상단에 "STONK Home" 복귀 버튼을 노출.
// window.SiteConfig 가 있어야 동작하며, 없으면 조용히 아무것도 하지 않는다(기존 동작 보존).
(function () {
  "use strict";
  var SC = window.SiteConfig;
  if (!SC) return;

  function homeUrl(room) {
    try { return SC.buildSiteUrl ? SC.buildSiteUrl("home", { room: room }) : "../STONK-Home/index.html"; }
    catch (e) { return "../STONK-Home/index.html"; }
  }
  function isLocalDev() {
    return /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) || location.protocol === "file:";
  }

  function showGate(room) {
    if (document.getElementById("stonk-home-gate")) return;
    var url = homeUrl(room);
    var auto = !isLocalDev();
    var wrap = document.createElement("div");
    wrap.id = "stonk-home-gate";
    wrap.setAttribute("role", "dialog");
    wrap.style.cssText = "position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;padding:24px;background:radial-gradient(120% 90% at 50% -10%,rgba(139,108,255,0.22),transparent 60%),rgba(5,6,10,0.94);backdrop-filter:blur(8px);color:#f4f7ff;font-family:Pretendard,Inter,'Noto Sans KR',system-ui,sans-serif";
    wrap.innerHTML =
      '<div style="width:min(460px,100%);text-align:center;padding:32px 26px;border:1px solid rgba(255,255,255,0.14);border-radius:18px;background:rgba(14,16,24,0.92);box-shadow:0 24px 70px rgba(0,0,0,0.5),0 0 60px rgba(139,108,255,0.16)">' +
        '<div style="font-size:13px;font-weight:900;letter-spacing:2px;color:#8b6cff;margin-bottom:8px">STONK UNIVERSE</div>' +
        '<h2 style="margin:0 0 10px;font-size:1.5rem">STONK Home에서 입장해 주세요</h2>' +
        '<p style="margin:0 0 18px;color:#aab2c8;font-size:0.95rem;line-height:1.5">방 코드가 없습니다. STONK Home에서 방을 선택하면 Board/Wiki가 해당 방의 시장 데이터를 보여줍니다.</p>' +
        '<a id="stonk-gate-go" href="' + url + '" style="display:inline-flex;align-items:center;justify-content:center;min-height:50px;padding:0 26px;border-radius:14px;font-weight:900;text-decoration:none;color:#0a0a12;background:linear-gradient(135deg,#a99bff,#8b6cff);box-shadow:0 10px 30px rgba(139,108,255,0.4)">STONK Home으로 이동</a>' +
        (auto ? '<div style="margin-top:12px;font-size:0.8rem;color:#8a93a8"><span id="stonk-gate-count">3</span>초 후 자동 이동…</div>' : '<div style="margin-top:12px;font-size:0.78rem;color:#5f6678">개발 모드: 자동 이동 없음</div>') +
      '</div>';
    document.body.appendChild(wrap);
    if (auto) {
      var left = 3, el = document.getElementById("stonk-gate-count");
      var iv = setInterval(function () { left -= 1; if (el) el.textContent = String(Math.max(0, left)); if (left <= 0) clearInterval(iv); }, 1000);
      setTimeout(function () { location.href = url; }, 2600);
    }
  }

  // roomCode 가 있을 때 좌상단에 Home 복귀 버튼 주입(기존 네비를 건드리지 않음)
  function injectHomeButton(room) {
    if (document.getElementById("stonkHomeBtn")) return;
    var a = document.createElement("a");
    a.id = "stonkHomeBtn";
    a.href = homeUrl(room);
    a.textContent = "← STONK Home";
    a.style.cssText = "position:fixed;left:12px;top:12px;z-index:9000;display:inline-flex;align-items:center;min-height:34px;padding:0 12px;border-radius:999px;font-size:12px;font-weight:800;text-decoration:none;color:#f4f7ff;background:rgba(139,108,255,0.18);border:1px solid rgba(139,108,255,0.5);backdrop-filter:blur(6px)";
    a.setAttribute("title", "STONK Home으로 돌아가기 (방 " + room + " 유지)");
    document.body.appendChild(a);
  }

  function run() {
    var room = "";
    try { room = SC.getCurrentRoomCode ? SC.getCurrentRoomCode() : ""; } catch (e) { room = ""; }
    if (!room) { showGate(""); return; }
    try { SC.setLastRoomCode && SC.setLastRoomCode(room); } catch (e) {}
    injectHomeButton(room);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run);
  else run();
})();
