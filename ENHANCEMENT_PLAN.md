# Deep-Reading Enhancement Plan

Plan for bringing the kind of analysis done in a Claude session — distinctive
vocabulary, silence/withdrawal detection, capitalization tracking, relative
baselines across relationships, narrative synthesis — into this dashboard.

Two layers, deliberately kept separate because they have different costs and
different implications for the project's stated design goals.

## Layer 1 — deterministic metrics (no new dependencies, no privacy change)

Pure Python additions to `parse_chat.py`, same category as the existing
`chemistry_score()`. All of this fits the project's current "zero
dependencies / privacy-first / nothing leaves the machine" design goal
unchanged. A lot of the raw plumbing already exists — `response_times_sent`/
`received` are stored as raw lists per chat (not just an average),
`initiations_sent`/`received` are already counted, `top_words_sent`/`received`
are already Counters. Most of this is new arithmetic on data already being
collected, not new data collection.

| Metric | What it computes | Hooks into existing code |
|---|---|---|
| **Relative latency/initiation table** | Your reply-speed and initiation-share for *this* chat vs. the median across all your chats (e.g. "your tapback rate here is #1 of 40 relationships") | `response_times_sent/received`, `initiations_sent/received` already exist per chat — needs a second pass across `chats_data` to rank |
| **Distinctive vocabulary (log-odds)** | Words a person uses at an outsized rate vs. your global baseline | `top_words_sent/received` Counters already exist per chat; add global `g_words` comparison, same pattern as `_mutual()` |
| **Function-word categories** | Absolutist / hedging / certainty / first-person-singular rates (LIWC-style) | New regex category dict, run inside `clean_words()`'s per-message loop |
| **Silence-anomaly detector** | A gap that's an outlier *for that specific relationship's own rhythm*, not an absolute threshold (this is what catches a deliberate withdrawal rather than normal dormancy) | New pass over each chat's message timestamps using `_median()` (already exists) plus a p95 |
| **Vulnerability / capitalization tracking** | Rate of self-disclosed distress; whether good news gets an active-constructive reply or a one-liner | Keyword classifier + look at the next message from the other party, same shape as `is_laugh_text()` |
| **Direct vs. indirect criticism** | Criticism aimed at the person you're texting vs. venting about a third party in that thread | Regex classifier, tag messages, aggregate per-chat and cross-chat |
| **Self-description extraction** | Your own "I'm ___" completions, aggregated | Simple regex over your sent messages only |

All of this outputs into the existing per-chat dict and a new global block,
served by the existing `/api/stats` endpoint unchanged. `app.js` just renders
new cards — no architecture change, just more fields in JSON already being
returned.

**Recommended build order:** this layer first, regardless of the Layer 2
decision. It's zero-risk, needs no new dependency or key, and it's the part
that actually made the deep reads sharp — the relative-baseline comparisons
(e.g. "his tapback rate is 1.7x his own median across 40 DMs, not just high
in absolute terms") did more analytical work than any single quoted message.

## Layer 2 — narrative synthesis (LLM-powered, real design fork)

The part that writes actual prose analysis — "here's what this pattern means,
here's the relevant research, here's why this exchange matters" — cannot come
from a formula. It requires an LLM reading curated excerpts in context and
applying judgment.

This is a genuine fork from the project's current privacy posture. The
README's stated goal #8 is "nothing is uploaded to the cloud." A synthesis
layer means selected message excerpts leave the machine and go to an LLM API
— even using your own key, that's a different privacy stance than what's
built so far. Worth deciding deliberately, not adding silently.

If pursued, shape:

```
insights_llm.py
  build_excerpt_bundle(chat_id, stats)   # uses Layer 1's flagged messages —
                                          # longest silences+repairs, top vuln/
                                          # absolutist hits, top distinctive
                                          # words, biggest latency/initiation
                                          # asymmetries — NOT the raw full log
  call_claude(bundle, stats) -> markdown # one API call, system prompt = the
                                          # "psychologist/relationship-coach,
                                          # cite evidence" framing
  cache to disk, keyed by chat_id + hash(stats)  # don't regenerate on every
                                                  # page load — costs money and
                                                  # the underlying data barely
                                                  # changes day to day
```

Server gets one new endpoint, `/api/insight?chat_id=X`, triggered by a button
click (not automatic) so each time real message content leaves the machine is
an explicit, visible action — and the README should say so plainly.

## Status

**Layer 1: four of seven shipped.** Relative latency/initiation ranking,
distinctive vocabulary (log-odds), function-word categories, and the
silence-anomaly detector are built and documented in the README under "Deep
Read"; they surface in a per-conversation **Deep Read** tab. No new dependency
was needed, and the privacy posture is unchanged.

Three corrections to this plan's assumptions, found while building:

- **The silence detector needed no new pass.** The plan called for "a new pass
  over each chat's message timestamps." The existing single pass already
  computes the per-chat gap for its marathon/initiation logic, so building the
  lull distribution was an append inside that loop — the cheapest of the four,
  not one of the more expensive.
- **Log-odds needed a baseline split first.** `g_words` was updated *before* the
  `is_from_me` branch, so it blended your words with all 300-odd other people's.
  Comparing a person against that baseline partly compares them against
  themselves. Now split into `g_words_sent` / `g_words_received`.
- **Function words are invisible to `clean_words()`.** Nearly every token in
  these categories is a stopword it drops by design, so style had to be counted
  over an unfiltered token stream. `analyze_tokens()` now returns both
  vocabularies from one tokenization, keeping the per-message cost flat.

Still open from Layer 1: vulnerability/capitalization tracking, direct vs.
indirect criticism, self-description extraction. The first of these is the
expensive one — it needs lookahead to the other party's next message, which the
globally time-ordered loop can't do with a keyword classifier alone.

**Layer 2 remains undecided and unbuilt**, deliberately. It should stay that way
until someone actively wants it: it is the only part of this plan that changes
what the project promises.
