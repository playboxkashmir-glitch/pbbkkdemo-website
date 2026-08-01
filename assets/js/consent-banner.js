// PlayBox Kashmir cookie consent banner.
// Shows a closable bar at the bottom of the page describing our use of
// cookies and similar technologies. Visitors can Accept All or Customise
// their preferences by category, including rejecting everything but the
// strictly necessary cookies. The choice is remembered so the banner will
// not reappear, and only the approved categories are ever used.
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

  function sendChoice(choice, prefs) {
    try {
      fetch('/api/settings?log=consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          choice: choice,
          analytics: !!(prefs && prefs.analytics),
          personalization: !!(prefs && prefs.personalization),
          page: location.pathname
        })
      }).catch(function () {});
    } catch (e) {}
  }

  function makeButton(label, bg, color) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.style.cssText = 'background:' + bg + ';color:' + color + ';border:none;padding:10px 18px;border-radius:8px;font-size:0.85rem;font-weight:600;cursor:pointer;white-space:nowrap;font-family:inherit;';
    return btn;
  }

  function buildBanner() {
    var bar = document.createElement('div');
    bar.id = 'pbk-consent-banner';
    bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:99998;background:#111827;color:#e5e7eb;padding:16px 20px;display:flex;gap:16px;flex-wrap:wrap;align-items:center;justify-content:space-between;box-shadow:0 -2px 12px rgba(0,0,0,0.35);font-family:inherit;';

    var text = document.createElement('div');
    text.style.cssText = 'flex:1 1 320px;font-size:0.85rem;line-height:1.5;';
    text.textContent = 'We use cookies and similar technologies to run our website, keep it secure, understand how it is used, and improve your experience. You can accept all cookies or customise your preferences.';

    var link = document.createElement('a');
    link.href = 'privacy.html';
    link.textContent = ' Learn more.';
    link.style.cssText = 'color:#93c5fd;text-decoration:underline;margin-left:4px;';
    text.appendChild(link);


    var btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;';

    var customiseBtn = makeButton('Customise', '#374151', '#fff');
    var acceptAllBtn = makeButton('Accept All', '#15803d', '#fff');
    var closeBtn = makeButton(String.fromCharCode(10005), 'transparent', '#9ca3af');
    closeBtn.style.padding = '10px 12px';
    closeBtn.setAttribute('aria-label', 'Close');

    function removeBar() {
      if (bar.parentNode) bar.parentNode.removeChild(bar);
    }

    function finalize(choice, prefs) {
      setCookie(COOKIE_NAME, choice, 365);
      sendChoice(choice, prefs);
      removeBar();
    }


    acceptAllBtn.addEventListener('click', function () {
      finalize('all', { analytics: true, personalization: true });
    });

    closeBtn.addEventListener('click', function () {
      removeBar();
    });

    customiseBtn.addEventListener('click', function () {
      removeBar();
      document.body.appendChild(buildPanel(finalize));
    });


    btnRow.appendChild(customiseBtn);
    btnRow.appendChild(acceptAllBtn);
    btnRow.appendChild(closeBtn);

    bar.appendChild(text);
    bar.appendChild(btnRow);
    return bar;
  }

  function buildToggleRow(title, description, checked, locked) {
    var row = document.createElement('div');
    row.style.cssText = 'display:flex;justify-content:space-between;align-items:flex-start;gap:16px;padding:14px 0;border-bottom:1px solid #374151;';

    var col = document.createElement('div');
    col.style.cssText = 'flex:1 1 auto;';
    var h = document.createElement('div');
    h.textContent = title;
    h.style.cssText = 'font-weight:600;font-size:0.9rem;margin-bottom:4px;';
    var p = document.createElement('div');
    p.textContent = description;
    p.style.cssText = 'font-size:0.8rem;color:#9ca3af;line-height:1.4;';
    col.appendChild(h);
    col.appendChild(p);

    var toggleWrap = document.createElement('label');
    toggleWrap.style.cssText = 'position:relative;display:inline-block;width:42px;height:24px;flex:0 0 auto;';
    var input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.disabled = !!locked;
    input.style.cssText = 'opacity:0;width:0;height:0;';
    var slider = document.createElement('span');
    slider.style.cssText = 'position:absolute;inset:0;background:' + (checked ? '#15803d' : '#4b5563') + ';border-radius:999px;transition:0.2s;cursor:' + (locked ? 'not-allowed' : 'pointer') + ';opacity:' + (locked ? '0.6' : '1') + ';';
    var knob = document.createElement('span');
    knob.style.cssText = 'position:absolute;top:3px;left:' + (checked ? '21px' : '3px') + ';width:18px;height:18px;background:#fff;border-radius:50%;transition:0.2s;';
    slider.appendChild(knob);

    input.addEventListener('change', function () {
      slider.style.background = input.checked ? '#15803d' : '#4b5563';
      knob.style.left = input.checked ? '21px' : '3px';
    });
    toggleWrap.appendChild(input);
    toggleWrap.appendChild(slider);

    row.appendChild(col);
    row.appendChild(toggleWrap);
    row._input = input;
    return row;
  }

  function buildPanel(finalize) {
    var overlay = document.createElement('div');
    overlay.id = 'pbk-consent-panel-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;padding:20px;';

    var panel = document.createElement('div');
    panel.style.cssText = 'background:#111827;color:#e5e7eb;max-width:480px;width:100%;border-radius:12px;padding:24px;box-shadow:0 10px 40px rgba(0,0,0,0.5);font-family:inherit;max-height:90vh;overflow:auto;';

    var h = document.createElement('h3');
    h.textContent = 'Cookie Preferences';
    h.style.cssText = 'margin:0 0 8px;font-size:1.1rem;';

    var p = document.createElement('p');
    p.textContent = 'Choose which categories of cookies and similar technologies you are comfortable with. You can update this choice at any time from our privacy page.';
    p.style.cssText = 'margin:0 0 12px;font-size:0.85rem;color:#9ca3af;line-height:1.5;';

    var necessaryRow = buildToggleRow('Necessary', 'Required for core site features such as browsing and completing bookings. Always active.', true, true);
    var analyticsRow = buildToggleRow('Analytics', 'Helps us understand how visitors use our site so we can improve it.', true, false);
    var personalizationRow = buildToggleRow('Personalisation', 'Lets us tailor offers, content, and future membership benefits to you.', true, false);

    var actions = document.createElement('div');
    actions.style.cssText = 'display:flex;justify-content:flex-end;gap:10px;margin-top:20px;flex-wrap:wrap;';

    var rejectBtn = makeButton('Reject All', 'transparent', '#9ca3af');
    rejectBtn.style.border = '1px solid #4b5563';
    var saveBtn = makeButton('Save Preferences', '#15803d', '#fff');

    rejectBtn.addEventListener('click', function () {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      finalize('none', { analytics: false, personalization: false });
    });


    saveBtn.addEventListener('click', function () {
      var prefs = {
        analytics: analyticsRow._input.checked,
        personalization: personalizationRow._input.checked
      };
      var choice = (prefs.analytics && prefs.personalization) ? 'all' : ((!prefs.analytics && !prefs.personalization) ? 'none' : 'custom');
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      finalize(choice, prefs);
    });


    actions.appendChild(rejectBtn);
    actions.appendChild(saveBtn);

    panel.appendChild(h);
    panel.appendChild(p);
    panel.appendChild(necessaryRow);
    panel.appendChild(analyticsRow);
    panel.appendChild(personalizationRow);
    panel.appendChild(actions);
    overlay.appendChild(panel);


    overlay.addEventListener('click', function (e) {
      if (e.target === overlay && overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }
    });

    return overlay;
  }

  function init() {
    if (getCookie(COOKIE_NAME)) return;
    document.body.appendChild(buildBanner());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
