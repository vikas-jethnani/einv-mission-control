/**
 * Mission Control Explorer — RAG Trend Charts
 * Heatmap, sparklines, timeline chart, stats
 */

(function () {
  'use strict';

  const RAG_COLORS = {
    red: '#E53E3E',
    amber: '#D69E2E',
    green: '#38A169',
    'no-data': '#E2E8F0',
  };

  const RAG_ORDER = { 'no-data': 0, red: 1, amber: 2, green: 3 };

  let timelineChart = null;

  // Main countries to track (skip pipeline-only countries)
  const TRACKED_COUNTRIES = [
    'India', 'Malaysia', 'KSA', 'Belgium', 'Croatia',
    'Poland', 'UAE', 'Germany', 'France', 'Singapore',
  ];

  window.renderTrends = function (ragHistory) {
    if (!ragHistory) return;

    renderHeatmap(ragHistory);
    renderTimeline(ragHistory);
    renderSparklines(ragHistory);
    renderStats(ragHistory);
  };

  // ===== Heatmap =====

  function renderHeatmap(data) {
    const container = document.getElementById('heatmapContainer');
    if (!container) return;

    const reports = data.reports;
    const countries = data.countries;

    let html = '<table class="heatmap-table"><thead><tr><th>Country</th>';
    reports.forEach((date) => {
      const d = new Date(date + 'T00:00:00');
      html += `<th>${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</th>`;
    });
    html += '</tr></thead><tbody>';

    TRACKED_COUNTRIES.forEach((name) => {
      const country = countries[name];
      if (!country) return;

      html += `<tr><td>${name}</td>`;
      reports.forEach((date) => {
        const entry = country.history.find((h) => h.date === date);
        const rag = entry ? (entry.overall || 'no-data') : 'no-data';
        html += `<td><span class="heatmap-cell ${rag}" title="${name}: ${rag} (${date})"></span></td>`;
      });
      html += '</tr>';
    });

    html += '</tbody></table>';
    container.innerHTML = html;
  }

  // ===== Timeline Chart =====

  function renderTimeline(data) {
    const canvas = document.getElementById('ragTimeline');
    if (!canvas) return;

    // Destroy existing chart
    if (timelineChart) {
      timelineChart.destroy();
      timelineChart = null;
    }

    const reports = data.reports;
    const labels = reports.map((d) => {
      const dt = new Date(d + 'T00:00:00');
      return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    });

    // Count RAG statuses per report date
    const redCounts = [];
    const amberCounts = [];
    const greenCounts = [];
    const noDataCounts = [];

    reports.forEach((date) => {
      let r = 0, a = 0, g = 0, nd = 0;
      TRACKED_COUNTRIES.forEach((name) => {
        const country = data.countries[name];
        if (!country) { nd++; return; }
        const entry = country.history.find((h) => h.date === date);
        const rag = entry ? (entry.overall || 'no-data') : 'no-data';
        if (rag === 'red') r++;
        else if (rag === 'amber') a++;
        else if (rag === 'green') g++;
        else nd++;
      });
      redCounts.push(r);
      amberCounts.push(a);
      greenCounts.push(g);
      noDataCounts.push(nd);
    });

    timelineChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Red',
            data: redCounts,
            backgroundColor: RAG_COLORS.red,
            borderRadius: 3,
          },
          {
            label: 'Amber',
            data: amberCounts,
            backgroundColor: RAG_COLORS.amber,
            borderRadius: 3,
          },
          {
            label: 'Green',
            data: greenCounts,
            backgroundColor: RAG_COLORS.green,
            borderRadius: 3,
          },
          {
            label: 'No Data',
            data: noDataCounts,
            backgroundColor: RAG_COLORS['no-data'],
            borderRadius: 3,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              usePointStyle: true,
              pointStyle: 'circle',
              padding: 16,
              font: { family: "'Inter', sans-serif", size: 11 },
            },
          },
        },
        scales: {
          x: {
            stacked: true,
            grid: { display: false },
            ticks: { font: { family: "'JetBrains Mono', monospace", size: 10 } },
          },
          y: {
            stacked: true,
            beginAtZero: true,
            max: TRACKED_COUNTRIES.length,
            ticks: {
              stepSize: 1,
              font: { family: "'JetBrains Mono', monospace", size: 10 },
            },
            grid: { color: '#E2E8F0' },
          },
        },
      },
    });
  }

  // ===== Sparklines =====

  function renderSparklines(data) {
    const grid = document.getElementById('sparklinesGrid');
    if (!grid) return;

    grid.innerHTML = '';

    TRACKED_COUNTRIES.forEach((name) => {
      const country = data.countries[name];
      if (!country) return;

      const item = document.createElement('div');
      item.className = 'sparkline-item';

      const label = document.createElement('span');
      label.className = 'sparkline-label';
      label.textContent = name;

      const chartContainer = document.createElement('div');
      chartContainer.className = 'sparkline-chart';
      const canvas = document.createElement('canvas');
      canvas.height = 30;
      chartContainer.appendChild(canvas);

      // Current status badge
      const history = country.history;
      const latest = history.length > 0 ? history[history.length - 1] : null;
      const currentRag = latest ? (latest.overall || 'no-data') : 'no-data';

      const badge = document.createElement('span');
      badge.className = `sparkline-current ${currentRag}`;
      badge.textContent = currentRag === 'no-data' ? 'N/A' : currentRag.toUpperCase();

      item.appendChild(label);
      item.appendChild(chartContainer);
      item.appendChild(badge);
      grid.appendChild(item);

      // Render mini sparkline
      const values = data.reports.map((date) => {
        const entry = history.find((h) => h.date === date);
        const rag = entry ? (entry.overall || 'no-data') : 'no-data';
        return RAG_ORDER[rag] ?? 0;
      });

      const colors = data.reports.map((date) => {
        const entry = history.find((h) => h.date === date);
        const rag = entry ? (entry.overall || 'no-data') : 'no-data';
        return RAG_COLORS[rag] || RAG_COLORS['no-data'];
      });

      new Chart(canvas, {
        type: 'line',
        data: {
          labels: data.reports,
          datasets: [{
            data: values,
            borderColor: colors[colors.length - 1],
            borderWidth: 2,
            pointBackgroundColor: colors,
            pointBorderColor: colors,
            pointRadius: 3,
            pointHoverRadius: 5,
            fill: false,
            tension: 0.3,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { enabled: false } },
          scales: {
            x: { display: false },
            y: { display: false, min: -0.5, max: 3.5 },
          },
        },
      });
    });
  }

  // ===== Stats =====

  function renderStats(data) {
    const container = document.getElementById('statsContainer');
    if (!container) return;

    const stats = [];

    TRACKED_COUNTRIES.forEach((name) => {
      const country = data.countries[name];
      if (!country || country.history.length < 2) return;

      const history = country.history;
      const latest = history[history.length - 1];
      const previous = history[history.length - 2];
      const latestRag = latest.overall || 'no-data';
      const previousRag = previous.overall || 'no-data';

      // Check for improvements
      if (RAG_ORDER[latestRag] > RAG_ORDER[previousRag]) {
        stats.push({
          type: 'positive',
          icon: '\u2191',
          text: `<strong>${name}</strong> improved from ${capitalize(previousRag)} to ${capitalize(latestRag)}`,
        });
      }

      // Check for deterioration
      if (RAG_ORDER[latestRag] < RAG_ORDER[previousRag]) {
        stats.push({
          type: 'negative',
          icon: '\u2193',
          text: `<strong>${name}</strong> worsened from ${capitalize(previousRag)} to ${capitalize(latestRag)}`,
        });
      }

      // Check for consecutive same status
      const consecutive = countConsecutive(history);
      if (consecutive.count >= 3 && latestRag !== 'no-data') {
        const severity = latestRag === 'red' ? 'negative' : latestRag === 'amber' ? 'warning' : 'positive';
        stats.push({
          type: severity,
          icon: latestRag === 'green' ? '\u2713' : '\u26A0',
          text: `<strong>${name}</strong> has been ${capitalize(latestRag)} for ${consecutive.count} consecutive reports`,
        });
      }
    });

    // Overall stats
    const latestDate = data.reports[data.reports.length - 1];
    let totalRed = 0, totalAmber = 0, totalGreen = 0;
    TRACKED_COUNTRIES.forEach((name) => {
      const country = data.countries[name];
      if (!country) return;
      const entry = country.history.find((h) => h.date === latestDate);
      const rag = entry ? (entry.overall || 'no-data') : 'no-data';
      if (rag === 'red') totalRed++;
      else if (rag === 'amber') totalAmber++;
      else if (rag === 'green') totalGreen++;
    });

    if (totalRed === 0) {
      stats.unshift({
        type: 'positive',
        icon: '\u2713',
        text: `<strong>No Red countries</strong> in the latest report`,
      });
    }

    container.innerHTML = '';
    if (stats.length === 0) {
      container.innerHTML = '<div class="stat-item neutral"><span class="stat-icon">i</span><span class="stat-text">Not enough data points to detect patterns yet</span></div>';
      return;
    }

    stats.forEach((s) => {
      const item = document.createElement('div');
      item.className = `stat-item ${s.type}`;
      item.innerHTML = `<span class="stat-icon">${s.icon}</span><span class="stat-text">${s.text}</span>`;
      container.appendChild(item);
    });
  }

  function countConsecutive(history) {
    if (history.length === 0) return { count: 0, rag: 'no-data' };
    const latestRag = history[history.length - 1].overall || 'no-data';
    let count = 0;
    for (let i = history.length - 1; i >= 0; i--) {
      const rag = history[i].overall || 'no-data';
      if (rag === latestRag) count++;
      else break;
    }
    return { count, rag: latestRag };
  }

  function capitalize(s) {
    if (!s) return s;
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
})();
