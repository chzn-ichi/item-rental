const CATEGORY_COLORS = {
  'Apparel':              { dark: '#C4B5FD', light: '#6D28D9' },
  'Electronics':          { dark: '#93C5FD', light: '#1D4ED8' },
  'Board and Card Games': { dark: '#6EE7B7', light: '#047857' },
  'Sports Equipment':     { dark: '#FCD34D', light: '#B45309' },
  'Others':               { dark: '#CBD5E1', light: '#475569' },
};

// Escapes text so user data can't inject HTML (replaces htmlspecialchars)
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function itemStatusBadge(status) {
  const map = {
    available: ['badge-available', 'Available'],
    rented: ['badge-rented', 'Rented'],
    maintenance: ['badge-maintenance', 'Under Maintenance'],
    damaged: ['badge-damaged', 'Damaged'],
  };
  const [cls, label] = map[status] || ['', esc(status)];
  return `<span class="badge ${cls}">${label}</span>`;
}

function rentalStatusBadge(status) {
  const map = {
    pending: ['badge-pending', 'Pending'],
    approved: ['badge-approved', 'Approved'],
    pending_return: ['badge-pending-return', 'Pending Return'],
    returned: ['badge-returned', 'Returned'],
  };
  const [cls, label] = map[status] || ['', esc(status)];
  return `<span class="badge ${cls}">${label}</span>`;
}

function categoryBadge(category) {
  const c = CATEGORY_COLORS[category] || CATEGORY_COLORS['Others'];
  return `<span class="badge cat" style="--c: ${c.dark}; --cl: ${c.light};">${esc(category)}</span>`;
}

function penaltyBadge(penalty) {
  if (penalty.waived) return '<span class="badge badge-returned">Waived</span>';
  if (penalty.paid) return '<span class="badge badge-approved">Paid</span>';
  return '<span class="badge badge-damaged">Unpaid</span>';
}

function formatDate(date) {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short', day: '2-digit', year: 'numeric',
  });
}

function formatMoney(amount) {
  return '₱' + Number(amount || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}

function daysOverdue(dueDate) {
  return Math.max(1, Math.ceil((Date.now() - new Date(dueDate)) / 86400000));
}


// YYYY-MM-DD in Philippine time (UTC+8), for <input type="date"> and range checks
function dateInputValue(date, plusDays = 0) {
  const d = new Date(new Date(date).getTime() + plusDays * 86400000 + 8 * 3600000);
  return d.toISOString().slice(0, 10);
}


module.exports = {
  esc, itemStatusBadge, rentalStatusBadge, categoryBadge,
  penaltyBadge, formatDate, formatMoney, daysOverdue, dateInputValue
};