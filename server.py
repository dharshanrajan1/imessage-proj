import http.server
import json
import os
import webbrowser
import threading
import socketserver
from urllib.parse import urlparse, parse_qs

from parse_chat import run_analysis, load_contacts

# Load contacts once at startup -- re-walking the AddressBook on every
# date-range change would be wasteful since it never changes mid-session.
print("Loading contacts...")
CONTACTS = load_contacts()

print("Running chat analysis... This might take a few moments.")
STATS_CACHE = {}

def get_stats(start_date=None, end_date=None):
    key = (start_date, end_date)
    if key not in STATS_CACHE:
        STATS_CACHE[key] = run_analysis(contacts=CONTACTS, start_date=start_date, end_date=end_date)
    return STATS_CACHE[key]

# Warm the cache with the default (all-time) view so first load is instant.
get_stats()
print("Analysis complete.")

class APIServerHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == '/api/stats':
            params = parse_qs(parsed.query)
            start_date = params.get('start_date', [None])[0]
            end_date = params.get('end_date', [None])[0]
            data = get_stats(start_date, end_date)

            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps(data).encode('utf-8'))
        else:
            super().do_GET()

def open_browser():
    webbrowser.open("http://localhost:8000")

if __name__ == '__main__':
    PORT = 8000
    
    # Allow port reuse
    socketserver.TCPServer.allow_reuse_address = True
    
    try:
        with socketserver.TCPServer(("", PORT), APIServerHandler) as httpd:
            print(f"Server running at http://localhost:{PORT} — Press Ctrl+C to stop")
            
            # Start timer to open browser
            threading.Timer(0.5, open_browser).start()
            
            # Serve indefinitely
            httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server...")
