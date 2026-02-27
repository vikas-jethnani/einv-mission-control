/**
 * Mission Control — Core Explorer Logic
 * Interactive country cards, RAG filtering, deep dive panel
 */

(function () {
  'use strict';

  const FLAGS = {
    India: '\u{1F1EE}\u{1F1F3}', Malaysia: '\u{1F1F2}\u{1F1FE}', KSA: '\u{1F1F8}\u{1F1E6}',
    Belgium: '\u{1F1E7}\u{1F1EA}', Croatia: '\u{1F1ED}\u{1F1F7}', Poland: '\u{1F1F5}\u{1F1F1}',
    UAE: '\u{1F1E6}\u{1F1EA}', Germany: '\u{1F1E9}\u{1F1EA}', France: '\u{1F1EB}\u{1F1F7}',
    Singapore: '\u{1F1F8}\u{1F1EC}', Egypt: '\u{1F1EA}\u{1F1EC}', Jordan: '\u{1F1EF}\u{1F1F4}',
  };

  const LAUNCH_STATUS = {
    India: 'GA', Malaysia: 'GA', KSA: 'GA',
    Belgium: 'EA', Croatia: 'EA', Poland: 'EA',
    UAE: 'DEV', Germany: 'DEV', France: 'DEV', Singapore: 'DEV',
  };

  const LAUNCH_GROUPS = [
    { key: 'GA',  label: 'Generally Available', desc: 'Live · GA' },
    { key: 'EA',  label: 'Early Access',         desc: 'Live · EA' },
    { key: 'DEV', label: 'In Development',       desc: 'Pre-launch' },
  ];

  const TRACKED = [
    'India', 'Malaysia', 'KSA', 'Belgium', 'Croatia',
    'Poland', 'UAE', 'Germany', 'France', 'Singapore',
  ];

  const RAG_ORDER = { 'no-data': 0, red: 1, amber: 2, green: 3 };
  const RAG_SORT = { red: 0, amber: 1, green: 2, 'no-data': 3 };

  // Customer ARR (USD thousands) — Source: salesforce_crm_v2.account via Athena, 27 Feb 2026
  // FX rates: EUR×1.08, INR×0.012, SAR×0.267, MYR×0.22
  // Persistent copy: data/customer-arr.json
  const CUSTOMER_ARR = {
    // Belgium
    'Delvaux': 17,             // EUR 15,500
    'Shaw Inc': 0,             // Not in Salesforce
    'Ascott (M-flie)': 41,    // EUR 37,560
    'Havas Media': 12,         // EUR 11,000
    'CPP Corp / CPPB': 13,    // EUR 12,200
    'G2V': 17,                 // EUR 15,650 (sum_of_arr_assets)
    'SGK': 17,                 // MYR 76,000 (Propelis/SGK)
    'UKG': 13,                 // INR 1,100,000
    'HID Global': 46,          // INR 3,800,000
    // Germany
    'Fried Frank': 7,          // EUR 6,500
    'K&S': 0,                  // Not in Salesforce
    'Adidas': 17,              // EUR 16,000 (Adidas Belgium entity)
    // KSA
    'Savvy Games': 50,         // SAR 187,500
    'Qiddiya': 350,            // SAR 1,310,625
    'IKK Group / Aramco PDF': 189, // USD 188,500
    // Malaysia
    'Vanity Group': 12,        // MYR 55,000
    'Media Prima': 168,        // MYR 762,000
    'Peikko': 6,               // MYR 25,000
    'HotelKey': 14,            // INR 1,153,846
    // India / internal (not customer ARR)
    'IRN Cancellation (NIC)': 0, 'Retool Audit Tool': 0, 'GSTN NIC Issues': 0, 'Ewaybill settings': 0,
  };

  function formatARR(k) {
    const v = CUSTOMER_ARR[k];
    if (v === undefined || v === 0) return null;
    return v >= 1000 ? `$${(v / 1000).toFixed(1)}M` : `$${v}K`;
  }

  // ===== State =====
  const state = {
    reports: [],
    currentReport: null,
    currentMode: 'overview',
    ragHistory: null,
    config: null,
    activeFilter: 'all',
    selectedCountry: null,
    insights: null,
    ticketData: null,
    volumeDays: 7,
  };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  // ===== Init =====
  async function init() {
    await Promise.all([
      loadManifest(),
      loadRagHistory(),
      loadConfig('config.json'),
      loadTicketData(),
    ]);
    setupModeTabs();
    setupKeyboard();
    setupConfigPicker();
    setupReportNav();
    startClock();

    if (state.reports.length > 0) {
      selectReport(state.reports[0]);
    }
    updateStatus();
  }

  // ===== Data Loading =====

  async function loadManifest() {
    try {
      const res = await fetch('manifest.json');
      const data = await res.json();
      state.reports = data.reports || [];
    } catch (e) {
      console.error('Failed to load manifest:', e);
    }
  }

  async function loadRagHistory() {
    try {
      const res = await fetch('data/rag-history.json');
      state.ragHistory = await res.json();
    } catch (e) {
      console.error('Failed to load RAG history:', e);
    }
  }

  async function loadConfig(path) {
    try {
      const res = await fetch(path);
      state.config = await res.json();
      const el = $('#teamType');
      if (el && state.config) el.textContent = (state.config.team_name || '').toUpperCase();
    } catch (e) {
      console.error('Failed to load config:', e);
    }
  }

  async function loadInsights(date) {
    try {
      const res = await fetch(`data/insights/${date}.json`);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  async function loadTicketData() {
    try {
      const res = await fetch('data/customer-tickets.json');
      state.ticketData = await res.json();
    } catch (e) {
      console.error('Failed to load ticket data:', e);
    }
  }

  // Lookup ticket data for a customer in a country
  // Normalizes names: "Ascott" → "Ascott (M-flie)", "CPP Corp" → "CPP Corp / CPPB" etc.
  function getTickets(country, custName) {
    if (!state.ticketData || !state.ticketData[country]) return null;
    const countryData = state.ticketData[country];
    // Direct match
    if (countryData[custName]) return countryData[custName];
    // Fuzzy match: try startsWith or contains
    const lc = custName.toLowerCase();
    for (const [key, val] of Object.entries(countryData)) {
      if (key === '_all_clients' || key === '_meta') continue;
      if (key.toLowerCase().startsWith(lc.split(' ')[0].split('(')[0])) return val;
    }
    return null;
  }

  function renderTicketRow(t) {
    const statusCls = t.s === 'done' ? 'tk-done' : t.s === 'qa' ? 'tk-qa' : 'tk-open';
    const statusLabel = t.s === 'done' ? 'PROD' : t.s === 'qa' ? 'QA' : 'DEV';
    const priBadge = t.p ? `<span class="tk-pri tk-${t.p.toLowerCase()}">${t.p}</span>` : `<span class="tk-pri"></span>`;
    const jiraTag = t.id
      ? `<a class="tk-jira" href="https://cleartaxtech.atlassian.net/browse/${t.id}" target="_blank" onclick="event.stopPropagation()">${t.id}</a>`
      : `<span class="tk-jira tk-noid">\u2014</span>`;
    const etaTag = t.eta
      ? `<span class="tk-eta tk-eta-set">${t.eta}</span>`
      : `<span class="tk-eta tk-noeta">N/A</span>`;
    return `<div class="tk-row ${statusCls}">
      <span class="tk-status">${statusLabel}</span>
      ${priBadge}
      ${jiraTag}
      <span class="tk-desc">${t.d}</span>
      ${etaTag}
    </div>`;
  }

  // ===== Report Selection =====

  async function selectReport(date) {
    state.currentReport = date;
    $('#currentDate').textContent = formatDateShort(date);
    updateStatus();

    // Load insights for this date
    state.insights = await loadInsights(date);

    if (state.currentMode === 'overview') {
      renderOverview();
    } else if (state.currentMode === 'volume') {
      if (typeof window.renderVolume === 'function') window.renderVolume(state.volumeDays || 7);
    }
  }

  // ===== Overview Rendering =====

  function renderOverview() {
    if (!state.ragHistory || !state.currentReport) return;

    const data = state.ragHistory;
    const date = state.currentReport;

    // Count RAGs
    let red = 0, amber = 0, green = 0, nodata = 0;
    TRACKED.forEach((name) => {
      const country = data.countries[name];
      if (!country) { nodata++; return; }
      const entry = country.history.find((h) => h.date === date);
      const rag = entry ? (entry.overall || 'no-data') : 'no-data';
      if (rag === 'red') red++;
      else if (rag === 'amber') amber++;
      else if (rag === 'green') green++;
      else nodata++;
    });

    // Report meta
    const reportIdx = data.reports.indexOf(date);
    $('#reportMeta').textContent = `REPORT ${reportIdx + 1} OF ${data.reports.length} \u00B7 ${formatDateShort(date)}`;

    // Render sub-components
    renderFilters(red, amber, green, nodata);
    renderExecBrief();
    renderCountryCards();

    // Auto-select first EA country on initial load; reopen on subsequent renders
    if (state.selectedCountry) {
      openDeepDive(state.selectedCountry);
    } else {
      const firstEA = LAUNCH_GROUPS.find(g => g.key === 'EA') &&
        Object.keys(LAUNCH_STATUS).find(n => LAUNCH_STATUS[n] === 'EA' && TRACKED.includes(n));
      if (firstEA) openDeepDive(firstEA);
    }
  }

  // ===== Filter Buttons =====

  function renderFilters(red, amber, green, nodata) {
    const container = $('#ragFilters');
    if (!container) return;

    const total = red + amber + green + nodata;
    const filters = [
      { rag: 'all', count: total, label: 'ALL', cls: 'rf-all' },
      { rag: 'red', count: red, label: 'RED', cls: 'rf-red' },
      { rag: 'amber', count: amber, label: 'AMBER', cls: 'rf-amber' },
      { rag: 'green', count: green, label: 'GREEN', cls: 'rf-green' },
      { rag: 'no-data', count: nodata, label: 'N/A', cls: 'rf-nodata' },
    ];

    container.innerHTML = filters.map((f) => {
      const active = state.activeFilter === f.rag ? 'active' : '';
      return `<button class="rag-filter ${f.cls} ${active}" data-rag="${f.rag}">
        <span class="filter-count">${f.count}</span>
        <span class="filter-label">${f.label}</span>
      </button>`;
    }).join('');

    container.querySelectorAll('.rag-filter').forEach((btn) => {
      btn.addEventListener('click', () => toggleFilter(btn.dataset.rag));
    });
  }

  function toggleFilter(rag) {
    // Clicking active filter resets to 'all', clicking 'all' also resets
    if (state.activeFilter === rag || rag === 'all') {
      state.activeFilter = 'all';
    } else {
      state.activeFilter = rag;
    }

    // Update button states
    $$('.rag-filter').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.rag === state.activeFilter);
    });

    // Filter cards
    $$('.country-card').forEach((card) => {
      if (state.activeFilter === 'all') {
        card.classList.remove('filtered-out');
      } else {
        card.classList.toggle('filtered-out', card.dataset.rag !== state.activeFilter);
      }
    });
  }

  // ===== Executive Brief =====

  function renderExecBrief() {
    const el = $('#execBrief');
    if (!el) return;

    if (state.insights && state.insights.executive_summary) {
      el.textContent = state.insights.executive_summary;
    } else {
      // Auto-generate a brief summary
      el.textContent = generateExecBrief();
    }
  }

  function generateExecBrief() {
    if (!state.ragHistory || !state.currentReport) return '';

    const data = state.ragHistory;
    const date = state.currentReport;
    const dateIndex = data.reports.indexOf(date);
    const prevDate = dateIndex > 0 ? data.reports[dateIndex - 1] : null;

    let red = 0, amber = 0, green = 0;
    const improvements = [];
    const deteriorations = [];

    TRACKED.forEach((name) => {
      const country = data.countries[name];
      if (!country) return;
      const entry = country.history.find((h) => h.date === date);
      const rag = entry ? (entry.overall || 'no-data') : 'no-data';
      if (rag === 'red') red++;
      else if (rag === 'amber') amber++;
      else if (rag === 'green') green++;

      if (prevDate) {
        const prev = country.history.find((h) => h.date === prevDate);
        const prevRag = prev ? (prev.overall || 'no-data') : 'no-data';
        if (RAG_ORDER[rag] > RAG_ORDER[prevRag]) improvements.push(name);
        else if (RAG_ORDER[rag] < RAG_ORDER[prevRag]) deteriorations.push(name);
      }
    });

    const parts = [];
    parts.push(`${TRACKED.length} countries tracked.`);
    if (red > 0) parts.push(`${red} Red.`);
    parts.push(`${amber} Amber, ${green} Green.`);
    if (red === 0) parts.push('No Red countries \u2014 positive signal.');
    if (improvements.length > 0) parts.push(`Improved: ${improvements.join(', ')}.`);
    if (deteriorations.length > 0) parts.push(`Worsened: ${deteriorations.join(', ')}.`);
    return parts.join(' ');
  }

  // ===== Country Cards =====

  function renderCountryCards() {
    const grid = $('#countryGrid');
    if (!grid) return;

    const data = state.ragHistory;
    const date = state.currentReport;
    const dateIndex = data.reports.indexOf(date);
    const prevDate = dateIndex > 0 ? data.reports[dateIndex - 1] : null;

    // Group by launch tier, sort within each group by RAG severity
    const byTier = {};
    LAUNCH_GROUPS.forEach(g => { byTier[g.key] = []; });
    TRACKED.forEach(name => {
      const tier = LAUNCH_STATUS[name] || 'DEV';
      byTier[tier].push(name);
    });
    LAUNCH_GROUPS.forEach(g => {
      byTier[g.key].sort((a, b) => {
        const ragA = getCountryRag(a, data, date);
        const ragB = getCountryRag(b, data, date);
        return (RAG_SORT[ragA] ?? 3) - (RAG_SORT[ragB] ?? 3);
      });
    });

    const buildCard = (name) => {
      const country = data.countries[name];
      const entry = country ? country.history.find((h) => h.date === date) : null;
      const rag = entry ? (entry.overall || 'no-data') : 'no-data';
      const ragClass = rag === 'no-data' ? 'rag-nodata' : `rag-${rag}`;
      const flag = FLAGS[name] || '';
      const ragText = rag === 'no-data' ? 'NO DATA' : rag.toUpperCase();

      // Movement
      let moveHtml = '';
      let prevRag = null;
      if (prevDate && country) {
        const prev = country.history.find((h) => h.date === prevDate);
        prevRag = prev ? (prev.overall || 'no-data') : 'no-data';
        if (RAG_ORDER[rag] > RAG_ORDER[prevRag]) {
          moveHtml = '<span class="card-move up">\u2191</span>';
        } else if (RAG_ORDER[rag] < RAG_ORDER[prevRag]) {
          moveHtml = '<span class="card-move down">\u2193</span>';
        }
      }

      // Streak
      const streak = countStreak(country, rag);

      // Dimensions (C→P→E→D)
      const dims = ['compliance', 'product', 'engineering', 'delivery'];
      const dimLabels = ['C', 'P', 'E', 'D'];
      const dimsHtml = dims.map((dim, i) => {
        const val = entry ? (entry[dim] || 'no-data') : 'no-data';
        const cls = val === 'no-data' ? 'd-nodata' : `d-${val}`;
        const arrow = i < dims.length - 1 ? '<span class="card-dim-arrow">\u25B8</span>' : '';
        return `<span class="card-dim ${cls}" title="${cap(dim)}: ${cap(val)}">${dimLabels[i]}</span>${arrow}`;
      }).join('');

      // Customer summary for card
      const customers = entry ? (entry.customers || []) : [];
      const custRed = customers.filter((c) => c.status === 'red').length;
      const custAmber = customers.filter((c) => c.status === 'amber').length;
      let custHtml = '';
      if (customers.length > 0) {
        const parts = [];
        if (custRed > 0) parts.push(`<span class="cust-red">${custRed} Red</span>`);
        if (custAmber > 0) parts.push(`<span class="cust-amber">${custAmber} Amber</span>`);
        custHtml = `<div class="card-customers">${parts.join(' \u00B7 ')}</div>`;
      }

      // Brief
      const brief = buildCardBrief(name, entry, rag, prevRag, streak);

      // Selected + filter state
      const selectedClass = state.selectedCountry === name ? 'selected' : '';
      const filteredClass = state.activeFilter !== 'all' && state.activeFilter !== rag ? 'filtered-out' : '';

      const launchKey = LAUNCH_STATUS[name] || 'DEV';
      const launchBadge = `<span class="card-launch card-launch-${launchKey.toLowerCase()}">${launchKey}</span>`;

      return `<div class="country-card ${ragClass} ${selectedClass} ${filteredClass}"
                   data-country="${name}" data-rag="${rag}">
        <div class="card-top">
          <span class="card-flag">${flag}</span>
          ${moveHtml}
        </div>
        <div class="card-name-row">
          <span class="card-name">${name.toUpperCase()}</span>
          ${launchBadge}
        </div>
        <div class="card-rag">${ragText}</div>
        <div class="card-dims">${dimsHtml}</div>
        ${custHtml}
        <div class="card-brief">${brief}</div>
      </div>`;
    };

    // Render grouped sections
    grid.innerHTML = LAUNCH_GROUPS.map(g => {
      const cards = byTier[g.key];
      if (!cards.length) return '';
      const cardHtml = cards.map(buildCard).join('');
      return `<div class="country-group">
        <div class="country-group-header">
          <span class="cg-label">${g.label}</span>
          <span class="cg-desc">${g.desc}</span>
          <span class="cg-count">${cards.length}</span>
        </div>
        <div class="country-group-grid">${cardHtml}</div>
      </div>`;
    }).join('');

    // Click handlers
    grid.querySelectorAll('.country-card').forEach((card) => {
      card.addEventListener('click', () => {
        const country = card.dataset.country;
        if (state.selectedCountry === country) {
          closeDeepDive();
        } else {
          openDeepDive(country);
        }
      });
    });
  }

  function getCountryRag(name, data, date) {
    const country = data.countries[name];
    if (!country) return 'no-data';
    const entry = country.history.find((h) => h.date === date);
    return entry ? (entry.overall || 'no-data') : 'no-data';
  }

  function countStreak(country, rag) {
    if (!country || !country.history) return 0;
    let count = 0;
    for (let i = country.history.length - 1; i >= 0; i--) {
      if ((country.history[i].overall || 'no-data') === rag) count++;
      else break;
    }
    return count;
  }

  function buildCardBrief(name, entry, rag, prevRag, streak) {
    if (rag === 'no-data') return 'Awaiting data';

    const parts = [];

    // Dimension analysis for non-green
    if ((rag === 'red' || rag === 'amber') && entry) {
      const dimMap = { compliance: 'Compliance', product: 'Product', engineering: 'Eng', delivery: 'Delivery' };
      const blocked = [];
      for (const [key, label] of Object.entries(dimMap)) {
        const val = entry[key] || 'no-data';
        if (val === 'red' || val === 'amber') blocked.push(label);
      }
      if (blocked.length > 0 && blocked.length < 4) {
        parts.push(blocked.join(', ') + ' needs work');
      } else if (blocked.length === 4) {
        parts.push('All dimensions need attention');
      }
    }

    // Movement
    if (prevRag) {
      if (RAG_ORDER[rag] > RAG_ORDER[prevRag]) {
        parts.push(`Improved from ${cap(prevRag)}`);
      } else if (RAG_ORDER[rag] < RAG_ORDER[prevRag]) {
        parts.push(`Dropped from ${cap(prevRag)}`);
      }
    }

    // Streak
    if (streak >= 3) {
      parts.push(`${streak}\u00D7 consecutive`);
    }

    // Default for green
    if (parts.length === 0 && rag === 'green') {
      return 'All dimensions healthy';
    }

    return parts.length > 0 ? parts.slice(0, 2).join('. ') : 'Status under review';
  }

  // ===== Deep Dive =====

  function openDeepDive(name) {
    state.selectedCountry = name;

    // Highlight selected card
    $$('.country-card').forEach((c) => c.classList.toggle('selected', c.dataset.country === name));

    const deepDive = $('#deepDive');
    deepDive.classList.add('active');
    renderDeepDive(name);

    // Scroll to deep dive
    setTimeout(() => {
      deepDive.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 50);
  }

  function closeDeepDive() {
    state.selectedCountry = null;
    $$('.country-card').forEach((c) => c.classList.remove('selected'));
    const deepDive = $('#deepDive');
    deepDive.classList.remove('active');
    deepDive.innerHTML = '';
  }

  function renderDeepDive(name) {
    const deepDive = $('#deepDive');
    const data = state.ragHistory;
    const date = state.currentReport;
    const country = data.countries[name];
    const entry = country ? country.history.find((h) => h.date === date) : null;
    const rag = entry ? (entry.overall || 'no-data') : 'no-data';
    const ragClass = rag === 'no-data' ? 'rag-nodata' : `rag-${rag}`;
    const ragText = rag === 'no-data' ? 'NO DATA' : rag.toUpperCase();
    const flag = FLAGS[name] || '';
    const streak = countStreak(country, rag);

    // Dimensions (C→P→E→D)
    const dims = [
      { key: 'compliance', label: 'Compliance' },
      { key: 'product', label: 'Product' },
      { key: 'engineering', label: 'Engineering' },
      { key: 'delivery', label: 'Delivery' },
    ];

    const dimsHtml = dims.map((d, i) => {
      const val = entry ? (entry[d.key] || 'no-data') : 'no-data';
      const cls = val === 'no-data' ? 'rag-nodata' : `rag-${val}`;
      const text = val === 'no-data' ? 'N/A' : val.toUpperCase();
      const arrow = i < dims.length - 1 ? '<div class="dd-dim-arrow">\u25BE</div>' : '';
      return `<div class="dd-dim-row">
        <span class="dd-dim-label">${d.label}</span>
        <span class="dd-dim-badge ${cls}">${text}</span>
      </div>${arrow}`;
    }).join('');

    // Customers — enhanced with ticket-level data
    const customers = entry ? (entry.customers || []) : [];
    let customersHtml = '';
    if (customers.length > 0) {
      // First pass: compute derived status for each customer
      const custObjects = customers.map((c, idx) => {
        const arr = formatARR(c.name);
        const tix = getTickets(name, c.name);
        const activeBugs = tix ? tix.tickets.filter(t => t.t !== 'feat' && t.s !== 'done') : [];
        const bugsQa = activeBugs.filter(t => t.s === 'qa').length;

        let derivedStatus;
        if (!tix) {
          derivedStatus = c.status || 'green';
        } else if (activeBugs.length === 0) {
          derivedStatus = 'green';
        } else if (activeBugs.some(t => t.p === 'P0' && t.s !== 'qa')) {
          derivedStatus = 'red';
        } else {
          derivedStatus = 'amber';
        }

        return { c, idx, arr, tix, activeBugs, bugsQa, derivedStatus };
      });

      // Sort: red first, then amber, then green
      const statusOrder = { red: 0, amber: 1, green: 2 };
      custObjects.sort((a, b) => statusOrder[a.derivedStatus] - statusOrder[b.derivedStatus]);

      let derivedRed = 0, derivedAmber = 0;
      let greenSectionAdded = false;

      const custRows = custObjects.map(({ c, idx, arr, tix, activeBugs, bugsQa, derivedStatus }) => {
        if (derivedStatus === 'red') derivedRed++;
        else if (derivedStatus === 'amber') derivedAmber++;

        const arrHtml = arr ? `<span class="dd-cust-arr">${arr}</span>` : '';
        const statusCls = derivedStatus === 'red' ? 'cst-red' : derivedStatus === 'amber' ? 'cst-amber' : 'cst-green';
        const statusText = derivedStatus.toUpperCase();

        // Badge: active bug count + QA count
        let ticketBadge = '';
        if (activeBugs.length > 0) {
          const parts = [`${activeBugs.length} bug${activeBugs.length > 1 ? 's' : ''}`];
          if (bugsQa > 0) parts.push(`${bugsQa} in QA`);
          ticketBadge = `<span class="tk-count">${parts.join(' \u00B7 ')}</span>`;
        }

        // 1-line summary from active bugs
        let summary;
        if (activeBugs.length > 0) {
          const themes = activeBugs.slice(0, 3).map(t => t.d.split(/[,.]/)[0].trim());
          const more = activeBugs.length > 3 ? ` +${activeBugs.length - 3} more` : '';
          summary = themes.join(', ') + more;
        } else if (tix) {
          summary = 'No active bugs';
        } else {
          const issueText = c.issues || '';
          const countMatch = issueText.match(/^(\d+)\s+active\s+issues?:\s*/i);
          if (countMatch) {
            const items = issueText.slice(countMatch[0].length).split(',').map(s => s.trim()).filter(Boolean);
            summary = items.slice(0, 3).join(', ') + (items.length > 3 ? ` +${items.length - 3} more` : '');
          } else {
            summary = issueText.length > 90 ? issueText.slice(0, 90).replace(/\s+\S*$/, '') + '\u2026' : issueText;
          }
        }

        // Expanded detail: active bugs only
        let detailHtml;
        if (tix) {
          const header = `<div class="tk-header-row"><span class="tk-h">STAGE</span><span class="tk-h">PRI</span><span class="tk-h">JIRA</span><span class="tk-h tk-h-desc">ISSUE</span><span class="tk-h">ETA</span></div>`;
          detailHtml = activeBugs.length > 0
            ? `<div class="tk-list">${header}${activeBugs.map(renderTicketRow).join('')}</div>`
            : '<div class="dd-cust-detail-text">No active bugs.</div>';
        } else {
          detailHtml = `<div class="dd-cust-detail-text">${c.issues || ''}</div>`;
        }

        // Insert green section divider before first green customer
        let divider = '';
        if (derivedStatus === 'green' && !greenSectionAdded) {
          greenSectionAdded = true;
          divider = `<div class="cust-green-divider"><span class="cust-green-label">Recently Turned Green</span></div>`;
        }

        return `${divider}<div class="dd-cust-block ${statusCls}" data-cust-idx="${idx}">
          <div class="dd-cust-header">
            <span class="dd-cust-status">${statusText}</span>
            <span class="dd-cust-name">${c.name}</span>
            ${arrHtml}
            ${ticketBadge}
            <span class="dd-cust-expand">\u25B8</span>
          </div>
          <div class="dd-cust-summary">${summary}</div>
          <div class="dd-cust-detail">${detailHtml}</div>
        </div>`;
      }).join('');

      const custRed = derivedRed;
      const custAmber = derivedAmber;
      const custSummary = [];
      if (custRed > 0) custSummary.push(`<span class="cust-red">${custRed} Red</span>`);
      if (custAmber > 0) custSummary.push(`<span class="cust-amber">${custAmber} Amber</span>`);
      customersHtml = `<div class="dd-section">
        <div class="dd-section-title">CUSTOMERS <span class="dd-cust-count">${custSummary.join(' \u00B7 ')}</span></div>
        <div class="dd-cust-list">${custRows}</div>
      </div>`;
    }

    // History
    const historyHtml = [...data.reports].reverse().map((d) => {
      const h = country ? country.history.find((e) => e.date === d) : null;
      const r = h ? (h.overall || 'no-data') : 'no-data';
      const cls = r === 'no-data' ? 'no-data' : r;
      const dateStr = formatDateCompact(d);
      const isActive = d === date;
      return `<div class="dd-history-row ${isActive ? 'active' : ''}">
        <span class="dd-date">${dateStr}</span>
        <span class="dd-dot ${cls}"></span>
        <span class="dd-rag-text">${cap(r)}</span>
      </div>`;
    }).join('');

    // AI Intel
    const intelHtml = buildCountryIntel(name, rag, streak, country);

    deepDive.innerHTML = `
      <div class="dd-header">
        <div class="dd-title">
          <span class="dd-flag">${flag}</span>
          <span class="dd-name">${name.toUpperCase()}</span>
          <span class="dd-badge ${ragClass}">${ragText}</span>
          ${streak >= 2 ? `<span class="dd-streak">${streak} CONSECUTIVE</span>` : ''}
        </div>
        <button class="dd-close" id="ddClose">&times;</button>
      </div>
      <div class="dd-body">
        <div class="dd-col dd-details">
          ${customersHtml}
          <div class="dd-section">
            <div class="dd-section-title">HISTORY</div>
            <div class="dd-history">${historyHtml}</div>
          </div>
        </div>
        <div class="dd-col dd-intel-col">
          <div class="dd-section">
            <div class="dd-section-title">COUNTRY OUTLOOK</div>
            <div class="dd-intel-items">${intelHtml}</div>
          </div>
          <div class="dd-section">
            <div class="dd-section-title">DIMENSIONS</div>
            <div class="dd-dim-grid">${dimsHtml}</div>
          </div>
        </div>
      </div>
    `;

    // Close handler
    $('#ddClose').addEventListener('click', (e) => {
      e.stopPropagation();
      closeDeepDive();
    });

    // Customer expand/collapse handlers — entire block is clickable
    deepDive.querySelectorAll('.dd-cust-block').forEach((block) => {
      block.addEventListener('click', (e) => {
        e.stopPropagation();
        block.classList.toggle('expanded');
      });
    });

    // Auto-expand first red customer, or first amber if no red
    const autoExpand = deepDive.querySelector('.dd-cust-block.cst-red') || deepDive.querySelector('.dd-cust-block.cst-amber');
    if (autoExpand) autoExpand.classList.add('expanded');
  }

  function buildCountryIntel(name, rag, streak, country) {
    const items = [];

    // Pull from loaded insights
    if (state.insights) {
      // Trends
      const trends = (state.insights.trends || []).filter((t) => t.country === name);
      trends.forEach((t) => {
        items.push({ text: t.insight, severity: t.severity || 'neutral', label: 'TREND' });
      });

      // Predictions
      const preds = (state.insights.predictions || []).filter((p) => p.country === name);
      preds.forEach((p) => {
        const sev = p.confidence === 'high' ? 'warning' : 'neutral';
        items.push({ text: `${p.prediction}`, severity: sev, label: `PREDICTION \u00B7 ${(p.confidence || '').toUpperCase()}` });
      });

      // Activities (what teams are doing)
      const acts = (state.insights.activities || []).filter((a) => a.country === name);
      acts.forEach((a) => {
        (a.items || []).forEach((item) => {
          items.push({ text: item, severity: 'neutral', label: 'ACTIVITY' });
        });
      });

      // Risk watch (string match)
      (state.insights.risk_watch || []).forEach((r) => {
        if (r.toLowerCase().includes(name.toLowerCase())) {
          items.push({ text: r, severity: 'negative', label: 'RISK' });
        }
      });

    }

    // Fallback: auto-generate from data
    if (items.length === 0) {
      items.push(...generateCountryIntel(name, rag, streak, country));
    }

    if (items.length === 0) {
      return '<div class="dd-intel-item neutral"><span class="dd-intel-label">STATUS</span>No specific intelligence available for this country.</div>';
    }

    return items.map((item) => {
      return `<div class="dd-intel-item ${item.severity}">
        ${item.label ? `<span class="dd-intel-label">${item.label}</span>` : ''}
        ${item.text}
      </div>`;
    }).join('');
  }

  function generateCountryIntel(name, rag, streak, country) {
    const items = [];
    const data = state.ragHistory;
    const date = state.currentReport;
    const dateIndex = data.reports.indexOf(date);
    const prevDate = dateIndex > 0 ? data.reports[dateIndex - 1] : null;

    // Movement analysis
    if (prevDate && country) {
      const prev = country.history.find((h) => h.date === prevDate);
      const prevRag = prev ? (prev.overall || 'no-data') : 'no-data';
      if (RAG_ORDER[rag] > RAG_ORDER[prevRag]) {
        items.push({ text: `Improved from ${cap(prevRag)} to ${cap(rag)}. Positive momentum.`, severity: 'positive', label: 'MOVEMENT' });
      } else if (RAG_ORDER[rag] < RAG_ORDER[prevRag]) {
        items.push({ text: `Worsened from ${cap(prevRag)} to ${cap(rag)}. Investigate what changed.`, severity: 'negative', label: 'MOVEMENT' });
      }
    }

    // Streak analysis — factual only, no coaching
    if (streak >= 3 && rag === 'amber') {
      items.push({ text: `Amber for ${streak} consecutive reports.`, severity: 'warning', label: 'PATTERN' });
    } else if (streak >= 2 && rag === 'red') {
      items.push({ text: `Red for ${streak} consecutive reports.`, severity: 'negative', label: 'PATTERN' });
    } else if (streak >= 3 && rag === 'green') {
      items.push({ text: `Green for ${streak} consecutive reports.`, severity: 'positive', label: 'PATTERN' });
    }

    // Status summary
    if (rag === 'green' && items.length === 0) {
      items.push({ text: 'All dimensions are healthy. No active blockers or concerns.', severity: 'positive', label: 'STATUS' });
    } else if (rag === 'amber' && items.length === 0) {
      items.push({ text: 'Currently Amber. Monitor for improvement or regression in upcoming reports.', severity: 'warning', label: 'STATUS' });
    } else if (rag === 'red' && items.length === 0) {
      items.push({ text: 'Currently Red. Needs immediate attention and escalation.', severity: 'negative', label: 'STATUS' });
    } else if (rag === 'no-data') {
      items.push({ text: 'No data available for analysis.', severity: 'neutral', label: 'STATUS' });
    }

    return items;
  }

  // ===== Mode Switching =====

  function setupModeTabs() {
    $$('.mode-tab').forEach((tab) => {
      tab.addEventListener('click', () => switchMode(tab.dataset.mode));
    });
  }

  function switchMode(mode) {
    state.currentMode = mode;

    $$('.mode-tab').forEach((tab) => {
      tab.classList.toggle('active', tab.dataset.mode === mode);
    });

    $$('.view-panel').forEach((p) => p.classList.remove('active'));
    const panelMap = {
      overview: '#viewOverview',
      volume: '#viewVolume',
    };
    const panel = $(panelMap[mode]);
    if (panel) panel.classList.add('active');

    if (mode === 'overview') {
      renderOverview();
    } else if (mode === 'volume') {
      if (typeof window.renderVolume === 'function') {
        window.renderVolume(state.volumeDays || 7);
      }
    }
  }

  // ===== Report Navigation =====

  function setupReportNav() {
    $('#prevReport').addEventListener('click', () => navigateReport(-1));
    $('#nextReport').addEventListener('click', () => navigateReport(1));
  }

  function navigateReport(direction) {
    const idx = state.reports.indexOf(state.currentReport);
    const newIdx = idx + direction;
    if (newIdx >= 0 && newIdx < state.reports.length) {
      selectReport(state.reports[newIdx]);
    }
  }

  // ===== Keyboard =====

  function setupKeyboard() {
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        navigateReport(1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        navigateReport(-1);
      } else if (e.key === '1') {
        switchMode('overview');
      } else if (e.key === '2') {
        switchMode('volume');
      } else if (e.key === 'Escape') {
        closeDeepDive();
      }
    });
  }

  // ===== Config Switcher =====

  function setupConfigPicker() {
    const picker = $('#configPicker');
    if (!picker) return;
    picker.addEventListener('change', () => loadConfig(picker.value));
  }

  // ===== Clock =====

  function startClock() {
    function tick() {
      const now = new Date();
      const el = $('#clock');
      if (el) {
        el.textContent = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      }
    }
    tick();
    setInterval(tick, 1000);
  }

  function updateStatus() {
    const el = $('#statusInfo');
    if (!el) return;
    const idx = state.reports.indexOf(state.currentReport);
    if (idx >= 0) {
      el.textContent = `REPORT ${idx + 1}/${state.reports.length}`;
    }
  }

  // ===== Utilities =====

  function formatDateShort(dateStr) {
    try {
      const d = new Date(dateStr + 'T00:00:00');
      return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
    } catch {
      return dateStr;
    }
  }

  function formatDateCompact(dateStr) {
    try {
      const d = new Date(dateStr + 'T00:00:00');
      return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }).toUpperCase();
    } catch {
      return dateStr;
    }
  }

  function cap(s) {
    if (!s) return s;
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  // ===== Expose =====
  window.explorerState = state;
  window.formatDate = formatDateShort;

  // ===== Boot =====
  document.addEventListener('DOMContentLoaded', init);
})();
