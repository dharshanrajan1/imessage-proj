import sqlite3
import os
import json
import re
from collections import defaultdict, Counter
from datetime import datetime, timezone, timedelta

MAC_EPOCH_OFFSET = 978307200

def load_contacts():
    """Query all macOS AddressBook databases (including iCloud/Google Sources) to build phone/email -> name mapping."""
    contact_map = {}
    
    base = os.path.expanduser('~/Library/Application Support/AddressBook')
    if not os.path.exists(base):
        print('[i] AddressBook directory not found.')
        return contact_map

    # Walk entire AddressBook tree to find all .abcddb files
    all_dbs = []
    for root, dirs, files in os.walk(base):
        for f in files:
            if f.endswith('.abcddb'):
                all_dbs.append(os.path.join(root, f))

    if not all_dbs:
        print('[i] No AddressBook databases found — handles will show as phone/email.')
        return contact_map

    for db_path in all_dbs:
        try:
            conn = sqlite3.connect(f'file:{db_path}?mode=ro', uri=True)
            cur = conn.cursor()

            # Phone numbers -> name
            try:
                cur.execute("""
                    SELECT r.ZFIRSTNAME, r.ZLASTNAME, r.ZORGANIZATION, p.ZFULLNUMBER
                    FROM ZABCDRECORD r
                    JOIN ZABCDPHONENUMBER p ON r.Z_PK = p.ZOWNER
                    WHERE p.ZFULLNUMBER IS NOT NULL
                """)
                for first, last, org, phone in cur.fetchall():
                    name = ' '.join(filter(None, [first, last])) or org
                    if name and phone:
                        # Store original
                        contact_map[phone] = name
                        # Normalized (digits + leading +)
                        normalized = re.sub(r'[\s\-\(\)\.]+', '', phone)
                        contact_map[normalized] = name
                        # With +1 prefix if missing
                        if normalized.lstrip('+').isdigit():
                            digits = normalized.lstrip('+')
                            contact_map['+1' + digits] = name
                            contact_map['+' + digits] = name
                            if len(digits) == 10:
                                contact_map[digits] = name
            except Exception:
                pass

            # Email addresses -> name
            try:
                cur.execute("""
                    SELECT r.ZFIRSTNAME, r.ZLASTNAME, r.ZORGANIZATION, e.ZADDRESS
                    FROM ZABCDRECORD r
                    JOIN ZABCDEMAILADDRESS e ON r.Z_PK = e.ZOWNER
                    WHERE e.ZADDRESS IS NOT NULL
                """)
                for first, last, org, email in cur.fetchall():
                    name = ' '.join(filter(None, [first, last])) or org
                    if name and email:
                        contact_map[email.lower()] = name
            except Exception:
                pass

            conn.close()
        except Exception as e:
            pass  # Skip unreadable DBs silently

    print(f'[+] Loaded {len(contact_map)} contact entries from {len(all_dbs)} AddressBook database(s).')

    # Also load user-defined overrides from contacts.json if present
    manual_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'contacts.json')
    if os.path.exists(manual_path):
        try:
            with open(manual_path, 'r') as f:
                manual = json.load(f)
            contact_map.update(manual)
            print(f'[+] Loaded {len(manual)} overrides from contacts.json.')
        except Exception:
            pass

    return contact_map


def resolve_handle(handle, contact_map):
    """Resolve a handle (phone/email) to a contact name."""
    if handle == 'me':
        return 'me'
    # Try exact match first
    if handle in contact_map:
        return contact_map[handle]
    # Try lowercase (for emails)
    if handle.lower() in contact_map:
        return contact_map[handle.lower()]
    # Try normalized phone (strip everything except digits and +)
    normalized = re.sub(r'[\s\-\(\)]+', '', handle)
    if normalized in contact_map:
        return contact_map[normalized]
    return handle  # Return original if no match


def normalize_chat_key(chat_identifier):
    """Collapse SMS vs iMessage variants of the same 1:1 conversation into one grouping key.

    macOS can keep separate `chat` rows (green-bubble vs blue-bubble) for the same
    contact if their phone number formatting differs slightly. Group chats keep a
    stable synthetic identifier (starts with 'chat') and are left untouched.
    """
    if not chat_identifier:
        return chat_identifier
    if chat_identifier.startswith('chat'):
        return chat_identifier
    if '@' in chat_identifier:
        return chat_identifier.lower()
    normalized = re.sub(r'[\s\-\(\)\.]+', '', chat_identifier)
    digits = normalized.lstrip('+')
    if digits.isdigit():
        if len(digits) == 10:
            return '+1' + digits
        if len(digits) == 11 and digits.startswith('1'):
            return '+' + digits
    return normalized


def extract_text_from_attributed_body(blob):
    """Best-effort extraction of message text from `attributedBody`.

    Modern macOS often leaves `message.text` NULL and stores the actual content
    as an Apple 'typedstream' archive (NSAttributedString) in `attributedBody`
    instead. We don't need a full typedstream parser -- the plain-text run is
    always stored as a length-prefixed NSString payload right after the
    'NSString' class marker, so we locate that marker and read the length prefix.
    """
    if not blob:
        return None
    try:
        marker = blob.find(b'NSString')
        if marker == -1:
            marker = blob.find(b'NSMutableString')
            if marker == -1:
                return None
            offset = marker + len(b'NSMutableString')
        else:
            offset = marker + len(b'NSString')

        # Skip fixed class-metadata bytes that follow the class name marker.
        offset += 5
        if offset >= len(blob):
            return None

        length_byte = blob[offset]
        if length_byte == 0x81:
            # Two-byte little-endian length prefix for strings >= 128 bytes.
            length = int.from_bytes(blob[offset + 1:offset + 3], 'little')
            offset += 3
        else:
            length = length_byte
            offset += 1

        text_bytes = blob[offset:offset + length]
        text = text_bytes.decode('utf-8', errors='ignore').strip()
        return text or None
    except Exception:
        return None


# Base English stopwords (function words, pronouns, auxiliaries).
STOP_WORDS = {
    'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves', 'you', 'your',
    'yours', 'yourself', 'yourselves', 'he', 'him', 'his', 'himself', 'she', 'her', 'hers',
    'herself', 'it', 'its', 'itself', 'they', 'them', 'their', 'theirs', 'themselves', 'what', 'which',
    'who', 'whom', 'this', 'that', 'these', 'those', 'am', 'is', 'are', 'was', 'were', 'be', 'been',
    'being', 'have', 'has', 'had', 'having', 'do', 'does', 'did', 'doing', 'a', 'an', 'the', 'and', 'but', 'if',
    'or', 'because', 'as', 'until', 'while', 'of', 'at', 'by', 'for', 'with', 'about', 'against', 'between',
    'into', 'through', 'during', 'before', 'after', 'above', 'below', 'to', 'from', 'up', 'down', 'in', 'out',
    'on', 'off', 'over', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why',
    'how', 'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not',
    'only', 'own', 'same', 'so', 'than', 'too', 'very', 'can', 'will', 'just', 'should',
    'now', 'ain', 'aren', 'couldn', 'didn', 'doesn', 'hadn', 'hasn', 'haven', 'isn',
    'ma', 'mightn', 'mustn', 'needn', 'shan', 'shouldn', 'wasn', 'weren', 'won', 'wouldn',
}

# Texting/internet filler that survives stopword lists but adds no signal to "top words".
FILLER_WORDS = {
    'im', 'ur', 'u', 'like', 'yeah', 'yea', 'ye', 'ya', 'yah', 'nah', 'naw', 'nope', 'yep', 'yup',
    'ok', 'okay', 'kk', 'k', 'oh', 'ah', 'uh', 'um', 'umm', 'uhh', 'hmm', 'hmmm', 'huh', 'meh', 'mhm',
    'idk', 'idc', 'tbh', 'ngl', 'fr', 'rn', 'btw', 'omg', 'smh', 'imo', 'imho', 'atp', 'asap',
    'wyd', 'hbu', 'wbu', 'lmk', 'lmao', 'lmfao', 'lol', 'lel', 'rofl', 'omfg', 'wtf', 'ffs',
    'gonna', 'wanna', 'gotta', 'kinda', 'sorta', 'dunno', 'cause', 'cuz', 'coz', 'okie',
    'http', 'https', 'www', 'com', 'org', 'net', 'html',
}

ALL_STOP_WORDS = STOP_WORDS | FILLER_WORDS

# Expand contractions into real words *before* tokenizing, so "can't" doesn't
# leave a dangling, meaning-inverted "can" once punctuation is stripped.
CONTRACTIONS = {
    "ain't": "am not", "aren't": "are not", "can't": "cannot", "can't've": "cannot have",
    "'cause": "because", "could've": "could have", "couldn't": "could not", "couldn't've": "could not have",
    "didn't": "did not", "doesn't": "does not", "don't": "do not", "hadn't": "had not",
    "hadn't've": "had not have", "hasn't": "has not", "haven't": "have not", "he'd": "he would",
    "he'd've": "he would have", "he'll": "he will", "he's": "he is", "how'd": "how did",
    "how'll": "how will", "how's": "how is", "i'd": "i would", "i'll": "i will", "i'm": "i am",
    "i've": "i have", "isn't": "is not", "it'd": "it would", "it'll": "it will", "it's": "it is",
    "let's": "let us", "ma'am": "madam", "might've": "might have", "mightn't": "might not",
    "must've": "must have", "mustn't": "must not", "needn't": "need not", "shan't": "shall not",
    "she'd": "she would", "she'll": "she will", "she's": "she is", "should've": "should have",
    "shouldn't": "should not", "that's": "that is", "there's": "there is", "they'd": "they would",
    "they'll": "they will", "they're": "they are", "they've": "they have", "wasn't": "was not",
    "we'd": "we would", "we'll": "we will", "we're": "we are", "we've": "we have",
    "weren't": "were not", "what's": "what is", "what've": "what have", "when's": "when is",
    "where'd": "where did", "where's": "where is", "who'll": "who will", "who's": "who is",
    "won't": "will not", "would've": "would have", "wouldn't": "would not",
    "y'all": "you all", "you'd": "you would", "you'll": "you will", "you're": "you are",
    "you've": "you have",
}
_CONTRACTION_RE = re.compile(
    r"\b(" + "|".join(re.escape(k) for k in sorted(CONTRACTIONS, key=len, reverse=True)) + r")\b"
)

_URL_RE = re.compile(r'https?://\S+|www\.\S+')
_EMAIL_RE = re.compile(r'\S+@\S+\.\S+')
_LAUGH_RE = re.compile(r'^(a*ha+h*)+$|^(l+o+)+l+$|^lma(o+)$|^lmf?ao+$|^ro+fl+$|^h?e*he+h*$|^b?a*ha+h*$')
_REPEAT_CHAR_RE = re.compile(r'(.)\1+')


def _expand_contractions(text):
    return _CONTRACTION_RE.sub(lambda m: CONTRACTIONS[m.group(0)], text)


def clean_words(text):
    if not text:
        return []
    text = text.lower()
    text = _URL_RE.sub(' ', text)
    text = _EMAIL_RE.sub(' ', text)
    text = _expand_contractions(text)

    words = re.findall(r"[a-z]+", text)
    out = []
    for w in words:
        if len(w) <= 1 or w in ALL_STOP_WORDS:
            continue
        if _LAUGH_RE.match(w):
            continue
        # Fully de-duplicate repeated letters ("soooo" -> "so") to catch elongated
        # filler, but only for the comparison -- keep the original spelling in output
        # so real double letters ("book", "letter") aren't corrupted.
        deduped = _REPEAT_CHAR_RE.sub(r'\1', w)
        if deduped in ALL_STOP_WORDS:
            continue
        out.append(w)
    return out


REACTIONS_ADDED = {2000: 'love', 2001: 'like', 2002: 'dislike', 2003: 'laugh', 2004: 'emphasize', 2005: 'question'}
REACTIONS_REMOVED = {3000, 3001, 3002, 3003, 3004, 3005}

def convert_mac_date(mac_date):
    if mac_date > 1000000000000000:
        mac_date = mac_date / 1000000000
    return datetime.fromtimestamp(mac_date + MAC_EPOCH_OFFSET, tz=timezone.utc)

def extract_emojis(text):
    if not text: return []
    return [c for c in text if ord(c) > 0xFFFF or (0x2600 <= ord(c) <= 0x27BF)]

def is_laugh_text(text):
    if not text: return False
    text = text.lower()
    return bool(re.search(r'\b(haha+|lol+|lmao|rofl|hehe+)\b', text))

# Messages within this gap of each other count as the same "marathon" streak.
MARATHON_GAP_SECONDS = 60 * 60

def _close_streak(cdata, end_dt):
    """Finalize the in-progress marathon streak and keep it if it's a new record."""
    if cdata["streak_start"] is None or cdata["streak_count"] < 2:
        return
    duration_hours = (end_dt - cdata["streak_start"]).total_seconds() / 3600
    if cdata["streak_count"] > cdata["best_streak"]["message_count"]:
        cdata["best_streak"] = {
            "start": cdata["streak_start"].isoformat(),
            "end": end_dt.isoformat(),
            "message_count": cdata["streak_count"],
            "duration_hours": round(duration_hours, 2),
        }

def run_analysis(contacts=None, start_date=None, end_date=None):
    """Run the full chat.db analysis.

    start_date / end_date are optional 'YYYY-MM-DD' strings (inclusive) used to
    restrict the analysis to a window of time -- handy for checking whether "top
    words" are being dominated by a recent burst of activity rather than reflecting
    the whole relationship history.
    """
    db_path = os.path.expanduser('~/Library/Messages/chat.db')
    if not os.path.exists(db_path):
        return {"global_stats": {}, "chats": []}

    start_dt = None
    end_dt = None
    if start_date:
        try:
            start_dt = datetime.strptime(start_date, '%Y-%m-%d').replace(tzinfo=timezone.utc)
        except ValueError:
            pass
    if end_date:
        try:
            end_dt = datetime.strptime(end_date, '%Y-%m-%d').replace(
                hour=23, minute=59, second=59, tzinfo=timezone.utc)
        except ValueError:
            pass

    # Load contact name mapping (callers may pass a pre-loaded map to avoid
    # re-walking the AddressBook on every date-range change)
    if contacts is None:
        contacts = load_contacts()

    try:
        conn = sqlite3.connect(f'file:{db_path}?mode=ro', uri=True)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
    except Exception as e:
        return {"error": str(e)}

    # Fetch messages
    query = """
    SELECT
        m.guid, m.text, m.attributedBody, m.is_from_me, m.date,
        m.associated_message_guid, m.associated_message_type,
        c.chat_identifier, c.display_name, h.id as sender_id
    FROM message m
    JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
    JOIN chat c ON cmj.chat_id = c.ROWID
    LEFT JOIN handle h ON m.handle_id = h.ROWID
    WHERE m.item_type = 0
    ORDER BY m.date ASC
    """
    
    cur.execute(query)
    rows = cur.fetchall()

    # Full dataset bounds (unaffected by the requested filter) so the UI can
    # populate date pickers without guessing.
    date_bounds = {"min": None, "max": None}
    if rows:
        date_bounds["min"] = convert_mac_date(rows[0]['date']).date().isoformat()
        date_bounds["max"] = convert_mac_date(rows[-1]['date']).date().isoformat()

    # Global state
    g_total = 0
    g_sent = 0
    g_received = 0
    g_hourly = [0]*24
    g_daily = [0]*7
    g_month_of_year = [0]*12  # Jan..Dec, aggregated across all years -- "peak season"
    g_reactions_sent = Counter()
    g_reactions_received = Counter()
    g_emojis = Counter()
    g_words = Counter()
    
    # Chat state
    chats_data = {}
    
    # Pass 1: standard messages & build mappings
    msg_guid_to_sender = {}
    
    # Pass 1 variables per chat
    chat_last_msg_time = {}
    chat_last_sender = {}
    
    # Process rows
    for row in rows:
        chat_id = normalize_chat_key(row['chat_identifier'])
        display_name = row['display_name']
        is_from_me = bool(row['is_from_me'])
        sender_id = "me" if is_from_me else (row['sender_id'] or "unknown")

        msg_guid = row['guid']
        text = row['text'] or extract_text_from_attributed_body(row['attributedBody'])
        assoc_guid = row['associated_message_guid']
        # Strip p: or bp: prefix that iMessage adds to reaction GUIDs
        if assoc_guid and assoc_guid.startswith(('p:', 'bp:')):
            assoc_guid = assoc_guid.split(':', 1)[1] if ':' in assoc_guid else assoc_guid
            # Handle double-prefixed GUIDs (e.g., "p:0/...")
            if '/' in assoc_guid:
                assoc_guid = assoc_guid.split('/', 1)[1]
        assoc_type = row['associated_message_type']
        
        dt = convert_mac_date(row['date'])

        if start_dt and dt < start_dt:
            continue
        if end_dt and dt > end_dt:
            continue

        if chat_id not in chats_data:
            chats_data[chat_id] = {
                "chat_identifier": chat_id,
                "display_name": display_name or chat_id,
                "total_messages": 0,
                "sent": 0,
                "received": 0,
                "laughs_sent": 0, "laughs_received": 0,
                "double_texts_sent": 0, "double_texts_received": 0,
                "initiations_sent": 0, "initiations_received": 0,
                "reactions_sent": Counter(), "reactions_received": Counter(),
                "top_emojis_sent": Counter(), "top_emojis_received": Counter(),
                "top_words_sent": Counter(), "top_words_received": Counter(),
                "monthly_activity": Counter(),
                "hourly_distribution": [0] * 24,
                "daily_distribution": [0] * 7,
                "members_data": {},
                "reaction_matrix_raw": Counter(),
                "response_times_sent": [],
                "response_times_received": [],
                # Marathon Chat: longest run of messages with no gap > MARATHON_GAP_SECONDS
                "streak_start": None,
                "streak_count": 0,
                "best_streak": {"start": None, "end": None, "message_count": 0, "duration_hours": 0},
                # Ghosting: longest delay before someone answered a "?" message
                "pending_question": None,
                "worst_ghost": {"delay_hours": 0, "ghoster": None, "asker": None,
                                 "question_preview": None, "question_date": None, "response_date": None},
            }
        
        cdata = chats_data[chat_id]
        
        if sender_id not in cdata["members_data"]:
            cdata["members_data"][sender_id] = {
                "message_count": 0,
                "word_count": 0,
                "reactions_received": 0,
                "reactions_given": 0,
                "initiations": 0,
                "laughs": 0,
                "night_owl_count": 0,
                "double_texts": 0,
                "emojis": Counter(),
                "words": Counter()
            }
        
        mdata = cdata["members_data"][sender_id]
        
        # Handle reactions
        if assoc_guid and assoc_type in REACTIONS_REMOVED:
            # Tapback un-done (e.g. un-hearting a message) -- not a new reaction,
            # and not a real message. Ignoring it avoids double counting.
            continue

        if assoc_guid and assoc_type in REACTIONS_ADDED:
            rtype = REACTIONS_ADDED[assoc_type]
            target_sender = msg_guid_to_sender.get(assoc_guid)
            if target_sender and target_sender in cdata["members_data"]:
                # Update matrix
                cdata["reaction_matrix_raw"][(sender_id, target_sender)] += 1
                
                # Member stats
                mdata["reactions_given"] += 1
                cdata["members_data"][target_sender]["reactions_received"] += 1
                
                # Chat stats
                if is_from_me:
                    cdata["reactions_sent"][rtype] += 1
                    g_reactions_sent[rtype] += 1
                else:
                    if target_sender == "me":
                        cdata["reactions_received"][rtype] += 1
                        g_reactions_received[rtype] += 1
                        
            continue # Reactions don't count as standard messages
            
        # Standard message
        msg_guid_to_sender[msg_guid] = sender_id
        
        g_total += 1
        g_hourly[dt.hour] += 1
        g_daily[dt.weekday()] += 1
        g_month_of_year[dt.month - 1] += 1
        cdata["hourly_distribution"][dt.hour] += 1
        cdata["daily_distribution"][dt.weekday()] += 1

        cdata["total_messages"] += 1
        mdata["message_count"] += 1
        
        month_key = f"{dt.year}-{dt.month:02d}"
        cdata["monthly_activity"][month_key] += 1
        
        if dt.hour >= 22 or dt.hour < 4:
            mdata["night_owl_count"] += 1
            
        is_laugh = is_laugh_text(text)
        if is_laugh:
            mdata["laughs"] += 1
            
        emojis = extract_emojis(text)
        words = clean_words(text)
        
        g_emojis.update(emojis)
        g_words.update(words)
        mdata["emojis"].update(emojis)
        mdata["words"].update(words)
        mdata["word_count"] += len(words)
        
        # Timing analysis
        if chat_id in chat_last_msg_time:
            time_diff = (dt - chat_last_msg_time[chat_id]).total_seconds()
            last_sender = chat_last_sender[chat_id]

            # Marathon Chat: extend or close the current streak
            if time_diff <= MARATHON_GAP_SECONDS:
                cdata["streak_count"] += 1
            else:
                _close_streak(cdata, chat_last_msg_time[chat_id])
                cdata["streak_start"] = dt
                cdata["streak_count"] = 1

            # Initiation
            if time_diff > 8 * 3600:
                mdata["initiations"] += 1
                if is_from_me:
                    cdata["initiations_sent"] += 1
                else:
                    cdata["initiations_received"] += 1

            # Double text
            elif last_sender == sender_id and time_diff > 60:
                mdata["double_texts"] += 1
                if is_from_me:
                    cdata["double_texts_sent"] += 1
                else:
                    cdata["double_texts_received"] += 1

            # Response time
            elif last_sender != sender_id:
                if is_from_me:
                    cdata["response_times_sent"].append(time_diff / 60)
                elif last_sender == "me":
                    cdata["response_times_received"].append(time_diff / 60)
        else:
            mdata["initiations"] += 1
            if is_from_me:
                cdata["initiations_sent"] += 1
            else:
                cdata["initiations_received"] += 1
            cdata["streak_start"] = dt
            cdata["streak_count"] = 1

        # Ghosting: did this message answer someone else's still-open "?"
        pending = cdata["pending_question"]
        if pending and pending["sender"] != sender_id:
            delay_hours = (dt - pending["dt"]).total_seconds() / 3600
            if delay_hours > cdata["worst_ghost"]["delay_hours"]:
                cdata["worst_ghost"] = {
                    "delay_hours": round(delay_hours, 2),
                    "ghoster": sender_id,
                    "asker": pending["sender"],
                    "question_preview": pending["text"],
                    "question_date": pending["dt"].isoformat(),
                    "response_date": dt.isoformat(),
                }
            cdata["pending_question"] = None
        if text and '?' in text:
            cdata["pending_question"] = {"sender": sender_id, "dt": dt, "text": text.strip()[:100]}

        chat_last_msg_time[chat_id] = dt
        chat_last_sender[chat_id] = sender_id
        
        if is_from_me:
            g_sent += 1
            cdata["sent"] += 1
            if is_laugh: cdata["laughs_sent"] += 1
            cdata["top_emojis_sent"].update(emojis)
            cdata["top_words_sent"].update(words)
        else:
            g_received += 1
            cdata["received"] += 1
            if is_laugh: cdata["laughs_received"] += 1
            cdata["top_emojis_received"].update(emojis)
            cdata["top_words_received"].update(words)

    conn.close()

    # Finalize outputs
    result = {
        "date_bounds": date_bounds,
        "applied_filter": {"start_date": start_date, "end_date": end_date},
        "global_stats": {
            "total_messages": g_total,
            "sent": g_sent,
            "received": g_received,
            "hourly_distribution": g_hourly,
            "daily_distribution": g_daily,
            "reactions_sent": dict(g_reactions_sent),
            "reactions_received": dict(g_reactions_received),
            "top_emojis": g_emojis.most_common(10),
            "top_words": g_words.most_common(10)
        },
        "chats": []
    }

    def _new_type_agg():
        return {
            "total": 0, "sent": 0, "received": 0,
            "hourly": [0] * 24, "daily": [0] * 7,
            "reactions_sent": Counter(), "reactions_received": Counter(),
            "emojis": Counter(), "words": Counter(),
        }

    # Exact group-chat vs DM breakdown, built by summing each chat's already-exact
    # (untruncated) counters -- no second pass over the raw message rows needed.
    type_aggs = {"group": _new_type_agg(), "dm": _new_type_agg()}

    # Cross-chat "Wrapped"-style records, filled in while we already have each
    # chat's finalized data in hand.
    member_double_texts = Counter()
    best_marathon = None
    worst_ghosting = None
    most_one_sided = None

    for cdata in chats_data.values():
        total = cdata["total_messages"]
        if total == 0: continue

        # Determine group chat
        non_me_senders = [s for s in cdata["members_data"].keys() if s != "me"]
        is_group_chat = len(non_me_senders) >= 2

        agg = type_aggs["group"] if is_group_chat else type_aggs["dm"]
        agg["total"] += total
        agg["sent"] += cdata["sent"]
        agg["received"] += cdata["received"]
        for i in range(24):
            agg["hourly"][i] += cdata["hourly_distribution"][i]
        for i in range(7):
            agg["daily"][i] += cdata["daily_distribution"][i]
        agg["reactions_sent"].update(cdata["reactions_sent"])
        agg["reactions_received"].update(cdata["reactions_received"])
        agg["emojis"].update(cdata["top_emojis_sent"])
        agg["emojis"].update(cdata["top_emojis_received"])
        agg["words"].update(cdata["top_words_sent"])
        agg["words"].update(cdata["top_words_received"])

        # Close out whatever streak was still active when the messages ran out.
        last_dt_for_chat = chat_last_msg_time.get(cdata["chat_identifier"])
        if last_dt_for_chat:
            _close_streak(cdata, last_dt_for_chat)

        chat_initiations = sum(m["initiations"] for m in cdata["members_data"].values())
        
        members = []
        num_members = len(cdata["members_data"])
        expected_share = 1.0 / num_members if num_members > 0 else 1
        
        for handle, m in cdata["members_data"].items():
            msg_count = m["message_count"]
            if msg_count == 0 and m["reactions_given"] == 0: continue
            
            mc = msg_count or 1
            share_pct = (msg_count / total) * 100 if total > 0 else 0
            ghost_score = max(0, min(1, 1 - ((msg_count / total) / expected_share))) if total > 0 else 1
            main_character_score = (m["reactions_received"] * 2) + msg_count + (m["initiations"] * 5)
            
            display_name = resolve_handle(handle, contacts)
            member_double_texts[display_name] += m["double_texts"]

            members.append({
                "handle": display_name,
                "message_count": msg_count,
                "message_share_pct": round(share_pct, 2),
                "avg_message_length": round(m["word_count"] / mc, 2),
                "reactions_received": m["reactions_received"],
                "reactions_received_per_msg": round(m["reactions_received"] / mc, 2),
                "reactions_given": m["reactions_given"],
                "main_character_score": main_character_score,
                "ghost_score": round(ghost_score, 2),
                "initiations": m["initiations"],
                "initiation_pct": round((m["initiations"] / chat_initiations * 100) if chat_initiations > 0 else 0, 2),
                "lpm": round(m["laughs"] / mc, 3),
                "night_owl_pct": round((m["night_owl_count"] / mc * 100), 2),
                "double_texts": m["double_texts"],
                "top_emojis": [e[0] for e in m["emojis"].most_common(3)],
                "top_words": [w[0] for w in m["words"].most_common(5)]
            })
            
        members.sort(key=lambda x: x["message_count"], reverse=True)
        
        reaction_matrix = []
        for (frm, to), count in cdata["reaction_matrix_raw"].items():
            reaction_matrix.append({
                "from": resolve_handle(frm, contacts),
                "to": resolve_handle(to, contacts),
                "count": count
            })
        reaction_matrix.sort(key=lambda x: x["count"], reverse=True)
        
        rt_sent = sum(cdata["response_times_sent"]) / len(cdata["response_times_sent"]) if cdata["response_times_sent"] else 0
        rt_recv = sum(cdata["response_times_received"]) / len(cdata["response_times_received"]) if cdata["response_times_received"] else 0
        
        sent = cdata["sent"] or 1
        recv = cdata["received"] or 1
        
        # Get last message timestamp for recency sorting
        last_dt = chat_last_msg_time.get(cdata["chat_identifier"])
        last_msg_iso = last_dt.isoformat() if last_dt else "2000-01-01T00:00:00+00:00"

        resolved_chat_name = (resolve_handle(cdata["display_name"], contacts)
                               if not cdata["display_name"].startswith('chat') else cdata["display_name"])

        marathon = dict(cdata["best_streak"])
        ghost = dict(cdata["worst_ghost"])
        if ghost["ghoster"]:
            ghost["ghoster"] = resolve_handle(ghost["ghoster"], contacts)
            ghost["asker"] = resolve_handle(ghost["asker"], contacts)

        if marathon["message_count"] >= 2 and (best_marathon is None or marathon["message_count"] > best_marathon["message_count"]):
            best_marathon = {**marathon, "chat": resolved_chat_name}
        if ghost["delay_hours"] > 0 and (worst_ghosting is None or ghost["delay_hours"] > worst_ghosting["delay_hours"]):
            worst_ghosting = {**ghost, "chat": resolved_chat_name}
        if total >= 20:
            skew = abs(cdata["sent"] - cdata["received"]) / total
            if most_one_sided is None or skew > most_one_sided["skew"]:
                dominant = "me" if cdata["sent"] > cdata["received"] else "them"
                most_one_sided = {
                    "chat": resolved_chat_name, "skew": round(skew, 3), "dominant": dominant,
                    "sent": cdata["sent"], "received": cdata["received"], "total": total,
                }

        result["chats"].append({
            "chat_identifier": cdata["chat_identifier"],
            "display_name": resolved_chat_name,
            "is_group_chat": is_group_chat,
            "marathon_chat": marathon,
            "ghosting": ghost,
            "last_message_date": last_msg_iso,
            "total_messages": total,
            "sent": cdata["sent"],
            "received": cdata["received"],
            "laughs_sent": cdata["laughs_sent"],
            "laughs_received": cdata["laughs_received"],
            "lpm_sent": round(cdata["laughs_sent"] / sent, 3),
            "lpm_recv": round(cdata["laughs_received"] / recv, 3),
            "double_texts_sent": cdata["double_texts_sent"],
            "double_texts_received": cdata["double_texts_received"],
            "initiations_sent": cdata["initiations_sent"],
            "initiations_received": cdata["initiations_received"],
            "avg_response_time_sent_mins": round(rt_sent, 2),
            "avg_response_time_received_mins": round(rt_recv, 2),
            "reactions_sent": dict(cdata["reactions_sent"]),
            "reactions_received": dict(cdata["reactions_received"]),
            "top_emojis_sent": cdata["top_emojis_sent"].most_common(10),
            "top_emojis_received": cdata["top_emojis_received"].most_common(10),
            "top_words_sent": cdata["top_words_sent"].most_common(10),
            "top_words_received": cdata["top_words_received"].most_common(10),
            "monthly_activity": dict(cdata["monthly_activity"]),
            "members": members,
            "reaction_matrix": reaction_matrix
        })
    
    # Sort chats by last message date descending (most recent first)
    result["chats"].sort(key=lambda x: x["last_message_date"], reverse=True)

    result["global_stats_by_type"] = {
        type_key: {
            "total_messages": agg["total"],
            "sent": agg["sent"],
            "received": agg["received"],
            "hourly_distribution": agg["hourly"],
            "daily_distribution": agg["daily"],
            "reactions_sent": dict(agg["reactions_sent"]),
            "reactions_received": dict(agg["reactions_received"]),
            "top_emojis": agg["emojis"].most_common(10),
            "top_words": agg["words"].most_common(10),
        }
        for type_key, agg in type_aggs.items()
    }

    month_names = ['January', 'February', 'March', 'April', 'May', 'June',
                   'July', 'August', 'September', 'October', 'November', 'December']
    peak_month_idx = max(range(12), key=lambda i: g_month_of_year[i]) if any(g_month_of_year) else None

    top_double_texter = member_double_texts.most_common(1)
    result["records"] = {
        "marathon_chat": best_marathon,
        "ghosting": worst_ghosting,
        "most_one_sided_chat": most_one_sided,
        "peak_season": {
            "month": month_names[peak_month_idx],
            "message_count": g_month_of_year[peak_month_idx],
        } if peak_month_idx is not None else None,
        "chronic_double_texter": {
            "handle": top_double_texter[0][0],
            "count": top_double_texter[0][1],
        } if top_double_texter and top_double_texter[0][1] > 0 else None,
    }

    return result

if __name__ == '__main__':
    res = run_analysis()
    with open('output.json', 'w') as f:
        json.dump(res, f, indent=2)
