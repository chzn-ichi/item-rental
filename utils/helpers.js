const CATEGORY_COLORS = {
  'Apparel': '#8B5CF6',
  'Electronics': '#3B82F6',
  'Board and Card Games': '#10B981',
  'Sports Equipment': '#F59E0B',
  'Others': '#6B7280',
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
  const color = CATEGORY_COLORS[category] || '#6B7280';
  return `<span class="badge" style="background: ${color}20; color: ${color}; padding: 4px 8px;">${esc(category)}</span>`;
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

module.exports = {
  esc, itemStatusBadge, rentalStatusBadge, categoryBadge,
  penaltyBadge, formatDate, formatMoney, daysOverdue,
};