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
"""
import asyncio
import json
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
        CellConfig(id="chat", header="Chat", width="320px"),
    ])

    def load_ui(self):
        self.set_theme("light")
        self.events = []

        self.video = self.add_mediaplayer("video", MediaPlayerConfig(items=video_items("mp4"),
                                                                    aria_label="Film"))
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

    def with_media_src(inner):
        """Add media-src 'self' blob: to pyTincture's policy (which has none)."""
        async def asgi(scope, receive, send):
            async def patched(message):
                if message["type"] == "http.response.start" and not strict:
                    headers = []
                    for key, value in message.get("headers", []):
                        if key.lower() == b"content-security-policy" and b"media-src" not in value:
                            value = value + b"; media-src 'self' blob:"
                        headers.append((key, value))
                    message = {**message, "headers": headers}
                await send(message)
            await inner(scope, receive, patched)
        return asgi

    uvicorn.run(with_media_src(app), host="127.0.0.1", port=int(os.getenv("MEDIAPLAYER_DEMO_PORT", "8070")))
