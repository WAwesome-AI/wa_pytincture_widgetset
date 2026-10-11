"""
A stand-in for *your* media server, for mediaplayer_demo.py — the four ways a
real one usually guards its media, on another origin than the app:

    python tests/mediaplayer_demo_server.py            # makes test media with ffmpeg once, then serves
    python tests/mediaplayer_demo_server.py --port 9102 --app-origin http://127.0.0.1:8070

    /open/<file>             anyone: a CDN, a static folder
    /auth/<file>             Authorization: Bearer demo-token, or 401 (an API gateway)
    /signed/<token>/<file>   a token from /mint, which /expire/<token> revokes: 403 (S3/CloudFront-style)
    /live/index.m3u8         a live stream: a sliding window of 5 x 2 s segments
    /mint, /expire/<token>   the "API" that issues and revokes signed URLs

Media (made once, under tests/.mediaplayer_demo/): an HLS film with two
renditions (720p, 360p) and WebVTT subtitles, a plain MP4, and three short
"songs". Standard library only; ffmpeg must be on PATH to make the media.
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import time
import uuid
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent / ".mediaplayer_demo"
TOKEN = "demo-token"


def make_media() -> None:
    if (ROOT / "film" / "master.m3u8").exists():
        return
    if not shutil.which("ffmpeg"):
        raise SystemExit("ffmpeg is needed once, to make the demo media")
    film = ROOT / "film"
    for sub in ("v0", "v1"):
        (film / sub).mkdir(parents=True, exist_ok=True)
    run = lambda *args: subprocess.run(["ffmpeg", "-loglevel", "error", "-y", *args], check=True, cwd=film)  # noqa: E731
    run("-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=24", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
        "-t", "60", "-filter_complex", "[0:v]split=2[a][b];[b]scale=640:360[bs]",
        "-map", "[a]", "-map", "[bs]", "-map", "1:a", "-map", "1:a", "-c:v", "libx264", "-preset", "veryfast",
        "-g", "48", "-keyint_min", "48", "-sc_threshold", "0", "-b:v:0", "2500k", "-b:v:1", "600k",
        "-c:a", "aac", "-b:a", "96k", "-f", "hls", "-hls_time", "2", "-hls_playlist_type", "vod",
        "-var_stream_map", "v:0,a:0 v:1,a:1", "-master_pl_name", "master.m3u8",
        "-hls_segment_filename", "v%v/seg%03d.ts", "v%v/index.m3u8")
    cues = ["WEBVTT", ""] + [f"00:00:{s:02d}.000 --> 00:00:{s + 4:02d}.000\nSecond {s} of the demo film\n" for s in range(0, 56, 5)]
    (film / "en.vtt").write_text("\n".join(cues))
    run("-f", "lavfi", "-i", "testsrc2=size=640x360:rate=24", "-f", "lavfi", "-i", "sine=frequency=330", "-t", "20",
        "-c:v", "libx264", "-preset", "veryfast", "-c:a", "aac", "-movflags", "+faststart", "../plain.mp4")
    for n, hz in enumerate((262, 330, 392)):
        run("-f", "lavfi", "-i", f"sine=frequency={hz}:duration=15", "-c:a", "libmp3lame", "-q:a", "5", f"../song{n + 1}.mp3")


def handler(app_origin: str):
    valid: set[str] = set()
    started = time.time()

    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *a, **kw):
            super().__init__(*a, directory=str(ROOT), **kw)

        def log_message(self, *a):
            pass

        def end_headers(self):
            # CORS: the app is on another origin. Allow the headers it sends,
            # and credentials for cookie-based setups.
            self.send_header("Access-Control-Allow-Origin", app_origin)
            self.send_header("Access-Control-Allow-Headers", "Authorization")
            self.send_header("Access-Control-Allow-Credentials", "true")
            if getattr(self, "asked", "").startswith(("/auth/", "/signed/")):
                # A protected response must not be served from cache to a
                # request with other credentials.
                self.send_header("Cache-Control", "no-store")
                self.send_header("Vary", "Authorization")
            super().end_headers()

        def do_OPTIONS(self):
            self.send_response(204)
            self.end_headers()

        def refuse(self, code: int):
            self.send_response(code)
            self.send_header("Content-Length", "0")
            self.end_headers()

        def text(self, body: str, ctype: str = "text/plain"):
            data = body.encode()
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def file(self, rel: str):
            self.path = "/" + rel
            return super().do_GET()

        def do_GET(self):
            self.asked = path = self.path.split("?")[0]
            if path.startswith("/open/"):
                return self.file(path[len("/open/"):])
            if path.startswith("/auth/"):
                if self.headers.get("Authorization") != f"Bearer {TOKEN}":
                    return self.refuse(401)
                return self.file(path[len("/auth/"):])
            if path.startswith("/signed/"):
                parts = path.split("/", 3)
                if len(parts) < 4 or parts[2] not in valid:
                    return self.refuse(403)
                return self.file(parts[3])
            if path == "/mint":
                token = uuid.uuid4().hex
                valid.add(token)
                return self.text(token)
            if path.startswith("/expire/"):
                valid.discard(path.rsplit("/", 1)[1])
                return self.text("expired")
            if path == "/live/index.m3u8":
                seq = int((time.time() - started) / 2) % 24
                lines = ["#EXTM3U", "#EXT-X-VERSION:3", "#EXT-X-TARGETDURATION:2", f"#EXT-X-MEDIA-SEQUENCE:{seq}"]
                for n in range(seq, seq + 5):
                    lines += ["#EXTINF:2.000000,", f"/open/film/v1/seg{n:03d}.ts"]
                return self.text("\n".join(lines) + "\n", "application/vnd.apple.mpegurl")
            return self.refuse(404)

    return Handler


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--port", type=int, default=9102)
    parser.add_argument("--app-origin", default="http://127.0.0.1:8070", help="where mediaplayer_demo is served from")
    args = parser.parse_args()
    make_media()
    print(f"media server on http://127.0.0.1:{args.port}/ for an app on {args.app_origin}")
    ThreadingHTTPServer(("127.0.0.1", args.port), handler(args.app_origin)).serve_forever()


if __name__ == "__main__":
    main()
