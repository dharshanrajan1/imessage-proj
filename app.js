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
};
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

function setupSearch() {
  const input = document.getElementById('chatSearch');
  input.addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase();
    const items = document.querySelectorAll('.chat-item');
    items.forEach(item => {
      const name = item.querySelector('.chat-name').textContent.toLowerCase();
      if (name.includes(term)) item.style.display = 'flex';
      else item.style.display = 'none';
    });
  });
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
      count.textContent = chat.total_messages.toLocaleString() + ' msgs';
      
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
}

function selectChat(chatId) {
  const chat = state.data.chats.find(c => c.chat_identifier === chatId);
  if (!chat) return;
  state.activeChat = chat;
  
  document.querySelectorAll('.chat-item').forEach(i => i.classList.remove('active'));
  const activeItem = document.querySelector(`.chat-item[data-id="${chatId}"]`);
  if (activeItem) activeItem.classList.add('active');
  
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

  // Reactions Radar
  destroyChart('globalReactionsChart');
  const rLabels = Object.keys(stats.reactions_sent || {});
  const rSent = Object.values(stats.reactions_sent || {});
  const rRecv = Object.values(stats.reactions_received || {});
  
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
}

function renderGlobalRecords() {
  const grid = document.getElementById('globalRecordsGrid');
  const records = (state.data && state.data.records) || {};
  const cards = [];

  const m = records.marathon_chat;
  if (m) {
    cards.push({
      title: 'Marathon Chat', handle: m.chat,
      stat: `${m.message_count} msgs in ${m.duration_hours < 1 ? Math.round(m.duration_hours * 60) + 'm' : m.duration_hours.toFixed(1) + 'h'}`,
      blurb: TERM_BLURBS.marathon_chat
    });
  }

  const g = records.ghosting;
  if (g) {
    cards.push({
      title: 'Ghosting', handle: `${g.ghoster} kept ${g.asker} waiting`,
      stat: formatTime(g.delay_hours * 60),
      blurb: TERM_BLURBS.ghosting
    });
  }

  const o = records.most_one_sided_chat;
  if (o) {
    cards.push({
      title: 'The Monologue', handle: o.chat,
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
      title: 'Chronic Double Texter', handle: d.handle,
      stat: `${d.count} double texts`,
      blurb: TERM_BLURBS.chronic_double_texter
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
  document.getElementById('chatIdentifier').textContent = chat.chat_identifier;

  document.getElementById('chatTotalMsg').textContent = chat.total_messages.toLocaleString();
  document.getElementById('chatLpm').textContent = `${(chat.lpm_sent || 0).toFixed(2)} / ${(chat.lpm_recv || 0).toFixed(2)}`;
  document.getElementById('chatDoubleTexts').textContent = `${chat.double_texts_sent || 0} / ${chat.double_texts_received || 0}`;
  document.getElementById('chatResponse').textContent = `${formatTime(chat.avg_response_time_sent_mins)} / ${formatTime(chat.avg_response_time_received_mins)}`;

  // Monthly
  destroyChart('chatMonthlyChart');
  if (chat.monthly_activity) {
    state.charts['chatMonthlyChart'] = new Chart(document.getElementById('chatMonthlyChart'), {
      type: 'line',
      data: {
        labels: Object.keys(chat.monthly_activity),
        datasets: [{
          label: 'Activity',
          data: Object.values(chat.monthly_activity),
          borderColor: '#10b981',
          tension: 0.3
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

  const renderList = (arr) => arr ? arr.map(i => { const val = Array.isArray(i) ? i[0] : i; return `<div style="padding:4px 8px;background:rgba(255,255,255,0.05);border-radius:4px;margin-bottom:4px;display:inline-block;margin-right:4px;">${val}</div>`; }).join('') : 'None';
  
  document.getElementById('chatEmojisComparison').innerHTML = `
    <div class="comp-col"><div class="comp-title">Me</div><div>${renderList(chat.top_emojis_sent)}</div></div>
    <div class="comp-col"><div class="comp-title">Them</div><div>${renderList(chat.top_emojis_received)}</div></div>
  `;
  document.getElementById('chatWordsComparison').innerHTML = `
    <div class="comp-col"><div class="comp-title">Me</div><div>${renderList(chat.top_words_sent)}</div></div>
    <div class="comp-col"><div class="comp-title">Them</div><div>${renderList(chat.top_words_received)}</div></div>
  `;
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

  document.getElementById('awardGrid').innerHTML = cards.map(c => `
    <div class="award-card">
      <span class="award-title">${c.title}</span>
      <span class="award-handle">${c.handle}</span>
      <span class="award-stat">${c.stat}</span>
      <p class="award-blurb">${c.blurb}</p>
    </div>
  `).join('');

  // Reactions
  const reactions = (chat.reaction_matrix || []).sort((a,b) => b.count - a.count).slice(0,10);
  document.getElementById('reactionAffinityList').innerHTML = reactions.map(r => `
    <li class="affinity-item">
      <span class="affinity-text">${r.from} <span class="affinity-arrow">→</span> ${r.to}</span>
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
      <td>${x.handle}</td>
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
