/* theme-toggle.js — STONK 공용 라이트/다크 토글 (Board·Wiki 동일 복제)
 * 라이트 기본. 선택은 localStorage["stonk:theme"] 에 저장(3개 사이트 공유, 같은 origin).
 * 페이지에 #themeToggle 버튼이 있으면 그걸 쓰고, 없으면 우상단 floating 알약을 만든다. */
(function () {
  var KEY = "stonk:theme";
  function get() {
    try { return localStorage.getItem(KEY) || "light"; } catch (e) { return "light"; }
  }
  function apply(t) {
    var theme = t === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem(KEY, theme); } catch (e) {}
    var btns = document.querySelectorAll("[data-theme-toggle], #themeToggle");
    for (var i = 0; i < btns.length; i++) {
      btns[i].textContent = theme === "dark" ? "☀️" : "🌙";
      btns[i].setAttribute("title", theme === "dark" ? "라이트 모드로" : "다크 모드로");
    }
  }
  function toggle() {
    apply(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
  }
  function ensureFloating() {
    if (document.getElementById("themeToggle") || document.querySelector("[data-theme-toggle]")) return;
    var b = document.createElement("button");
    b.id = "themeToggle";
    b.type = "button";
    b.setAttribute("aria-label", "테마 전환");
    b.style.cssText =
      "position:fixed;right:16px;bottom:16px;z-index:9999;width:44px;height:44px;border-radius:50%;" +
      "border:1px solid var(--border,#e5e8eb);background:var(--card,#fff);color:var(--text,#191f28);" +
      "font-size:18px;line-height:1;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.18);display:flex;" +
      "align-items:center;justify-content:center;";
    document.body.appendChild(b);
  }
  function bind() {
    var btns = document.querySelectorAll("[data-theme-toggle], #themeToggle");
    for (var i = 0; i < btns.length; i++) {
      if (btns[i].dataset.themeBound) continue;
      btns[i].dataset.themeBound = "1";
      btns[i].addEventListener("click", toggle);
    }
  }
  function start() {
    apply(get());
    ensureFloating();
    bind();
    apply(get()); // floating 생성 후 아이콘 반영
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
