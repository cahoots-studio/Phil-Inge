// Footer message form (Netlify Forms).
// - The message field shows a short prompt at rest and the full example message once
//   it opens (hover or focus); it goes back when the field is left empty.
// - Sends in place and shows a thank-you, instead of leaving the page.
(function () {
  var form = document.querySelector('.contact-form');
  if (!form) return;

  var message = form.querySelector('.ghost-field--message');
  if (message) {
    var rest = message.getAttribute('placeholder');
    var open = message.getAttribute('data-placeholder-open') || rest;
    var update = function () {
      var isOpen = message.matches(':hover') || document.activeElement === message;
      message.setAttribute('placeholder', isOpen ? open : rest);
    };
    ['mouseenter', 'mouseleave', 'focus', 'blur'].forEach(function (type) {
      message.addEventListener(type, update);
    });
  }

  form.addEventListener('submit', function (e) {
    if (!window.fetch) return; // plain POST still works
    e.preventDefault();
    var send = form.querySelector('[type="submit"]');
    if (send) send.disabled = true;
    fetch('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(new FormData(form)).toString(),
    }).then(function (res) {
      if (!res.ok) throw new Error(res.status);
      form.innerHTML = '<p class="contact-form__status" role="status">Thanks — your message is on its way. I’ll get back to you soon.</p>';
    }).catch(function () {
      if (send) send.disabled = false;
      var note = form.querySelector('.contact-form__status') || document.createElement('p');
      note.className = 'contact-form__status';
      note.setAttribute('role', 'alert');
      note.textContent = 'That didn’t send — please try again, or email via www.cahoots.studio.';
      form.appendChild(note);
    });
  });
})();
