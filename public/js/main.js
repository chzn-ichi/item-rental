document.addEventListener('DOMContentLoaded', () => {
  // Mobile menu
  const toggle = document.querySelector('.nav-toggle');
  const menu = document.getElementById('topbar-menu');
  if (toggle && menu) {
    toggle.addEventListener('click', () => {
      const open = menu.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  // Clickable table rows (student dashboard)
  document.querySelectorAll('.clickable-row').forEach((row) => {
    row.addEventListener('click', () => {
      window.location.href = row.dataset.href;
    });
  });
});

// Show/hide password button (used on the login pages)
function togglePassword(btn) {
  const input = btn.parentElement.querySelector('input');
  const showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  btn.classList.toggle('visible', !showing);
  btn.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
}

// Confirmation modal for any <form data-confirm="...">
(function () {
  let overlay = null;
  let pendingForm = null;
  let lastFocus = null;

  function build() {
    overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.hidden = true;
    overlay.innerHTML =
      '<div class="modal" role="alertdialog" aria-modal="true" aria-labelledby="modal-title" aria-describedby="modal-message">' +
        '<h2 class="modal-title" id="modal-title"></h2>' +
        '<p class="modal-message" id="modal-message"></p>' +
        '<div class="modal-actions">' +
          '<button type="button" class="btn" data-modal-cancel>Cancel</button>' +
          '<button type="button" class="btn" data-modal-confirm></button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('[data-modal-cancel]').addEventListener('click', close);
    overlay.querySelector('[data-modal-confirm]').addEventListener('click', () => {
      const form = pendingForm;
      close();
      if (form) form.submit();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !overlay.hidden) close();
    });
  }

  function open(form) {
    if (!overlay) build();
    pendingForm = form;
    lastFocus = document.activeElement;

    const danger = form.dataset.confirmType === 'danger';
    overlay.querySelector('.modal-title').textContent = form.dataset.confirmTitle || 'Are you sure?';
    overlay.querySelector('.modal-message').textContent = form.dataset.confirm;

    const confirmBtn = overlay.querySelector('[data-modal-confirm]');
    confirmBtn.textContent = form.dataset.confirmLabel || 'Confirm';
    confirmBtn.className = 'btn ' + (danger ? 'btn-danger' : 'btn-primary');

    overlay.hidden = false;
    document.body.style.overflow = 'hidden';
    overlay.querySelector('[data-modal-cancel]').focus();
  }

  function close() {
    if (!overlay) return;
    overlay.hidden = true;
    pendingForm = null;
    document.body.style.overflow = '';
    if (lastFocus) lastFocus.focus();
  }

  document.addEventListener('submit', (e) => {
    const form = e.target;
    if (form.dataset && form.dataset.confirm) {
      e.preventDefault();
      open(form);
    }
  });
})();


// Login / Register switch on the auth page
function showForm(form) {
  const login = document.getElementById('login-form');
  const register = document.getElementById('register-form');
  if (!login || !register) return;
  login.style.display = form === 'login' ? 'block' : 'none';
  register.style.display = form === 'register' ? 'block' : 'none';
  document.querySelectorAll('.toggle-btn').forEach((b, i) => {
    b.classList.toggle('active', (i === 0) === (form === 'login'));
  });
}

// Toast messages fade out on their own, or on click
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.toast').forEach((toast) => {
    const dismiss = () => {
      toast.classList.add('hide');
      setTimeout(() => toast.remove(), 350);
    };
    setTimeout(dismiss, 4500);
    toast.addEventListener('click', dismiss);
  });
});