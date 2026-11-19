(function () {
  const weeklyCanvas = document.getElementById('chart-weekly');
  if (!weeklyCanvas) return; // not on the dashboard

  const statusCanvas = document.getElementById('chart-status');
  const statusEmpty = document.getElementById('status-empty');
  const topList = document.getElementById('top-list');
  const charts = [];
  let data = null;

  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  function showContent() {
    document.querySelectorAll('[data-skel]').forEach((el) => { el.hidden = true; });
    document.querySelectorAll('[data-chart-content]').forEach((el) => { el.hidden = false; });
  }

  function showError() {
    document.querySelectorAll('[data-skel]').forEach((el) => { el.hidden = true; });
    document.getElementById('charts-error').hidden = false;
  }

  function drawTopList() {
    topList.textContent = '';
    if (data.top.length === 0) {
      const li = document.createElement('li');
      li.className = 'muted';
      li.textContent = 'No rentals yet.';
      topList.appendChild(li);
      return;
    }
    const max = Math.max(...data.top.map((t) => t.count));
    data.top.forEach((t) => {
      const li = document.createElement('li');

      const row = document.createElement('div');
      row.className = 'rank-row';
      const name = document.createElement('span');
      name.className = 'rank-name';
      name.textContent = t.name;
      const count = document.createElement('span');
      count.className = 'rank-count';
      count.textContent = t.count + (t.count === 1 ? ' rental' : ' rentals');
      row.append(name, count);

      const track = document.createElement('div');
      track.className = 'rank-track';
      const fill = document.createElement('div');
      fill.className = 'rank-fill';
      fill.style.width = Math.round((t.count / max) * 100) + '%';
      track.appendChild(fill);

      li.append(row, track);
      topList.appendChild(li);
    });
  }

  function draw() {
    charts.forEach((c) => c.destroy());
    charts.length = 0;

    Chart.defaults.font.family = "'Figtree', 'Segoe UI', system-ui, sans-serif";
    Chart.defaults.color = css('--muted');
    const grid = css('--line');

    charts.push(new Chart(weeklyCanvas, {
      type: 'bar',
      data: {
        labels: data.weeks.map((w) => w.label),
        datasets: [{
          label: 'Requests',
          data: data.weeks.map((w) => w.count),
          backgroundColor: '#3B82F6',
          borderRadius: 8,
          maxBarThickness: 34,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, border: { display: false } },
          y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: grid }, border: { display: false } },
        },
      },
    }));

    const s = data.statuses;
    const total = s.available + s.rented + s.maintenance + s.damaged;
    statusCanvas.hidden = total === 0;
    statusEmpty.hidden = total !== 0;

    if (total > 0) {
      charts.push(new Chart(statusCanvas, {
        type: 'doughnut',
        data: {
          labels: ['Available', 'Rented', 'Under maintenance', 'Damaged'],
          datasets: [{
            data: [s.available, s.rented, s.maintenance, s.damaged],
            backgroundColor: ['#34D399', '#3B82F6', '#FB923C', '#F87171'],
            borderWidth: 0,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '68%',
          plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8 } } },
        },
      }));
    }

    drawTopList();
  }

  fetch('/admin/api/stats', { headers: { Accept: 'application/json' }, credentials: 'same-origin' })
    .then((r) => {
      if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) throw new Error('bad response');
      return r.json();
    })
    .then((d) => {
      data = d;
      showContent();
      draw();
    })
    .catch(showError);

  // Redraw with the right colors when the theme is switched
  new MutationObserver(() => { if (data) draw(); })
    .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
})();