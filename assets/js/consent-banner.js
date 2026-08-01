// PlayBox Kashmir consent banner.
// Shows a closable bar at the bottom of the page describing what data we
// collect and lets the visitor choose Accept All, Mandatory Only, or
// Decline All. The choice is remembered in a cookie so the banner will not
// reappear, and only data matching the chosen tier is ever sent to the backend.
(function () {
  var COOKIE_NAME = 'pbk_consent';

 function getCookie(name) {
   var match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
   return match ? decodeURIComponent(match[1]) : null;
 }

 function setCookie(name, value, days) {
   var expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toUTCString();
   document.cookie = name + '=' + encodeURIComponent(value) + '; expires=' + expires + '; path=/; SameSite=Lax';
 }
  function sendChoice(choice) {
    try {
      fetch('/api/settings?log=consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ choice: choice, page: location.pathname })
      }).catch(function () {});
    } catch (e) {}
  }

 function buildBanner() {
   var bar = document.createElement('div');
   bar.id = 'pbk-consent-banner';
   bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:99998;background:#111827;color:#e5e7eb;padding:16px 20px;font-family:Inter,Arial,sans-serif;box-shadow:0 -4px 20px rgba(0,0,0,0.3);display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;';

  var text = document.createElement('div');
   text.style.cssText = 'flex:1 1 320px;font-size:0.85rem;line-height:1.5;';
   text.textContent = "We use cookies and similar data, like your IP address and visit activity, to keep the site running smoothly, understand how it is used, and in the future help tailor services and membership plans. Choose what you are comfortable sharing.";

  var btnRow = document.createElement('div');
   btnRow.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;';

  function makeButton(label, bg, color) {
    var b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'background:' + bg + ';color:' + color + ';border:none;padding:10px 16px;border-radius:8px;font-size:0.85rem;font-weight:600;cursor:pointer;white-space:nowrap;';
    return b;
  }

  var acceptAllBtn = makeButton('Accept All', '#15803d', '#fff');
   var mandatoryBtn = makeButton('Mandatory Only', '#374151', '#fff');
   var declineBtn = makeButton('Decline All', 'transparent', '#9ca3af');
   declineBtn.style.border = '1px solid #4b5563';
   var closeBtn = makeButton(String.fromCharCode(10005), 'transparent', '#9ca3af');
   closeBtn.style.padding = '10px 12px';
   closeBtn.setAttribute('aria-label', 'Close');

  function choose(choice) {
    setCookie(COOKIE_NAME, choice, 365);
    sendChoice(choice);
    if (bar.parentNode) bar.parentNode.removeChild(bar);
  }

  acceptAllBtn.addEventListener('click', function () { choose('all'); });
   mandatoryBtn.addEventListener('click', function () { choose('mandatory'); });
   declineBtn.addEventListener('click', function () { choose('none'); });
   closeBtn.addEventListener('click', function () { choose('none'); });

  btnRow.appendChild(acceptAllBtn);
   btnRow.appendChild(mandatoryBtn);
   btnRow.appendChild(declineBtn);
   btnRow.appendChild(closeBtn);

  bar.appendChild(text);
   bar.appendChild(btnRow);
   return bar;
 }

 function init() {
   if (getCookie(COOKIE_NAME)) return;
   var bar = buildBanner();
   document.body.appendChild(bar);
 }

 if (document.readyState === 'loading') {
   document.addEventListener('DOMContentLoaded', init);
 } else {
   init();
 }
})();
