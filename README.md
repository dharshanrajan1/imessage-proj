# iMessage Wrapped

iMessage Wrapped is a local, privacy-first web dashboard that analyzes your macOS iMessage database (`chat.db`) and visualizes your texting habits, group chat dynamics, and conversation statistics.

## Project Goals

1. **Deep Analytics:** Provide insights beyond simple message counts. Calculate advanced metrics like Laughs Per Message (LPM), double text ratios, conversation initiations, and response times.
2. **Group Chat Dynamics:** Track individual member contributions within group chats to assign fun awards like "Reaction Magnet", "Ghost", and calculate a "Main Character Score".
3. **DM Superlatives:** Cross-DM awards for your one-on-one chats — Best Friend, Fastest Replier, Leaves You on Read, Makes You Laugh, Your Biggest Fan, You Chase Them / They Chase You, Perfectly Balanced, and Longest Day Streak — plus per-chat Day Streak, Marathon, and Longest Ghost cards.
4. **Chemistry Score:** A 0–100 "mesh" score ranking the people you click with most. It rewards *mutual* effort rather than raw volume — an even message split, fast replies in both directions, shared conversation-starting, and laughs/reactions you trade with each other. Each component is a reciprocal signal (a one-sided chat scores low even at high volume), blended into a weighted score with your top 5 matches surfaced on the Overview.
5. **Reaction Affinity:** Map out who reacts to whose messages the most to visualize hidden group dynamics.
6. **Beautiful UI:** Present the data in a modern, responsive, premium glassmorphic interface using Chart.js.
7. **Automated-Sender Filtering:** Messages from SMS short codes (3–6 digit numbers) and toll-free numbers (800/888/877/866/855/844/833) are automatically excluded — these are verification codes, delivery alerts, and marketing, not real conversations, so they no longer skew your message counts, top words, or records.
8. **Zero Dependencies & Privacy First:** Use only standard Python libraries. All data processing happens locally on your machine, directly from your macOS Messages database. Nothing is uploaded to the cloud.

## Getting Started

### Prerequisites
- macOS
- Python 3.x
- You must grant your Terminal application **Full Disk Access** in `System Settings -> Privacy & Security -> Full Disk Access` so it can read `~/Library/Messages/chat.db` and the Contacts AddressBook.

### Running the App
1. Open your Terminal and navigate to the project directory:
   ```bash
   cd /Users/dharshanrajan/Desktop/imessage_proj
   ```
2. Start the local server:
   ```bash
   python3 server.py
   ```
3. The script will parse your database, resolve contact names, start the server, and automatically open your web browser to `http://localhost:8000`.

*Note: The initial parsing step may take 10-30 seconds depending on the size of your iMessage database.*

## Codebase Summary

- **`parse_chat.py`**: The core ETL (Extract, Transform, Load) engine. It connects to the SQLite `chat.db` in your Library, extracts messages, reactions, and timestamps, and calculates all the aggregate statistics. It also scans your macOS `AddressBook` SQLite databases to map phone numbers and emails to real contact names.
- **`server.py`**: A lightweight, zero-dependency Python HTTP server. On startup, it triggers `parse_chat.py` to generate the data, holds it in memory, and serves it via an `/api/stats` endpoint, while also serving the static frontend files.
- **`index.html`**: The HTML structure of the dashboard, containing a sidebar for navigation and tabs for Global Overview, Chat Analysis, and Group Members.
- **`styles.css`**: A sleek, dark-themed glassmorphism design system. It uses CSS variables for theming and includes custom styling for leaderboards, metric cards, and scrolling areas.
- **`app.js`**: The frontend logic. It fetches data from `/api/stats`, handles tab navigation and sidebar filtering, populates the DOM, and uses `Chart.js` to render interactive charts.

## Metrics & Methodology

This section documents how the non-obvious metrics are calculated. All processing happens in `parse_chat.py`.

### Chemistry ("mesh") score — 0 to 100

Every one-on-one chat with at least **50 total messages and at least 10 from each person** (`CHEM_MIN_TOTAL` / `CHEM_MIN_SIDE`) gets a chemistry score. The score answers "how much do you two *click*, over time" and is built around two ideas: **mutual effort** (a chat you carry single-handedly scores low no matter the volume) and **consistency** (a single intense burst shouldn't outrank a lasting friendship). It appears as a metric card on each chat and as a full ranked list on the Overview.

**Step 1 — interaction quality (0–1).** A weighted blend of five components measuring how good the back-and-forth is *when you talk*:

| Component | Weight | Definition (0–1) |
|---|---|---|
| **Balance** | 0.25 | `1 − abs(sent − received) / total`. Peaks at a 50/50 split. |
| **Responsiveness** | 0.25 | `sqrt( f(median_reply_you) × f(median_reply_them) )` where `f(t) = 1 / (1 + t/30)` (t in minutes). The geometric mean means *both* sides must reply quickly; if either side has fewer than 5 reply samples, that side falls back to a neutral 0.5. |
| **Reciprocity** | 0.20 | `1 − abs(init_share_you − init_share_them)`, where init shares are each person's fraction of conversation starts (a start = first message after an 8h+ lull). Peaks when you both initiate equally. Falls back to 0.5 with fewer than 5 initiations. |
| **Humor** | 0.15 | `mutual(lpm_you, lpm_them, cap=0.25)` — you make *each other* laugh. |
| **Affection** | 0.15 | `mutual(reactions_you_give_per_their_msg, reactions_they_give_per_your_msg, cap=0.35)` — tapbacks traded both ways. |

where `mutual(a, b, cap) = sqrt( min(a,cap) × min(b,cap) ) / cap`. The **geometric mean** is the key design choice for the mutual signals (responsiveness, humor, affection): if either side contributes zero, the whole component collapses to zero — exactly the "it takes two" property we want. Call this weighted blend `quality`.

**Step 2 — two "gate" multipliers.** The quality blend is then multiplied by two factors that capture *whether this is a living, ongoing friendship* rather than a one-time spark. Making these **multipliers** (not just extra weighted bars) is deliberate: a bar would only shave a fraction off a burst or a dormant chat, leaving it near the top — a gate actually pushes it down.

*Consistency* — `consistency = min(1, active_weeks / 20)`, where `active_weeks` is the number of *distinct calendar weeks* in which you exchanged at least one message. A one-off burst spans a week or two (≈0.05–0.10); a real ongoing friendship spans many (→ 1.0).

*Recency* — `recency = 1 / (1 + days_since_last / 180)`, where `days_since_last` is measured against your most recent message with *anyone* (so it respects date filters and ≈ "now" for a live database). A 6-month half-life: talked today → 1.0, ~6 months → 0.5, 1 year → ~0.33, 2–3 years → ~0.12.

```
sustain      = 0.40 + 0.60 × consistency     # ranges 0.40 … 1.00
recency_gate = 0.35 + 0.65 × recency         # ranges 0.35 … 1.00
final score  = round( 100 × quality × sustain × recency_gate )
```

Each gate has a floor (0.40, 0.35) so a genuinely great-but-inactive chat isn't zeroed — just moved down. Worked examples (perfect-quality chat, quality ≈ 0.99): last message **today → 99**, **1 month → 90**, **6 months → 67**, **1 year → 56**, **3 years → 44**. Combined with consistency, an 800-message burst over 2 weeks lands around **39**. Consistency and recency each show as their own bar in the UI, so a low bar next to high quality bars visibly explains a lower score.

The card's one-line highlight names whichever signal scored highest. All knobs are constants at the top of the chemistry section in `parse_chat.py` — `CHEM_WEIGHTS`, `CHEM_TARGET_WEEKS`, `CHEM_SUSTAIN_FLOOR`, `CHEM_RECENCY_HALF_DAYS`, `CHEM_RECENCY_FLOOR`, `_CHEM_LPM_CAP`, `_CHEM_RXN_CAP` — so you can tune them if the scores feel off for your data. Chemistry is only defined for 1:1 chats; group chats show `—` (their equivalent is the per-member leaderboard and Main Character Score).

### Group chat names

Group chats you never named show up in `chat.db` as an opaque identifier like `chat948716…`. Instead of displaying that, unnamed groups are labeled with their **participants' names**, pulled from the full roster (`chat_handle_join`, so even members who never sent a message are included) and resolved against your contacts — e.g. **"Alice + Bob + Carol"**. Names are ordered by how active each person is (most messages first) for a stable, recognizable label, capped at three with a `+N more` suffix. You (the account owner) are left out, matching how Messages itself names groups. Groups you *did* name keep their custom name.

### Other derived metrics

- **Typical reply time** — the **median** gap before someone replies (only gaps under 8h count as replies; longer gaps are treated as new conversation starts). Median is used instead of the mean because reply times are heavily right-skewed — a few hours-later replies would wreck an average. The mean is still emitted in the JSON as `avg_response_time_*` for reference.
- **Automated-sender filtering** — messages from SMS short codes (3–6 digit numbers) and toll-free numbers (area codes 800/822/833/844/855/866/877/888) are dropped before any counting, since they're verification codes / delivery alerts / marketing, not conversations. See `is_automated_handle()`.
- **Local-time bucketing** — all hour-of-day, day-of-week, and night-owl stats use your Mac's local timezone, converted from the UTC timestamps stored in `chat.db`.
- **Day streak** — longest run of consecutive calendar days with at least one message. **Marathon** — longest unbroken back-and-forth (no gap over 1 hour). **Ghosting** — the longest anyone made someone wait before answering a message containing "?". **LPM** — laughs (haha/lol/lmao/…) per message. **Ghost score** — how far below their "fair share" (`1/num_members`) of the conversation a group member falls.
- **Word cleaning** — text is lowercased, URLs/emails stripped, curly apostrophes normalized to ASCII so contractions expand correctly (otherwise "you'll" leaks a stray "ll"), contractions expanded, then tokenized; stopwords, filler ("lol", "idk", …), and laughter are removed, and elongated spellings ("soooo") are de-duplicated for stopword matching.

### Incremental Parsing

On every server restart, the analyzer stores a checkpoint of the last parsed message timestamp in `_parse_checkpoint.json`. On the next run, if `incremental=True` is passed to `run_analysis()`, only messages added since the checkpoint are parsed, dramatically speeding up startup. The checkpoint is automatically updated after each parse.

### Sentiment Analysis

Messages are analyzed using `TextBlob` (install it with `pip install textblob`; without it, sentiment is reported as "no data" rather than a fake neutral score). Polarity scores (–1 to +1) are normalized to 0–1 (negative to positive). Sentiment is tracked:
- **Per chat** — an average over the chat's scorable messages (shown on the Sentiment insight tab)
- **Year-over-year** — sentiment trends across years within each chat

**Unscorable messages are excluded, not counted as neutral.** TextBlob's lexicon is tuned on prose and reviews, and roughly **two thirds of real text messages** ("ok", "wyd", "on my way") contain no lexicon word at all, so it returns exactly 0.0 polarity for them. Averaging those in as 0.5 pulled every chat's mean to ≈0.50 and made the whole feature look broken — every conversation scored identically regardless of tone. `get_sentiment()` therefore returns `None` for text with no signal, and callers skip it, so the average reflects only messages that actually expressed something. On a real database this widens the per-chat spread from ≈0.00 to **0.46–0.72**.

Because the denominator is now "messages that carried sentiment", each chat also reports `sentiment_msg_count`, and the Sentiment tab lists only chats with **20+** scorable messages — below that, one enthusiastic message swings the whole average. A chat with nothing scorable reports `null`, which the UI renders as `—` rather than a neutral-looking 0.5.

### Call history

Connected calls are read from the separate macOS call database at `~/Library/Application Support/CallHistoryDB/CallHistory.storedata` and joined onto conversations by normalized handle (`normalize_chat_key()`, the same key DMs use). Only calls that actually connected (`ZDURATION > 0`) count — a missed call says nothing about closeness.

Two limits are deliberate:

- **macOS prunes call history far more aggressively than `chat.db`** (roughly two years, vs. the full message history). Every call figure in the UI is therefore scoped to the chemistry window and labelled *(18mo)*, so it is never read as an all-time total sitting next to all-time message counts.
- **Group FaceTime isn't mapped.** `ZADDRESS` holds a single handle, so calls join to DMs only; group chats show no call stats.

Call time feeds the chemistry score as a **capped bonus on top of** the weighted base, not as another weighted component — most DMs have no calls at all, so folding voice into the weights would silently deduct points from every text-only chat and reshuffle the ranking. As a bonus, a chat with no calls keeps exactly the score it had. Decayed call minutes use the same half-life as message volume, on a square-root ramp (`CHEM_CALL_BONUS_MAX`, `CHEM_CALL_MINUTES_CAP`).

### Insights Tab

The Insights tab provides three exploratory views. They deliberately operate at **different scopes**, so each panel states its own scope as a badge — a mixed tab that doesn't say which panel applies to what is just confusing:

1. **Trends** *(one conversation)* — Year-over-year metrics per year: message count, average message length, LPM, and sentiment, each with a ↑/↓ change against the previous year. The panel has its own conversation picker and falls back to whatever is open in Chat Analysis.
2. **Compare** *(two conversations)* — Pick any two DMs and see genuinely side-by-side cards: total messages, sentiment, LPM (sent/received), median reply times, call time, and chemistry. Both cards render from one shared row spec so they always line up.
3. **Sentiment** *(all DMs)* — Global sentiment plus a per-DM breakdown with a 0–1 bar and mood label, ranked, limited to chats with enough scorable messages to mean anything.

All insights are accessible from the main navigation without cluttering the Overview, Chat Analysis, or Members tabs.

## Potential Improvements

1. **Significant UI overhaul**: The current dashboard grew section by section and still shows it. A pass worth doing:
   - **Overview is one ~4,400px scroll** through four unrelated sections (Records → Chemistry → Leaderboards → Superlatives → global charts) with no in-page navigation. It wants either a sticky section jump-bar or a split into its own sub-tabs.
   - **Information hierarchy is flat** — every section is a grid of same-weight cards, so nothing signals what matters most. There's no landing summary ("here's your year in three numbers") before the detail.
   - **No responsive story below ~900px.** The layout collapses the sidebar to a fixed 300px block and stacks everything single-column; it has never been designed for a narrow viewport, only made not to break.
   - **Charts are Chart.js defaults on a custom design system.** The palette is now unified and validated, but the charts still have no tooltips/crosshair beyond stock behavior, no direct labels, and no table view for accessibility.
   - **Group-chat surfaces lag DM surfaces.** Members is a lone table plus one chart, and is disabled with no explanation until a group is selected.
   - **No empty/loading states** beyond the initial spinner — switching date range re-renders with no skeleton, and several panels render blank rather than saying why.
2. **Export to Image/PDF**: Allowing users to generate a "Wrapped" graphic (like Spotify Wrapped) to share with friends.
3. **Search within Chats**: Adding the ability to search for specific messages or deeply analyze word usage over time for a specific word.
4. **Time-window Filtering**: Refine insight calculations based on the date range filters in the main header.
5. **Sentiment Trajectory**: Track how sentiment has evolved over time for a single chat (e.g., sentiment per month).
6. **Better sentiment model**: TextBlob's prose-tuned lexicon scores nothing on two thirds of real messages. A messaging-aware model (VADER, or an emoji/slang-aware lexicon) would widen coverage well beyond the current third.
7. **Broaden automated-sender filtering**: `is_automated_handle()` catches short codes and toll-free numbers, but named senders and no-reply addresses (e.g. "Delta Air Lines", `donotreply@…`) still rank alongside real people in leaderboards and the Sentiment tab.
8. **Reconcile the chemistry docs with the code**: the Methodology section above still describes the older `quality × sustain × recency_gate` model and constants (`CHEM_TARGET_WEEKS`, `CHEM_SUSTAIN_FLOOR`, `CHEM_RECENCY_HALF_DAYS`), while `parse_chat.py` now scores a recency-decayed 18-month window with volume/regularity components. The write-up needs to catch up to the implementation.
