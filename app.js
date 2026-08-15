import { moveIndicator, growBars } from './motion.js';

/* ============================================================================
   State

   `scope` is the single source of truth for what's on screen. It is set by the
   sidebar and nothing else. Previously the sidebar set the active chat while
   the tab bar independently decided whether that chat mattered -- Overview and
   Insights ignored it entirely, Members greyed out, and Insights carried its
   own contact pickers. There was no way to answer "what am I looking at?".

   Now: sidebar picks the scope, the tab bar offers the views that exist for
   that scope, and every view renders the scope. A tab that wouldn't apply is
   never built, so there is no disabled state to explain.
   ========================================================================== */

const state = {
  data: null,
  scope: { kind: 'everyone' },   // { kind:'everyone' } | { kind:'chat', chat }
  view: null,                    // id of the active view within the scope
  charts: {},
  sortColumn: 'message_count',
  sortAsc: false,
  chatTypeFilter: 'all',         // 'all' | 'dm' | 'group'
  dateRange: { start: null, end: null },
  compareWith: null,             // the other DM in the Compare view
};

/* ============================================================================
   Chart color

   The slot ORDER here is the colorblind-safety mechanism, not decoration -- it
   was picked by testing orderings, so don't reshuffle it casually.

   The values themselves now live in styles.css as --data-1..6 and are read at
   render time, because there are two validated ramps: one for the dark surface
   and a darker, higher-contrast one for white. A single palette cannot clear
   3:1 against both #17171c and #ffffff.

   Slots are assigned in fixed order and never cycled. Before this, each chart
   picked its own colors, so "Me" was purple in the balance donut and pink in
   the initiations pie right beside it -- the same entity with two identities.
   ========================================================================== */

function tokens() {
  const cs = getComputedStyle(document.documentElement);
  const t = name => cs.getPropertyValue(name).trim();
  return {
    series: [t('--data-1'), t('--data-2'), t('--data-3'), t('--data-4'), t('--data-5'), t('--data-6')],
    grid: t('--data-grid'),
    ink: t('--data-ink'),
    surface: t('--surface'),
    font: t('--font'),
  };
}

// Me/Them is one recurring pair, so it gets fixed slots used by every chart
// that splits the two.
function viz() {
  const t = tokens();
  return {
    me: t.series[0],
    them: t.series[1],
    primary: t.series[0],
    primaryFill: withAlpha(t.series[0], 0.14),
    grid: t.grid,
    ink: t.ink,
    surface: t.surface,
    font: t.font,
  };
}

// Chart.js wants a concrete color string, so translucent fills are mixed here
// rather than with color-mix() in CSS.
function withAlpha(hex, alpha) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// Recessive axes/grid and no legend for single-series charts, applied to every
// chart so they read as one family. The card title names the series, which is
// what lets a single-series chart drop its legend entirely.
function chartOptions({ legend = false, scales = true } = {}) {
  const v = viz();
  const axis = {
    grid: { color: v.grid, drawBorder: false },
    ticks: { color: v.ink, font: { family: v.font, size: 11 } },
  };
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: prefersReducedMotion() ? 0 : 420 },
    plugins: {
      legend: legend
        ? { labels: { color: v.ink, font: { family: v.font, size: 11 }, usePointStyle: true, pointStyle: 'circle', boxWidth: 6 } }
        : { display: false },
      tooltip: {
        backgroundColor: v.surface,
        titleColor: v.ink,
        bodyColor: v.ink,
        borderColor: v.grid,
        borderWidth: 1,
        titleFont: { family: v.font },
        bodyFont: { family: v.font },
        padding: 10,
        displayColors: legend,
      },
    },
    ...(scales ? { scales: { x: axis, y: { ...axis, beginAtZero: true } } } : {}),
  };
}

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/* ============================================================================
   Copy
   ========================================================================== */

// One-line explanations shown under each award/record card so the jargon is
// self-explanatory.
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
// Titles are plain text now -- the emoji were doing icon duty at body-text size,
// where they read as noise in a list and carried no meaning the label didn't
// already have.
const DM_AWARD_DEFS = {
  best_friend:        { title: 'Best friend',        stat: a => `${a.total.toLocaleString()} msgs` },
  fastest_replier:    { title: 'Fastest replier',    stat: a => `${formatTime(a.avg_mins)} typical reply` },
  slowest_replier:    { title: 'Leaves you on read', stat: a => `${formatTime(a.avg_mins)} typical reply` },
  makes_you_laugh:    { title: 'Makes you laugh',    stat: a => `you laugh in ${(a.lpm * 100).toFixed(0)}% of your msgs` },
  your_biggest_fan:   { title: 'Your biggest fan',   stat: a => `laughs in ${(a.lpm * 100).toFixed(0)}% of their msgs` },
  you_chase:          { title: 'You chase them',     stat: a => `you start ${a.pct}% of convos` },
  chases_you:         { title: 'They chase you',     stat: a => `they start ${a.pct}% of convos` },
  most_balanced:      { title: 'Perfectly balanced', stat: a => `${a.sent.toLocaleString()} / ${a.received.toLocaleString()} split` },
  longest_day_streak: { title: 'Longest streak',     stat: a => `${a.days} days in a row` },
  shutterbug:         { title: 'Shutterbug',         stat: a => `${a.count.toLocaleString()} media sent to you` },
};

// Top-5 leaderboards.
const LEADERBOARD_DEFS = {
  most_messages:    { title: 'Most messages',   fmt: r => `${r.value.toLocaleString()} msgs` },
  fastest_repliers: { title: 'Fastest to reply', fmt: r => formatTime(r.value) },
  top_ghosters:     { title: 'Ghosts you most', fmt: r => `${r.value}×`,
                      sub: r => `~${formatTime(r.avg_wait_hours * 60)} avg wait` },
  longest_convos:   { title: 'Longest convos',  fmt: r => `${r.value.toLocaleString()} msgs`,
                      sub: r => r.marathon && r.marathon.first_text ? `“${r.marathon.first_text}”` : null },
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

// Deep Read: the relative-standing rows, in display order. `fmt` renders the
// raw value; `flip` marks metrics where the low end is the notable one, so the
// summary line reads "faster than" rather than "more than".
const RELATIVE_DEFS = {
  their_reply_time:    { title: 'They reply',        fmt: v => formatTime(v), flip: true },
  my_reply_time:       { title: 'You reply',         fmt: v => formatTime(v), flip: true },
  my_initiation_share: { title: 'You start it',      fmt: v => `${Math.round(v * 100)}%` },
  they_make_you_laugh: { title: 'They make you laugh', fmt: v => v.toFixed(3) },
  you_make_them_laugh: { title: 'You make them laugh', fmt: v => v.toFixed(3) },
  their_tapback_rate:  { title: 'They tapback you',  fmt: v => v.toFixed(3) },
  your_tapback_rate:   { title: 'You tapback them',  fmt: v => v.toFixed(3) },
  // The stored value is the *skew*, so a smaller number is the more even chat.
  balance:             { title: 'Talking is split',  fmt: v => `${Math.round(v * 100)} pt gap`, flip: true },
};

// Style categories, in display order, with a plain-English gloss. The names are
// LIWC's; nobody outside that literature knows what "absolutist" means on sight.
const STYLE_LABELS = {
  i_me:       { title: 'I / me',      hint: 'attention turned inward' },
  we_us:      { title: 'We / us',     hint: 'shared framing' },
  you_focus:  { title: 'You',         hint: 'attention on the other person' },
  hedging:    { title: 'Hedging',     hint: 'maybe, probably, kinda' },
  certainty:  { title: 'Certainty',   hint: 'definitely, obviously, exactly' },
  absolutist: { title: 'Absolutist',  hint: 'always, never, everything' },
  negation:   { title: 'Negation',    hint: 'not, no, never' },
};

/* ============================================================================
   Formatting helpers
   ========================================================================== */

function esc(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function displayName(n) {
  return n === 'me' ? 'You' : n;
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
// How far back the call figures actually reach. Calls come from a separate
// database with its own ~2-year horizon, so they're always windowed -- to the
// chemistry window normally, or to the active date filter when that's narrower.
// The label has to track whichever is in force, or a 5-day filter would still
// claim "18mo" beside five days of messages.
function callWindowLabel() {
  const w = state.data && state.data.call_window;
  if (!w) return 'last 18 months';
  const days = w.days;
  if (days <= 31) return `${days} day${days === 1 ? '' : 's'}`;
  const months = Math.round(days / 30.4);
  return months >= 12 && months % 12 === 0
    ? `${months / 12} yr`
    : `${months}mo`;
}

function callSummaryLine(calls) {
  if (!calls || !calls.count) return null;
  return `${calls.count} call${calls.count === 1 ? '' : 's'} · ${formatCallTime(calls.total_minutes)}`;
}

// "Opened by X on <date>: 'first line…'" footer for marathon cards, so the
// conversation can be found again by searching that line in Messages.
function marathonOpenerHTML(m) {
  if (!m || !m.first_text) return '';
  const when = new Date(m.start).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const who = m.first_sender ? esc(displayName(m.first_sender)) : 'someone';
  return `<p class="award-quote">Opened by ${who} on ${esc(when)}: &ldquo;${esc(m.first_text)}&rdquo;<br>
          Search that line in Messages to relive it.</p>`;
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

/* ============================================================================
   Small markup builders
   ========================================================================== */

const $ = id => document.getElementById(id);

function metric(label, value, hint) {
  return `<div class="metric">
    <span class="metric-label">${esc(label)}</span>
    <span class="metric-value">${value}</span>
    ${hint ? `<span class="metric-hint">${esc(hint)}</span>` : ''}
  </div>`;
}

// "189 / 455" under a "(Me/Them)" header made you read the header to decode
// which side was which. Label each half at the value instead.
function pair(mine, theirs) {
  return `<span class="pair">
    <span class="pair-side"><small>me</small><b>${mine}</b></span>
    <span class="pair-sep">/</span>
    <span class="pair-side"><small>them</small><b>${theirs}</b></span>
  </span>`;
}

function chartCard(id, title, { wide = false, sub = '' } = {}) {
  return `<div class="chart${wide ? ' wide' : ''}">
    <div>
      <h3 class="chart-title">${esc(title)}</h3>
      ${sub ? `<p class="chart-sub">${esc(sub)}</p>` : ''}
    </div>
    <div class="chart-body"><canvas id="${id}"></canvas></div>
  </div>`;
}

function panelCard(title, bodyHtml, { wide = false, sub = '' } = {}) {
  return `<div class="chart${wide ? ' wide' : ''}">
    <div>
      <h3 class="chart-title">${esc(title)}</h3>
      ${sub ? `<p class="chart-sub">${esc(sub)}</p>` : ''}
    </div>
    ${bodyHtml}
  </div>`;
}

// `name`, `stat`, `blurb` and `quote` are interpolated as HTML, so every caller
// must pass values that are already escaped. They have to be raw, because
// several are composed strings that legitimately carry markup -- the marathon
// opener footer, the "X kept Y waiting" phrasing. `title` is escaped here since
// it's always literal copy from the tables above.
function awardCard(c) {
  return `<div class="award">
    <span class="award-title">${esc(c.title)}</span>
    <span class="award-name">${c.name}</span>
    <span class="award-stat">${c.stat}</span>
    ${c.blurb ? `<p class="award-blurb">${c.blurb}</p>` : ''}
    ${c.quote || ''}
  </div>`;
}

function section(title, bodyHtml, { note = '', longNote = '' } = {}) {
  // Long explanations live behind a disclosure rather than permanently above
  // the content they describe. The chemistry section's used to be a 90-word
  // paragraph you had to scroll past on every visit.
  const id = 'note-' + Math.random().toString(36).slice(2, 8);
  return `<section class="section">
    <div class="section-head">
      <h2 class="section-title">${esc(title)}</h2>
      ${note ? `<p class="section-note">${note}</p>` : ''}
      ${longNote ? `<button type="button" class="note-toggle" data-note="${id}"
                      aria-expanded="false" aria-controls="${id}">How this is calculated</button>
                    <div class="note-body" id="${id}" hidden>${longNote}</div>` : ''}
    </div>
    ${bodyHtml}
  </section>`;
}

function emptyNote(text) {
  return `<p class="empty-note">${esc(text)}</p>`;
}

/* ============================================================================
   Data access
   ========================================================================== */

function getFilteredChats() {
  if (!state.data || !state.data.chats) return [];
  if (state.chatTypeFilter === 'dm') return state.data.chats.filter(c => !c.is_group_chat);
  if (state.chatTypeFilter === 'group') return state.data.chats.filter(c => c.is_group_chat);
  return state.data.chats;
}

function globalStats() {
  const d = state.data;
  return state.chatTypeFilter === 'all'
    ? d.global_stats
    : (d.global_stats_by_type && d.global_stats_by_type[state.chatTypeFilter]) || d.global_stats;
}

/* ============================================================================
   View registry

   Which views exist depends on the scope, which is what makes every tab
   meaningful. Members only exists for a group that has members; Compare only
   exists for a DM, because comparing a group against a DM compares two
   different kinds of thing.
   ========================================================================== */

function viewsForScope(scope) {
  if (scope.kind === 'everyone') {
    return [
      { id: 'overview', label: 'Overview', render: renderEveryoneOverview },
      { id: 'rankings', label: 'Rankings', render: renderRankings },
      { id: 'records',  label: 'Records',  render: renderRecords },
    ];
  }

  const chat = scope.chat;
  const views = [{ id: 'overview', label: 'Overview', render: renderChatOverview }];

  if (chat.is_group_chat && chat.members && chat.members.length) {
    views.push({ id: 'members', label: 'Members', render: renderMembers });
  }
  // Only offered when the parser actually produced something -- a short chat
  // has no baseline to rank against and no rhythm to call a silence unusual.
  if (chat.relative || chat.silences ||
      (chat.distinctive_words && (chat.distinctive_words.sent.length ||
                                  chat.distinctive_words.received.length))) {
    views.push({ id: 'deepread', label: 'Deep Read', render: renderDeepRead });
  }
  if (chat.yearly_stats && Object.keys(chat.yearly_stats).length) {
    views.push({ id: 'trends', label: 'Trends', render: renderTrends });
  }
  if (!chat.is_group_chat) {
    views.push({ id: 'compare', label: 'Compare', render: renderCompare });
  }
  return views;
}

/* ============================================================================
   Scope + view routing
   ========================================================================== */

function setScope(scope, { view = null } = {}) {
  state.scope = scope;
  state.compareWith = null;

  const views = viewsForScope(scope);
  // Keep the same view across a scope change when it exists in the new scope --
  // moving from one person to another while reading Trends should keep showing
  // Trends, not throw you back to Overview.
  const keep = views.find(v => v.id === view) || views.find(v => v.id === state.view);
  state.view = (keep || views[0]).id;

  renderSidebar();
  renderScopeHeader();
  renderTabBar();
  renderView();
  closeSidebarSheet();
}

function setView(id) {
  if (state.view === id) return;
  state.view = id;
  renderTabBar();
  renderView();
}

function scopeTitleText() {
  if (state.scope.kind === 'everyone') return 'Everyone';
  const c = state.scope.chat;
  return c.display_name || c.chat_identifier;
}

function scopeSubText() {
  const parts = [];

  if (state.scope.kind === 'everyone') {
    const chats = getFilteredChats();
    const label = state.chatTypeFilter === 'dm' ? 'direct messages'
                : state.chatTypeFilter === 'group' ? 'group chats'
                : 'conversations';
    parts.push(`${chats.length.toLocaleString()} ${label}`);
    const g = state.data ? globalStats() : null;
    if (g) parts.push(`${g.total_messages.toLocaleString()} messages`);
  } else {
    const c = state.scope.chat;
    if (c.is_group_chat) {
      parts.push('Group chat');
      if (c.members && c.members.length) parts.push(`${c.members.length} people`);
    } else {
      parts.push('Direct message');
      // For unnamed group chats the raw "chat9847..." identifier is noise. DMs
      // still show the phone/email handle, since that's how you'd find them.
      if (c.chat_identifier && c.chat_identifier !== c.display_name) parts.push(c.chat_identifier);
    }
    parts.push(`${c.total_messages.toLocaleString()} messages`);
    if (c.first_message_date) parts.push(`since ${c.first_message_date}`);
    if (c.active_day_count) parts.push(`${c.active_day_count.toLocaleString()} active days`);
  }

  // The time filter is part of the answer to "what am I looking at", so it
  // belongs in the scope line rather than in a banner elsewhere on the page.
  const { start, end } = state.dateRange;
  if (start || end) parts.push(`${start || 'the beginning'} → ${end || 'now'}`);

  return parts.join(' · ');
}

function renderScopeHeader() {
  $('scopeTitle').textContent = scopeTitleText();
  $('scopeSub').textContent = scopeSubText();
}

function renderTabBar() {
  const bar = $('tabBar');
  const indicator = $('tabIndicator');
  const views = viewsForScope(state.scope);

  // Rebuild only when the set of tabs actually changed; otherwise the indicator
  // would have nothing to travel from and every scope change would snap it.
  const signature = views.map(v => v.id).join(',');
  if (bar.dataset.signature !== signature) {
    bar.querySelectorAll('.tab').forEach(t => t.remove());
    views.forEach(v => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tab';
      btn.setAttribute('role', 'tab');
      btn.dataset.view = v.id;
      btn.textContent = v.label;
      btn.addEventListener('click', () => setView(v.id));
      bar.appendChild(btn);
    });
    bar.dataset.signature = signature;
    // A rebuilt bar has no previous position to animate from.
    indicator.style.opacity = '0';
  }

  bar.querySelectorAll('.tab').forEach(tab => {
    tab.setAttribute('aria-selected', String(tab.dataset.view === state.view));
  });

  const active = bar.querySelector(`.tab[data-view="${state.view}"]`);
  moveIndicator(indicator, active);
}

// Views are swapped instantly, with no cross-fade.
//
// Animating the swap meant both views were in the document at once, each
// layer-promoted and re-composited every frame -- and Rankings alone is ~1,500
// elements. It stuttered visibly, and because the two shared a grid cell that
// sized to the taller of them, the page jumped when the outgoing view finally
// left. The tab indicator sliding already says the tab changed; the content
// doesn't need to say it a second time, more expensively.
function renderView() {
  const host = $('viewHost');

  const def = viewsForScope(state.scope).find(v => v.id === state.view);
  if (!def) return;

  // Old view out before the new one is built, so only one is ever in the tree.
  host.querySelectorAll('.view').forEach(v => v.remove());

  // Chart.js keeps a global registry keyed by canvas, so instances outliving
  // their canvas leak both the chart and its resize observer.
  Object.values(state.charts).forEach(c => c.destroy());
  state.charts = {};

  const view = document.createElement('div');
  view.className = 'view';
  view.setAttribute('role', 'tabpanel');
  // Appended before render() runs: Chart.js measures its container at
  // construction, and an unattached or display:none node measures 0x0, which
  // yields an invisible chart that never recovers.
  host.appendChild(view);

  def.render(view);

  wireNoteToggles(view);
  growBars(view);

  $('contentScroll').scrollTop = 0;
}

function wireNoteToggles(root) {
  root.querySelectorAll('.note-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const body = root.querySelector('#' + btn.dataset.note);
      const open = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', String(!open));
      body.hidden = open;
    });
  });
}

/* ============================================================================
   Sidebar — the single navigator

   The full list runs to hundreds of conversations. Rendering every one put ~824
   nodes (≈69,000px) in the DOM, and search then walked all of them toggling
   display. Instead each section renders a capped window and grows on demand;
   search filters the data and re-renders, so the DOM only ever holds what's
   actually on screen.
   ========================================================================== */

const SIDEBAR_PAGE = 40;
const sidebarShown = { dm: SIDEBAR_PAGE, group: SIDEBAR_PAGE };

function renderSidebar() {
  const list = $('scopeList');
  const term = ($('chatSearch').value || '').trim().toLowerCase();
  list.innerHTML = '';

  // "Everyone" is a scope like any other, so it's an ordinary row in the same
  // list rather than a separate control somewhere else. It hides during a
  // search because you're looking for a person at that point.
  if (!term) {
    const group = document.createElement('div');
    group.className = 'sidebar-group';
    group.appendChild(scopeRow({
      name: 'Everyone',
      meta: state.data ? `${getFilteredChats().length.toLocaleString()} conversations` : '',
      current: state.scope.kind === 'everyone',
      onSelect: () => setScope({ kind: 'everyone' }),
    }));
    list.appendChild(group);
  }

  let visible = getFilteredChats();
  if (term) {
    visible = visible.filter(c =>
      (c.display_name || c.chat_identifier || '').toLowerCase().includes(term));
  }

  if (!visible.length) {
    const empty = document.createElement('p');
    empty.className = 'sidebar-empty';
    empty.textContent = term
      ? `No conversation matches “${term}”.`
      : 'No conversations in this range.';
    list.appendChild(empty);
    return;
  }

  const dms = visible.filter(c => !c.is_group_chat);
  const gcs = visible.filter(c => c.is_group_chat);

  addGroup(list, 'People', dms, 'dm', term);
  addGroup(list, 'Groups', gcs, 'group', term);
}

function addGroup(list, title, chats, key, term) {
  if (!chats.length) return;

  const group = document.createElement('div');
  group.className = 'sidebar-group';

  const label = document.createElement('div');
  label.className = 'sidebar-label';
  // Searching should show what it found, not just a static label.
  label.textContent = `${title} · ${chats.length.toLocaleString()}`;
  group.appendChild(label);

  // A search narrow enough to fit is shown whole; otherwise page through.
  const limit = term ? Math.max(sidebarShown[key], SIDEBAR_PAGE) : sidebarShown[key];

  chats.slice(0, limit).forEach(chat => {
    group.appendChild(scopeRow({
      name: chat.display_name || chat.chat_identifier,
      meta: `${chat.total_messages.toLocaleString()} msgs · ${relTime(chat.last_message_date)}`,
      current: state.scope.kind === 'chat'
               && state.scope.chat.chat_identifier === chat.chat_identifier,
      onSelect: () => setScope({ kind: 'chat', chat }),
    }));
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
    group.appendChild(more);
  }

  list.appendChild(group);
}

// Built as a DOM node rather than an HTML string because chat identifiers can
// contain quotes and other characters that make an attribute selector invalid;
// holding the chat object in the closure sidesteps identifier escaping entirely.
function scopeRow({ name, meta, current, onSelect }) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'scope-item';
  if (current) btn.setAttribute('aria-current', 'true');

  const n = document.createElement('span');
  n.className = 'scope-name';
  n.textContent = name;
  btn.appendChild(n);

  if (meta) {
    const m = document.createElement('span');
    m.className = 'scope-meta';
    m.textContent = meta;
    btn.appendChild(m);
  }

  btn.addEventListener('click', onSelect);
  return btn;
}

/* ============================================================================
   Views — Everyone
   ========================================================================== */

function renderEveryoneOverview(root) {
  const stats = globalStats();
  const ratio = stats.total_messages ? Math.round((stats.sent / stats.total_messages) * 100) : 0;

  root.innerHTML = `
    <div class="metrics">
      ${metric('Total messages', stats.total_messages.toLocaleString())}
      ${metric('Sent', stats.sent.toLocaleString())}
      ${metric('Received', stats.received.toLocaleString())}
      ${metric('Sent ratio', ratio + '%', 'share of messages you wrote')}
    </div>

    <div class="charts">
      ${chartCard('gMonthly', 'Messages over time', { wide: true })}
      ${chartCard('gDaily', 'Day of week')}
      ${chartCard('gHourly', 'Hourly activity', { wide: true })}
      ${chartCard('gReactions', 'Reactions')}
      ${panelCard('Top words', `<ul class="rows scroll-y">${
        (stats.top_words || []).map(w =>
          `<li class="row"><span class="row-label">${esc(w[0])}</span><span class="row-value">${w[1].toLocaleString()}</span></li>`
        ).join('') || emptyNote('None')
      }</ul>`)}
      ${panelCard('Top emojis', `<div class="emoji-grid">${
        (stats.top_emojis || []).map(e =>
          `<div class="emoji-item"><span>${esc(e[0])}</span><span class="emoji-count">${e[1].toLocaleString()}</span></div>`
        ).join('') || emptyNote('None')
      }</div>`)}
    </div>`;

  const v = viz();

  if (stats.monthly_activity) {
    const monthly = fillMonthlyGaps(stats.monthly_activity);
    line(root, 'gMonthly', monthly.labels, monthly.values, v, 0.3);
  }
  line(root, 'gHourly', Array.from({ length: 24 }, (_, i) => `${i}:00`), stats.hourly_distribution, v, 0.4);

  state.charts.gDaily = new Chart(root.querySelector('#gDaily'), {
    type: 'bar',
    data: {
      labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
      datasets: [{ label: 'Messages', data: stats.daily_distribution, backgroundColor: v.primary, borderRadius: 4 }],
    },
    options: chartOptions(),
  });

  // Build one label set from the union of both dicts so sent/received values
  // stay aligned to the right axis labels.
  const sentMap = stats.reactions_sent || {};
  const recvMap = stats.reactions_received || {};
  const rLabels = [...new Set([...Object.keys(sentMap), ...Object.keys(recvMap)])];
  if (rLabels.length) {
    state.charts.gReactions = new Chart(root.querySelector('#gReactions'), {
      type: 'radar',
      data: {
        labels: rLabels,
        datasets: [
          { label: 'Sent', data: rLabels.map(k => sentMap[k] || 0),
            borderColor: v.me, backgroundColor: withAlpha(v.me, 0.18), borderWidth: 2 },
          { label: 'Received', data: rLabels.map(k => recvMap[k] || 0),
            borderColor: v.them, backgroundColor: withAlpha(v.them, 0.18), borderWidth: 2 },
        ],
      },
      options: {
        ...chartOptions({ legend: true, scales: false }),
        scales: {
          r: {
            ticks: { display: false },
            grid: { color: v.grid },
            angleLines: { color: v.grid },
            pointLabels: { color: v.ink, font: { family: v.font, size: 11 } },
          },
        },
      },
    });
  }
}

function line(root, id, labels, values, v, tension) {
  const el = root.querySelector('#' + id);
  if (!el) return;
  state.charts[id] = new Chart(el, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Messages', data: values,
        borderColor: v.primary, backgroundColor: v.primaryFill,
        borderWidth: 2, fill: true, tension, pointRadius: 0,
      }],
    },
    options: chartOptions(),
  });
}

// Only the strongest few chats get the full bar breakdown. Rendering all of
// them expanded produced ~4,500px of near-identical cards that buried every
// section below Chemistry.
const CHEM_FEATURED = 6;
const CHEM_ROWS_COLLAPSED = 10;
let chemShowAll = false;

const SENTIMENT_MIN_MESSAGES = 20;
const SENTIMENT_MAX_CARDS = 30;

function renderRankings(root) {
  const records = (state.data && state.data.records) || {};
  const matches = records.chemistry || [];
  const boards = records.leaderboards || {};

  const chemBody = matches.length
    ? `<div class="chem-grid">${matches.slice(0, CHEM_FEATURED).map(chemCardHtml).join('')}</div>
       <div id="chemRest"></div>`
    : emptyNote('Not enough recent two-way DM activity to score chemistry yet — it needs 50+ messages in the last 18 months with both people taking part.');

  const boardCards = Object.entries(LEADERBOARD_DEFS)
    .filter(([key]) => (boards[key] || []).length)
    .map(([key, def]) => panelCard(def.title, `<ol class="rows">${
      boards[key].map((r, i) => `
        <li class="row">
          <span class="row-label${def.sub && def.sub(r) ? ' stacked' : ''}"><span class="rank">${i + 1}</span> ${esc(displayName(r.name))}${
            def.sub && def.sub(r) ? `<br><span class="chem-note">${esc(def.sub(r))}</span>` : ''}</span>
          <span class="row-value">${esc(def.fmt(r))}</span>
        </li>`).join('')
    }</ol>`));

  // Only chats with a real sample, strongest feeling first. This used to render
  // a card for every DM -- hundreds of them, most with too little scorable text
  // to say anything, all showing the same number.
  const dms = state.data.chats
    .filter(c => !c.is_group_chat && c.sentiment_avg != null
                 && (c.sentiment_msg_count || 0) >= SENTIMENT_MIN_MESSAGES)
    .sort((a, b) => b.sentiment_avg - a.sentiment_avg)
    .slice(0, SENTIMENT_MAX_CARDS);

  const globalSentiment = state.data.global_stats_by_type?.dm?.sentiment_avg;

  root.innerHTML = `
    ${section('Chemistry', chemBody, {
      note: 'Every one-on-one chat scored 0–100, best first.',
      longNote: `Scored from <em>the last 18 months only</em> — older history doesn't count.
        It blends how much and how regularly you actually talk (recent weeks count most)
        with how <em>mutual</em> it is when you do: balanced back-and-forth, fast replies
        both ways, shared conversation-starting, and the reactions and laughs you trade.
        Each mutual signal uses a geometric mean, so if either side contributes nothing
        that component collapses to zero — it takes two.`,
    })}

    ${section('Leaderboards',
      boardCards.length
        ? `<div class="charts">${boardCards.join('')}</div>`
        : emptyNote('Not enough DM activity in this range to build leaderboards.'),
      { note: 'The top 5 in each category across all your one-on-one chats.' })}

    ${section('Sentiment',
      dms.length
        ? `<div class="metrics">${metric('Global sentiment',
             globalSentiment == null ? '—' : globalSentiment.toFixed(2), 'across all DMs')}</div>
           <div class="sentiment-grid">${dms.map(sentimentCardHtml).join('')}</div>`
        : emptyNote(`No conversation has ${SENTIMENT_MIN_MESSAGES}+ messages with measurable sentiment in this range.`),
      {
        note: 'Mood and tone across every conversation, on a 0–1 scale.',
        longNote: `0 is negative, 1 is positive. Only messages carrying a recognisable
          sentiment word are scored, and only chats with ${SENTIMENT_MIN_MESSAGES}+ such
          messages are listed — below that, one enthusiastic “love it” swings the whole
          number.`,
      })}`;

  renderChemRest(root);
  wireChemNavigation(root);
}

function chemCardHtml(mch, i) {
  const bars = Object.keys(CHEM_LABELS).map(k => {
    const pct = Math.round((mch.breakdown[k] || 0) * 100);
    return `<span class="chem-bar-label">${esc(CHEM_LABELS[k])}</span>
            <span class="bar-track"><span class="bar-fill" data-fill="${pct}"></span></span>
            <span class="chem-bar-pct">${pct}</span>`;
  }).join('');

  const callLine = callSummaryLine(mch.calls);
  const note = [mch.highlight, callLine].filter(Boolean).join(' · ');

  return `<button type="button" class="chem-card" data-chem="${esc(mch.chat_identifier)}">
    <span class="chem-top">
      <span class="chem-rank">${i + 1}</span>
      <span class="chem-id">
        <span class="chem-name">${esc(mch.name)}</span>
        <span class="chem-note">${esc(note)}</span>
      </span>
      <span class="chem-score">${mch.score}<span class="chem-score-of">/100</span></span>
    </span>
    <span class="chem-bars">${bars}</span>
  </button>`;
}

// Compact one-line form for everyone outside the featured ranks.
function chemRowHtml(mch, i) {
  return `<button type="button" class="chem-row" data-chem="${esc(mch.chat_identifier)}">
    <span class="chem-rank">${i + 1}</span>
    <span class="chem-row-name">${esc(mch.name)}</span>
    <span class="bar-track"><span class="bar-fill" data-fill="${mch.score}"></span></span>
    <span class="chem-row-score">${mch.score}</span>
  </button>`;
}

function renderChemRest(root) {
  const host = root.querySelector('#chemRest');
  if (!host) return;

  const matches = (state.data.records && state.data.records.chemistry) || [];
  const remaining = matches.slice(CHEM_FEATURED);
  if (!remaining.length) { host.innerHTML = ''; return; }

  const shown = chemShowAll ? remaining : remaining.slice(0, CHEM_ROWS_COLLAPSED);
  host.innerHTML = `
    <div class="chem-rows">${shown.map((m, i) => chemRowHtml(m, i + CHEM_FEATURED)).join('')}</div>
    ${remaining.length > CHEM_ROWS_COLLAPSED
      ? `<button type="button" class="note-toggle" id="chemToggle">${
          chemShowAll ? 'Show fewer' : `Show all ${matches.length} scored chats`}</button>`
      : ''}`;

  const toggle = host.querySelector('#chemToggle');
  if (toggle) toggle.addEventListener('click', () => {
    chemShowAll = !chemShowAll;
    renderChemRest(root);
    growBars(host);
    wireChemNavigation(root);
  });

  growBars(host);
}

// A chemistry card names a conversation, so clicking it should go there. It's
// the same object the sidebar lists, and things that look the same must behave
// the same way.
//
// Matched on chat_identifier, not display_name: 15 display names in this data
// are shared by more than one conversation (two threads with the same contact,
// a person reachable at both a number and an email), so a name lookup silently
// opens whichever one happens to be first in the array.
function wireChemNavigation(root) {
  root.querySelectorAll('[data-chem]').forEach(el => {
    if (el.dataset.wired) return;
    el.dataset.wired = '1';
    el.addEventListener('click', () => {
      const chat = state.data.chats.find(c => c.chat_identifier === el.dataset.chem);
      if (chat) setScope({ kind: 'chat', chat }, { view: 'overview' });
    });
  });
}

function sentimentCardHtml(chat) {
  const s = chat.sentiment_avg;
  const mood = s > 0.65 ? 'Positive' : s > 0.45 ? 'Neutral' : 'Negative';
  return `<div class="sentiment-card">
    <span class="sentiment-name">${esc(chat.display_name)}</span>
    <span class="sentiment-value">${s.toFixed(2)}</span>
    <span class="bar-track"><span class="bar-fill" data-fill="${(s * 100).toFixed(0)}"></span></span>
    <span class="chem-note">${mood} · ${(chat.sentiment_msg_count || 0).toLocaleString()} scored</span>
  </div>`;
}

function renderRecords(root) {
  const records = (state.data && state.data.records) || {};
  const cards = [];

  const m = records.marathon_chat;
  if (m) cards.push({
    title: 'Marathon chat', name: esc(m.chat),
    stat: `${m.message_count} msgs in ${m.duration_hours < 1
      ? Math.round(m.duration_hours * 60) + 'm' : m.duration_hours.toFixed(1) + 'h'}`,
    blurb: TERM_BLURBS.marathon_chat, quote: marathonOpenerHTML(m),
  });

  const g = records.ghosting;
  if (g) cards.push({
    title: 'Ghosting', name: `${esc(displayName(g.ghoster))} kept ${esc(displayName(g.asker))} waiting`,
    stat: formatTime(g.delay_hours * 60), blurb: TERM_BLURBS.ghosting,
  });

  const o = records.most_one_sided_chat;
  if (o) cards.push({
    title: 'The monologue', name: esc(o.chat),
    stat: `${o.dominant === 'me' ? 'You' : 'They'} sent ${Math.round(o.skew * 50 + 50)}% of it`,
    blurb: TERM_BLURBS.most_one_sided_chat,
  });

  const p = records.peak_season;
  if (p) cards.push({
    title: 'Peak season', name: esc(p.month),
    stat: `${p.message_count.toLocaleString()} msgs`, blurb: TERM_BLURBS.peak_season,
  });

  const d = records.chronic_double_texter;
  if (d) cards.push({
    title: 'Chronic double texter', name: esc(displayName(d.handle)),
    stat: `${d.count} double texts`, blurb: TERM_BLURBS.chronic_double_texter,
  });

  const b = records.busiest_day;
  if (b) cards.push({
    title: 'Busiest day ever', name: esc(b.date),
    stat: `${b.count.toLocaleString()} msgs in one day`, blurb: TERM_BLURBS.busiest_day,
  });

  const lm = records.longest_message;
  if (lm) {
    // In a DM the chat is named after the other person, so "Alice in Alice"
    // read as a glitch. Only name the chat when it adds something.
    const sender = displayName(lm.sender);
    const inChat = lm.chat && lm.chat !== sender ? ` in ${esc(lm.chat)}` : '';
    cards.push({
      title: 'Longest message', name: `${esc(sender)}${inChat}`,
      stat: `${lm.chars.toLocaleString()} characters`,
      blurb: TERM_BLURBS.longest_message,
      quote: `<p class="award-quote">“${esc(lm.preview)}${lm.chars > lm.preview.length ? '…' : ''}”</p>`,
    });
  }

  const awards = records.dm_awards || {};
  const awardCards = Object.entries(DM_AWARD_DEFS)
    .filter(([key]) => awards[key])
    .map(([key, def]) => awardCard({
      title: def.title, name: esc(awards[key].name),
      stat: esc(def.stat(awards[key])), blurb: TERM_BLURBS[key] || '',
    }));

  root.innerHTML = `
    ${section('All-time records',
      cards.length
        ? `<div class="award-grid">${cards.map(awardCard).join('')}</div>`
        : emptyNote('Not enough data in this range to calculate records yet.'),
      { note: 'Pulled from your whole texting history, or whatever time range is selected.' })}

    ${section('DM superlatives',
      awardCards.length
        ? `<div class="award-grid">${awardCards.join('')}</div>`
        : emptyNote('Not enough DM activity in this range to hand out awards.'),
      { note: 'Awards across all your one-on-one conversations.' })}`;
}

/* ============================================================================
   Views — a conversation
   ========================================================================== */

function renderChatOverview(root) {
  const chat = state.scope.chat;
  const v = viz();

  const calls = chat.calls;
  // Call time is windowed (macOS prunes call history), so say over what rather
  // than letting it read as an all-time figure. The window is the chemistry
  // window *or* the active date filter, whichever is narrower -- so the label
  // has to come from the payload, not a hard-coded "18 months".
  const callHint = calls
    ? `${calls.count} call${calls.count === 1 ? '' : 's'} · ${calls.outgoing} out / ${calls.incoming} in`
    : (chat.is_group_chat ? 'matched for 1-on-1 chats only' : `none in ${callWindowLabel()}`);

  const chemHint = chat.chemistry
    ? (chat.chemistry.highlight || '')
    : (chat.is_group_chat ? 'scored for 1-on-1 chats only' : 'not enough recent two-way activity');

  const records = chatRecordCards(chat);

  root.innerHTML = `
    <div class="metrics">
      ${metric('Total messages', chat.total_messages.toLocaleString())}
      ${metric('Chemistry', chat.chemistry ? chat.chemistry.score : '—', chemHint)}
      ${metric('Typical reply', pair(formatTime(chat.median_response_time_sent_mins),
                                     formatTime(chat.median_response_time_received_mins)))}
      ${metric('Laughs per message', pair((chat.lpm_sent || 0).toFixed(2), (chat.lpm_recv || 0).toFixed(2)))}
      ${metric('Double texts', pair(chat.double_texts_sent || 0, chat.double_texts_received || 0))}
      ${metric('Words per message', pair((chat.avg_words_sent || 0).toFixed(1), (chat.avg_words_recv || 0).toFixed(1)))}
      ${metric('Media shared', pair((chat.media_sent || 0).toLocaleString(), (chat.media_received || 0).toLocaleString()))}
      ${metric('Call time', calls ? formatCallTime(calls.total_minutes) : '—', callHint)}
    </div>

    ${records.length ? `<div class="award-grid">${records.map(awardCard).join('')}</div>` : ''}

    <div class="charts">
      ${chartCard('cMonthly', 'Monthly activity', { wide: true })}
      ${chartCard('cBalance', 'Conversational balance')}
      ${chartCard('cHourly', 'Hourly activity', { wide: true })}
      ${chartCard('cInit', 'Who starts it')}
      ${panelCard('Top emojis', comparisonHtml(chat.top_emojis_sent, chat.top_emojis_received))}
      ${panelCard('Top words', comparisonHtml(chat.top_words_sent, chat.top_words_received))}
    </div>`;

  if (chat.monthly_activity) {
    const monthly = fillMonthlyGaps(chat.monthly_activity);
    line(root, 'cMonthly', monthly.labels, monthly.values, v, 0.3);
  }
  if (chat.hourly_distribution) {
    line(root, 'cHourly', Array.from({ length: 24 }, (_, i) => `${i}:00`), chat.hourly_distribution, v, 0.4);
  }

  // The donut's segment gap is painted in the card's own surface color, so it
  // reads as a gap in both themes instead of a dark ring on white.
  state.charts.cBalance = new Chart(root.querySelector('#cBalance'), {
    type: 'doughnut',
    data: {
      labels: ['Me', 'Them'],
      datasets: [{ data: [chat.sent, chat.received],
                   backgroundColor: [v.me, v.them], borderColor: v.surface, borderWidth: 2 }],
    },
    options: chartOptions({ legend: true, scales: false }),
  });

  state.charts.cInit = new Chart(root.querySelector('#cInit'), {
    type: 'pie',
    data: {
      labels: ['Me', 'Them'],
      datasets: [{ data: [chat.initiations_sent || 0, chat.initiations_received || 0],
                   // Same two entities as the balance donut, so the same two colors.
                   backgroundColor: [v.me, v.them], borderColor: v.surface, borderWidth: 2 }],
    },
    options: chartOptions({ legend: true, scales: false }),
  });
}

// Each item is a [value, count] pair (from Counter.most_common); show the count
// so you can see how often each word/emoji was actually used.
function comparisonHtml(sent, received) {
  const col = arr => (arr && arr.length)
    ? arr.map(i => {
        const [val, count] = Array.isArray(i) ? i : [i, null];
        return `<span class="chip"><b>${esc(val)}</b>${
          count != null ? `<span class="chip-count">${count.toLocaleString()}</span>` : ''}</span>`;
      }).join('')
    : emptyNote('None');

  return `<div class="split">
    <div class="split-col"><span class="split-head">Me</span><div>${col(sent)}</div></div>
    <div class="split-col"><span class="split-head">Them</span><div>${col(received)}</div></div>
  </div>`;
}

/* ============================================================================
   Deep Read

   Four panels that all answer "compared to what?" -- the question the Overview's
   raw numbers can't. Standing ranks this chat against every other DM; silences
   compare a gap against this chat's own rhythm; distinctive words compare its
   vocabulary against your baseline; style compares how it's written against how
   you write everywhere else.
   ========================================================================== */

function relativeRowsHtml(relative) {
  const rows = Object.entries(RELATIVE_DEFS)
    .filter(([key]) => relative[key])
    .map(([key, def]) => {
      const r = relative[key];
      // percentile is already oriented so 100 = the notable end of the scale.
      const pct = Math.round(r.percentile);
      const medal = r.rank <= 3 ? ` rank-${r.rank}` : '';
      return `<li class="row deep-row">
        <span class="row-label"><span class="rank${medal}">${r.rank}</span> ${esc(def.title)}
          <span class="chem-note">${esc(def.fmt(r.value))} · typical is ${esc(def.fmt(r.median_across_dms))}</span>
        </span>
        <span class="deep-bar">
          <span class="bar-track"><span class="bar-fill" data-fill="${pct}"></span></span>
          <span class="chem-bar-pct">${r.rank}/${r.of}</span>
        </span>
      </li>`;
    });
  return rows.length ? `<ol class="rows">${rows.join('')}</ol>` : '';
}

function silencesHtml(s) {
  const events = (s.events || []).map(e => {
    const days = e.hours / 24;
    const span = days >= 1.5 ? `${Math.round(days)} days` : `${Math.round(e.hours)} hours`;
    return `<li class="row deep-row">
      <span class="row-label">${esc(span)} of nothing
        <span class="chem-note">${esc(e.start.slice(0, 10))} → ${esc(e.end.slice(0, 10))} ·
          ${esc(e.broken_by)} spoke first</span>
      </span>
      <span class="row-value">${(e.hours / s.typical_lull_hours).toFixed(0)}×</span>
    </li>`;
  }).join('');

  return `<div class="metrics">
      ${metric('Typical quiet stretch', formatTime(s.typical_lull_hours * 60), 'between messages')}
      ${metric('Counts as a silence', formatTime(s.threshold_hours * 60), 'for this chat')}
      ${metric('Silences found', s.count.toLocaleString())}
      ${metric('Who broke them', pair(s.broken_by_me, s.broken_by_them), 'spoke first after')}
    </div>
    <div class="charts">
      ${panelCard('Longest silences', `<ol class="rows">${events}</ol>`,
                  { wide: true, sub: 'Multiples are against this chat’s own typical gap.' })}
    </div>`;
}

function distinctiveHtml(d) {
  const col = arr => (arr && arr.length)
    ? arr.map(w => `<span class="chip"><b>${esc(w.word)}</b><span class="chip-count">${w.count.toLocaleString()}</span></span>`).join('')
    : emptyNote('Not enough text to compare.');

  return `<div class="split">
    <div class="split-col"><span class="split-head">Me</span><div>${col(d.sent)}</div></div>
    <div class="split-col"><span class="split-head">Them</span><div>${col(d.received)}</div></div>
  </div>`;
}

function styleHtml(style, baseline) {
  const rows = Object.entries(STYLE_LABELS).map(([key, def]) => {
    const mine = style.sent ? style.sent.rates[key] : null;
    const theirs = style.received ? style.received.rates[key] : null;
    const base = baseline && baseline.rates ? baseline.rates[key] : null;
    // Only your own side has a personal baseline to compare against: "you use
    // 'I' more here than you do anywhere else" is a statement about you. Their
    // rate has no equivalent -- you'd need that person's messages to everyone
    // else, which this database doesn't have.
    const delta = (mine != null && base) ? mine / base : null;
    const drift = delta != null && Math.abs(delta - 1) >= 0.15
      ? `<span class="chem-note">${delta > 1 ? '↑' : '↓'} ${Math.abs(Math.round((delta - 1) * 100))}% vs. your norm</span>`
      : '';
    return `<li class="row deep-row">
      <span class="row-label">${esc(def.title)}
        <span class="chem-note">${esc(def.hint)}</span>${drift}
      </span>
      <span class="row-value">${pair(mine == null ? '—' : mine.toFixed(1),
                                     theirs == null ? '—' : theirs.toFixed(1))}</span>
    </li>`;
  }).join('');

  return `<ol class="rows">${rows}</ol>`;
}

function renderDeepRead(root) {
  const chat = state.scope.chat;
  const parts = [];

  if (chat.relative && Object.keys(chat.relative).length) {
    parts.push(section('Standing', relativeRowsHtml(chat.relative), {
      note: 'Where this conversation ranks among all your one-on-one chats.',
      longNote: `A reply time on its own is nearly meaningless — fast compared to what?
        Each row ranks this chat against the same measurement in every other DM with
        enough data, and shows what a typical conversation of yours looks like. The bar
        is the percentile: full means this is the most extreme chat you have on that
        measure.`,
    }));
  }

  if (chat.silences) {
    parts.push(section('Silences', silencesHtml(chat.silences), {
      note: 'Gaps that are unusual for this relationship specifically.',
      longNote: `A fixed threshold like “over a week” flags every dormant acquaintance
        and misses the friend you normally talk to hourly going quiet for two days —
        which is the one that means something. So the bar is set from this chat’s own
        rhythm: a gap has to beat both its 95th-percentile lull and 3× its typical
        one (and at least 24 hours) before it counts.`,
    }));
  }

  const d = chat.distinctive_words;
  if (d && ((d.sent || []).length || (d.received || []).length)) {
    parts.push(section('Distinctive words', distinctiveHtml(d), {
      note: 'Words used here far more than anywhere else.',
      longNote: `Not the most frequent words — those are the same in every chat. These
        are words whose rate here stands out against the same person-type baseline
        everywhere else (your words against all your words; theirs against everyone
        else’s). Scored with a log-odds ratio under an informative Dirichlet prior, which
        keeps a word said twice from outranking one said two hundred times.`,
    }));
  }

  const st = chat.style;
  if (st && (st.sent || st.received)) {
    const baseline = state.data.global_stats && state.data.global_stats.style_sent;
    parts.push(section('Style', styleHtml(st, baseline), {
      note: 'How this conversation is written, per 1,000 words.',
      longNote: `Function-word rates — the small words that carry tone rather than
        topic. Categories overlap on purpose (“never” is both absolutist and a negation);
        they’re separate lenses, not a partition. Your side is compared against how you
        write across every chat, so the arrow means you shift when talking to this person.`,
    }));
  }

  root.innerHTML = parts.length
    ? parts.join('')
    : emptyNote('Not enough messages in this conversation for a deep read — it needs a few hundred words and a dozen or so quiet stretches to compare against.');
}

function chatRecordCards(chat) {
  const cards = [];

  const s = chat.day_streak;
  if (s && s.days >= 2) cards.push({
    title: 'Day streak', name: `${s.days} days in a row`,
    stat: `${esc(s.start)} → ${esc(s.end)}`, blurb: TERM_BLURBS.day_streak,
  });

  const m = chat.marathon_chat;
  if (m && m.message_count >= 2) cards.push({
    title: 'Marathon', name: `${m.message_count} msgs back-to-back`,
    stat: m.duration_hours < 1 ? Math.round(m.duration_hours * 60) + 'm' : m.duration_hours.toFixed(1) + 'h',
    blurb: TERM_BLURBS.marathon_chat, quote: marathonOpenerHTML(m),
  });

  const g = chat.ghosting;
  if (g && g.delay_hours > 1) cards.push({
    title: 'Longest ghost', name: `${esc(displayName(g.ghoster))} kept ${esc(displayName(g.asker))} waiting`,
    stat: formatTime(g.delay_hours * 60), blurb: TERM_BLURBS.ghosting,
  });

  const b = chat.busiest_day;
  if (b && b.count >= 10) cards.push({
    title: 'Busiest day', name: esc(b.date),
    stat: `${b.count.toLocaleString()} msgs`, blurb: TERM_BLURBS.chat_busiest_day,
  });

  return cards;
}

/* --- Members ------------------------------------------------------------- */

const MEMBER_COLUMNS = [
  { key: 'handle', label: 'Member', fmt: x => esc(displayName(x.handle)) },
  { key: 'message_count', label: 'Messages', fmt: x => x.message_count.toLocaleString() },
  { key: 'message_share_pct', label: 'Share', fmt: x => x.message_share_pct.toFixed(1) + '%' },
  { key: 'reactions_received', label: 'Reactions', fmt: x => x.reactions_received.toLocaleString() },
  { key: 'main_character_score', label: 'MC score', fmt: x => x.main_character_score },
];

function renderMembers(root) {
  const chat = state.scope.chat;
  const m = chat.members;
  const v = viz();

  const cards = [];
  const top = (cmp) => [...m].sort(cmp)[0];

  const mostActive = top((a, b) => b.message_count - a.message_count);
  if (mostActive) cards.push({ title: 'Most active', name: esc(displayName(mostActive.handle)),
    stat: mostActive.message_count.toLocaleString() + ' msgs', blurb: TERM_BLURBS.most_active });

  const magnet = top((a, b) => b.reactions_received_per_msg - a.reactions_received_per_msg);
  if (magnet) cards.push({ title: 'Reaction magnet', name: esc(displayName(magnet.handle)),
    stat: magnet.reactions_received_per_msg.toFixed(2) + ' per msg', blurb: TERM_BLURBS.reaction_magnet });

  const hype = top((a, b) => b.reactions_given - a.reactions_given);
  if (hype) cards.push({ title: 'Hype person', name: esc(displayName(hype.handle)),
    stat: hype.reactions_given.toLocaleString() + ' reactions', blurb: TERM_BLURBS.hype_person });

  const ghost = top((a, b) => b.ghost_score - a.ghost_score);
  if (ghost && ghost.ghost_score > 0.3) cards.push({ title: 'Ghost', name: esc(displayName(ghost.handle)),
    stat: ghost.ghost_score.toFixed(2) + ' score', blurb: TERM_BLURBS.ghost });

  const owl = top((a, b) => b.night_owl_pct - a.night_owl_pct);
  if (owl) cards.push({ title: 'Night owl', name: esc(displayName(owl.handle)),
    stat: owl.night_owl_pct.toFixed(1) + '%', blurb: TERM_BLURBS.night_owl });

  const starter = top((a, b) => b.initiation_pct - a.initiation_pct);
  if (starter) cards.push({ title: 'Conversation starter', name: esc(displayName(starter.handle)),
    stat: starter.initiation_pct.toFixed(1) + '%', blurb: TERM_BLURBS.conv_starter });

  const paparazzi = top((a, b) => (b.media_count || 0) - (a.media_count || 0));
  if (paparazzi && paparazzi.media_count > 0) cards.push({ title: 'Paparazzi',
    name: esc(displayName(paparazzi.handle)),
    stat: paparazzi.media_count.toLocaleString() + ' media', blurb: TERM_BLURBS.paparazzi });

  const reactions = (chat.reaction_matrix || []).sort((a, b) => b.count - a.count).slice(0, 10);

  root.innerHTML = `
    ${section('Leaderboard', `<div class="chart"><div class="table-wrap">
      <table id="memberTable">
        <thead><tr>
          <th>Rank</th>
          ${MEMBER_COLUMNS.map(c => `<th data-sort="${c.key}">${esc(c.label)}</th>`).join('')}
        </tr></thead>
        <tbody id="memberBody"></tbody>
      </table></div></div>`,
      { note: 'MC score blends message volume, reactions received, and conversations started.' })}

    ${cards.length ? section('Awards', `<div class="award-grid">${cards.map(awardCard).join('')}</div>`) : ''}

    ${section('Dynamics', `<div class="charts">
      ${panelCard('Who reacts to whom', `<ul class="rows scroll-y">${
        reactions.length
          ? reactions.map(r => `<li class="row">
              <span class="row-label">${esc(displayName(r.from))} → ${esc(displayName(r.to))}</span>
              <span class="row-value">${r.count.toLocaleString()}</span></li>`).join('')
          : emptyNote('No reactions recorded in this range.')
      }</ul>`, { wide: true })}
      ${chartCard('memberShare', 'Message share')}
    </div>`)}`;

  renderMemberRows(root);

  root.querySelectorAll('th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      if (state.sortColumn === col) state.sortAsc = !state.sortAsc;
      else { state.sortColumn = col; state.sortAsc = false; }
      renderMemberRows(root);
    });
  });

  // This was a doughnut fed the whole categorical palette, which Chart.js then
  // cycled once a group had more members than colors -- two people sharing a
  // color in the same chart. It's also the wrong form: ranking members by
  // volume is one series of magnitudes, so it's a bar in a single hue, which
  // stays readable at any member count and needs no legend at all.
  const byCount = [...m].sort((a, b) => b.message_count - a.message_count);
  const topMembers = byCount.slice(0, 10);
  const otherTotal = byCount.slice(10).reduce((sum, x) => sum + x.message_count, 0);
  const shareLabels = topMembers.map(x => displayName(x.handle));
  const shareValues = topMembers.map(x => x.message_count);
  if (otherTotal > 0) {
    shareLabels.push(`Other (${byCount.length - 10})`);
    shareValues.push(otherTotal);
  }

  state.charts.memberShare = new Chart(root.querySelector('#memberShare'), {
    type: 'bar',
    data: { labels: shareLabels,
            datasets: [{ label: 'Messages', data: shareValues, backgroundColor: v.primary, borderRadius: 4 }] },
    options: { ...chartOptions(), indexAxis: 'y' },
  });
}

function renderMemberRows(root) {
  const m = [...state.scope.chat.members];
  m.sort((a, b) => {
    const valA = a[state.sortColumn];
    const valB = b[state.sortColumn];
    if (typeof valA === 'string') return state.sortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
    return state.sortAsc ? valA - valB : valB - valA;
  });

  root.querySelector('#memberBody').innerHTML = m.map((x, i) => `
    <tr>
      <td class="rank rank-${i + 1}">${i + 1}</td>
      ${MEMBER_COLUMNS.map(c => `<td>${c.fmt(x)}</td>`).join('')}
    </tr>`).join('');

  root.querySelectorAll('th[data-sort]').forEach(th => {
    if (th.dataset.sort === state.sortColumn) {
      th.setAttribute('aria-sort', state.sortAsc ? 'ascending' : 'descending');
    } else {
      th.removeAttribute('aria-sort');
    }
  });
}

/* --- Trends -------------------------------------------------------------- */

function renderTrends(root) {
  const chat = state.scope.chat;
  const yearlyStats = chat.yearly_stats || {};
  const years = Object.keys(yearlyStats).sort();

  // null values mean "not measurable this year" rather than zero, so they get
  // no arrow instead of a bogus -100%.
  const getChange = (curr, prev) => {
    if (curr == null || prev == null || !prev) return null;
    const pct = Math.round((curr - prev) / prev * 100);
    if (pct === 0) return null;
    return { pct: Math.abs(pct), dir: pct > 0 ? 'up' : 'down' };
  };

  // Direction is data, so it's allowed color -- and it's always paired with an
  // arrow glyph so it never depends on color alone.
  const delta = ch => ch
    ? `<span class="delta ${ch.dir}">${ch.dir === 'up' ? '↑' : '↓'}${ch.pct}%</span>` : '';

  const row = (label, value, change) => `
    <div class="row">
      <span class="row-label">${esc(label)}</span>
      <span class="trend-value">${value}${delta(change)}</span>
    </div>`;

  const body = years.length
    ? `<div class="trend-grid">${years.map(year => {
        const s = yearlyStats[year];
        const prev = yearlyStats[parseInt(year) - 1];
        return `<div class="trend-card">
          <h3 class="trend-year">${esc(year)}</h3>
          ${row('Messages', (s.total || 0).toLocaleString(), getChange(s.total, prev?.total))}
          ${row('Avg length', `${(s.avg_msg_length || 0).toFixed(1)} words`, getChange(s.avg_msg_length, prev?.avg_msg_length))}
          ${row('Laughs / msg', (s.lpm || 0).toFixed(3), getChange(s.lpm, prev?.lpm))}
          ${row('Sentiment', s.sentiment_avg == null ? '—' : s.sentiment_avg.toFixed(2), getChange(s.sentiment_avg, prev?.sentiment_avg))}
        </div>`;
      }).join('')}</div>`
    : emptyNote('No year-over-year data available for this conversation.');

  root.innerHTML = section('Year over year', body, {
    note: `How your messaging with ${esc(scopeTitleText())} has changed. Arrows compare each year to the one before.`,
  });
}

/* --- Compare ------------------------------------------------------------- */

// One spec per comparison row. Both sides render from this same list, so they
// always show the same rows in the same order -- the two-column grid only lines
// up if neither side can skip a row.
const COMPARE_ROWS = [
  { label: 'Messages', get: c => (c.total_messages || 0).toLocaleString() },
  { label: 'Chemistry', get: c => (c.chemistry ? c.chemistry.score : '—') },
  { label: 'Sentiment', get: c => (c.sentiment_avg == null ? '—' : c.sentiment_avg.toFixed(2)) },
  { label: 'Laughs / msg (you)', get: c => (c.lpm_sent || 0).toFixed(3) },
  { label: 'Laughs / msg (them)', get: c => (c.lpm_recv || 0).toFixed(3) },
  // These read median_* fields, so they're medians -- the old labels said "Avg".
  { label: 'Median reply (you)', get: c => formatTime(c.median_response_time_sent_mins) },
  { label: 'Median reply (them)', get: c => formatTime(c.median_response_time_received_mins) },
  // Label is a function: the call window depends on the active date filter, so
  // it can't be baked in when this table is defined.
  { label: () => `Call time (${callWindowLabel()})`, get: c => formatCallTime(c.calls?.total_minutes) },
];

const DM_PICKER_MAX = 50;  // the full list is hundreds long; cap the dropdown

function renderCompare(root) {
  const chat = state.scope.chat;

  // Side A is the current scope, so this needs one picker where the old
  // Insights panel needed two. The conversation you're already looking at is
  // the one you want to compare from.
  root.innerHTML = section('Compare', `
    <div class="compare-bar">
      <div class="compare-picker">
        <label for="compareInput">Compare with</label>
        <input type="text" id="compareInput" class="control" placeholder="Search a DM…" autocomplete="off" spellcheck="false">
        <ul class="dropdown popover" id="compareList" hidden></ul>
      </div>
    </div>
    <div id="compareResults"></div>`, {
    note: `${esc(scopeTitleText())} against any other one-on-one conversation.`,
  });

  const input = root.querySelector('#compareInput');
  const list = root.querySelector('#compareList');

  const renderList = () => {
    const query = input.value.trim().toLowerCase();
    const dms = state.data.chats.filter(c =>
      !c.is_group_chat && c.chat_identifier !== chat.chat_identifier);
    const filtered = (query ? dms.filter(c => c.display_name.toLowerCase().includes(query)) : dms)
      .slice(0, DM_PICKER_MAX);

    list.innerHTML = filtered
      .map((dm, i) => `<li data-index="${i}">${esc(dm.display_name)}</li>`).join('');
    list.hidden = filtered.length === 0;

    list.querySelectorAll('li').forEach(li => {
      li.addEventListener('click', () => {
        const dm = filtered[Number(li.dataset.index)];
        if (!dm) return;
        input.value = dm.display_name;
        list.hidden = true;
        state.compareWith = dm;
        drawComparison(root, chat, dm);
      });
    });
  };

  input.addEventListener('input', renderList);
  // Focus opens the list too -- clicking an empty box used to do nothing until
  // you typed a character.
  input.addEventListener('focus', renderList);

  if (state.compareWith) {
    input.value = state.compareWith.display_name;
    drawComparison(root, chat, state.compareWith);
  } else {
    root.querySelector('#compareResults').innerHTML =
      emptyNote('Pick a conversation above to see them side by side.');
  }
}

function drawComparison(root, a, b) {
  const card = dm => `<div class="chart">
    <h3 class="chart-title">${esc(dm.display_name)}</h3>
    <div class="rows">${COMPARE_ROWS.map(r => `
      <div class="row">
        <span class="row-label">${esc(typeof r.label === 'function' ? r.label() : r.label)}</span>
        <span class="row-value">${esc(String(r.get(dm)))}</span>
      </div>`).join('')}</div>
  </div>`;

  root.querySelector('#compareResults').innerHTML =
    `<div class="compare-cols">${card(a)}${card(b)}</div>`;
}

/* ============================================================================
   Data loading
   ========================================================================== */

async function fetchData(startDate, endDate) {
  const loading = $('loadingState');
  const error = $('errorState');
  const host = $('viewHost');

  try {
    // Re-show the spinner on refetches -- date-range changes can take seconds.
    loading.hidden = false;
    error.hidden = true;
    host.hidden = true;

    const params = new URLSearchParams();
    if (startDate) params.set('start_date', startDate);
    if (endDate) params.set('end_date', endDate);
    const qs = params.toString();

    const res = await fetch('/api/stats' + (qs ? `?${qs}` : ''));
    if (!res.ok) throw new Error(`Server responded ${res.status}`);
    const data = await res.json();

    state.data = data;
    state.dateRange = { start: startDate || null, end: endDate || null };

    loading.hidden = true;
    host.hidden = false;

    populateDateBounds(data.date_bounds);

    // A refetch keeps you where you were if that conversation still exists in
    // the new range; otherwise it falls back to Everyone rather than silently
    // showing a different person's numbers under the old heading.
    if (state.scope.kind === 'chat') {
      const same = data.chats.find(c => c.chat_identifier === state.scope.chat.chat_identifier);
      setScope(same ? { kind: 'chat', chat: same } : { kind: 'everyone' });
    } else {
      setScope({ kind: 'everyone' });
    }
  } catch (err) {
    console.error('iMessage Wrapped failed to load:', err);
    loading.hidden = true;
    host.hidden = true;
    error.hidden = false;
    $('errorMessage').textContent = err.message;
  }
}

function populateDateBounds(bounds) {
  if (!bounds || !bounds.min || !bounds.max) return;
  const startInput = $('startDateInput');
  const endInput = $('endDateInput');
  [startInput, endInput].forEach(input => {
    input.min = bounds.min;
    input.max = bounds.max;
  });
  if (!startInput.value) startInput.value = bounds.min;
  if (!endInput.value) endInput.value = bounds.max;
}

/* ============================================================================
   Controls
   ========================================================================== */

function setupDateRange() {
  const select = $('dateRangeSelect');
  const custom = $('customDateRange');

  const isoDaysAgo = days => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().slice(0, 10);
  };
  const todayIso = () => new Date().toISOString().slice(0, 10);

  select.addEventListener('change', () => {
    const val = select.value;
    if (val === 'custom') { custom.hidden = false; return; }
    custom.hidden = true;
    if (val === 'all') { fetchData(); return; }
    const presetDays = { '1y': 365, '6m': 182, '3m': 91, '30d': 30 };
    fetchData(isoDaysAgo(presetDays[val]), todayIso());
  });

  $('applyDateRange').addEventListener('click', () => {
    const start = $('startDateInput').value;
    const end = $('endDateInput').value;
    if (!start || !end) return;
    fetchData(start, end);
  });
}

function setupChatTypeToggle() {
  const buttons = $('chatTypeToggle').querySelectorAll('button');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      buttons.forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
      state.chatTypeFilter = btn.dataset.type;

      // Filtering can remove whatever is in scope. Falling back to Everyone is
      // honest about it; the old code silently swapped in a different chat.
      const visible = getFilteredChats();
      const stillValid = state.scope.kind === 'chat'
        && visible.some(c => c.chat_identifier === state.scope.chat.chat_identifier);
      setScope(stillValid ? state.scope : { kind: 'everyone' });
    });
  });
}

function setupSearch() {
  // renderSidebar reads the search box itself and rebuilds from the data, so a
  // new search starts from the first page of results rather than inheriting
  // however far the previous one had been paged open.
  $('chatSearch').addEventListener('input', () => {
    sidebarShown.dm = SIDEBAR_PAGE;
    sidebarShown.group = SIDEBAR_PAGE;
    renderSidebar();
  });
}

/* --- Theme --------------------------------------------------------------- */

function setupTheme() {
  const toggle = $('themeToggle');
  const media = window.matchMedia('(prefers-color-scheme: dark)');

  const isDark = () => {
    const explicit = document.documentElement.getAttribute('data-theme');
    return explicit ? explicit === 'dark' : media.matches;
  };

  const syncIcon = () => {
    // The button shows what you'd switch *to*, which is the convention people
    // already have from every OS appearance control.
    $('themeIconLight').hidden = !isDark();
    $('themeIconDark').hidden = isDark();
    toggle.setAttribute('aria-label', isDark() ? 'Switch to light appearance' : 'Switch to dark appearance');
  };

  // Charts hold their colors as baked-in strings, so a theme change has to
  // rebuild them. Re-rendering the view does that and is simpler than mutating
  // every chart's options in place.
  const reTheme = () => { syncIcon(); if (state.data) renderView(); };

  toggle.addEventListener('click', () => {
    const next = isDark() ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    reTheme();
  });

  media.addEventListener('change', () => {
    if (!document.documentElement.getAttribute('data-theme')) reTheme();
  });

  syncIcon();
}

/* --- Sidebar sheet (narrow viewports) ------------------------------------ */

function openSidebarSheet() {
  $('sidebar').dataset.open = 'true';
  $('sidebarScrim').dataset.open = 'true';
  $('sidebarToggle').setAttribute('aria-expanded', 'true');
}

function closeSidebarSheet() {
  delete $('sidebar').dataset.open;
  delete $('sidebarScrim').dataset.open;
  $('sidebarToggle').setAttribute('aria-expanded', 'false');
}

function setupSidebarSheet() {
  $('sidebarToggle').addEventListener('click', () => {
    const open = $('sidebar').dataset.open === 'true';
    open ? closeSidebarSheet() : openSidebarSheet();
  });
  $('sidebarScrim').addEventListener('click', closeSidebarSheet);
  // Escape closes the sheet: never trap someone in a view they opened.
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeSidebarSheet();
  });
}

/* ============================================================================
   Boot
   ========================================================================== */

// Any click outside a picker dismisses its dropdown.
document.addEventListener('click', e => {
  if (!e.target.closest('.compare-picker')) {
    document.querySelectorAll('.dropdown').forEach(l => { l.hidden = true; });
  }
});

// The indicator is positioned from measured geometry, so it has to be
// remeasured when the layout changes underneath it.
window.addEventListener('resize', () => {
  const active = $('tabBar').querySelector('.tab[aria-selected="true"]');
  if (active) moveIndicator($('tabIndicator'), active);
});

Chart.defaults.font.family = getComputedStyle(document.documentElement)
  .getPropertyValue('--font').trim();

setupTheme();
setupSearch();
setupDateRange();
setupChatTypeToggle();
setupSidebarSheet();
fetchData();
