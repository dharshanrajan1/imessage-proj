const state = {
  data: null,
  activeChat: null,
  charts: {},
  sortColumn: 'message_count',
  sortAsc: false,
  chatTypeFilter: 'all',   // 'all' | 'dm' | 'group'
  dateRange: { start: null, end: null }
};

// ---- Chart color system -------------------------------------------------
// One ordered categorical palette for every chart, stepped for this app's dark
// surface (~#151024) and validated: all six slots sit inside the dark lightness
// band, clear the chroma floor, keep worst-adjacent CVD ΔE 10.6 (target ≥8) and
// normal-vision ΔE 19.3 (floor ≥15), and exceed 3:1 contrast on the surface.
// The slot ORDER is the colorblind-safety mechanism, not decoration -- it was
// picked by testing orderings, so don't reshuffle it casually.
//
// Slots are assigned in fixed order and never cycled. Previously each chart
// picked its own colors, so "Me" was purple in the balance donut and pink in
// the initiations pie right beside it -- the same entity, two identities.
const CHART_COLORS = ['#8b5cf6', '#1baf7a', '#c98500', '#d55181', '#3987e5', '#e66767'];

// Me/Them is one recurring pair, so it gets fixed slots used by every chart
// that splits the two. These two also clear the stricter all-pairs gate that
// pie and donut forms need (CVD ΔE 25.0, normal-vision 33.5).
const VIZ = {
  me: CHART_COLORS[0],
  them: CHART_COLORS[1],
  // Single-series lines/bars: one hue, no legend -- the card title names it.
  primary: CHART_COLORS[0],
  primaryFill: 'rgba(139, 92, 246, 0.14)',
  grid: 'rgba(255, 255, 255, 0.06)',
  ink: '#94a3b8',
};

// Recessive axes/grid and no legend for single-series charts, applied to every
// chart so they read as one family.
function chartOptions({ legend = false, scales = true } = {}) {
  const axis = {
    grid: { color: VIZ.grid, drawBorder: false },
    ticks: { color: VIZ.ink, font: { family: 'Outfit' } },
  };
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: legend
        ? { labels: { color: VIZ.ink, font: { family: 'Outfit' }, usePointStyle: true, pointStyle: 'circle' } }
        : { display: false },
    },
    ...(scales ? { scales: { x: axis, y: { ...axis, beginAtZero: true } } } : {}),
  };
}

// One-line explanations shown under each award/record card so the jargon is self-explanatory.
const TERM_BLURBS = {
  marathon_chat: 'Longest unbroken back-and-forth — messages exchanged with no gap over 1 hour.',
  ghosting: 'The longest anyone made someone wait to reply after being asked a question ("?").',
  most_one_sided_chat: 'The chat with the most lopsided you-vs-them message balance.',
  peak_season: 'The calendar month (across all years) you text the most.',
  chronic_double_texter: 'Sends the most back-to-back messages before waiting for a reply.',
  most_active: 'Sent the most messages in this chat.',
  reaction_magnet: 'Highest average reactions received per message.',
  hype_person: 'Hands out the most reactions to others.',
  ghost: 'Talks the least relative to their "fair share" of the conversation.',
  night_owl: 'Highest share of messages sent between 10pm and 4am.',
  conv_starter: 'Highest share of conversations kicked off after an 8+ hour lull.',
  best_friend: 'Your most-messaged one-on-one chat.',
  fastest_replier: 'Shortest typical (median) time to reply to you.',
  slowest_replier: 'Longest typical (median) time to reply to you.',
  makes_you_laugh: 'The DM where you send the most "haha/lol" per message.',
  your_biggest_fan: 'Laughs at your messages more than anyone else.',
  you_chase: 'You start the biggest share of conversations in this DM.',
  chases_you: 'They start the biggest share of conversations with you.',
  most_balanced: 'Closest to a perfect 50/50 message split (100+ msgs).',
  longest_day_streak: 'Most consecutive days exchanging at least one message.',
  day_streak: 'Longest run of consecutive days with at least one message in this chat.',
  shutterbug: 'Sends you the most photos, videos, and files.',
  paparazzi: 'Sent the most photos, videos, and files in this chat.',
  busiest_day: 'The single calendar day with the most messages across all chats.',
  chat_busiest_day: 'The single day with the most messages in this chat.',
  longest_message: 'The longest single message anyone ever sent, by character count.',
};

// How each DM Superlative is titled and formatted; keys match records.dm_awards.
const DM_AWARD_DEFS = {
  best_friend: { title: '👑 Best Friend', stat: a => `${a.total.toLocaleString()} msgs` },
  fastest_replier: { title: '⚡ Fastest Replier', stat: a => `${formatTime(a.avg_mins)} typical reply` },
  slowest_replier: { title: '🐢 Leaves You on Read', stat: a => `${formatTime(a.avg_mins)} typical reply` },
  makes_you_laugh: { title: '😂 Makes You Laugh', stat: a => `you laugh in ${(a.lpm * 100).toFixed(0)}% of your msgs` },
  your_biggest_fan: { title: '🎉 Your Biggest Fan', stat: a => `laughs in ${(a.lpm * 100).toFixed(0)}% of their msgs` },
  you_chase: { title: '🏃 You Chase Them', stat: a => `you start ${a.pct}% of convos` },
  chases_you: { title: '🧲 They Chase You', stat: a => `they start ${a.pct}% of convos` },
  most_balanced: { title: '⚖️ Perfectly Balanced', stat: a => `${a.sent.toLocaleString()} / ${a.received.toLocaleString()} split` },
  longest_day_streak: { title: '🔥 Longest Streak', stat: a => `${a.days} days in a row` },
  shutterbug: { title: '📸 Shutterbug', stat: a => `${a.count.toLocaleString()} media sent to you` },
};

// Friendly labels for the chemistry sub-scores, in display order.
const CHEM_LABELS = {
  volume: 'Volume',
  regularity: 'Regularity',
  balance: 'Balance',
  responsiveness: 'Reply speed',
  reciprocity: 'Reciprocity',
  humor: 'Humor',
  affection: 'Reactions',
};

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// "Opened by X on <date>: 'first line…'" footer for marathon cards, so the
// conversation can be found again by searching that line in Messages.
function marathonOpenerHTML(m) {
  if (!m || !m.first_text) return '';
  const when = new Date(m.start).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const who = m.first_sender ? esc(displayName(m.first_sender)) : 'someone';
  return `<span class="marathon-opener">Opened by ${who} on ${when}: &ldquo;${esc(m.first_text)}&rdquo;<br>Search that line in Messages to relive it.</span>`;
}

function displayName(n) {
  return n === 'me' ? 'You' : n;
}
Chart.defaults.color = '#94a3b8';
Chart.defaults.font.family = "'Outfit', sans-serif";

document.addEventListener('DOMContentLoaded', () => {
  setupNavigation();
  setupSearch();
  setupDateRangeControls();
  setupChatTypeToggle();
  fetchData();
});

async function fetchData(startDate, endDate) {
  try {
    // Re-show the spinner on refetches (date-range changes can take a few seconds).
    document.getElementById('statsDashboard').classList.add('hidden');
    document.getElementById('loadingState').classList.remove('hidden');

    const params = new URLSearchParams();
    if (startDate) params.set('start_date', startDate);
    if (endDate) params.set('end_date', endDate);
    const qs = params.toString();

    const res = await fetch('/api/stats' + (qs ? `?${qs}` : ''));
    if (!res.ok) throw new Error('Failed to fetch data');
    const data = await res.json();
    state.data = data;
    state.dateRange = { start: startDate || null, end: endDate || null };

    document.getElementById('loadingState').classList.add('hidden');
    document.getElementById('statsDashboard').classList.remove('hidden');

    populateDateBounds(data.date_bounds);
    renderFilterSummary();
    renderSidebar();
    renderGlobalOverview();

    const visibleChats = getFilteredChats();
    if (visibleChats.length > 0) {
      selectChat(visibleChats[0].chat_identifier);
    } else {
      state.activeChat = null;
    }
  } catch (error) {
    console.error('iMessage Wrapped failed to load:', error);
    document.getElementById('loadingState').innerHTML = `<p style="color:#ef4444">Error loading data: ${error.message}</p>`;
  }
}

function populateDateBounds(bounds) {
  if (!bounds || !bounds.min || !bounds.max) return;
  const startInput = document.getElementById('startDateInput');
  const endInput = document.getElementById('endDateInput');
  [startInput, endInput].forEach(input => {
    input.min = bounds.min;
    input.max = bounds.max;
  });
  if (!startInput.value) startInput.value = bounds.min;
  if (!endInput.value) endInput.value = bounds.max;
}

function renderFilterSummary() {
  const el = document.getElementById('filterSummary');
  const { start, end } = state.dateRange;
  if (!start && !end) {
    el.classList.add('hidden');
    return;
  }
  el.classList.remove('hidden');
  el.textContent = `Showing data from ${start || 'the beginning'} to ${end || 'now'}`;
}

function getFilteredChats() {
  if (!state.data || !state.data.chats) return [];
  if (state.chatTypeFilter === 'dm') return state.data.chats.filter(c => !c.is_group_chat);
  if (state.chatTypeFilter === 'group') return state.data.chats.filter(c => c.is_group_chat);
  return state.data.chats;
}

function setupDateRangeControls() {
  const select = document.getElementById('dateRangeSelect');
  const customRange = document.getElementById('customDateRange');
  const applyBtn = document.getElementById('applyDateRange');

  function isoDaysAgo(days) {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().slice(0, 10);
  }
  function todayIso() {
    return new Date().toISOString().slice(0, 10);
  }

  select.addEventListener('change', () => {
    const val = select.value;
    if (val === 'custom') {
      customRange.classList.remove('hidden');
      return;
    }
    customRange.classList.add('hidden');
    if (val === 'all') {
      fetchData();
      return;
    }
    const presetDays = { '1y': 365, '6m': 182, '3m': 91, '30d': 30 };
    fetchData(isoDaysAgo(presetDays[val]), todayIso());
  });

  applyBtn.addEventListener('click', () => {
    const start = document.getElementById('startDateInput').value;
    const end = document.getElementById('endDateInput').value;
    if (!start || !end) return;
    fetchData(start, end);
  });
}

function setupChatTypeToggle() {
  const buttons = document.querySelectorAll('#chatTypeToggle .segment');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      buttons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.chatTypeFilter = btn.dataset.type;

      renderSidebar();
      renderGlobalOverview();

      const visibleChats = getFilteredChats();
      const stillValid = state.activeChat && visibleChats.some(c => c.chat_identifier === state.activeChat.chat_identifier);
      if (!stillValid) {
        if (visibleChats.length > 0) selectChat(visibleChats[0].chat_identifier);
        else state.activeChat = null;
      }
    });
  });
}

function setupNavigation() {
  const tabs = document.querySelectorAll('.tab-btn');
  tabs.forEach(tab => {
    tab.addEventListener('click', (e) => {
      if (tab.disabled) return;
      tabs.forEach(t => {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
      });
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');

      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      document.getElementById(tab.dataset.tab).classList.add('active');

      // The insight panels are built on demand, so opening the tab has to
      // populate whichever sub-panel is showing.
      if (tab.dataset.tab === 'insightsTab') renderActiveInsight();
    });
  });
}

function setupSearch() {
  // renderSidebar reads the search box itself and rebuilds from the data, so a
  // new search starts from the first page of results rather than inheriting
  // however far the previous one had been paged open.
  document.getElementById('chatSearch').addEventListener('input', () => {
    sidebarShown.dm = SIDEBAR_PAGE;
    sidebarShown.group = SIDEBAR_PAGE;
    renderSidebar();
  });
}

function relTime(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '';
  const days = (Date.now() - t) / 86400000;
  if (days < 1) return 'today';
  if (days < 30) return Math.floor(days) + 'd ago';
  if (days < 365) return Math.floor(days / 30.44) + 'mo ago';
  return Math.floor(days / 365.25) + 'y ago';
}

function formatTime(mins) {
  if (mins === undefined || mins === null || mins === 0) return 'N/A';
  if (mins < 1) return Math.round(mins * 60) + 's';
  if (mins < 60) return Math.round(mins) + 'm';
  const hours = mins / 60;
  if (hours < 24) return hours.toFixed(1) + 'h';
  // Ghosting records reach into the thousands of hours ("20832.7h" told nobody
  // anything), so keep stepping up the unit until the number is readable.
  const days = hours / 24;
  if (days < 30) return days.toFixed(days < 10 ? 1 : 0) + 'd';
  if (days < 365) return (days / 30.44).toFixed(1) + 'mo';
  return (days / 365.25).toFixed(1) + 'y';
}

// Call time reads better as "4h 12m" than the "4.2h" formatTime() gives, since
// these are durations someone actually spent rather than reply latencies.
function formatCallTime(mins) {
  if (!mins) return 'None';
  if (mins < 60) return Math.round(mins) + 'm';
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}

// One-line summary of a chat's calls, e.g. "12 calls · 4h 12m". Null when the
// chat has no calls in the window, so callers can omit the line entirely.
function callSummaryLine(calls) {
  if (!calls || !calls.count) return null;
  return `${calls.count} call${calls.count === 1 ? '' : 's'} · ${formatCallTime(calls.total_minutes)}`;
}

function destroyChart(id) {
  if (state.charts[id]) {
    state.charts[id].destroy();
    delete state.charts[id];
  }
}

// The full list runs to hundreds of conversations. Rendering every one put ~824
// nodes (≈69,000px) in the DOM, and search then walked all of them toggling
// display. Instead each section renders a capped window and grows on demand;
// search filters the data and re-renders, so the DOM only ever holds what's
// actually on screen.
const SIDEBAR_PAGE = 40;
const sidebarShown = { dm: SIDEBAR_PAGE, group: SIDEBAR_PAGE };

function renderSidebar() {
  const list = document.getElementById('chatList');
  const term = (document.getElementById('chatSearch').value || '').trim().toLowerCase();
  list.innerHTML = '';

  let visible = getFilteredChats();
  if (term) {
    visible = visible.filter(c =>
      (c.display_name || c.chat_identifier || '').toLowerCase().includes(term));
  }
  const dms = visible.filter(c => !c.is_group_chat);
  const gcs = visible.filter(c => c.is_group_chat);

  if (!visible.length) {
    const empty = document.createElement('p');
    empty.className = 'sidebar-empty';
    empty.textContent = term
      ? `No conversation matches “${term}”.`
      : 'No conversations in this range.';
    list.appendChild(empty);
    return;
  }

  function addSection(title, chats, key) {
    if (chats.length === 0) return;

    const header = document.createElement('div');
    header.className = 'sidebar-section-header';
    // Searching should show what it found, not just a static label.
    header.textContent = `${title} · ${chats.length.toLocaleString()}`;
    list.appendChild(header);

    // A search narrow enough to fit is shown whole; otherwise page through.
    const limit = term ? Math.max(sidebarShown[key], SIDEBAR_PAGE) : sidebarShown[key];
    chats.slice(0, limit).forEach(chat => {
      const item = document.createElement('div');
      item.className = 'chat-item';
      item.dataset.id = chat.chat_identifier;
      if (state.activeChat && state.activeChat.chat_identifier === chat.chat_identifier) {
        item.classList.add('active');
      }

      const row = document.createElement('div');
      row.className = 'chat-item-header';

      const name = document.createElement('span');
      name.className = 'chat-name';
      name.textContent = chat.display_name || chat.chat_identifier;
      row.appendChild(name);

      const count = document.createElement('span');
      count.className = 'chat-count';
      count.textContent = `${chat.total_messages.toLocaleString()} msgs · ${relTime(chat.last_message_date)}`;

      item.appendChild(row);
      item.appendChild(count);

      item.addEventListener('click', () => {
        selectChat(chat.chat_identifier);
        document.querySelector('.tab-btn[data-tab="chatTab"]').click();
      });
      list.appendChild(item);
    });

    if (chats.length > limit) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'sidebar-more';
      more.textContent = `Show ${Math.min(SIDEBAR_PAGE, chats.length - limit)} more of ${chats.length.toLocaleString()}`;
      more.addEventListener('click', () => {
        sidebarShown[key] += SIDEBAR_PAGE;
        renderSidebar();
      });
      list.appendChild(more);
    }
  }

  addSection('Direct Messages', dms, 'dm');
  addSection('Group Chats', gcs, 'group');
}

function selectChat(chatId) {
  const chat = state.data.chats.find(c => c.chat_identifier === chatId);
  if (!chat) return;
  state.activeChat = chat;
  
  // Compare dataset values directly rather than building a selector string --
  // chat identifiers can contain characters (quotes, etc.) that make an
  // attribute selector invalid and throw.
  document.querySelectorAll('.chat-item').forEach(i => {
    i.classList.toggle('active', i.dataset.id === chatId);
  });
  
  renderChatDetails(chat);
  
  const membersTabBtn = document.getElementById('membersTabBtn');
  if (chat.is_group_chat && chat.members && chat.members.length > 0) {
    membersTabBtn.disabled = false;
    renderMembers(chat);
  } else {
    membersTabBtn.disabled = true;
    if (document.getElementById('membersTabBtn').classList.contains('active')) {
      document.querySelector('.tab-btn[data-tab="chatTab"]').click();
    }
  }
}

function renderGlobalOverview() {
  const stats = state.chatTypeFilter === 'all'
    ? state.data.global_stats
    : (state.data.global_stats_by_type && state.data.global_stats_by_type[state.chatTypeFilter]) || state.data.global_stats;
  document.getElementById('globalTotalMsg').textContent = stats.total_messages.toLocaleString();
  document.getElementById('globalSentMsg').textContent = stats.sent.toLocaleString();
  document.getElementById('globalRecvMsg').textContent = stats.received.toLocaleString();
  const ratio = stats.total_messages ? Math.round((stats.sent / stats.total_messages) * 100) : 0;
  document.getElementById('globalSentRatio').textContent = ratio + '%';

  // Messages Over Time
  destroyChart('globalMonthlyChart');
  if (stats.monthly_activity) {
    const monthly = fillMonthlyGaps(stats.monthly_activity);
    state.charts['globalMonthlyChart'] = new Chart(document.getElementById('globalMonthlyChart'), {
      type: 'line',
      data: {
        labels: monthly.labels,
        datasets: [{
          label: 'Messages',
          data: monthly.values,
          borderColor: VIZ.primary,
          backgroundColor: VIZ.primaryFill,
          borderWidth: 2,
          fill: true,
          tension: 0.3,
          pointRadius: 0
        }]
      },
      options: chartOptions()
    });
  }

  // Hourly
  destroyChart('globalHourlyChart');
  state.charts['globalHourlyChart'] = new Chart(document.getElementById('globalHourlyChart'), {
    type: 'line',
    data: {
      labels: Array.from({length: 24}, (_, i) => `${i}:00`),
      datasets: [{
        label: 'Messages',
        data: stats.hourly_distribution,
        borderColor: VIZ.primary,
        backgroundColor: VIZ.primaryFill,
        borderWidth: 2,
        fill: true,
        tension: 0.4,
        pointRadius: 0
      }]
    },
    options: chartOptions()
  });

  // Daily
  destroyChart('globalDailyChart');
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  state.charts['globalDailyChart'] = new Chart(document.getElementById('globalDailyChart'), {
    type: 'bar',
    data: {
      labels: days,
      datasets: [{
        label: 'Messages',
        data: stats.daily_distribution,
        backgroundColor: VIZ.primary,
        borderRadius: 4
      }]
    },
    options: chartOptions()
  });

  // Reactions Radar -- build one label set from the union of both dicts so
  // sent/received values stay aligned to the right axis labels.
  destroyChart('globalReactionsChart');
  const sentMap = stats.reactions_sent || {};
  const recvMap = stats.reactions_received || {};
  const rLabels = [...new Set([...Object.keys(sentMap), ...Object.keys(recvMap)])];
  const rSent = rLabels.map(k => sentMap[k] || 0);
  const rRecv = rLabels.map(k => recvMap[k] || 0);

  if (rLabels.length > 0) {
    state.charts['globalReactionsChart'] = new Chart(document.getElementById('globalReactionsChart'), {
      type: 'radar',
      data: {
        labels: rLabels,
        datasets: [
          { label: 'Sent', data: rSent, borderColor: VIZ.me, backgroundColor: 'rgba(139, 92, 246, 0.2)', borderWidth: 2 },
          { label: 'Received', data: rRecv, borderColor: VIZ.them, backgroundColor: 'rgba(27, 175, 122, 0.2)', borderWidth: 2 }
        ]
      },
      options: {
        ...chartOptions({ legend: true, scales: false }),
        scales: { r: { ticks: { display: false }, grid: { color: VIZ.grid },
                       angleLines: { color: VIZ.grid },
                       pointLabels: { color: VIZ.ink, font: { family: 'Outfit' } } } }
      }
    });
  }

  // Top Words & Emojis
  const ulWords = document.getElementById('globalTopWords');
  ulWords.innerHTML = (stats.top_words || []).map(w => `<li><span>${w[0]}</span><span>${w[1]}</span></li>`).join('');

  const divEmojis = document.getElementById('globalTopEmojis');
  divEmojis.innerHTML = (stats.top_emojis || []).map(e => `<div class="emoji-item"><span>${e[0]}</span><span class="emoji-count">${e[1]}</span></div>`).join('');

  renderGlobalRecords();
  renderChemistry();
  renderDmLeaderboards();
  renderDmAwards();
}

// Top-5 leaderboards (most messages, ghosters, fastest repliers, longest convos).
const LEADERBOARD_DEFS = {
  most_messages: {
    title: '💬 Most Messages',
    fmt: r => `${r.value.toLocaleString()} msgs`,
  },
  fastest_repliers: {
    title: '⚡ Fastest to Reply',
    fmt: r => formatTime(r.value),
  },
  top_ghosters: {
    title: '👻 Ghosts You Most',
    fmt: r => `${r.value}×`,
    sub: r => `~${formatTime(r.avg_wait_hours * 60)} avg wait`,
  },
  longest_convos: {
    title: '🏃 Longest Convos',
    fmt: r => `${r.value.toLocaleString()} msgs`,
    sub: r => r.marathon && r.marathon.first_text
      ? `“${esc(r.marathon.first_text)}”`
      : null,
  },
};

function renderDmLeaderboards() {
  const grid = document.getElementById('dmLeaderboardsGrid');
  if (!grid) return;
  const boards = (state.data && state.data.records && state.data.records.leaderboards) || {};
  const cards = Object.entries(LEADERBOARD_DEFS)
    .filter(([key]) => (boards[key] || []).length)
    .map(([key, def]) => {
      const rows = boards[key].map((r, i) => `
        <li class="lb-row">
          <span class="lb-rank">${i + 1}</span>
          <span class="lb-name">${esc(displayName(r.name))}${def.sub && def.sub(r) ? `<span class="lb-sub">${def.sub(r)}</span>` : ''}</span>
          <span class="lb-value">${def.fmt(r)}</span>
        </li>`).join('');
      return `
        <div class="leaderboard-card glass-card">
          <h3 class="lb-title">${def.title}</h3>
          <ol class="lb-list">${rows}</ol>
        </div>`;
    });
  grid.innerHTML = cards.length
    ? cards.join('')
    : `<p style="color:var(--text-secondary)">Not enough DM activity in this range to build leaderboards.</p>`;
}

// Only the strongest few chats get the full bar breakdown. Rendering all of
// them expanded produced ~4,500px of near-identical cards that buried every
// section below Chemistry on the Overview page.
const CHEM_FEATURED = 6;
let chemShowAll = false;

function chemCardHtml(mch, i) {
  const medals = ['🥇', '🥈', '🥉'];
  const bars = Object.keys(CHEM_LABELS).map(k => {
    const v = mch.breakdown[k] || 0;
    const pct = Math.round(v * 100);
    return `
      <div class="chem-bar-row">
        <span class="chem-bar-label">${CHEM_LABELS[k]}</span>
        <span class="chem-bar-track"><span class="chem-bar-fill" style="width:${pct}%"></span></span>
        <span class="chem-bar-pct">${pct}</span>
      </div>`;
  }).join('');
  const callLine = callSummaryLine(mch.calls);
  return `
    <div class="chem-card">
      <div class="chem-card-top">
        <span class="chem-rank">${medals[i] || '#' + (i + 1)}</span>
        <div class="chem-id">
          <span class="chem-name">${esc(mch.name)}</span>
          <span class="chem-highlight">${mch.highlight}</span>
        </div>
        <div class="chem-score">
          <span class="chem-score-num">${mch.score}</span>
          <span class="chem-score-label">/ 100</span>
        </div>
      </div>
      <div class="chem-bars">${bars}</div>
      <div class="chem-calls">${callLine ? `📞 ${callLine}` : ''}</div>
    </div>`;
}

// Compact one-line form for everyone outside the featured ranks.
function chemRowHtml(mch, i) {
  const callLine = callSummaryLine(mch.calls);
  return `
    <li class="chem-row">
      <span class="chem-row-rank">#${i + 1}</span>
      <span class="chem-row-name">${esc(mch.name)}</span>
      <span class="chem-row-meta">${esc(mch.highlight)}${callLine ? ` · 📞 ${callLine}` : ''}</span>
      <span class="chem-row-track"><span class="chem-row-fill" style="width:${mch.score}%"></span></span>
      <span class="chem-row-score">${mch.score}</span>
    </li>`;
}

function renderChemistry() {
  const grid = document.getElementById('chemistryGrid');
  const rest = document.getElementById('chemistryRest');
  const matches = (state.data && state.data.records && state.data.records.chemistry) || [];
  if (!matches.length) {
    grid.innerHTML = `<p style="color:var(--text-secondary)">Not enough recent two-way DM activity to score chemistry yet (needs 50+ messages in the last 18 months with both people participating).</p>`;
    rest.innerHTML = '';
    return;
  }

  grid.innerHTML = matches.slice(0, CHEM_FEATURED).map(chemCardHtml).join('');

  const remaining = matches.slice(CHEM_FEATURED);
  if (!remaining.length) {
    rest.innerHTML = '';
    return;
  }
  const shown = chemShowAll ? remaining : remaining.slice(0, 10);
  rest.innerHTML = `
    <ol class="chem-rows">${shown.map((m, i) => chemRowHtml(m, i + CHEM_FEATURED)).join('')}</ol>
    ${remaining.length > 10
      ? `<button type="button" class="btn-ghost" id="chemToggle">${
          chemShowAll ? 'Show fewer' : `Show all ${matches.length} scored chats`}</button>`
      : ''}`;

  const toggle = document.getElementById('chemToggle');
  if (toggle) toggle.addEventListener('click', () => { chemShowAll = !chemShowAll; renderChemistry(); });
}

function renderDmAwards() {
  const grid = document.getElementById('dmAwardsGrid');
  const awards = (state.data && state.data.records && state.data.records.dm_awards) || {};
  const cards = Object.entries(DM_AWARD_DEFS)
    .filter(([key]) => awards[key])
    .map(([key, def]) => {
      const a = awards[key];
      return `
        <div class="award-card">
          <span class="award-title">${def.title}</span>
          <span class="award-handle">${esc(a.name)}</span>
          <span class="award-stat">${def.stat(a)}</span>
          <p class="award-blurb">${TERM_BLURBS[key] || ''}</p>
        </div>`;
    });
  grid.innerHTML = cards.length
    ? cards.join('')
    : `<p style="color:var(--text-secondary)">Not enough DM activity in this range to hand out awards.</p>`;
}

function renderGlobalRecords() {
  const grid = document.getElementById('globalRecordsGrid');
  const records = (state.data && state.data.records) || {};
  const cards = [];

  const m = records.marathon_chat;
  if (m) {
    cards.push({
      title: 'Marathon Chat', handle: esc(m.chat),
      stat: `${m.message_count} msgs in ${m.duration_hours < 1 ? Math.round(m.duration_hours * 60) + 'm' : m.duration_hours.toFixed(1) + 'h'}`,
      blurb: TERM_BLURBS.marathon_chat + marathonOpenerHTML(m)
    });
  }

  const g = records.ghosting;
  if (g) {
    cards.push({
      title: 'Ghosting', handle: `${esc(displayName(g.ghoster))} kept ${esc(displayName(g.asker))} waiting`,
      stat: formatTime(g.delay_hours * 60),
      blurb: TERM_BLURBS.ghosting
    });
  }

  const o = records.most_one_sided_chat;
  if (o) {
    cards.push({
      title: 'The Monologue', handle: esc(o.chat),
      stat: `${o.dominant === 'me' ? 'You' : 'They'} sent ${Math.round(o.skew * 50 + 50)}% of it`,
      blurb: TERM_BLURBS.most_one_sided_chat
    });
  }

  const p = records.peak_season;
  if (p) {
    cards.push({
      title: 'Peak Season', handle: p.month,
      stat: `${p.message_count.toLocaleString()} msgs`,
      blurb: TERM_BLURBS.peak_season
    });
  }

  const d = records.chronic_double_texter;
  if (d) {
    cards.push({
      title: 'Chronic Double Texter', handle: esc(displayName(d.handle)),
      stat: `${d.count} double texts`,
      blurb: TERM_BLURBS.chronic_double_texter
    });
  }

  const b = records.busiest_day;
  if (b) {
    cards.push({
      title: 'Busiest Day Ever', handle: b.date,
      stat: `${b.count.toLocaleString()} msgs in one day`,
      blurb: TERM_BLURBS.busiest_day
    });
  }

  const lm = records.longest_message;
  if (lm) {
    // In a DM the chat is named after the other person, so "Alice in Alice"
    // read as a glitch. Only name the chat when it adds something.
    const sender = displayName(lm.sender);
    const inChat = lm.chat && lm.chat !== sender ? ` in ${esc(lm.chat)}` : '';
    cards.push({
      title: 'Longest Message', handle: `${esc(sender)}${inChat}`,
      stat: `${lm.chars.toLocaleString()} characters`,
      blurb: `"${esc(lm.preview)}${lm.chars > lm.preview.length ? '…' : ''}"`
    });
  }

  if (cards.length === 0) {
    grid.innerHTML = `<p style="color:var(--text-secondary)">Not enough data in this range to calculate records yet.</p>`;
    return;
  }

  grid.innerHTML = cards.map(c => `
    <div class="award-card">
      <span class="award-title">${c.title}</span>
      <span class="award-handle">${c.handle}</span>
      <span class="award-stat">${c.stat}</span>
      <p class="award-blurb">${c.blurb}</p>
    </div>
  `).join('');
}

function renderChatDetails(chat) {
  document.getElementById('chatName').textContent = chat.display_name || chat.chat_identifier;
  // For unnamed group chats the raw "chat9847..." identifier is noise; show the
  // participant count instead. DMs still show the phone/email handle.
  const context = [];
  if (chat.is_group_chat) {
    if (chat.members && chat.members.length) context.push(`${chat.members.length} people`);
  } else {
    context.push(chat.chat_identifier);
  }
  if (chat.first_message_date) context.push(`texting since ${chat.first_message_date}`);
  if (chat.active_day_count) context.push(`${chat.active_day_count.toLocaleString()} active days`);
  document.getElementById('chatIdentifier').textContent = context.join(' · ');

  document.getElementById('chatTotalMsg').textContent = chat.total_messages.toLocaleString();

  // "189 / 455" under a "(Me/Them)" header made you read the header to decode
  // which side was which. Label each half at the value instead.
  const setPair = (id, mine, theirs) => {
    document.getElementById(id).innerHTML =
      `<span class="pair"><span class="pair-side"><small>me</small>${mine}</span>`
      + `<span class="pair-sep">/</span>`
      + `<span class="pair-side"><small>them</small>${theirs}</span></span>`;
  };
  setPair('chatLpm', (chat.lpm_sent || 0).toFixed(2), (chat.lpm_recv || 0).toFixed(2));
  setPair('chatDoubleTexts', chat.double_texts_sent || 0, chat.double_texts_received || 0);
  setPair('chatResponse', formatTime(chat.median_response_time_sent_mins),
          formatTime(chat.median_response_time_received_mins));
  setPair('chatWords', (chat.avg_words_sent || 0).toFixed(1), (chat.avg_words_recv || 0).toFixed(1));
  setPair('chatMedia', (chat.media_sent || 0).toLocaleString(),
          (chat.media_received || 0).toLocaleString());

  // Call time is windowed to the last 18 months (macOS prunes call history), so
  // say so in the tooltip rather than letting it read as an all-time figure.
  const callsEl = document.getElementById('chatCalls');
  const calls = chat.calls;
  callsEl.textContent = calls ? formatCallTime(calls.total_minutes) : '—';
  callsEl.title = calls
    ? `${calls.count} connected call${calls.count === 1 ? '' : 's'} in the last 18 months `
      + `(${calls.outgoing} out / ${calls.incoming} in) · longest ${formatCallTime(calls.longest_minutes)}`
      + `${calls.last_call_date ? ` · last on ${calls.last_call_date}` : ''}`
    : (chat.is_group_chat ? 'Call history is matched for 1-on-1 chats only'
                          : 'No connected calls in the last 18 months');

  const chemEl = document.getElementById('chatChemistry');
  if (chat.chemistry) {
    chemEl.textContent = chat.chemistry.score;
    const bonus = chat.chemistry.call_bonus || 0;
    chemEl.title = (chat.chemistry.highlight || '')
      + (bonus ? ` · includes +${bonus} from call time` : '');
  } else {
    chemEl.textContent = '—';
    chemEl.title = chat.is_group_chat ? 'Chemistry is scored for 1-on-1 chats only' : 'Not enough recent two-way activity to score (last 18 months)';
  }

  renderChatRecords(chat);

  // Monthly -- fill skipped months with 0 so the line doesn't jump across gaps.
  destroyChart('chatMonthlyChart');
  if (chat.monthly_activity) {
    const monthly = fillMonthlyGaps(chat.monthly_activity);
    state.charts['chatMonthlyChart'] = new Chart(document.getElementById('chatMonthlyChart'), {
      type: 'line',
      data: {
        labels: monthly.labels,
        datasets: [{
          label: 'Activity',
          data: monthly.values,
          borderColor: VIZ.primary,
          backgroundColor: VIZ.primaryFill,
          borderWidth: 2,
          fill: true,
          tension: 0.3,
          pointRadius: 0
        }]
      },
      options: chartOptions()
    });
  }

  // Hourly
  destroyChart('chatHourlyChart');
  if (chat.hourly_distribution) {
    state.charts['chatHourlyChart'] = new Chart(document.getElementById('chatHourlyChart'), {
      type: 'line',
      data: {
        labels: Array.from({length: 24}, (_, i) => `${i}:00`),
        datasets: [{
          label: 'Messages',
          data: chat.hourly_distribution,
          borderColor: VIZ.primary,
          backgroundColor: VIZ.primaryFill,
          borderWidth: 2,
          fill: true,
          tension: 0.4,
          pointRadius: 0
        }]
      },
      options: chartOptions()
    });
  }

  // Balance
  destroyChart('chatBalanceChart');
  state.charts['chatBalanceChart'] = new Chart(document.getElementById('chatBalanceChart'), {
    type: 'doughnut',
    data: {
      labels: ['Me', 'Them'],
      datasets: [{
        data: [chat.sent, chat.received],
        backgroundColor: [VIZ.me, VIZ.them],
        // 2px surface-coloured gap between segments, per the mark spec.
        borderColor: '#151024', borderWidth: 2
      }]
    },
    options: chartOptions({ legend: true, scales: false })
  });

  // Initiations
  destroyChart('chatInitiationsChart');
  state.charts['chatInitiationsChart'] = new Chart(document.getElementById('chatInitiationsChart'), {
    type: 'pie',
    data: {
      labels: ['Me', 'Them'],
      datasets: [{
        data: [chat.initiations_sent || 0, chat.initiations_received || 0],
        // Same two entities as the balance donut, so the same two colours.
        backgroundColor: [VIZ.me, VIZ.them],
        borderColor: '#151024', borderWidth: 2
      }]
    },
    options: chartOptions({ legend: true, scales: false })
  });

  // Each item is a [value, count] pair (from Counter.most_common); show the count
  // as a subtle badge so you can see how often each word/emoji was actually used.
  const renderList = (arr) => (arr && arr.length)
    ? arr.map(i => {
        const [val, count] = Array.isArray(i) ? i : [i, null];
        const badge = count != null ? `<span class="freq-count">${count.toLocaleString()}</span>` : '';
        return `<span class="freq-chip">${esc(val)}${badge}</span>`;
      }).join('')
    : '<span class="muted-note">None</span>';
  
  document.getElementById('chatEmojisComparison').innerHTML = `
    <div class="comp-col"><div class="comp-title">Me</div><div>${renderList(chat.top_emojis_sent)}</div></div>
    <div class="comp-col"><div class="comp-title">Them</div><div>${renderList(chat.top_emojis_received)}</div></div>
  `;
  document.getElementById('chatWordsComparison').innerHTML = `
    <div class="comp-col"><div class="comp-title">Me</div><div>${renderList(chat.top_words_sent)}</div></div>
    <div class="comp-col"><div class="comp-title">Them</div><div>${renderList(chat.top_words_received)}</div></div>
  `;
}

function fillMonthlyGaps(monthly) {
  const keys = Object.keys(monthly).sort();
  if (keys.length === 0) return { labels: [], values: [] };
  const labels = [], values = [];
  let [y, m] = keys[0].split('-').map(Number);
  const [ey, em] = keys[keys.length - 1].split('-').map(Number);
  while (y < ey || (y === ey && m <= em)) {
    const k = `${y}-${String(m).padStart(2, '0')}`;
    labels.push(k);
    values.push(monthly[k] || 0);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return { labels, values };
}

function renderChatRecords(chat) {
  const grid = document.getElementById('chatRecordsGrid');
  const cards = [];

  const s = chat.day_streak;
  if (s && s.days >= 2) {
    cards.push({
      title: '🔥 Day Streak', handle: `${s.days} days in a row`,
      stat: `${s.start} → ${s.end}`,
      blurb: TERM_BLURBS.day_streak
    });
  }

  const m = chat.marathon_chat;
  if (m && m.message_count >= 2) {
    cards.push({
      title: '🏃 Marathon', handle: `${m.message_count} msgs back-to-back`,
      stat: m.duration_hours < 1 ? Math.round(m.duration_hours * 60) + 'm' : m.duration_hours.toFixed(1) + 'h',
      blurb: TERM_BLURBS.marathon_chat + marathonOpenerHTML(m)
    });
  }

  const g = chat.ghosting;
  if (g && g.delay_hours > 1) {
    cards.push({
      title: '👻 Longest Ghost', handle: `${esc(displayName(g.ghoster))} kept ${esc(displayName(g.asker))} waiting`,
      stat: formatTime(g.delay_hours * 60),
      blurb: TERM_BLURBS.ghosting
    });
  }

  const b = chat.busiest_day;
  if (b && b.count >= 10) {
    cards.push({
      title: '📅 Busiest Day', handle: b.date,
      stat: `${b.count.toLocaleString()} msgs`,
      blurb: TERM_BLURBS.chat_busiest_day
    });
  }

  grid.innerHTML = cards.map(c => `
    <div class="award-card">
      <span class="award-title">${c.title}</span>
      <span class="award-handle">${c.handle}</span>
      <span class="award-stat">${c.stat}</span>
      <p class="award-blurb">${c.blurb}</p>
    </div>
  `).join('');
}

function renderMembers(chat) {
  renderLeaderboard();
  
  // Award Cards
  const m = chat.members;
  const cards = [];
  
  const mostActive = [...m].sort((a,b) => b.message_count - a.message_count)[0];
  if (mostActive) cards.push({ title: 'Most Active', handle: mostActive.handle, stat: mostActive.message_count + ' msgs', blurb: TERM_BLURBS.most_active });

  const reactionMagnet = [...m].sort((a,b) => b.reactions_received_per_msg - a.reactions_received_per_msg)[0];
  if (reactionMagnet) cards.push({ title: 'Reaction Magnet', handle: reactionMagnet.handle, stat: reactionMagnet.reactions_received_per_msg.toFixed(2) + ' per msg', blurb: TERM_BLURBS.reaction_magnet });

  const hypePerson = [...m].sort((a,b) => b.reactions_given - a.reactions_given)[0];
  if (hypePerson) cards.push({ title: 'Hype Person', handle: hypePerson.handle, stat: hypePerson.reactions_given + ' reactions', blurb: TERM_BLURBS.hype_person });

  const ghost = [...m].sort((a,b) => b.ghost_score - a.ghost_score)[0];
  if (ghost && ghost.ghost_score > 0.3) cards.push({ title: 'Ghost', handle: ghost.handle, stat: ghost.ghost_score.toFixed(2) + ' score', blurb: TERM_BLURBS.ghost });

  const nightOwl = [...m].sort((a,b) => b.night_owl_pct - a.night_owl_pct)[0];
  if (nightOwl) cards.push({ title: 'Night Owl', handle: nightOwl.handle, stat: nightOwl.night_owl_pct.toFixed(1) + '%', blurb: TERM_BLURBS.night_owl });

  const starter = [...m].sort((a,b) => b.initiation_pct - a.initiation_pct)[0];
  if (starter) cards.push({ title: 'Conv. Starter', handle: starter.handle, stat: starter.initiation_pct.toFixed(1) + '%', blurb: TERM_BLURBS.conv_starter });

  const paparazzi = [...m].sort((a,b) => (b.media_count || 0) - (a.media_count || 0))[0];
  if (paparazzi && paparazzi.media_count > 0) cards.push({ title: 'Paparazzi', handle: paparazzi.handle, stat: paparazzi.media_count.toLocaleString() + ' media', blurb: TERM_BLURBS.paparazzi });

  document.getElementById('awardGrid').innerHTML = cards.map(c => `
    <div class="award-card">
      <span class="award-title">${c.title}</span>
      <span class="award-handle">${esc(displayName(c.handle))}</span>
      <span class="award-stat">${c.stat}</span>
      <p class="award-blurb">${c.blurb}</p>
    </div>
  `).join('');

  // Reactions
  const reactions = (chat.reaction_matrix || []).sort((a,b) => b.count - a.count).slice(0,10);
  document.getElementById('reactionAffinityList').innerHTML = reactions.map(r => `
    <li class="affinity-item">
      <span class="affinity-text">${esc(displayName(r.from))} <span class="affinity-arrow">→</span> ${esc(displayName(r.to))}</span>
      <span class="affinity-count">${r.count}</span>
    </li>
  `).join('');

  // Member Share. This was a doughnut fed the whole categorical palette, which
  // Chart.js then cycled once a group had more members than colors -- two people
  // sharing a color in the same chart. It's also the wrong form: ranking members
  // by volume is one series of magnitudes, so it's a bar in a single hue, which
  // stays readable at any member count and needs no color legend at all.
  destroyChart('memberShareChart');
  const byCount = [...m].sort((a, b) => b.message_count - a.message_count);
  const topMembers = byCount.slice(0, 10);
  const otherTotal = byCount.slice(10).reduce((sum, x) => sum + x.message_count, 0);
  const shareLabels = topMembers.map(x => displayName(x.handle));
  const shareValues = topMembers.map(x => x.message_count);
  if (otherTotal > 0) {
    shareLabels.push(`Other (${byCount.length - 10})`);
    shareValues.push(otherTotal);
  }
  state.charts['memberShareChart'] = new Chart(document.getElementById('memberShareChart'), {
    type: 'bar',
    data: {
      labels: shareLabels,
      datasets: [{
        label: 'Messages',
        data: shareValues,
        backgroundColor: VIZ.primary,
        borderRadius: 4
      }]
    },
    options: { ...chartOptions(), indexAxis: 'y' }
  });
}

function renderLeaderboard() {
  const m = [...state.activeChat.members];
  m.sort((a, b) => {
    let valA = a[state.sortColumn];
    let valB = b[state.sortColumn];
    if (typeof valA === 'string') return state.sortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
    return state.sortAsc ? valA - valB : valB - valA;
  });

  const body = document.getElementById('leaderboardBody');
  body.innerHTML = m.map((x, i) => `
    <tr class="rank-${i+1}">
      <td class="rank-cell">#${i+1}</td>
      <td>${esc(displayName(x.handle))}</td>
      <td>${x.message_count}</td>
      <td>${x.message_share_pct.toFixed(1)}%</td>
      <td>${x.reactions_received}</td>
      <td>${x.main_character_score}</td>
    </tr>
  `).join('');
}

document.querySelectorAll('th[data-sort]').forEach(th => {
  th.addEventListener('click', () => {
    const col = th.dataset.sort;
    if (state.sortColumn === col) state.sortAsc = !state.sortAsc;
    else { state.sortColumn = col; state.sortAsc = false; }
    if (state.activeChat) renderLeaderboard();
  });
});

/* Insights Tab Functionality */

// Render whichever insight sub-panel is currently active. Both the outer tab
// ("Insights") and the inner sub-tabs route through this: the outer tab used to
// only toggle CSS classes, so arriving at Insights showed the Trends panel
// without ever populating it, and it stayed blank until you clicked away to
// another sub-tab and back.
function renderActiveInsight() {
  const active = document.querySelector('.insights-tab-btn.active');
  const insight = active ? active.dataset.insight : 'trends';
  if (insight === 'trends') renderTrends();
  else if (insight === 'sentiment') renderSentiment();
  else if (insight === 'compare') renderComparison();
}

document.querySelectorAll('.insights-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const insight = btn.dataset.insight;
    document.querySelectorAll('.insights-tab-btn').forEach(b => {
      b.classList.remove('active');
      b.setAttribute('aria-selected', 'false');
    });
    document.querySelectorAll('.insight-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    btn.setAttribute('aria-selected', 'true');
    document.getElementById(insight + 'Content').classList.add('active');
    renderActiveInsight();
  });
});

function renderTrends() {
  const grid = document.getElementById('trendsGrid');
  const subtitle = document.getElementById('trendsSubtitle');
  const input = document.getElementById('trendsChatInput');

  // Trends are per-conversation (yearly_stats lives on a chat). The panel's own
  // picker wins; otherwise fall back to whatever is open in Chat Analysis, so
  // drilling into a chat and clicking Insights still lands somewhere useful.
  const chat = trendsChat || state.activeChat;
  if (!chat) {
    subtitle.textContent = 'Pick a conversation to see how it has evolved across years.';
    grid.innerHTML = '<p style="color:var(--text-secondary)">No conversation selected yet — search for one above.</p>';
    return;
  }
  // Keep the box in sync when the selection came from the sidebar.
  if (input.value !== chat.display_name) input.value = chat.display_name;
  subtitle.textContent = `How your messaging with ${chat.display_name} has evolved across years.`;

  const yearlyStats = chat.yearly_stats || {};
  const years = Object.keys(yearlyStats).sort();

  if (years.length === 0) {
    grid.innerHTML = '<p style="color:var(--text-secondary)">No year-over-year data available for this conversation.</p>';
    return;
  }

  grid.innerHTML = years.map(year => {
    const stats = yearlyStats[year];
    const prevYear = parseInt(year) - 1;
    const prevStats = yearlyStats[prevYear];

    // null values mean "not measurable this year" rather than zero, so they get
    // no arrow instead of a bogus -100%.
    const getChange = (curr, prev) => {
      if (curr == null || prev == null || !prev) return null;
      const pct = Math.round((curr - prev) / prev * 100);
      if (pct === 0) return null;
      return { pct: Math.abs(pct), dir: pct > 0 ? 'up' : 'down' };
    };

    // A year-over-year panel that never showed direction was missing the point.
    // These were all computed and then dropped on the floor, and the
    // .trend-arrow styles went unused.
    const arrow = ch => ch
      ? `<span class="trend-arrow ${ch.dir}">${ch.dir === 'up' ? '↑' : '↓'}${ch.pct}%</span>`
      : '';

    const row = (label, value, change) => `
      <div class="trend-stat">
        <span class="trend-label">${label}</span>
        <span class="trend-value">${value}${arrow(change)}</span>
      </div>`;

    return `
      <div class="trend-card glass-card">
        <h4>${year}</h4>
        ${row('Messages', (stats.total || 0).toLocaleString(),
              getChange(stats.total, prevStats?.total))}
        ${row('Avg Message Length', `${(stats.avg_msg_length || 0).toFixed(1)} words`,
              getChange(stats.avg_msg_length, prevStats?.avg_msg_length))}
        ${row('LPM', (stats.lpm || 0).toFixed(3),
              getChange(stats.lpm, prevStats?.lpm))}
        ${row('Sentiment', stats.sentiment_avg == null ? '—' : stats.sentiment_avg.toFixed(2),
              getChange(stats.sentiment_avg, prevStats?.sentiment_avg))}
      </div>
    `;
  }).join('');
}

// A chat needs at least this many scorable messages before its average means
// anything. Below that, one enthusiastic "love it" swings the whole number.
const SENTIMENT_MIN_MESSAGES = 20;
const SENTIMENT_MAX_CARDS = 30;

function renderSentiment() {
  const globalSentiment = state.data.global_stats_by_type?.dm?.sentiment_avg;
  document.getElementById('globalSentiment').textContent =
    globalSentiment == null ? '—' : globalSentiment.toFixed(2);

  const grid = document.getElementById('sentimentGrid');
  // Only chats with a real sample, strongest feeling first. This used to render
  // a card for every DM -- hundreds of them, most with too little scorable text
  // to say anything, all showing the same number.
  const dms = state.data.chats
    .filter(c => !c.is_group_chat
                 && c.sentiment_avg != null
                 && (c.sentiment_msg_count || 0) >= SENTIMENT_MIN_MESSAGES)
    .sort((a, b) => b.sentiment_avg - a.sentiment_avg)
    .slice(0, SENTIMENT_MAX_CARDS);

  if (!dms.length) {
    grid.innerHTML = `<p style="color:var(--text-secondary)">No conversation has ${SENTIMENT_MIN_MESSAGES}+ messages with measurable sentiment in this range.</p>`;
    return;
  }

  grid.innerHTML = dms.map(chat => {
    const sentiment = chat.sentiment_avg;
    const fillPct = (sentiment * 100).toFixed(0);
    const moodLabel = sentiment > 0.65 ? 'Positive' : sentiment > 0.45 ? 'Neutral' : 'Negative';

    return `
      <div class="sentiment-card glass-card">
        <h4>${esc(chat.display_name)}</h4>
        <div class="sentiment-value">${sentiment.toFixed(2)}</div>
        <div class="sentiment-bar">
          <div class="sentiment-fill" style="width: ${fillPct}%"></div>
        </div>
        <div style="color: var(--text-secondary); font-size: 0.85rem; margin-top: 0.5rem;">${moodLabel} · ${(chat.sentiment_msg_count || 0).toLocaleString()} scored</div>
      </div>
    `;
  }).join('');
}

// Searchable DM picker, shared by the Trends and Compare panels. Trends needs
// one and Compare needs two, so the selection is handed back via onSelect
// instead of being wired to specific module-level variables.
const DM_PICKER_MAX = 50;  // the full list is hundreds long; cap the dropdown

function attachDMPicker(input, list, onSelect) {
  const render = () => {
    if (!state.data || !state.data.chats) return;
    const query = input.value.trim().toLowerCase();
    const dms = state.data.chats.filter(c => !c.is_group_chat);
    const filtered = (query ? dms.filter(c => c.display_name.toLowerCase().includes(query)) : dms)
      .slice(0, DM_PICKER_MAX);

    list.innerHTML = filtered.map(dm =>
      `<li data-id="${esc(dm.chat_identifier)}">${esc(dm.display_name)}</li>`).join('');
    list.classList.toggle('hidden', filtered.length === 0);

    list.querySelectorAll('li').forEach(li => {
      li.addEventListener('click', () => {
        const chat = dms.find(d => d.chat_identifier === li.dataset.id);
        if (!chat) return;
        input.value = chat.display_name;
        list.classList.add('hidden');
        onSelect(chat);
      });
    });
  };
  input.addEventListener('input', render);
  // Focus opens the list too -- clicking an empty box used to do nothing until
  // you typed a character.
  input.addEventListener('focus', render);
}

// --- Trends picker (one conversation) ---
let trendsChat = null;
attachDMPicker(
  document.getElementById('trendsChatInput'),
  document.getElementById('trendsChatList'),
  chat => { trendsChat = chat; renderTrends(); }
);

// --- Compare pickers (two conversations) ---
let selectedDM1 = null;
let selectedDM2 = null;
attachDMPicker(
  document.getElementById('compareDM1Input'),
  document.getElementById('compareDM1List'),
  chat => { selectedDM1 = chat; if (selectedDM1 && selectedDM2) renderComparison(); }
);
attachDMPicker(
  document.getElementById('compareDM2Input'),
  document.getElementById('compareDM2List'),
  chat => { selectedDM2 = chat; if (selectedDM1 && selectedDM2) renderComparison(); }
);

document.addEventListener('click', e => {
  if (!e.target.closest('.compare-select')) {
    document.querySelectorAll('.contact-dropdown').forEach(l => l.classList.add('hidden'));
  }
});

// One spec per comparison row. Both cards render from this same list, so they
// always show the same rows in the same order -- the two-column grid only lines
// up if neither side can skip a row.
const COMPARE_ROWS = [
  { label: 'Messages', get: c => (c.total_messages || 0).toLocaleString() },
  { label: 'Sentiment', get: c => (c.sentiment_avg == null ? '—' : c.sentiment_avg.toFixed(2)) },
  { label: 'LPM (You)', get: c => (c.lpm_sent || 0).toFixed(3) },
  { label: 'LPM (Them)', get: c => (c.lpm_recv || 0).toFixed(3) },
  // These read median_* fields, so they're medians -- the old labels said "Avg".
  { label: 'Median Reply (You)', get: c => formatTime(c.median_response_time_sent_mins) },
  { label: 'Median Reply (Them)', get: c => formatTime(c.median_response_time_received_mins) },
  { label: 'Call Time (18mo)', get: c => formatCallTime(c.calls?.total_minutes) },
  { label: 'Chemistry', get: c => (c.chemistry ? c.chemistry.score : '—') },
];

function renderComparison() {
  if (!selectedDM1 || !selectedDM2) return;

  const results = document.getElementById('comparisonResults');
  results.classList.remove('hidden');

  const card = dm => `
    <div class="compare-card glass-card">
      <h3>${esc(dm.display_name)}</h3>
      ${COMPARE_ROWS.map(row => `
        <div class="compare-stat">
          <span class="compare-label">${row.label}</span>
          <span class="compare-value">${row.get(dm)}</span>
        </div>`).join('')}
    </div>`;

  results.innerHTML = card(selectedDM1) + card(selectedDM2);
}
