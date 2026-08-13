const state = {
  data: null,
  activeChat: null,
  charts: {},
  sortColumn: 'message_count',
  sortAsc: false,
  chatTypeFilter: 'all',   // 'all' | 'dm' | 'group'
  dateRange: { start: null, end: null }
};

const CHART_COLORS = ['#8b5cf6', '#0284c7', '#ec4899', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#a855f7', '#14b8a6', '#f97316'];

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
  recency: 'Recency',
  consistency: 'Consistency',
  balance: 'Balance',
  responsiveness: 'Reply speed',
  reciprocity: 'Reciprocity',
  humor: 'Humor',
  affection: 'Reactions',
};

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      document.getElementById(tab.dataset.tab).classList.add('active');
    });
  });
}

function applySearchFilter() {
  const term = document.getElementById('chatSearch').value.toLowerCase();
  document.querySelectorAll('.chat-item').forEach(item => {
    const name = item.querySelector('.chat-name').textContent.toLowerCase();
    item.style.display = name.includes(term) ? 'flex' : 'none';
  });
}

function setupSearch() {
  document.getElementById('chatSearch').addEventListener('input', applySearchFilter);
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
  return (mins / 60).toFixed(1) + 'h';
}

function destroyChart(id) {
  if (state.charts[id]) {
    state.charts[id].destroy();
    delete state.charts[id];
  }
}

function renderSidebar() {
  const list = document.getElementById('chatList');
  list.innerHTML = '';

  const visible = getFilteredChats();
  const dms = visible.filter(c => !c.is_group_chat);
  const gcs = visible.filter(c => c.is_group_chat);

  function addSection(title, chats) {
    if (chats.length === 0) return;
    
    const header = document.createElement('div');
    header.className = 'sidebar-section-header';
    header.textContent = title;
    list.appendChild(header);
    
    chats.forEach(chat => {
      const item = document.createElement('div');
      item.className = 'chat-item';
      item.dataset.id = chat.chat_identifier;
      
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
  }
  
  addSection('Direct Messages', dms);
  addSection('Group Chats', gcs);

  // Keep any active search term applied across re-renders (filter/date changes).
  applySearchFilter();
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
          borderColor: '#ec4899',
          backgroundColor: 'rgba(236, 72, 153, 0.1)',
          fill: true,
          tension: 0.3,
          pointRadius: 0
        }]
      },
      options: { responsive: true, maintainAspectRatio: false }
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
        borderColor: '#8b5cf6',
        backgroundColor: 'rgba(139, 92, 246, 0.1)',
        fill: true,
        tension: 0.4
      }]
    },
    options: { responsive: true, maintainAspectRatio: false }
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
        backgroundColor: '#0284c7',
        borderRadius: 4
      }]
    },
    options: { responsive: true, maintainAspectRatio: false }
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
          { label: 'Sent', data: rSent, borderColor: '#ec4899', backgroundColor: 'rgba(236, 72, 153, 0.2)' },
          { label: 'Received', data: rRecv, borderColor: '#10b981', backgroundColor: 'rgba(16, 185, 129, 0.2)' }
        ]
      },
      options: { responsive: true, maintainAspectRatio: false, scales: { r: { ticks: { display: false } } } }
    });
  }

  // Top Words & Emojis
  const ulWords = document.getElementById('globalTopWords');
  ulWords.innerHTML = (stats.top_words || []).map(w => `<li><span>${w[0]}</span><span>${w[1]}</span></li>`).join('');

  const divEmojis = document.getElementById('globalTopEmojis');
  divEmojis.innerHTML = (stats.top_emojis || []).map(e => `<div class="emoji-item"><span>${e[0]}</span><span class="emoji-count">${e[1]}</span></div>`).join('');

  renderGlobalRecords();
  renderChemistry();
  renderDmAwards();
}

function renderChemistry() {
  const grid = document.getElementById('chemistryGrid');
  const matches = (state.data && state.data.records && state.data.records.chemistry) || [];
  if (!matches.length) {
    grid.innerHTML = `<p style="color:var(--text-secondary)">Not enough two-way DM activity in this range to score chemistry yet (needs ~20+ messages with both people participating).</p>`;
    return;
  }
  const medals = ['🥇', '🥈', '🥉'];
  grid.innerHTML = matches.map((mch, i) => {
    const bars = Object.keys(CHEM_LABELS).map(k => {
      const v = mch.breakdown[k] || 0;
      return `
        <div class="chem-bar-row">
          <span class="chem-bar-label">${CHEM_LABELS[k]}</span>
          <span class="chem-bar-track"><span class="chem-bar-fill" style="width:${Math.round(v * 100)}%"></span></span>
        </div>`;
    }).join('');
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
      </div>`;
  }).join('');
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
      blurb: TERM_BLURBS.marathon_chat
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
    cards.push({
      title: 'Longest Message', handle: `${esc(displayName(lm.sender))}${lm.chat ? ' in ' + esc(lm.chat) : ''}`,
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
  document.getElementById('chatLpm').textContent = `${(chat.lpm_sent || 0).toFixed(2)} / ${(chat.lpm_recv || 0).toFixed(2)}`;
  document.getElementById('chatDoubleTexts').textContent = `${chat.double_texts_sent || 0} / ${chat.double_texts_received || 0}`;
  document.getElementById('chatResponse').textContent = `${formatTime(chat.median_response_time_sent_mins)} / ${formatTime(chat.median_response_time_received_mins)}`;
  document.getElementById('chatWords').textContent = `${(chat.avg_words_sent || 0).toFixed(1)} / ${(chat.avg_words_recv || 0).toFixed(1)}`;
  document.getElementById('chatMedia').textContent = `${(chat.media_sent || 0).toLocaleString()} / ${(chat.media_received || 0).toLocaleString()}`;

  const chemEl = document.getElementById('chatChemistry');
  if (chat.chemistry) {
    chemEl.textContent = chat.chemistry.score;
    chemEl.title = chat.chemistry.highlight || '';
  } else {
    chemEl.textContent = '—';
    chemEl.title = chat.is_group_chat ? 'Chemistry is scored for 1-on-1 chats only' : 'Not enough two-way activity to score';
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
          borderColor: '#10b981',
          backgroundColor: 'rgba(16, 185, 129, 0.1)',
          fill: true,
          tension: 0.3
        }]
      },
      options: { responsive: true, maintainAspectRatio: false }
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
          borderColor: '#8b5cf6',
          backgroundColor: 'rgba(139, 92, 246, 0.1)',
          fill: true,
          tension: 0.4
        }]
      },
      options: { responsive: true, maintainAspectRatio: false }
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
        backgroundColor: ['#8b5cf6', '#0284c7']
      }]
    },
    options: { responsive: true, maintainAspectRatio: false }
  });

  // Initiations
  destroyChart('chatInitiationsChart');
  state.charts['chatInitiationsChart'] = new Chart(document.getElementById('chatInitiationsChart'), {
    type: 'pie',
    data: {
      labels: ['Me', 'Them'],
      datasets: [{
        data: [chat.initiations_sent || 0, chat.initiations_received || 0],
        backgroundColor: ['#ec4899', '#f59e0b']
      }]
    },
    options: { responsive: true, maintainAspectRatio: false }
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
      blurb: TERM_BLURBS.marathon_chat
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

  // Member Share Chart
  destroyChart('memberShareChart');
  state.charts['memberShareChart'] = new Chart(document.getElementById('memberShareChart'), {
    type: 'doughnut',
    data: {
      labels: m.map(x => x.handle),
      datasets: [{
        data: m.map(x => x.message_count),
        backgroundColor: CHART_COLORS
      }]
    },
    options: { responsive: true, maintainAspectRatio: false }
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
