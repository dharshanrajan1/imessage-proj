# iMessage Wrapped

iMessage Wrapped is a local, privacy-first web dashboard that analyzes your macOS iMessage database (`chat.db`) and visualizes your texting habits, group chat dynamics, and conversation statistics.

## Project Goals

1. **Deep Analytics:** Provide insights beyond simple message counts. Calculate advanced metrics like Laughs Per Message (LPM), double text ratios, conversation initiations, and response times.
2. **Group Chat Dynamics:** Track individual member contributions within group chats to assign fun awards like "Reaction Magnet", "Ghost", and calculate a "Main Character Score".
3. **Reaction Affinity:** Map out who reacts to whose messages the most to visualize hidden group dynamics.
4. **Beautiful UI:** Present the data in a modern, responsive, premium glassmorphic interface using Chart.js.
5. **Zero Dependencies & Privacy First:** Use only standard Python libraries. All data processing happens locally on your machine, directly from your macOS Messages database. Nothing is uploaded to the cloud.

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

## Potential Improvements

1. **Data Caching / Incremental Updates**: Currently, the entire `chat.db` is parsed every time the server starts. Caching the output JSON and only parsing messages that arrived after the last timestamp would significantly speed up startup times.
2. **Attachment Analysis**: Analyzing the `attachment` table to provide stats on who sends the most photos, videos, or links.
3. **Sentiment Analysis**: Integrating a lightweight NLP library (like `TextBlob` or `VADER`) to determine if conversations are generally positive, negative, or neutral.
4. **Export to Image/PDF**: Allowing users to generate a "Wrapped" graphic (like Spotify Wrapped) to share with friends.
5. **Search within Chats**: Adding the ability to search for specific messages or deeply analyze word usage over time for a specific word.
6. **Time Filtering**: Adding a global date picker to restrict analysis to a specific year or month.
