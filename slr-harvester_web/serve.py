#!/usr/bin/env python3
"""
SLR Harvester Web — local dev server with CORS proxy.

Serves the web app as static files and proxies external API endpoints that
do not send Access-Control-Allow-Origin headers (arXiv) or that return
CORS-less error responses (Semantic Scholar 429).

Endpoints proxied:
  GET /proxy/arxiv?<qs>  →  http://export.arxiv.org/api/query?<qs>   (HTTP — canonical arXiv URL)
  GET /proxy/s2?<qs>     →  https://api.semanticscholar.org/graph/v1/paper/search?<qs>
"""

import http.server
import socket
import sys
import urllib.request
import urllib.error
import os
import ssl

# Windows consoles default to cp1252, which can't encode arrows/dashes used
# in log output; force UTF-8 so future print() calls can't crash the server.
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')

PORT = 8765

PROXY_MAP = {
    # arXiv: plain HTTP — their canonical API URL, avoids SSL timeout/cert issues
    '/proxy/arxiv': 'http://export.arxiv.org/api/query',
    '/proxy/s2':    'https://api.semanticscholar.org/graph/v1/paper/search',
}

# SSL context for HTTPS targets only (S2)
_ssl_ctx = ssl.create_default_context()

# Upstream timeout in seconds
_TIMEOUT = 20


class Handler(http.server.SimpleHTTPRequestHandler):

    def do_OPTIONS(self):
        """Handle CORS preflight."""
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        for prefix, target_base in PROXY_MAP.items():
            if self.path == prefix or self.path.startswith(prefix + '?'):
                qs = self.path[len(prefix):]   # '' or '?...'
                url = target_base + qs
                try:
                    req = urllib.request.Request(
                        url,
                        headers={
                            'User-Agent': 'SLRHarvesterWeb/2.0',
                            'Accept': '*/*',
                        },
                    )
                    # Only pass SSL context for HTTPS URLs
                    ctx = _ssl_ctx if url.startswith('https://') else None
                    with urllib.request.urlopen(req, context=ctx, timeout=_TIMEOUT) as resp:
                        body = resp.read()
                        ct = resp.headers.get('Content-Type', 'application/octet-stream')
                    self._proxy_send(200, ct, body)

                except urllib.error.HTTPError as exc:
                    body = exc.read()
                    ct = exc.headers.get('Content-Type', 'text/plain; charset=utf-8')
                    self._proxy_send(exc.code, ct, body)

                except (socket.timeout, TimeoutError) as exc:
                    # Upstream timed out — tell JS to wait and retry
                    msg = f'Upstream timeout: {exc}'.encode('utf-8')
                    self._proxy_send(503, 'text/plain; charset=utf-8', msg)

                except ssl.SSLError as exc:
                    msg = f'SSL error: {exc}'.encode('utf-8')
                    self._proxy_send(503, 'text/plain; charset=utf-8', msg)

                except Exception as exc:
                    msg = str(exc).encode('utf-8')
                    self._proxy_send(502, 'text/plain; charset=utf-8', msg)

                return  # handled

        super().do_GET()  # fall back to static-file serving

    def _proxy_send(self, status, content_type, body: bytes):
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        # Suppress noisy static-file lines; only log proxy hits
        path = self.path.split('?')[0]
        if any(path.startswith(p) for p in PROXY_MAP):
            super().log_message(fmt, *args)


if __name__ == '__main__':
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    with http.server.ThreadingHTTPServer(('', PORT), Handler) as httpd:
        print(f'SLR Harvester Web  ->  http://localhost:{PORT}')
        print('Press Ctrl+C to stop.\n')
        httpd.serve_forever()
