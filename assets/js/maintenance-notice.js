// PlayBox Kashmir maintenance/booking notice.
// This does NOT auto-show on every page load. It exposes a gate function
// that the booking flow calls right before payment is initiated, so the
// notice only appears at the final payment step (keeps the homepage and
// booking pages crawl-friendly for SEO) while still requiring I Accept
// before any booking payment can proceed.
(function () {
    var ACK_KEY = 'pbk_maintenance_ack';

 function alreadyAccepted() {
     try { return sessionStorage.getItem(ACK_KEY) === '1'; } catch (e) { return false; }
 }

 function markAccepted() {
     try { sessionStorage.setItem(ACK_KEY, '1'); } catch (e) {}
 }

 function buildModal(onAccept) {
     var overlay = document.createElement('div');
     overlay.id = 'pbk-maintenance-overlay';
     overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(15,23,42,0.75);display:flex;align-items:center;justify-content:center;padding:20px;font-family:Inter,Arial,sans-serif;';

    var box = document.createElement('div');
     box.style.cssText = 'background:#fff;max-width:480px;width:100%;border-radius:14px;padding:28px 26px;box-shadow:0 20px 60px rgba(0,0,0,0.35);';

    var title = document.createElement('h2');
     title.textContent = 'Important Notice Before You Pay';
     title.style.cssText = 'margin:0 0 12px;font-size:1.25rem;color:#111827;';

    var msg = document.createElement('p');
     msg.textContent = "PlayBox Kashmir's website is currently under construction and is not yet accepting bookings. The website is under maintenance, so please do not make any bookings right now. PlayBox Kashmir will not be liable for any accidental bookings made during this time.";
     msg.style.cssText = 'margin:0 0 20px;font-size:0.95rem;line-height:1.6;color:#374151;';

    var btn = document.createElement('button');
     btn.textContent = 'I Accept';
     btn.style.cssText = 'background:#15803d;color:#fff;border:none;padding:12px 22px;border-radius:8px;font-size:1rem;font-weight:600;cursor:pointer;width:100%;';

    btn.addEventListener('click', function () {
        markAccepted();
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        document.body.style.overflow = '';
        if (typeof onAccept === 'function') onAccept();
    });

    box.appendChild(title);
     box.appendChild(msg);
     box.appendChild(btn);
     overlay.appendChild(box);
     return overlay;
 }

 // Public gate: call this right before initiating payment.
 // Returns true if already accepted this session (caller proceeds immediately).
 // Returns false if the modal was just shown (caller must wait; onProceed is
 // invoked automatically once the visitor clicks I Accept.
 window.PBKEnsureMaintenanceAccepted = function (onProceed) {
     if (alreadyAccepted()) return true;
     var overlay = buildModal(onProceed);
     document.body.appendChild(overlay);
     document.body.style.overflow = 'hidden';
     return false;
 };
})();
