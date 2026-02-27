/**
 * Mission Control — AI Intelligence Feed
 * Renders compact intel feed on dashboard + full insights view
 */

(function () {
  'use strict';

  const insightsCache = {};

  // ===== Dashboard Intel Feed (compact) =====

  window.renderIntelFeed = async function (reportDate) {
    const container = document.getElementById('intelFeed');
    if (!container) return;

    if (!reportDate) {
      container.innerHTML = '<div class="intel-loading">SELECT A REPORT</div>';
      return;
    }

    const insights = await loadInsights(reportDate);

    if (!insights) {
      const ragHistory = window.explorerState?.ragHistory;
      if (ragHistory) {
        const generated = generateInsightsFromData(reportDate, ragHistory);
        renderIntelHTML(container, generated);
      } else {
        container.innerHTML = '<div class="intel-loading">NO AI INSIGHTS AVAILABLE</div>';
      }
      return;
    }

    renderIntelHTML(container, insights);
  };

  function renderIntelHTML(container, data) {
    let html = '';

    // Executive Brief
    if (data.executive_summary) {
      html += '<div class="intel-section">';
      html += '<div class="intel-section-header">EXECUTIVE BRIEF</div>';
      html += `<div class="intel-item summary">${data.executive_summary}</div>`;
      html += '</div>';
    }

    // Risk Watch (high priority)
    if (data.risk_watch && data.risk_watch.length > 0) {
      html += '<div class="intel-section">';
      html += '<div class="intel-section-header">RISK WATCH</div>';
      data.risk_watch.forEach((r) => {
        html += `<div class="intel-item warning">${r}</div>`;
      });
      html += '</div>';
    }

    // Country Trends
    if (data.trends && data.trends.length > 0) {
      html += '<div class="intel-section">';
      html += '<div class="intel-section-header">COUNTRY TRENDS</div>';
      data.trends.forEach((t) => {
        const severity = t.severity || 'neutral';
        html += `<div class="intel-item ${severity}">`;
        html += `<span class="intel-country">${t.country}:</span> ${t.insight}`;
        html += '</div>';
      });
      html += '</div>';
    }

    // Predictions
    if (data.predictions && data.predictions.length > 0) {
      html += '<div class="intel-section">';
      html += '<div class="intel-section-header">PREDICTIONS</div>';
      data.predictions.forEach((p) => {
        const severity = p.confidence === 'high' ? 'positive' : p.confidence === 'low' ? 'warning' : 'neutral';
        html += `<div class="intel-item ${severity}">`;
        html += `<span class="intel-country">${p.country}:</span> ${p.prediction}`;
        html += `<span class="intel-confidence">${(p.confidence || 'unknown').toUpperCase()}</span>`;
        html += '</div>';
      });
      html += '</div>';
    }

    // Coaching
    if (data.coaching && data.coaching.length > 0) {
      html += '<div class="intel-section">';
      html += '<div class="intel-section-header">LEADERSHIP COACHING</div>';
      data.coaching.forEach((c) => {
        html += `<div class="intel-item neutral">${c}</div>`;
      });
      html += '</div>';
    }

    container.innerHTML = html;
  }

  // ===== Data Loading =====

  async function loadInsights(date) {
    if (insightsCache[date]) return insightsCache[date];

    try {
      const res = await fetch(`data/insights/${date}.json`);
      if (!res.ok) return null;
      const data = await res.json();
      insightsCache[date] = data;
      return data;
    } catch {
      return null;
    }
  }

  // ===== Auto-generate from RAG data =====

  function generateInsightsFromData(reportDate, ragHistory) {
    const data = ragHistory;
    const reports = data.reports;
    const dateIndex = reports.indexOf(reportDate);

    const TRACKED = [
      'India', 'Malaysia', 'KSA', 'Belgium', 'Croatia',
      'Poland', 'UAE', 'Germany', 'France', 'Singapore',
    ];

    const RAG_ORDER = { 'no-data': 0, red: 1, amber: 2, green: 3 };

    let redCount = 0, amberCount = 0, greenCount = 0, noDataCount = 0;
    const improvements = [];
    const deteriorations = [];
    const streaks = [];

    TRACKED.forEach((name) => {
      const country = data.countries[name];
      if (!country) return;

      const entry = country.history.find((h) => h.date === reportDate);
      const rag = entry ? (entry.overall || 'no-data') : 'no-data';

      if (rag === 'red') redCount++;
      else if (rag === 'amber') amberCount++;
      else if (rag === 'green') greenCount++;
      else noDataCount++;

      if (dateIndex > 0) {
        const prevDate = reports[dateIndex - 1];
        const prevEntry = country.history.find((h) => h.date === prevDate);
        const prevRag = prevEntry ? (prevEntry.overall || 'no-data') : 'no-data';

        if (RAG_ORDER[rag] > RAG_ORDER[prevRag]) {
          improvements.push({ name, from: prevRag, to: rag });
        } else if (RAG_ORDER[rag] < RAG_ORDER[prevRag]) {
          deteriorations.push({ name, from: prevRag, to: rag });
        }
      }

      let streak = 0;
      if (country.history) {
        for (let i = country.history.length - 1; i >= 0; i--) {
          if ((country.history[i].overall || 'no-data') === rag) streak++;
          else break;
        }
        if (streak >= 3 && rag !== 'no-data') {
          streaks.push({ name, rag, count: streak });
        }
      }
    });

    return {
      date: reportDate,
      executive_summary: buildSummary(redCount, amberCount, greenCount, noDataCount, improvements, deteriorations, TRACKED.length),
      trends: buildTrends(streaks, improvements, deteriorations),
      predictions: buildPredictions(streaks, improvements),
      coaching: buildCoaching(streaks, redCount, amberCount, greenCount, improvements),
      risk_watch: buildRiskWatch(deteriorations, streaks),
    };
  }

  function buildSummary(red, amber, green, noData, improvements, deteriorations, total) {
    const parts = [];
    parts.push(`${total} countries tracked.`);
    if (red > 0) parts.push(`${red} Red.`);
    parts.push(`${amber} Amber, ${green} Green.`);
    if (red === 0) parts.push('No Red countries \u2014 positive signal.');
    if (improvements.length > 0) {
      parts.push(`Improved: ${improvements.map((i) => `${i.name} (${cap(i.from)} \u2192 ${cap(i.to)})`).join(', ')}.`);
    }
    if (deteriorations.length > 0) {
      parts.push(`Worsened: ${deteriorations.map((d) => `${d.name} (${cap(d.from)} \u2192 ${cap(d.to)})`).join(', ')}.`);
    }
    return parts.join(' ');
  }

  function buildTrends(streaks, improvements, deteriorations) {
    const trends = [];
    streaks.forEach((s) => {
      const severity = s.rag === 'green' ? 'positive' : s.rag === 'red' ? 'negative' : 'warning';
      trends.push({
        country: s.name,
        insight: `${cap(s.rag)} for ${s.count} consecutive reports.${s.rag === 'amber' ? ' Persistent Amber may indicate systemic blockers.' : s.rag === 'green' ? ' Stable and healthy.' : ' Sustained Red \u2014 needs immediate attention.'}`,
        severity,
      });
    });
    improvements.forEach((i) => {
      trends.push({ country: i.name, insight: `Improved from ${cap(i.from)} to ${cap(i.to)}. Positive momentum.`, severity: 'positive' });
    });
    deteriorations.forEach((d) => {
      trends.push({ country: d.name, insight: `Worsened from ${cap(d.from)} to ${cap(d.to)}. Investigate root cause.`, severity: 'negative' });
    });
    return trends;
  }

  function buildPredictions(streaks, improvements) {
    const predictions = [];
    improvements.forEach((i) => {
      if (i.to === 'green') {
        predictions.push({ country: i.name, prediction: 'Recently reached Green. Should maintain if no new issues surface.', confidence: 'medium' });
      } else if (i.to === 'amber' && i.from === 'red') {
        predictions.push({ country: i.name, prediction: 'Improving from Red to Amber. Could reach Green in 2-3 reports with sustained effort.', confidence: 'medium' });
      }
    });
    streaks.filter((s) => s.rag === 'amber' && s.count >= 4).forEach((s) => {
      predictions.push({ country: s.name, prediction: `Amber for ${s.count} reports. Without intervention, unlikely to reach Green this quarter.`, confidence: 'high' });
    });
    return predictions;
  }

  function buildCoaching(streaks, red, amber, green, improvements) {
    const coaching = [];
    const greenMoves = improvements.filter((i) => i.to === 'green');
    if (greenMoves.length > 0) {
      coaching.push(`${greenMoves.map((g) => g.name).join(' and ')} reached Green. Pattern: zero support tickets AND no active blockers for 2+ weeks.`);
    }
    streaks.filter((s) => s.rag === 'amber' && s.count >= 4).forEach((s) => {
      coaching.push(`${s.name} has been Amber for ${s.count} consecutive reports.`);
    });
    if (red === 0 && amber > 5) {
      coaching.push(`No Red countries, but ${amber} remain Amber.`);
    }
    if (coaching.length === 0) {
      coaching.push('Overall trajectory is positive.');
    }
    return coaching;
  }

  function buildRiskWatch(deteriorations, streaks) {
    const risks = [];
    deteriorations.forEach((d) => {
      risks.push(`${d.name} worsened ${cap(d.from)} \u2192 ${cap(d.to)}. Investigate what changed.`);
    });
    streaks.filter((s) => s.rag === 'red' && s.count >= 2).forEach((s) => {
      risks.push(`${s.name} Red for ${s.count} reports. Extended Red correlates with missed ETAs.`);
    });
    return risks;
  }

  function cap(s) {
    if (!s) return s;
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
})();
