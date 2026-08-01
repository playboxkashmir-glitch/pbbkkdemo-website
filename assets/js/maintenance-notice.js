(function () {
    var ACK_KEY = 'pbk_maintenance_ack';

   function injectStyles() {
         if (document.getElementById('pbkMaintenanceStyles')) return;
         var style = document.createElement('style');
         style.id = 'pbkMaintenanceStyles';
         style.textContent =
                 '#pbkMaintenanceOverlay{position:fixed;inset:0;width:100%;height:100%;' +
                 'background:rgba(10,20,15,0.82);z-index:2147483647;display:flex;' +
                 'align-items:center;justify-content:center;padding:20px;' +
                 'font-family:"Inter",Helvetica,Arial,sans-serif;}' +
                 '.pbk-maintenance-modal{background:#fff;max-width:460px;width:100%;' +
                 'border-radius:14px;padding:32px 28px;text-align:center;' +
                 'box-shadow:0 25px 70px rgba(0,0,0,0.35);}' +
                 '.pbk-maintenance-icon{font-size:38px;margin-bottom:10px;}' +
                 '.pbk-maintenance-modal h2{margin:0 0 14px;color:#15803d;font-size:21px;}' +
                 '.pbk-maintenance-modal p{color:#374151;font-size:14.5px;line-height:1.6;' +
                 'margin:0 0 12px;text-align:left;}' +
                 '.pbk-maintenance-modal p strong{color:#111827;}' +
                 '#pbkMaintenanceAccept{margin-top:12px;background:#15803d;color:#fff;' +
                 'border:none;padding:12px 34px;border-radius:8px;font-size:15px;' +
                 'font-weight:600;cursor:pointer;}' +
                 '#pbkMaintenanceAccept:hover{background:#116830;}';
         document.head.appendChild(style);
   }

   function showNotice() {
         if (document.getElementById('pbkMaintenanceOverlay')) return;
         injectStyles();

      var overlay = document.createElement('div');
         overlay.id = 'pbkMaintenanceOverlay';
         overlay.innerHTML =
                 '<div class="pbk-maintenance-modal" role="dialog" aria-modal="true" aria-labelledby="pbkMaintenanceTitle">' +
                   '<div class="pbk-maintenance-icon">&#9888;&#65039;</div>' +
                   '<h2 id="pbkMaintenanceTitle">Website Under Maintenance</h2>' +
                   '<p>We are currently <strong>under construction</strong> and are <strong>not accepting any bookings</strong> at this time.</p>' +
                   '<p>The website is under maintenance, so please do not make any bookings right now.</p>' +
                   '<p>PlayBox Kashmir&trade; will <strong>not be liable for any accidental bookings</strong> made during this period.</p>' +
                   '<button id="pbkMaintenanceAccept">I Accept</button>' +
                 '</div>';

      document.body.appendChild(overlay);
         document.documentElement.style.overflow = 'hidden';

      document.getElementById('pbkMaintenanceAccept').addEventListener('click', function () {
              try { sessionStorage.setItem(ACK_KEY, '1'); } catch (e) {}
              overlay.parentNode.removeChild(overlay);
              document.documentElement.style.overflow = '';
      });
   }

   function init() {
         var acknowledged = false;
         try { acknowledged = sessionStorage.getItem(ACK_KEY) === '1'; } catch (e) {}
         if (!acknowledged) showNotice();
   }

   if (document.readyState === 'loading') {
         document.addEventListener('DOMContentLoaded', init);
   } else {
         init();
   }
})();
