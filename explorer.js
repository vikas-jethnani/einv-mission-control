/**
 * Mission Control Explorer — Core SPA Logic
 * Report loading, navigation, comparison, filtering, keyboard shortcuts
 */

(function () {
  'use strict';

  // ===== State =====
  const state = {
    reports: [],
    currentReport: null,
    currentMode: 'report',
    ragHistory: null,
    config: null,
    activeFilters: { red: true, amber: true, green: true, 'no-data': true },
  };

  // ===== DOM refs =====
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  // ===== Init =====
  async function init() {
    await loadManifest();
    await loadRagHistory();
    await loadConfig('config.json');
    setupModeTabs();
    setupFilters();
    setupKeyboard();
    setupConfigPicker();
    renderReportList();
    // Load latest report
    if (state.reports.length > 0) {
      selectReport(state.reports[0]);
    }
  }

  // ===== Data Loading =====

  async function loadManifest() {
    try {
      const res = await fetch('manifest.json');
      const data = await res.json();
      state.reports = data.reports || [];
    } catch (e) {
      console.error('Failed to load manifest:', e);
      state.reports = [];
    }
  }

  async function loadRagHistory() {
    try {
      const res = await fetch('data/rag-history.json');
      state.ragHistory = await res.json();
    } catch (e) {
      console.error('Failed to load RAG history:', e);
      state.ragHistory = null;
    }
  }

  async function loadConfig(path) {
    try {
      const res = await fetch(path);
      state.config = await res.json();
      updateTeamDisplay();
    } catch (e) {
      console.error('Failed to load config:', e);
    }
  }

  function updateTeamDisplay() {
    if (!state.config) return;
    $('#teamName').textContent = 'Mission Control Explorer';
    $('#teamType').textContent = state.config.team_name || '';
  }

  // ===== Report List =====

  function renderReportList() {
    const list = $('#reportList');
    list.innerHTML = '';

    state.reports.forEach((date, i) => {
      const item = document.createElement('div');
      item.className = 'report-item';
      item.dataset.date = date;

      const dot = document.createElement('span');
      dot.className = 'report-dot';

      const label = document.createElement('span');
      label.className = 'report-label';
      label.textContent = formatDate(date);

      item.appendChild(dot);
      item.appendChild(label);

      if (i === 0) {
        const badge = document.createElement('span');
        badge.className = 'report-badge';
        badge.textContent = 'LATEST';
        item.appendChild(badge);
      }

      item.addEventListener('click', () => selectReport(date));
      list.appendChild(item);
    });

    // Populate compare dropdowns
    populateCompareDropdowns();
  }

  function populateCompareDropdowns() {
    const selA = $('#compareA');
    const selB = $('#compareB');
    if (!selA || !selB) return;

    selA.innerHTML = '';
    selB.innerHTML = '';

    state.reports.forEach((date, i) => {
      const optA = new Option(formatDate(date), date);
      const optB = new Option(formatDate(date), date);
      selA.appendChild(optA);
      selB.appendChild(optB);
    });

    // Default: compare latest with second-latest
    if (state.reports.length >= 2) {
      selA.value = state.reports[1];
      selB.value = state.reports[0];
    }
  }

  // ===== Report Loading =====

  async function selectReport(date) {
    state.currentReport = date;
    highlightReportItem(date);

    if (state.currentMode === 'report') {
      await loadReport(date);
    }
  }

  async function loadReport(date) {
    const container = $('#reportContainer');
    container.innerHTML = '<div class="loading">Loading report...</div>';

    try {
      const res = await fetch(`reports/${date}.html`);
      const html = await res.text();

      // Extract body content from the HTML
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      // Get all body children
      const body = doc.body;

      // We need the report styles too — load them into our page if not already
      ensureReportStyles();

      container.innerHTML = '';
      // Clone all body children into our container
      Array.from(body.children).forEach((child) => {
        container.appendChild(document.adoptNode(child));
      });

      // Apply RAG filters
      applyFilters();
    } catch (e) {
      container.innerHTML = `<div class="loading">Failed to load report for ${date}</div>`;
      console.error('Failed to load report:', e);
    }
  }

  function ensureReportStyles() {
    if (document.getElementById('report-styles')) return;
    const link = document.createElement('link');
    link.id = 'report-styles';
    link.rel = 'stylesheet';
    link.href = 'reports/styles.css';
    document.head.appendChild(link);
  }

  function highlightReportItem(date) {
    $$('.report-item').forEach((item) => {
      item.classList.toggle('active', item.dataset.date === date);
    });
  }

  // ===== Mode Switching =====

  function setupModeTabs() {
    $$('.mode-tab').forEach((tab) => {
      tab.addEventListener('click', () => switchMode(tab.dataset.mode));
    });

    // Compare button
    const compareBtn = $('#compareBtn');
    if (compareBtn) {
      compareBtn.addEventListener('click', runComparison);
    }
  }

  function switchMode(mode) {
    state.currentMode = mode;

    // Update tab active states
    $$('.mode-tab').forEach((tab) => {
      tab.classList.toggle('active', tab.dataset.mode === mode);
    });

    // Show/hide view panels
    $$('.view-panel').forEach((panel) => panel.classList.remove('active'));
    const panelMap = {
      report: '#viewReport',
      trends: '#viewTrends',
      compare: '#viewCompare',
      insights: '#viewInsights',
    };
    const panel = $(panelMap[mode]);
    if (panel) panel.classList.add('active');

    // Show/hide compare controls
    const compareControls = $('#compareControls');
    if (compareControls) {
      compareControls.style.display = mode === 'compare' ? 'flex' : 'none';
    }

    // Trigger mode-specific actions
    if (mode === 'report' && state.currentReport) {
      loadReport(state.currentReport);
    } else if (mode === 'trends') {
      if (typeof window.renderTrends === 'function') {
        window.renderTrends(state.ragHistory);
      }
    } else if (mode === 'insights') {
      if (typeof window.renderInsights === 'function') {
        window.renderInsights(state.currentReport);
      }
    }
  }

  // ===== Filters =====

  function setupFilters() {
    $$('.filter-check input').forEach((checkbox) => {
      checkbox.addEventListener('change', () => {
        state.activeFilters[checkbox.dataset.rag] = checkbox.checked;
        applyFilters();
      });
    });
  }

  function applyFilters() {
    const container = $('#reportContainer');
    if (!container) return;

    // Filter country cards based on their RAG class
    container.querySelectorAll('.country-card').forEach((card) => {
      const classes = card.className;
      let rag = 'no-data';
      if (classes.includes('rag-red')) rag = 'red';
      else if (classes.includes('rag-amber')) rag = 'amber';
      else if (classes.includes('rag-green')) rag = 'green';
      else if (classes.includes('rag-none')) rag = 'no-data';

      card.style.display = state.activeFilters[rag] ? '' : 'none';
    });
  }

  // ===== Comparison =====

  async function runComparison() {
    const dateA = $('#compareA').value;
    const dateB = $('#compareB').value;

    if (!dateA || !dateB) return;

    // Load both reports into panes
    await Promise.all([
      loadReportIntoPane(dateA, '#comparePaneBodyA', '#comparePaneHeaderA'),
      loadReportIntoPane(dateB, '#comparePaneBodyB', '#comparePaneHeaderB'),
    ]);

    // Generate diff
    generateDiff(dateA, dateB);
  }

  async function loadReportIntoPane(date, bodySelector, headerSelector) {
    const body = $(bodySelector);
    const header = $(headerSelector);
    header.textContent = formatDate(date);
    body.innerHTML = '<div class="loading">Loading...</div>';

    try {
      const res = await fetch(`reports/${date}.html`);
      const html = await res.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      ensureReportStyles();
      body.innerHTML = '';
      Array.from(doc.body.children).forEach((child) => {
        body.appendChild(document.adoptNode(child));
      });
    } catch (e) {
      body.innerHTML = `<div class="loading">Failed to load ${date}</div>`;
    }
  }

  function generateDiff(dateA, dateB) {
    if (!state.ragHistory) return;

    const countries = state.ragHistory.countries;
    const diffs = [];
    let improved = 0, worsened = 0, unchanged = 0;

    const ragOrder = { 'red': 0, 'amber': 1, 'green': 2, 'no-data': -1 };

    for (const [country, data] of Object.entries(countries)) {
      const histA = data.history.find((h) => h.date === dateA);
      const histB = data.history.find((h) => h.date === dateB);

      if (!histA && !histB) continue;

      const ragA = histA ? (histA.overall || 'no-data') : 'no-data';
      const ragB = histB ? (histB.overall || 'no-data') : 'no-data';

      const orderA = ragOrder[ragA] ?? -1;
      const orderB = ragOrder[ragB] ?? -1;

      let change = 'unchanged';
      if (orderB > orderA) {
        change = 'improved';
        improved++;
      } else if (orderB < orderA) {
        change = 'worsened';
        worsened++;
      } else {
        unchanged++;
      }

      diffs.push({ country, ragA, ragB, change });
    }

    // Render summary
    const summary = $('#compareSummary');
    summary.innerHTML = `<span class="improved">${improved} improved</span> &middot; <span class="worsened">${worsened} worsened</span> &middot; <span class="unchanged">${unchanged} unchanged</span>`;

    // Render diff cards
    const diffContainer = $('#compareDiff');
    diffContainer.innerHTML = '';

    // Sort: worsened first, then improved, then unchanged
    const sortOrder = { worsened: 0, improved: 1, unchanged: 2 };
    diffs.sort((a, b) => (sortOrder[a.change] ?? 2) - (sortOrder[b.change] ?? 2));

    diffs.forEach((d) => {
      const card = document.createElement('div');
      card.className = `diff-card ${d.change}`;

      const arrowClass = d.change === 'improved' ? 'up' : d.change === 'worsened' ? 'down' : 'same';
      const arrowChar = d.change === 'improved' ? '\u2191' : d.change === 'worsened' ? '\u2193' : '\u2192';

      card.innerHTML = `
        <span class="diff-arrow ${arrowClass}">${arrowChar}</span>
        <span class="diff-country">${d.country}</span>
        <span class="diff-change">${capitalize(d.ragA)} \u2192 ${capitalize(d.ragB)}</span>
      `;
      diffContainer.appendChild(card);
    });
  }

  // ===== Keyboard Navigation =====

  function setupKeyboard() {
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;

      const idx = state.reports.indexOf(state.currentReport);

      if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        if (idx > 0) selectReport(state.reports[idx - 1]);
      } else if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        if (idx < state.reports.length - 1) selectReport(state.reports[idx + 1]);
      } else if (e.key === '1') {
        switchMode('report');
      } else if (e.key === '2') {
        switchMode('trends');
      } else if (e.key === '3') {
        switchMode('compare');
      } else if (e.key === '4') {
        switchMode('insights');
      }
    });
  }

  // ===== Config Switcher =====

  function setupConfigPicker() {
    const picker = $('#configPicker');
    if (!picker) return;

    picker.addEventListener('change', () => {
      loadConfig(picker.value);
    });
  }

  // ===== Utilities =====

  function formatDate(dateStr) {
    try {
      const d = new Date(dateStr + 'T00:00:00');
      return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch {
      return dateStr;
    }
  }

  function capitalize(s) {
    if (!s) return s;
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  // ===== Expose state for other modules =====
  window.explorerState = state;
  window.formatDate = formatDate;

  // ===== Boot =====
  document.addEventListener('DOMContentLoaded', init);
})();
