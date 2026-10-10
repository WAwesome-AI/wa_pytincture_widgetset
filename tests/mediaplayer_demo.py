"""
MediaPlayer demo: a video in a layout cell, an album docked at the foot of the
window with every track's URL resolved only when it is reached, and two voice
messages in a chat column that pause each other.

Unlike the other demos this one is served with ``create_app`` rather than
``launch_service``, the way a real media app has to be: it needs a same-origin
route for its media, and pyTincture's Content-Security-Policy has no
``media-src``, which falls back to ``default-src 'self'`` and blocks the
``blob:`` URLs hls.js plays from. The server below adds ``media-src 'self'
blob:``; run with ``MEDIAPLAYER_DEMO_STRICT_CSP=1`` to keep the policy as
pyTincture ships it and see the player say so.

    ./scripts/dev_wheel.sh tests
    cd tests && uv run mediaplayer_demo.py      # http://127.0.0.1:8070/mediaplayer_demo/
                                                # (MEDIAPLAYER_DEMO_PORT to move it)

Test media is generated with ffmpeg into tests/.mediaplayer-fixtures on first run.

**A local player.** "On this computer" plays files from your disk — chosen
one by one or as a whole folder, or dropped on the column — with no server at
all: each ``File`` becomes a ``blob:`` URL (``URL.createObjectURL``). Songs
queue in the docked bar, video plays in the Video cell, and a ``.vtt`` with a
video's name becomes its subtitles. The browser decides what plays: MP4, WebM,
MP3, AAC, FLAC, Ogg and WAV almost everywhere; Matroska (``.mkv``) seldom.

**Your own media server.** "Your server" plays from a server on
another origin, the four ways a real one usually guards its media: open, a
Bearer header, a signed URL that expires mid-play (and is refreshed), and a
live stream. Start the stand-in first:

    python tests/mediaplayer_demo_server.py     # http://127.0.0.1:9102 (MEDIAPLAYER_DEMO_SERVER to move it)

The policy wrapper below adds that origin to ``media-src`` and ``connect-src``
(hls.js fetches with XHR, so ``media-src`` alone isn't enough); the server
answers CORS for this app's origin. See the wiki's "MediaPlayer: connecting
your media server" for the same patterns against a real backend.
"""
import asyncio
import json
import os
import sys

try:  # the browser half; the server half below runs under CPython
    import js
    from pyodide.ffi import create_proxy
except ImportError:
    js = create_proxy = None

from wapyt import (
    CellConfig,
    LayoutConfig,
    MainWindow,
    MediaItem,
    MediaPlayer,
    MediaPlayerConfig,
    MediaTextTrack,
)

F = "/fixtures"
# The stand-in for your own media server (mediaplayer_demo_server.py). In the
# browser os.environ is empty, so the page learns it from the URL (?server=).
SERVER = os.getenv("MEDIAPLAYER_DEMO_SERVER", "http://127.0.0.1:9102")
TOKEN = "demo-token"
TRACKS = [
    {"title": "First Light", "file": "song1.mp3", "cover": "cover1.jpg"},
    {"title": "Second Wind", "file": "song2.mp3", "cover": "cover2.jpg"},
    {"title": "Third Rail", "file": "song3.mp3", "cover": "cover1.jpg"},
]


def video_items(kind):
    subs = [MediaTextTrack(f"{F}/subs.en.vtt", "English", "en"), MediaTextTrack(f"{F}/subs.fr.vtt", "Français", "fr")]
    if kind == "hls":
        return [MediaItem(f"{F}/hls/index.m3u8", title="Test pattern (HLS) <b>", poster=f"{F}/poster.jpg",
                          text_tracks=subs, data={"id": "hls"})]
    if kind == "missing":
        return [MediaItem(f"{F}/nope.mp4", title="Missing file", data={"id": "missing"})]
    return [MediaItem(f"{F}/video.mp4", title="Test pattern (MP4)", poster=f"{F}/poster.jpg",
                      text_tracks=subs, data={"id": "mp4"})]


class mediaplayer_demo(MainWindow):
    layout_config = LayoutConfig(cols=[
        CellConfig(id="video", header="Video", grow=1),
        CellConfig(id="server", header="Sources", width="300px"),
        CellConfig(id="chat", header="Chat", width="320px"),
    ])

    def load_ui(self):
        self.set_theme("light")
        self.events = []

        # A short buffer, so "Your server"'s expiring URL is felt within seconds:
        # with hls.js's default (30 s ahead) a short film is fetched whole before
        # its URL lapses. An app keeps the default.
        self.video = self.add_mediaplayer("video", MediaPlayerConfig(items=video_items("mp4"), aria_label="Film",
                                                                    hls_config={"maxBufferLength": 6,
                                                                                "maxMaxBufferLength": 6}))
        for name in ("play", "pause", "ended", "change", "unload", "error", "tracks", "mode"):
            getattr(self.video, f"on_{name}" if name != "tracks" else "on_tracks")(
                lambda p, n=name: self.events.append(["video", n, p]))

        dock = js.document.createElement("div")
        js.document.body.appendChild(dock)
        self.music = MediaPlayer(MediaPlayerConfig(mode="audio", dock="bottom", aria_label="Music",
                                                   time_update_interval=0.5), container=dock)
        self.music.on_resolve(self._resolve)
        for name in ("change", "unload", "ended", "queue_end", "time_update", "play"):
            getattr(self.music, f"on_{name}")(lambda p, n=name: self.events.append(["music", n, p]))

        self.attach_html("chat", '<div style="padding:10px;display:flex;flex-direction:column;gap:10px">'
                                 '<div>Voice message one:</div><div id="vm1"></div>'
                                 '<div>Voice message two:</div><div id="vm2"></div></div>')
        self.vm = [
            MediaPlayer(MediaPlayerConfig(mode="compact", group="chat",
                                          items=[MediaItem(f"{F}/song{i}.mp3", kind="audio", data={"vm": i})]),
                        root=f"#vm{i}")
            for i in (1, 2)
        ]
        for i, p in enumerate(self.vm):
            p.on_play(lambda payload, i=i: self.events.append([f"vm{i + 1}", "play", payload]))
            p.on_pause(lambda payload, i=i: self.events.append([f"vm{i + 1}", "pause", payload]))

        self._server_column()

        players = {"video": self.video, "music": self.music, "vm1": self.vm[0], "vm2": self.vm[1]}
        api = {
            "state": lambda name: players[name].state(),
            "events": lambda: self.events,
            "clear_events": lambda: self.events.clear(),
            "video": lambda kind: self.video.load(video_items(kind), autoplay=True),
            "album": lambda: self.music.load([MediaItem(title=t["title"], subtitle="The Demo Band", kind="audio",
                                                        data={"file": t["file"], "cover": t["cover"]})
                                              for t in TRACKS], autoplay=True),
            # Test hook: arguments arrive as JS values; the widget's API takes Python ones.
            "call": lambda name, method, *args: getattr(players[name], method)(
                *[a.to_py() if hasattr(a, "to_py") else a for a in args]),
        }
        js.window.wapytMedia = create_proxy(lambda name, *a: json.dumps(api[name](*a)))
        js.document.body.dataset.ready = "true"

    # ── Your own media server ─────────────────────────────────────────────

    def _server_column(self):
        """Four buttons, each one way a media server guards its media, played
        in the Video cell; and a log of what the player reported."""
        params = js.URLSearchParams.new(js.window.location.search)
        self.server = str(params.get("server") or SERVER).rstrip("/")
        self.attach_html("server", '<div style="padding:10px;display:flex;flex-direction:column;gap:8px">'
                                   '<strong>On this computer</strong>'
                                   '<label>Files <input id="local-files" type="file" multiple accept="audio/*,video/*,.vtt"></label>'
                                   '<label>A folder <input id="local-folder" type="file" webkitdirectory multiple></label>'
                                   '<div id="local-drop" style="border:2px dashed #94a3b8;border-radius:8px;padding:10px;'
                                   'text-align:center">…or drop files here</div>'
                                   '<strong>Your server</strong>'
                                   '<button id="srv-open">Open HLS, two renditions</button>'
                                   '<button id="srv-auth">Bearer header</button>'
                                   '<button id="srv-signed">Signed URL (expires after 10 s)</button>'
                                   '<button id="srv-live">Live</button>'
                                   '<pre id="srv-log" style="font-size:11px;white-space:pre-wrap;margin:0"></pre></div>')
        s = self.server
        plays = {
            # A CDN or a static folder: just the URL. Its renditions show under
            # the bar's Quality menu.
            "open": lambda: [MediaItem(f"{s}/open/film/master.m3u8", title="Open HLS",
                                       text_tracks=[MediaTextTrack(f"{s}/open/film/en.vtt", "English", "en")])],
            # An API gateway: the header goes on every playlist and segment request.
            "auth": lambda: [MediaItem(f"{s}/auth/film/master.m3u8", title="Bearer header",
                                       headers={"Authorization": f"Bearer {TOKEN}"})],
            # Signed URLs: none in the item; on_resolve asks the server for one when
            # the item is reached, and again (refresh) when it expires mid-play.
            "signed": lambda: [MediaItem(title="Signed URL", kind="video", data={"signed": True})],
            # A live stream: start at its live edge.
            "live": lambda: [MediaItem(f"{s}/live/index.m3u8", title="Live", live=True)],
        }
        for key, items in plays.items():
            button = js.document.getElementById(f"srv-{key}")
            button.addEventListener("click", create_proxy(lambda _e, items=items: self.video.load(items(), autoplay=True)))

        self._local_urls = []
        for input_id in ("local-files", "local-folder"):
            js.document.getElementById(input_id).addEventListener(
                "change", create_proxy(lambda e: self._play_local(e.target.files)))
        drop = js.document.getElementById("local-drop")
        drop.addEventListener("dragover", create_proxy(lambda e: e.preventDefault()))
        drop.addEventListener("drop", create_proxy(lambda e: (e.preventDefault(), self._play_local(e.dataTransfer.files))))

        self.video.on_resolve(self._resolve_video)
        # An expired URL is a 401/403/410 from the media server: ask for a new one
        # and carry on from the same position.
        self.video.on_error(lambda e: self.video.refresh() if e.get("status") in (401, 403, 410) else None)
        self.video.on_levels(lambda e: self._log(f"levels: {', '.join(l['label'] for l in e['levels'])}"
                                                 f" ({'auto' if e['auto'] else 'fixed'})"))
        self.video.on_error(lambda e: self._log(f"error {e['code']} {e.get('status') or ''}: {e['message']}"))
        self.video.on_unload(lambda e: self._log(f"unload ({e['reason']}): {e['title']}"))

    def _play_local(self, file_list):
        """Files from the viewer's own disk, played with no server: each File
        becomes a blob: URL. A folder's files come in path order; a .vtt named
        like a video becomes its subtitles. The last selection's URLs are
        released (revokeObjectURL) when a new one replaces it."""
        files = sorted((file_list.item(i) for i in range(file_list.length)),
                       key=lambda f: str(f.webkitRelativePath or f.name).lower())
        stem = lambda f: str(f.name).rsplit(".", 1)[0]  # noqa: E731
        subtitles = {stem(f): f for f in files if str(f.name).lower().endswith(".vtt")}
        media = [f for f in files if str(f.type).startswith(("audio/", "video/"))]
        if not media:
            self._log("local: nothing playable among those files")
            return
        for url in self._local_urls:
            js.URL.revokeObjectURL(url)
        self._local_urls = []

        def url(f):
            u = str(js.URL.createObjectURL(f))
            self._local_urls.append(u)
            return u

        items = []
        for f in media:
            kind = "audio" if str(f.type).startswith("audio/") else "video"
            tracks = [MediaTextTrack(url(subtitles[stem(f)]), "Subtitles")] if kind == "video" and stem(f) in subtitles else []
            # The type matters: a blob: URL has no extension to say what it is.
            items.append(MediaItem(url(f), title=stem(f), kind=kind, type=str(f.type) or None, text_tracks=tracks,
                                   subtitle=str(f.webkitRelativePath or "").rsplit("/", 1)[0] or "On this computer",
                                   data={"local": str(f.webkitRelativePath or f.name)}))
        songs = all(i.kind == "audio" for i in items)
        (self.music if songs else self.video).load(items, autoplay=True)
        self._log(f"local: {len(items)} file(s) → {'the music bar' if songs else 'the video cell'}")

    async def _resolve_video(self, item):
        from pyodide.http import pyfetch
        if not (item.get("data") or {}).get("signed"):
            return None
        token = await (await pyfetch(f"{self.server}/mint")).string()
        self._log(f"resolve{' (refresh)' if item.get('refresh') else ''}: minted {token[:8]}…")
        # For the demo: revoke it after 10 s, the way a short-lived signed URL lapses.
        js.setTimeout(create_proxy(lambda: asyncio.ensure_future(pyfetch(f"{self.server}/expire/{token}"))), 10000)
        return {"src": f"{self.server}/signed/{token}/film/master.m3u8"}

    def _log(self, line):
        node = js.document.getElementById("srv-log")
        if node:
            node.textContent = (line + "\n" + node.textContent)[:2000]
        self.events.append(["server", "log", line])

    async def _resolve(self, item):
        # A real app would ask its media server for a session URL here.
        await asyncio.sleep(0.05)
        return {"src": f"{F}/{item['data']['file']}", "poster": f"{F}/{item['data']['cover']}"}


APP_ENTRYPOINT = "mediaplayer_demo"


if __name__ == "__main__" and sys.platform != "emscripten":
    import os
    import shutil
    import subprocess
    from pathlib import Path

    import uvicorn
    from fastapi.staticfiles import StaticFiles
    from pytincture import PytinctureConfig, create_app

    here = Path(__file__).resolve().parent
    fixtures = here / ".mediaplayer-fixtures"

    def ffmpeg(*args):
        subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", *args], check=True)

    if not (fixtures / "hls" / "index.m3u8").exists():
        if not shutil.which("ffmpeg"):
            sys.exit("ffmpeg is needed once, to generate the demo's test media")
        (fixtures / "hls").mkdir(parents=True, exist_ok=True)
        clip = ["-f", "lavfi", "-i", "testsrc2=size=640x360:rate=24:duration=30",
                "-f", "lavfi", "-i", "sine=frequency=440:duration=30",
                "-c:v", "libx264", "-pix_fmt", "yuv420p", "-g", "48", "-c:a", "aac", "-shortest"]
        ffmpeg(*clip, "-movflags", "+faststart", str(fixtures / "video.mp4"))
        ffmpeg(*clip, "-f", "hls", "-hls_time", "4", "-hls_playlist_type", "vod", "-hls_segment_type", "fmp4",
               "-hls_segment_filename", str(fixtures / "hls" / "seg%d.m4s"), str(fixtures / "hls" / "index.m3u8"))
        for i, (freq, seconds) in enumerate([(330, 6), (550, 6), (660, 5)], start=1):
            ffmpeg("-f", "lavfi", "-i", f"sine=frequency={freq}:duration={seconds}", str(fixtures / f"song{i}.mp3"))
        for name, colour in [("cover1.jpg", "teal"), ("cover2.jpg", "orange"), ("poster.jpg", "navy")]:
            ffmpeg("-f", "lavfi", "-i", f"color=c={colour}:size=320x320", "-frames:v", "1", str(fixtures / name))
        (fixtures / "subs.en.vtt").write_text("WEBVTT\n\n00:00.500 --> 00:04.000\nHello from WebVTT\n\n"
                                              "00:05.000 --> 00:08.000\nA second cue\n")
        (fixtures / "subs.fr.vtt").write_text("WEBVTT\n\n00:00.500 --> 00:04.000\nBonjour\n")

    app = create_app(PytinctureConfig(modules_path=str(here), default_application="mediaplayer_demo"))
    app.mount("/fixtures", StaticFiles(directory=str(fixtures)), name="fixtures")

    strict = os.getenv("MEDIAPLAYER_DEMO_STRICT_CSP") == "1"

    media_origin = SERVER.rstrip("/").encode()

    def with_media_src(inner):
        """Add media-src 'self' blob: to pyTincture's policy (which has none), and
        let the page reach the media server's origin: media-src for plain files,
        connect-src for hls.js's requests (and the signed-URL API), img-src for
        posters."""
        async def asgi(scope, receive, send):
            async def patched(message):
                if message["type"] == "http.response.start" and not strict:
                    headers = []
                    for key, value in message.get("headers", []):
                        if key.lower() == b"content-security-policy":
                            if b"media-src" not in value:
                                value = value + b"; media-src 'self' blob: " + media_origin
                            for directive in (b"connect-src", b"img-src"):
                                if directive + b" " in value:
                                    value = value.replace(directive + b" ", directive + b" " + media_origin + b" ", 1)
                                else:
                                    value = value + b"; " + directive + b" 'self' " + media_origin
                        headers.append((key, value))
                    message = {**message, "headers": headers}
                await send(message)
            await inner(scope, receive, patched)
        return asgi

    uvicorn.run(with_media_src(app), host="127.0.0.1", port=int(os.getenv("MEDIAPLAYER_DEMO_PORT", "8070")))
