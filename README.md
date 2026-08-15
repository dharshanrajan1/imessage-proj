# iMessage Wrapped

iMessage Wrapped is a local, privacy-first web dashboard that analyzes your macOS iMessage database (`chat.db`) and visualizes your texting habits, group chat dynamics, and conversation statistics.

## Project Goals

1. **Deep Analytics:** Provide insights beyond simple message counts. Calculate advanced metrics like Laughs Per Message (LPM), double text ratios, conversation initiations, and response times.
2. **Group Chat Dynamics:** Track individual member contributions within group chats to assign fun awards like "Reaction Magnet", "Ghost", and calculate a "Main Character Score".
3. **DM Superlatives:** Cross-DM awards for your one-on-one chats — Best Friend, Fastest Replier, Leaves You on Read, Makes You Laugh, Your Biggest Fan, You Chase Them / They Chase You, Perfectly Balanced, and Longest Day Streak — plus per-chat Day Streak, Marathon, and Longest Ghost cards.
4. **Chemistry Score:** A 0–100 "mesh" score ranking the people you click with most. It rewards *mutual* effort rather than raw volume — an even message split, fast replies in both directions, shared conversation-starting, and laughs/reactions you trade with each other. Each component is a reciprocal signal (a one-sided chat scores low even at high volume), blended into a weighted score with your top 5 matches surfaced on the Overview.
5. **Reaction Affinity:** Map out who reacts to whose messages the most to visualize hidden group dynamics.
6. **Deep Read:** Read a single relationship against a baseline instead of in isolation — where it ranks among all your chats, which silences are unusual *for it*, the vocabulary that distinguishes it, and how your writing style shifts with that person. A number with nothing to compare it to isn't an insight.
7. **Beautiful UI:** Present the data in a modern, responsive, premium glassmorphic interface using Chart.js.
8. **Automated-Sender Filtering:** Messages from SMS short codes (3–6 digit numbers) and toll-free numbers (800/888/877/866/855/844/833) are automatically excluded — these are verification codes, delivery alerts, and marketing, not real conversations, so they no longer skew your message counts, top words, or records.
9. **Zero Dependencies & Privacy First:** Only the standard library is required — the one optional extra, TextBlob, degrades to "no data" rather than faking a score. All processing happens locally, directly from your macOS Messages database. Nothing is uploaded to the cloud, and nothing written to disk (including the sentiment cache) contains message text.

## Getting Started

### Prerequisites
- macOS
- Python 3.x
- You must grant your Terminal application **Full Disk Access** in `System Settings -> Privacy & Security -> Full Disk Access` so it can read `~/Library/Messages/chat.db` and the Contacts AddressBook.
- *Optional:* `pip install textblob` enables sentiment analysis. Without it, sentiment reports "no data" everywhere rather than a fake neutral score — nothing else is affected.

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

*Note: on a ~590,000-message database the first parse takes roughly 40 seconds; later starts take about 17, once the sentiment cache is warm. See [Parsing performance](#parsing-performance).*

**The database is parsed once, at startup, and held in memory for the life of the process.** Nothing re-reads `chat.db` while the server runs, so new messages — and any change to `parse_chat.py` — only show up after a restart (`Ctrl-C`, then `python3 server.py` again). A stale server is the usual explanation for the UI not showing something you expect.

## Codebase Summary

- **`parse_chat.py`**: The core ETL (Extract, Transform, Load) engine. It connects to the SQLite `chat.db` in your Library, extracts messages, reactions, and timestamps, and calculates all the aggregate statistics — including the Deep Read layer (relative standing, silence anomalies, distinctive vocabulary, style rates). It also scans your macOS `AddressBook` SQLite databases to map phone numbers and emails to real contact names.
- **`server.py`**: A lightweight, zero-dependency Python HTTP server. On startup, it triggers `parse_chat.py` to generate the data, holds it in memory, and serves it via an `/api/stats` endpoint, while also serving the static frontend files. Results are memoized per date range in `STATS_CACHE`, so revisiting a range you've already viewed is instant.
- **`index.html`**: The app shell — a toolbar, the sidebar navigator, and an empty content region that `app.js` fills. It holds no view markup of its own.
- **`styles.css`**: A token-driven design system, adaptive light/dark, governed by two rules: **color is data** (the interface is achromatic; every hue on screen belongs to a chart, bar, medal, or trend arrow) and **glass means "floats above"** (translucency only on the toolbar and sidebar, which content scrolls underneath). Uses the platform system font, so there is no webfont request.
- **`app.js`**: The frontend logic. The sidebar sets a *scope* — Everyone, a person, or a group — and the tab bar offers the views that exist for that scope, so no tab is ever disabled or out of context. (**Deep Read** appears only on a person or group, and only when that conversation has enough data to compare; it is not offered on Everyone, since every panel in it is about one relationship.) Fetches `/api/stats`, builds each view on demand, and renders charts with `Chart.js` against theme tokens read from the stylesheet.
- **`motion.js`**: A dependency-free critically-damped spring. Animations retarget from their current presentation value instead of restarting, so transitions stay interruptible.

## Metrics & Methodology

This section documents how the non-obvious metrics are calculated. All processing happens in `parse_chat.py`.

### Chemistry ("mesh") score — 0 to 100

Chemistry looks at **the last 18 months only** (`CHEM_WINDOW_DAYS = 548`). How a chat went years ago says nothing about the relationship now, so older history is ignored outright rather than discounted. Inside that window, a chat qualifies with at least **50 messages and at least 10 from each person** (`CHEM_MIN_TOTAL` / `CHEM_MIN_SIDE`) — so a chat that was huge in 2019 and silent since simply stops being scored. It appears as a metric card on each chat and as a full ranked list under Rankings.

The score is one weighted blend of seven components, each normalized to 0–1, in two families:

**Engagement — do you actually talk?**

| Component | Weight | Definition |
|---|---|---|
| **Volume** | 0.25 | Recency-weighted message count, log-scaled: `log1p(decayed) / log1p(max_decayed)`. Each message counts `0.5 ^ (age_days / 90)`, so a 90-day-old message is worth half a fresh one. Normalized against the most active qualifying DM. The log matters — it makes "daily vs. weekly" count for more than "daily vs. hourly". |
| **Regularity** | 0.20 | `active_weeks / weeks_available` — the share of the window's weeks with at least one message. A chat younger than the window is judged against its own age, floored at `CHEM_REGULARITY_MIN_WEEKS = 26` so a two-week fling can't instantly show 100%. |

**Quality — when you talk, is it mutual?** Each of these only scores high when *both* people contribute.

| Component | Weight | Definition |
|---|---|---|
| **Balance** | 0.15 | `1 − abs(sent − received) / total`. Peaks at a 50/50 split. |
| **Responsiveness** | 0.15 | `sqrt( f(reply_you) × f(reply_them) )`, `f(t) = 1 / (1 + t/30)` (minutes). Either side with fewer than 5 samples falls back to a neutral 0.5. |
| **Reciprocity** | 0.10 | `1 − abs(init_share_you − init_share_them)` — you both start conversations. Falls back to 0.5 below 5 initiations. |
| **Humor** | 0.08 | `mutual(lpm_you, lpm_them, cap=0.25)` — you make *each other* laugh. |
| **Affection** | 0.07 | `mutual(rxn_you_give_per_their_msg, rxn_they_give_per_your_msg, cap=0.35)` — tapbacks traded both ways. |

where `mutual(a, b, cap) = sqrt( min(a,cap) × min(b,cap) ) / cap`. The **geometric mean** is the key design choice for the mutual signals: if either side contributes zero, the component collapses to zero — the "it takes two" property. Note that recency is *not* a separate multiplier; it's baked into Volume through the 90-day decay, which is why a dormant chat falls out on its own.

```
base       = 100 × Σ (component × weight)
call_bonus = CHEM_CALL_BONUS_MAX × sqrt( min(1, decayed_call_minutes / 600) )
score      = min(100, round(base + call_bonus))
```

The card's one-line highlight names whichever component contributed the most weighted points — so "you talk all the time" only appears when volume is genuinely carrying the score. Voice wins the headline on its own merit when it clears `_CHEM_VOICE_HIGHLIGHT_MIN`, since real phone time is more interesting to call out than whichever text metric edged ahead.

All knobs are constants at the top of the chemistry section in `parse_chat.py` — `CHEM_WINDOW_DAYS`, `CHEM_WEIGHTS`, `CHEM_DECAY_HALF_LIFE_DAYS`, `CHEM_REGULARITY_MIN_WEEKS`, `_CHEM_LPM_CAP`, `_CHEM_RXN_CAP`, `CHEM_CALL_BONUS_MAX`, `CHEM_CALL_MINUTES_CAP`. Chemistry is only defined for 1:1 chats; group chats show `—` (their equivalent is the per-member leaderboard and Main Character Score).

### Group chat names

Group chats you never named show up in `chat.db` as an opaque identifier like `chat948716…`. Instead of displaying that, unnamed groups are labeled with their **participants' names**, pulled from the full roster (`chat_handle_join`, so even members who never sent a message are included) and resolved against your contacts — e.g. **"Alice + Bob + Carol"**. Names are ordered by how active each person is (most messages first) for a stable, recognizable label, capped at three with a `+N more` suffix. You (the account owner) are left out, matching how Messages itself names groups. Groups you *did* name keep their custom name.

### Other derived metrics

- **Typical reply time** — the **median** gap before someone replies (only gaps under 8h count as replies; longer gaps are treated as new conversation starts). Median is used instead of the mean because reply times are heavily right-skewed — a few hours-later replies would wreck an average. The mean is still emitted in the JSON as `avg_response_time_*` for reference.
- **Automated-sender filtering** — messages from SMS short codes (3–6 digit numbers) and toll-free numbers (area codes 800/822/833/844/855/866/877/888) are dropped before any counting, since they're verification codes / delivery alerts / marketing, not conversations. See `is_automated_handle()`.
- **Local-time bucketing** — all hour-of-day, day-of-week, and night-owl stats use your Mac's local timezone, converted from the UTC timestamps stored in `chat.db`.
- **Day streak** — longest run of consecutive calendar days with at least one message. **Marathon** — longest unbroken back-and-forth (no gap over 1 hour). **Ghosting** — the longest anyone made someone wait before answering a message containing "?". **LPM** — laughs (haha/lol/lmao/…) per message. **Ghost score** — how far below their "fair share" (`1/num_members`) of the conversation a group member falls.
- **Word cleaning** — text is lowercased, URLs/emails stripped, curly apostrophes normalized to ASCII so contractions expand correctly (otherwise "you'll" leaks a stray "ll"), contractions expanded, then tokenized; stopwords, filler ("lol", "idk", …), and laughter are removed, and elongated spellings ("soooo") are de-duplicated for stopword matching.

### Deep Read

Four metrics that all answer the question a raw per-chat number can't: *compared to what?* They share a tab (**Deep Read**, offered on any conversation with enough data) and all run in the existing single pass — no extra query, no new dependency.

**Relative standing.** A median reply time of four minutes is uninterpretable on its own. Every DM with a large enough sample is ranked against every other DM on eight measures — your reply speed, theirs, who starts conversations, laughs traded each way, tapbacks each way, and how evenly the talking splits — and each is reported as a rank, a percentile, and the median across all your conversations. "The 3rd fastest of your 41 chats, against a typical 19 minutes" is a statement; "4 minutes" isn't. A measure needs at least 5 qualifying chats before it's ranked at all, since "2nd of 3" implies a precision that isn't there.

**Silence anomalies.** A silence is judged against *that relationship's own rhythm*, never a fixed threshold. An absolute rule like "over a week" is the obvious approach and the wrong one — it flags every dormant acquaintance while missing the friend you normally talk to hourly going quiet for two days, which is the one that means something. A gap has to beat this chat's 95th-percentile lull, `SILENCE_RATIO = 3` × its median lull, *and* an absolute 24-hour floor. Gaps under an hour never enter the baseline at all (that's turn-taking inside a conversation, not a lull). Each flagged silence also records **who spoke first afterwards** — consistently being the one who repairs is a different relationship than taking turns.

**Distinctive vocabulary.** Words this chat uses at an outsized rate versus a baseline — implemented as the log-odds ratio with an informative Dirichlet prior (Monroe, Colaresi & Quinn 2008). Two properties are doing real work here. Raw frequency returns roughly the same list for every chat, so a baseline is what makes a word *distinctive* rather than merely common. And a plain log-odds ratio is dominated by rare words — one use of a word nobody else says yields an enormous ratio — so the global counts serve as a prior that shrinks exactly those estimates, and dividing by the estimated standard deviation gives a z-score comparable across words of any frequency. The baseline is **directional**: your words in a chat are compared against your words everywhere, theirs against everyone else's. Pooling both directions into one baseline would measure "unlike the average of everyone, including myself", which is not the question. The comparison corpus also excludes the chat being scored, so a dominant conversation isn't measured against a baseline it defines.

**Style (function words).** LIWC-style rates per 1,000 words for seven categories — `i_me`, `we_us`, `you_focus`, `hedging`, `certainty`, `absolutist`, `negation`. These live almost entirely in the words `clean_words()` deliberately throws away, so they're counted over the tokenizer's *unfiltered* stream; `analyze_tokens()` returns both vocabularies from one pass so this costs nothing extra. Categories overlap on purpose ("never" is both absolutist and a negation) — they're separate lenses on the same text, not a partition. The denominator is words, not messages, so writing long messages doesn't make you look more absolutist. Your side of each chat is compared against how you write across every chat, which is what makes a shift meaningful: you hedge more with this person than you do generally. Their side has no equivalent baseline — that would need their messages to *other* people, which this database doesn't contain — so no drift arrow is shown for them.

### Sentiment Analysis

Messages are analyzed using `TextBlob` (install it with `pip install textblob`; without it, sentiment is reported as "no data" rather than a fake neutral score). Polarity scores (–1 to +1) are normalized to 0–1 (negative to positive). Sentiment is tracked:
- **Per chat** — an average over the chat's scorable messages (shown on the Sentiment insight tab)
- **Year-over-year** — sentiment trends across years within each chat

**Unscorable messages are excluded, not counted as neutral.** TextBlob's lexicon is tuned on prose and reviews, and roughly **two thirds of real text messages** ("ok", "wyd", "on my way") contain no lexicon word at all, so it returns exactly 0.0 polarity for them. Averaging those in as 0.5 pulled every chat's mean to ≈0.50 and made the whole feature look broken — every conversation scored identically regardless of tone. `get_sentiment()` therefore returns `None` for text with no signal, and callers skip it, so the average reflects only messages that actually expressed something. On a real database this widens the per-chat spread from ≈0.00 to **0.46–0.72**.

Because the denominator is now "messages that carried sentiment", each chat also reports `sentiment_msg_count`, and the Sentiment tab lists only chats with **20+** scorable messages — below that, one enthusiastic message swings the whole average. A chat with nothing scorable reports `null`, which the UI renders as `—` rather than a neutral-looking 0.5.

### Call history

Connected calls are read from the separate macOS call database at `~/Library/Application Support/CallHistoryDB/CallHistory.storedata` and joined onto conversations by normalized handle (`normalize_chat_key()`, the same key DMs use). Only calls that actually connected (`ZDURATION > 0`) count — a missed call says nothing about closeness.

Two limits are deliberate:

- **macOS prunes call history far more aggressively than `chat.db`** (roughly two years, vs. the full message history). Every call figure in the UI is therefore windowed and labelled with the window it covers, so it is never read as an all-time total sitting next to all-time message counts.
- **The window is the chemistry window or the active date filter, whichever is narrower.** Calls come from a separate database, so the row-level date filter applied to messages never touches them — `summarize_calls()` has to apply the requested range itself. It previously windowed only on the chemistry cutoff, which meant a five-day filter still reported eighteen months of calls next to five days of messages, and kept crediting the chemistry call bonus for phone time from outside the range. The effective window is returned as `call_window` and the UI labels itself from that rather than hard-coding "18mo".
- **Group FaceTime isn't mapped.** `ZADDRESS` holds a single handle, so calls join to DMs only; group chats show no call stats.

Call time feeds the chemistry score as a **capped bonus on top of** the weighted base, not as another weighted component — most DMs have no calls at all, so folding voice into the weights would silently deduct points from every text-only chat and reshuffle the ranking. As a bonus, a chat with no calls keeps exactly the score it had. Decayed call minutes use the same half-life as message volume, on a square-root ramp (`CHEM_CALL_BONUS_MAX`, `CHEM_CALL_MINUTES_CAP`).

### Insights Tab

The Insights tab provides three exploratory views. They deliberately operate at **different scopes**, so each panel states its own scope as a badge — a mixed tab that doesn't say which panel applies to what is just confusing:

1. **Trends** *(one conversation)* — Year-over-year metrics per year: message count, average message length, LPM, and sentiment, each with a ↑/↓ change against the previous year. The panel has its own conversation picker and falls back to whatever is open in Chat Analysis.
2. **Compare** *(two conversations)* — Pick any two DMs and see genuinely side-by-side cards: total messages, sentiment, LPM (sent/received), median reply times, call time, and chemistry. Both cards render from one shared row spec so they always line up.
3. **Sentiment** *(all DMs)* — Global sentiment plus a per-DM breakdown with a 0–1 bar and mood label, ranked, limited to chats with enough scorable messages to mean anything.

All insights are accessible from the main navigation without cluttering the Overview, Chat Analysis, or Members tabs.

A fourth view, **Deep Read**, sits on the conversation scope rather than here, because every panel in it is about one relationship. See [Deep Read](#deep-read) for the methodology.

### Parsing performance

A full parse of ~540,000 messages takes about 70 seconds, and roughly 60% of that is TextBlob scoring sentiment. So that — and only that — is cached between runs, in `_sentiment_cache.json`.

Sentiment is the one stage that is safe to reuse: it's a **pure function of the message text**, so a cache hit is exactly equal to a recompute. Everything else is recalculated from the full row set on every run. That's deliberate. The aggregates are order-dependent and interlocking (streaks, reply times, initiations, per-chat baselines), and a half-updated set of them is worse than a slow correct one.

> An earlier version of this file described a checkpoint that re-parsed only messages newer than the last run. That approach was removed: because no prior state was reloaded, it would have reported each chat's totals as *only what happened since the last parse*. It was never enabled, which is why the wrong numbers never surfaced.

**The cache stores a hash of each message and its score — never the text.** A plaintext mirror of `chat.db` sitting in the project directory would undo the point of the project; digests are all a cache needs. It's written atomically (temp file + `os.replace`), capped at 1.5M entries, git-ignored, and safe to delete at any time — you'll just pay one slow run. It's also ignored entirely when TextBlob isn't installed, so a cache written without it can't pin you to "no sentiment anywhere" after you install it.

Measured on a 590k-message database:

| Run | Before | After |
|---|---|---|
| First parse (cold cache) | 73s | 40s |
| Restart (warm cache) | 73s | 17s |
| Changing the date range | 73s | 9s |

The cold-run gain is free deduplication: the cache is consulted in-memory during the run too, and real message logs repeat heavily ("ok", "lol", "on my way"). The date-range gain matters most in practice — the server keeps a separate `STATS_CACHE` entry per range, so every filter change used to re-score all 540k messages from scratch.

## Potential Improvements

1. **Remaining UI work.** The foundational redesign is done — one navigator, adaptive light/dark, an achromatic interface that leaves color to the data, spring-driven transitions, and a real narrow-viewport layout. What it did not finish:
   - **Charts are still close to Chart.js defaults.** The palette is unified and theme-aware, but there are no direct labels, no crosshair, and no table view of a chart's data for screen-reader users.
   - **Loading is a spinner, not a skeleton.** Changing the date range blanks the content region instead of holding the shape of what's arriving. The `.skeleton` style exists and is unused.
   - **No landing summary.** Everyone → Overview opens on four metrics; it could open on a sentence — "you sent 412,000 messages to 340 people" — before the detail.
   - **Group surfaces still lag DM surfaces.** Members has a table, awards, and two panels; a DM has eight metrics, records, and six charts.
2. **Export to Image/PDF**: Allowing users to generate a "Wrapped" graphic (like Spotify Wrapped) to share with friends.
3. **Search within Chats**: Adding the ability to search for specific messages or deeply analyze word usage over time for a specific word.
4. **Time-window Filtering**: Refine insight calculations based on the date range filters in the main header.
5. **Sentiment Trajectory**: Track how sentiment has evolved over time for a single chat (e.g., sentiment per month).
6. **Better sentiment model**: TextBlob's prose-tuned lexicon scores nothing on two thirds of real messages. A messaging-aware model (VADER, or an emoji/slang-aware lexicon) would widen coverage well beyond the current third.
7. **Broaden automated-sender filtering**: `is_automated_handle()` catches short codes and toll-free numbers, but named senders and no-reply addresses (e.g. "Delta Air Lines", `donotreply@…`) still rank alongside real people in leaderboards and the Sentiment tab.
8. **Deep Read, the parts not built.** The deterministic layer is in (relative standing, silences, distinctive vocabulary, style). Still open from the same plan:
   - **Vulnerability and capitalization tracking** — rate of self-disclosed distress, and whether good news gets an active-constructive reply or a one-liner. Unlike the four that shipped, this needs *lookahead* to the other person's next message, which the globally time-ordered loop can't do with a keyword classifier alone; it needs a per-chat pending flag carried on `cdata`.
   - **Direct vs. indirect criticism** — criticism aimed at the person you're texting versus venting about a third party in that thread.
   - **Self-description extraction** — your own "I'm ___" completions, aggregated.
   These are all keyword classifiers whose accuracy on real texting is worth checking against the shipped metrics before trusting them.
9. **Narrative synthesis (Layer 2)** — prose analysis of a relationship, which no formula produces; it needs an LLM reading curated excerpts. This is a **genuine fork from goal #9**: message excerpts would leave the machine. See `ENHANCEMENT_PLAN.md`, which keeps it deliberately separate for that reason. If built, it should send bundles assembled from the Deep Read metrics above (flagged silences, top distinctive words, biggest asymmetries) rather than raw logs, fire only on an explicit button press, and ship with a dry-run that prints exactly what would be uploaded — so the privacy claim is verifiable instead of asserted.
