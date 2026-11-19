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
// Optional: data-confirm-fields="fieldName:Label|otherField:Label" shows a summary of the form's values
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
        '<div class="modal-summary" hidden></div>' +
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

  function renderSummary(form) {
    const box = overlay.querySelector('.modal-summary');
    box.innerHTML = '';
    const spec = form.dataset.confirmFields;
    if (spec) {
      spec.split('|').forEach((pair) => {
        const [name, label] = pair.split(':');
        const el = form.elements[name];
        if (!el) return;

        let value = el.tagName === 'SELECT' ? el.options[el.selectedIndex].text : el.value.trim();
        if (el.type === 'date' && value) {
          value = new Date(value + 'T00:00:00').toLocaleDateString('en-US', {
            month: 'short', day: '2-digit', year: 'numeric',
          });
        }

        const row = document.createElement('div');
        row.className = 'modal-row';
        const left = document.createElement('span');
        left.textContent = label;
        const right = document.createElement('strong');
        right.textContent = value || '—';
        row.append(left, right);
        box.appendChild(row);
      });
    }
    box.hidden = box.children.length === 0;
  }

  function open(form) {
    if (!overlay) build();
    pendingForm = form;
    lastFocus = document.activeElement;

    const danger = form.dataset.confirmType === 'danger';
    overlay.querySelector('.modal-title').textContent = form.dataset.confirmTitle || 'Are you sure?';
    overlay.querySelector('.modal-message').textContent = form.dataset.confirm;
    renderSummary(form);

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


// Live search on the Borrow page
document.addEventListener('DOMContentLoaded', () => {
  const box = document.querySelector('[data-search]');
  if (!box) return;

  const cards = [...document.querySelectorAll('[data-search-item]')];
  const empty = document.getElementById('search-empty');
  const countEl = document.getElementById('result-count');

  box.addEventListener('input', () => {
    const q = box.value.trim().toLowerCase();
    let shown = 0;
    cards.forEach((card) => {
      const hit = !q || card.dataset.searchItem.includes(q);
      card.hidden = !hit;
      if (hit) shown += 1;
    });
    if (empty) empty.hidden = shown !== 0;
    if (countEl) countEl.textContent = shown;
  });
});

// Light / dark theme toggle (the choice is remembered in this browser)
document.addEventListener('click', (e) => {
  if (!e.target.closest('[data-theme-toggle]')) return;
  const root = document.documentElement;
  const wasLight = root.getAttribute('data-theme') === 'light';
  if (wasLight) root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', 'light');
  try { localStorage.setItem('theme', wasLight ? 'dark' : 'light'); } catch (err) { /* private mode */ }
});


// Thin loading bar while the next page loads
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href]');
  if (!a || a.target === '_blank' || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin) return;
  if (url.pathname === location.pathname && url.search === location.search) return;
  document.body.classList.add('is-loading');
});
document.addEventListener('submit', (e) => {
  if (!e.defaultPrevented) document.body.classList.add('is-loading');
});
window.addEventListener('pageshow', () => document.body.classList.remove('is-loading'));


// Theme buttons on the Settings page
document.addEventListener('DOMContentLoaded', () => {
  const buttons = document.querySelectorAll('[data-theme-set]');
  if (!buttons.length) return;
  const root = document.documentElement;

  const mark = () => {
    const light = root.getAttribute('data-theme') === 'light';
    buttons.forEach((b) => b.classList.toggle('on', (b.dataset.themeSet === 'light') === light));
  };

  buttons.forEach((b) => b.addEventListener('click', () => {
    const light = b.dataset.themeSet === 'light';
    if (light) root.setAttribute('data-theme', 'light');
    else root.removeAttribute('data-theme');
    try { localStorage.setItem('theme', light ? 'light' : 'dark'); } catch (err) { /* private mode */ }
    mark();
  }));

  new MutationObserver(mark).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  mark();
});