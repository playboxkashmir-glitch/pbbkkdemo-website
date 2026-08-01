// PlayBox Kashmir anonymous visit funnel tracking.
// Assigns each browser a random, non-identifying visitor id and reports
// page visits to the backend so we can compare how many unique visitors
// reach the booking flow versus how many complete a booking.
(function () {
  var ID_KEY = 'pbk_visitor_id';

  function getVisitorId() {
    try {
      var id = localStorage.getItem(ID_KEY);
      if (!id) {
        id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2));
                                                                           localStorage.setItem(ID_KEY, id);
                                                                           }
      return id;
                                                                           } catch (e) {
      return null;
                                                                           }
                                                                           }

                                                                           function reportVisit(flags) {
                                                                             var visitorId = getVisitorId();
                                                                             if (!visitorId) return;
                                                                             try {
                                                                               fetch('/api/settings?log=visit', {
        method: 'POST',
                                                                                 headers: { 'Content-Type': 'application/json' },
                                                                                 body: JSON.stringify({
          visitorId: visitorId,
                                                                                   reachedBooking: !!(flags && flags.reachedBooking),
                                                                                   completedBooking: !!(flags && flags.completedBooking)
                                                                                 })
                                                                               }).catch(function () {});
                                                                                 } catch (e) {}
                                                                                 }

                                                                                 var isBookingPage = /\/book\.html/i.test(location.pathname);
                                                                                 reportVisit({ reachedBooking: isBookingPage });

                                                                                 window.pbkTrackBookingComplete = function () {
                                                                                   reportVisit({ reachedBooking: true, completedBooking: true });
                                                                                 };
                                                                                   })();
