(function () {
  // MediaPlayer: video and audio in a container, with a queue.
  //
  // One <video> element plays everything (audio too: it takes a poster and
  // text tracks where <audio> takes neither). The three shapes -- video in
  // place, an audio bar, a compact inline player -- are classes on the same
  // element tree. The media element is never moved or re-created mid-playback:
  // with hls.js attached through Media Source Extensions, moving it is a
  // demuxer error waiting to happen.
  //
  // Sources are plain files, or HLS through the vendored hls.js light build
  // (vendor-hlsjs.light.min.js, globalThis.Hls). hls.js is tried FIRST and
  // native HLS second: canPlayType("application/vnd.apple.mpegurl") answers
  // "maybe" in Chromium, which cannot play HLS natively, and the natural order
  // hands it a playlist to demux. hls.js gets startPosition 0 unless an item
  // says otherwise, because its default (-1) starts a growing EVENT playlist
  // at the live edge, seconds into the file.
  //
  // An item may arrive without a src. When it becomes current the player
  // emits "resolve" and waits for resolve(index, {src, ...}): how a media
  // server's per-play session URL, or an expiring signed link, gets fetched
  // only when it is needed.
  //
  // Everything per-frame (time, buffering, the scrubber) stays here in JS.
  // Python hears a throttled "timeupdate" (timeUpdateInterval seconds).
  //
  // Text reaches the DOM only through textContent; URLs only as properties.
  const globalNS = (globalThis.wapyt = globalThis.wapyt || {});

  const MODES = new Set(["auto", "video", "audio", "compact"]);
  const REPEAT = ["off", "all", "one"];
  const AUDIO_EXT = /\.(mp3|m4a|aac|flac|ogg|oga|opus|wav|weba|alac|aiff?)(\?|#|$)/i;
  const HLS_EXT = /\.m3u8(\?|#|$)/i;
  const HLS_TYPES = new Set(["hls", "application/vnd.apple.mpegurl", "application/x-mpegurl", "audio/mpegurl"]);
  const HIDE_CONTROLS_MS = 2500;

  const groups = new Map(); // exclusive group name -> Set of players
  let sessionOwner = null; // the player the OS media controls drive

  function resolveHost(target) {
    if (target && typeof target.attachHTML === "function") {
      const mountId = `wapyt_mediahost_${Math.random().toString(16).slice(2)}`;
      target.attachHTML(`<div id="${mountId}" style="width:100%;height:100%"></div>`);
      return document.getElementById(mountId);
    }
    if (typeof target === "string") return document.querySelector(target);
    if (target && target.nodeType === 1) return target;
    return null;
  }

  function el(tag, className, attrs) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    Object.entries(attrs || {}).forEach(([key, value]) => node.setAttribute(key, value));
    return node;
  }

  function iconButton(icon, label, className) {
    const button = el("button", `wapyt-media-btn ${className || ""}`.trim(), { type: "button", "aria-label": label, title: label });
    setIcon(button, icon);
    return button;
  }

  function setIcon(button, icon) {
    button.textContent = "";
    if (globalNS.icons) button.appendChild(globalNS.icons.iconElement(icon));
    else button.textContent = icon.replace(/^mdi-/, "");
  }

  function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return "--:--";
    const s = Math.floor(seconds % 60);
    const m = Math.floor(seconds / 60) % 60;
    const h = Math.floor(seconds / 3600);
    const pad = (n) => String(n).padStart(2, "0");
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  }

  function isHls(item) {
    const type = String(item.type || "").toLowerCase();
    if (type) return HLS_TYPES.has(type);
    return HLS_EXT.test(String(item.src || ""));
  }

  function kindOf(item) {
    if (item.kind === "audio" || item.kind === "video") return item.kind;
    const type = String(item.type || "").toLowerCase();
    if (type.startsWith("audio/")) return "audio";
    if (type.startsWith("video/")) return "video";
    return AUDIO_EXT.test(String(item.src || "")) ? "audio" : "video";
  }

  function shuffled(values) {
    const out = values.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  // A blocked blob: media URL raises no media error anywhere -- the player
  // fetches the playlist and the fragments and then plays nothing, for ever.
  // The page's Content-Security-Policy needs media-src 'self' blob: for
  // hls.js. One listener for the page; every live player hears about it.
  const players = new Set();
  let cspWatched = false;
  function watchCsp() {
    if (cspWatched) return;
    cspWatched = true;
    document.addEventListener("securitypolicyviolation", (event) => {
      const directive = String(event.effectiveDirective || event.violatedDirective || "");
      const blocked = String(event.blockedURI || "");
      if (!directive.startsWith("media-src") && !(directive.startsWith("default-src") && blocked.startsWith("blob"))) return;
      players.forEach((player) => player._cspBlocked(directive, blocked));
    });
  }

  class MediaPlayer {
    constructor(target, config) {
      this._host = resolveHost(target);
      if (!this._host) throw new Error("wapyt.MediaPlayer: container not found");
      this._config = config || {};
      this._events = {};
      this._items = [];
      this._index = -1;
      this._order = null;
      // The items played this pass through the queue, in the order they played:
      // a shuffle keeps them behind the current item and never deals them again
      // until every item has played (then, with repeat all, a new pass).
      this._played = [];
      this._nextPass = null; // the shuffled order of the coming pass, once known
      this._repeat = REPEAT.includes(this._config.repeat) ? this._config.repeat : "off";
      this._shuffle = false;
      this._hls = null;
      this._recovered = { network: false, media: false };
      this._awaiting = -1; // index waiting on resolve()
      this._lastTimeEmit = 0;
      this._hideTimer = null;
      this._seeking = false;
      this._build();
      this._bind();
      players.add(this);
      watchCsp();
      const group = this._config.group;
      if (group) {
        if (!groups.has(group)) groups.set(group, new Set());
        groups.get(group).add(this);
      }
      this.setVolume(this._config.volume ?? 1);
      this.setMuted(Boolean(this._config.muted));
      if (this._config.rate) this.setRate(this._config.rate);
      this._applyMode();
      if (Array.isArray(this._config.items) && this._config.items.length) {
        this.load(this._config.items, this._config.startIndex || 0, Boolean(this._config.autoplay));
      } else {
        this._renderInfo();
      }
      if (this._config.shuffle) this.setShuffle(true);
    }

    // ── DOM ──────────────────────────────────────────────────────────────

    _build() {
      const cfg = this._config;
      const root = el("div", "wapyt-media", { role: "region", "aria-label": cfg.ariaLabel || "Media player" });
      if (cfg.height) root.style.height = typeof cfg.height === "number" ? `${cfg.height}px` : String(cfg.height);

      const stage = el("div", "wapyt-media-stage");
      const video = el("video", "wapyt-media-video", { playsinline: "", preload: cfg.preload || "metadata" });
      if (cfg.crossOrigin) video.crossOrigin = cfg.crossOrigin;
      video.controls = false;
      const status = el("div", "wapyt-media-status", { role: "status", "aria-live": "polite" });
      status.hidden = true;
      const bigPlay = iconButton("mdi-play", "Play", "wapyt-media-bigplay");
      // The status line sits beside the stage, not in it: audio and compact
      // modes hide the stage, and an error nobody can see is no error message.
      stage.append(video, bigPlay);

      const bar = el("div", "wapyt-media-bar");
      const cover = el("img", "wapyt-media-cover", { alt: "" });
      cover.hidden = true;
      const info = el("div", "wapyt-media-info");
      const title = el("div", "wapyt-media-title");
      const subtitle = el("div", "wapyt-media-subtitle");
      const queueLine = el("div", "wapyt-media-queue");
      info.append(title, subtitle, queueLine);

      const controls = el("div", "wapyt-media-controls");
      const prev = iconButton("mdi-skip-previous", "Previous", "wapyt-media-prev");
      const play = iconButton("mdi-play", "Play", "wapyt-media-play");
      const next = iconButton("mdi-skip-next", "Next", "wapyt-media-next");
      const current = el("span", "wapyt-media-time wapyt-media-current");
      current.textContent = "0:00";
      const scrub = el("input", "wapyt-media-scrub", { type: "range", min: "0", max: "0", step: "0.1", value: "0", "aria-label": "Seek" });
      const duration = el("span", "wapyt-media-time wapyt-media-duration");
      duration.textContent = "--:--";
      const mute = iconButton("mdi-volume-high", "Mute", "wapyt-media-mute");
      const volume = el("input", "wapyt-media-volume", { type: "range", min: "0", max: "1", step: "0.05", value: "1", "aria-label": "Volume" });
      const shuffle = iconButton("mdi-shuffle-variant", "Shuffle", "wapyt-media-shuffle");
      const repeat = iconButton("mdi-repeat-off", "Repeat: off", "wapyt-media-repeat");
      const tracks = iconButton("mdi-closed-caption-outline", "Subtitles and audio", "wapyt-media-tracks");
      tracks.setAttribute("aria-haspopup", "menu");
      tracks.setAttribute("aria-expanded", "false");
      const full = iconButton("mdi-fullscreen", "Full screen", "wapyt-media-full");
      // The app's own buttons (config.actions): "add to playlist", "save",
      // "reply". Each emits an "action" event about the current item.
      const actions = el("span", "wapyt-media-actions");
      controls.append(prev, play, next, current, scrub, duration, mute, volume, shuffle, repeat, actions, tracks, full);
      bar.append(cover, info, controls);

      const menu = el("div", "wapyt-media-menu", { role: "menu" });
      menu.hidden = true;

      root.append(stage, status, bar, menu);
      this._host.appendChild(root);
      Object.assign(this, {
        _root: root, _stage: stage, _video: video, _status: status, _bigPlay: bigPlay, _bar: bar,
        _cover: cover, _title: title, _subtitle: subtitle, _queueLine: queueLine, _prev: prev, _play: play,
        _next: next, _current: current, _scrub: scrub, _duration: duration, _mute: mute, _volume: volume,
        _shuffleBtn: shuffle, _repeatBtn: repeat, _tracksBtn: tracks, _full: full, _menu: menu, _actions: actions,
      });
      this.setActions(this._config.actions || []);
      if (this._config.controls === false) bar.hidden = true;
      this._renderRepeat();
    }

    _bind() {
      const v = this._video;
      const on = (target, name, fn, opts) => target.addEventListener(name, fn, opts);
      on(this._play, "click", () => this.toggle());
      on(this._bigPlay, "click", () => this.play());
      on(this._prev, "click", () => this.previous());
      on(this._next, "click", () => this.next());
      on(this._mute, "click", () => this.setMuted(!v.muted));
      on(this._volume, "input", () => this.setVolume(Number(this._volume.value)));
      on(this._shuffleBtn, "click", () => this.setShuffle(!this._shuffle));
      on(this._repeatBtn, "click", () => this.setRepeat(REPEAT[(REPEAT.indexOf(this._repeat) + 1) % REPEAT.length]));
      on(this._tracksBtn, "click", (event) => { event.stopPropagation(); this._toggleMenu(); });
      on(this._full, "click", () => this.fullscreen());
      on(this._scrub, "input", () => { this._seeking = true; this._current.textContent = formatTime(Number(this._scrub.value)); });
      on(this._scrub, "change", () => { this._seeking = false; this.seek(Number(this._scrub.value)); });
      on(v, "click", () => { if (this._mode() === "video") this.toggle(); });
      on(v, "dblclick", () => { if (this._mode() === "video") this.fullscreen(); });

      on(v, "play", () => {
        this._pauseGroup();
        this._claimSession();
        this._renderPlaying();
        this._emit("play", this._payload());
      });
      on(v, "pause", () => { this._renderPlaying(); if (!v.ended) this._emit("pause", this._payload()); });
      on(v, "playing", () => this._showStatus(""));
      on(v, "waiting", () => this._showStatus("Loading…"));
      on(v, "ended", () => this._ended());
      on(v, "loadedmetadata", () => {
        const item = this._items[this._index];
        if (item && item.start > 0 && !this._hls && Math.abs(v.currentTime - item.start) > 0.5) v.currentTime = item.start;
        this._renderTime();
        this._renderTracks();
      });
      on(v, "durationchange", () => this._renderTime());
      on(v, "timeupdate", () => this._timeUpdate());
      on(v, "progress", () => this._renderBuffered());
      on(v, "volumechange", () => {
        this._renderVolume();
        this._emit("volume", { volume: v.volume, muted: v.muted });
      });
      on(v, "ratechange", () => this._emit("rate", { rate: v.playbackRate }));
      on(v, "error", () => {
        if (this._hls) return; // hls.js reports its own
        const code = v.error ? v.error.code : 0;
        const message = ["", "Playback was aborted.", "A network error stopped playback.",
          "This file could not be decoded.", "This format is not supported here."][code] || "Playback failed.";
        this._fail(message, true);
      });
      if (v.textTracks) on(v.textTracks, "change", () => this._renderTrackButton());

      on(this._root, "keydown", (event) => this._key(event));
      on(this._root, "pointermove", () => this._wake());
      on(this._root, "focusin", () => this._wake());
      on(document, "click", (event) => { if (!this._menu.hidden && !this._menu.contains(event.target)) this._closeMenu(); });
      on(document, "fullscreenchange", () => {
        const active = document.fullscreenElement === this._root;
        this._root.toggleAttribute("data-fullscreen", active);
        setIcon(this._full, active ? "mdi-fullscreen-exit" : "mdi-fullscreen");
        this._emit("fullscreen", { active });
      });
    }

    // ── Queue ────────────────────────────────────────────────────────────

    load(items, startIndex, autoplay) {
      this._unload("load");
      this._index = -1; // the old index means nothing in the new list
      this._items = (items || []).map((item) => Object.assign({}, item));
      this._played = [];
      this._nextPass = null;
      this._order = this._shuffle ? this._shuffleOrder(startIndex || 0) : null;
      if (!this._items.length) {
        this._index = -1;
        this._renderInfo();
        return;
      }
      this._select(Math.min(Math.max(startIndex || 0, 0), this._items.length - 1), autoplay !== false, "load");
    }

    add(items, at) {
      const fresh = (items || []).map((item) => Object.assign({}, item));
      const position = at == null || at < 0 || at > this._items.length ? this._items.length : at;
      this._items.splice(position, 0, ...fresh);
      if (this._index >= position) this._index += fresh.length;
      const shift = (i) => (i >= position ? i + fresh.length : i);
      this._played = this._played.map(shift);
      this._nextPass = null;
      if (this._order) this._order = this._shuffleOrder(this._index); // the new items join what's to come
      if (this._index < 0 && this._items.length) this._select(0, false, "load");
      else this._renderInfo();
    }

    remove(index) {
      if (index < 0 || index >= this._items.length) return;
      const wasCurrent = index === this._index;
      if (wasCurrent) {
        this._unload("remove");
        this._index = -1;
      }
      this._items.splice(index, 1);
      if (index < this._index) this._index -= 1;
      this._played = this._played.filter((i) => i !== index).map((i) => (i > index ? i - 1 : i));
      this._nextPass = null;
      if (this._order) this._order = this._shuffleOrder(Math.max(this._index, 0));
      if (wasCurrent) {
        if (this._items.length) this._select(Math.min(index, this._items.length - 1), !this._video.paused, "remove");
        else { this._index = -1; this._renderInfo(); }
      } else {
        this._renderInfo();
      }
    }

    clear() {
      this._unload("clear");
      this._items = [];
      this._order = null;
      this._played = [];
      this._nextPass = null;
      this._index = -1;
      this._renderInfo();
    }

    playIndex(index) {
      if (index < 0 || index >= this._items.length) return;
      this._select(index, true, "select");
    }

    next() {
      this._advance("next");
    }

    // Moving on, by Next or at an item's end. Past the last item with repeat
    // all, a shuffled queue starts a new pass in a new order.
    _advance(reason) {
      const step = this._step(1);
      if (step == null) {
        this._emit("queueend", { index: this._index });
        return;
      }
      if (this._atEnd()) { // a new pass: shuffled, in a new order
        if (this._order) this._order = this._nextPass || this._newPass();
        this._nextPass = null;
        this._played = [];
      }
      this._select(step, true, reason);
    }

    _atEnd() {
      const order = this._order || this._items.map((_, i) => i);
      return order.indexOf(this._index) === order.length - 1;
    }

    // A whole new shuffled pass, not starting with the item that just played
    // (which would sound like a repeat).
    _newPass() {
      const order = shuffled(this._items.map((_, i) => i));
      if (order.length > 1 && order[0] === this._index) [order[0], order[1]] = [order[1], order[0]];
      return order;
    }

    previous() {
      if (this._video.currentTime > 3 || this._items.length < 2) {
        this.seek(0);
        return;
      }
      const step = this._step(-1);
      this._select(step == null ? this._index : step, true, "previous");
    }

    _step(delta) {
      const order = this._order || this._items.map((_, i) => i);
      const at = order.indexOf(this._index);
      const target = at + delta;
      if (target >= 0 && target < order.length) return order[target];
      if (this._repeat === "all" && order.length) {
        // Shuffled, the next pass is a new order: deal it now, so "up next"
        // and the item that actually follows agree.
        if (this._order && delta > 0) {
          this._nextPass = this._nextPass || this._newPass();
          return this._nextPass[0];
        }
        return order[(target + order.length) % order.length];
      }
      return null;
    }

    // The shuffled order around the current item: what already played this
    // pass stays behind it, in the order it played (so Previous retraces it),
    // and only what hasn't played yet is shuffled to come after.
    _shuffleOrder(current) {
      const valid = (i) => i >= 0 && i < this._items.length;
      const behind = this._played.filter((i) => valid(i) && i !== current);
      const done = new Set(behind);
      const ahead = this._items.map((_, i) => i).filter((i) => i !== current && !done.has(i));
      return [...behind, ...(valid(current) ? [current] : []), ...shuffled(ahead)];
    }

    // ── Playing one item ─────────────────────────────────────────────────

    _select(index, autoplay, reason) {
      const previous = this._index;
      if (previous !== index) this._unload(reason);
      this._index = index;
      if (index >= 0 && !this._played.includes(index)) this._played.push(index);
      this._autoplay = autoplay;
      this._recovered = { network: false, media: false };
      const item = this._items[index];
      this._applyMode();
      this._renderInfo();
      this._emit("change", Object.assign(this._payload(), { previous, reason }));
      if (!item.src) {
        this._awaiting = index;
        this._showStatus("Loading…");
        this._emit("resolve", this._payload());
        return;
      }
      this._open(item);
    }

    resolve(index, patch) {
      const item = this._items[index];
      if (!item) return;
      Object.assign(item, patch || {});
      if (index === this._awaiting && index === this._index) {
        this._awaiting = -1;
        this._applyMode();
        this._renderInfo();
        if (item.src) this._open(item);
        else this._fail((patch && patch.error) || "This item could not be loaded.", true);
      }
    }

    _open(item) {
      const v = this._video;
      this._teardownSource();
      this._failure = "";
      this._showStatus("");
      v.poster = item.poster || "";
      v.playbackRate = this._rate || 1;
      (item.textTracks || []).forEach((track, i) => {
        const node = el("track", "", { kind: track.kind || "subtitles", label: track.label || track.language || `Track ${i + 1}` });
        if (track.language) node.srclang = track.language;
        node.src = track.src;
        if (track.default) node.default = true;
        v.appendChild(node);
      });
      if (isHls(item)) {
        const Hls = globalThis.Hls;
        if (Hls && Hls.isSupported()) {
          const hls = new Hls(Object.assign({ startPosition: item.start || 0 }, this._config.hlsConfig || {}));
          this._hls = hls;
          hls.on(Hls.Events.ERROR, (_event, data) => this._hlsError(hls, data));
          hls.on(Hls.Events.MANIFEST_PARSED, () => this._renderTracks());
          hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => this._renderTracks());
          hls.loadSource(item.src);
          hls.attachMedia(v);
        } else if (v.canPlayType("application/vnd.apple.mpegurl")) {
          v.src = item.src; // Safari: genuinely native HLS
        } else {
          this._fail("This browser cannot play HLS streams.", true);
          return;
        }
      } else {
        v.src = item.src;
      }
      if (this._autoplay) this._tryPlay();
    }

    _tryPlay() {
      const attempt = this._video.play();
      if (attempt && typeof attempt.catch === "function") {
        attempt.catch((error) => {
          // A browser that wants a click before it plays sound is not an error.
          if (error && error.name === "NotAllowedError") this._renderPlaying();
          else if (error && error.name !== "AbortError") this._fail(error.message || "Playback failed.", false);
        });
      }
    }

    _hlsError(hls, data) {
      if (!data || !data.fatal) return;
      const Hls = globalThis.Hls;
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR && !this._recovered.network) {
        this._recovered.network = true;
        hls.startLoad();
        return;
      }
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !this._recovered.media) {
        this._recovered.media = true;
        hls.recoverMediaError();
        return;
      }
      this._fail(`Stream error: ${data.details || data.type}`, true);
    }

    _cspBlocked(directive, blocked) {
      if (this._index < 0) return;
      const what = blocked === "blob" || blocked.startsWith("blob:") ? "streamed media (blob: URLs)" : blocked || "this media";
      this._fail(`This page's Content-Security-Policy blocks ${what} under ${directive}. ` +
        "Allow media-src 'self' blob: for it to play.", true, "csp");
    }

    _fail(message, fatal, code) {
      // A blocked policy is the cause; the "no supported source" the browser
      // reports a moment later is only its symptom, and must not replace it.
      if (this._failure === "csp" && code !== "csp") return;
      this._failure = code || "error";
      this._showStatus(message, true);
      this._renderPlaying();
      this._emit("error", Object.assign(this._payload(), { message, fatal: Boolean(fatal), code: code || "" }));
    }

    _ended() {
      this._renderPlaying();
      this._emit("ended", this._payload());
      if (this._repeat === "one") {
        this.seek(0);
        this._tryPlay();
        return;
      }
      this._advance("ended");
    }

    // The item stops being current: tell the app (a media server session to
    // close, a signed URL to forget) and drop the source.
    _unload(reason) {
      if (this._index >= 0 && this._items[this._index]) {
        this._emit("unload", Object.assign(this._payload(), { reason }));
      }
      this._awaiting = -1;
      this._teardownSource();
    }

    _teardownSource() {
      const v = this._video;
      if (this._hls) {
        try { this._hls.destroy(); } catch (_) { /* already gone */ }
        this._hls = null;
      }
      v.pause();
      v.removeAttribute("src");
      Array.from(v.querySelectorAll("track")).forEach((node) => node.remove());
      try { v.load(); } catch (_) { /* nothing loaded */ }
      this._scrub.max = "0";
      this._scrub.value = "0";
      this._root.style.setProperty("--wapyt-media-buffered", "0%");
    }

    // ── Transport ────────────────────────────────────────────────────────

    play() {
      if (this._index < 0 && this._items.length) {
        this._select(0, true, "select");
        return;
      }
      this._autoplay = true;
      if (this._awaiting >= 0) return; // starts once resolved
      this._tryPlay();
    }

    pause() { this._video.pause(); }
    toggle() { if (this._video.paused) this.play(); else this.pause(); }

    stop() {
      this._unload("stop");
      this._renderPlaying();
      this._renderTime();
    }

    seek(seconds) {
      const v = this._video;
      const limit = Number.isFinite(v.duration) ? v.duration : Infinity;
      v.currentTime = Math.max(0, Math.min(Number(seconds) || 0, limit));
    }

    skip(delta) { this.seek(this._video.currentTime + Number(delta || 0)); }

    setVolume(value) {
      this._video.volume = Math.max(0, Math.min(1, Number(value)));
      if (this._video.volume > 0 && this._video.muted) this._video.muted = false;
    }

    setMuted(muted) { this._video.muted = Boolean(muted); }

    setRate(rate) {
      this._rate = Math.max(0.25, Math.min(4, Number(rate) || 1));
      this._video.playbackRate = this._rate;
    }

    setShuffle(on) {
      this._shuffle = Boolean(on);
      this._nextPass = null;
      this._order = this._shuffle && this._items.length ? this._shuffleOrder(Math.max(this._index, 0)) : null;
      this._shuffleBtn.setAttribute("aria-pressed", String(this._shuffle));
      this._renderInfo();
      this._emit("shuffle", { shuffle: this._shuffle });
    }

    setRepeat(mode) {
      if (!REPEAT.includes(mode)) return;
      this._repeat = mode;
      this._renderRepeat();
      this._renderInfo();
      this._emit("repeat", { repeat: mode });
    }

    setTextTrack(index) {
      Array.from(this._video.textTracks || []).forEach((track, i) => {
        track.mode = i === index ? "showing" : "disabled";
      });
      this._renderTrackButton();
      this._emitTracks();
    }

    setAudioTrack(index) {
      if (this._hls && this._hls.audioTracks && index >= 0 && index < this._hls.audioTracks.length) {
        this._hls.audioTrack = index;
      } else if (this._video.audioTracks && index >= 0 && index < this._video.audioTracks.length) {
        Array.from(this._video.audioTracks).forEach((track, i) => { track.enabled = i === index; });
      }
      this._emitTracks();
    }

    setMode(mode) {
      if (!MODES.has(mode)) return;
      this._config.mode = mode;
      this._applyMode();
    }

    fullscreen(on) {
      const active = document.fullscreenElement === this._root;
      const want = on == null ? !active : Boolean(on);
      if (want && !active && this._root.requestFullscreen) this._root.requestFullscreen().catch(() => {});
      if (!want && active && document.exitFullscreen) document.exitFullscreen().catch(() => {});
    }

    getState() {
      const v = this._video;
      return {
        index: this._index,
        count: this._items.length,
        paused: v.paused,
        ended: v.ended,
        position: v.currentTime || 0,
        duration: Number.isFinite(v.duration) ? v.duration : null,
        live: v.duration === Infinity,
        volume: v.volume,
        muted: v.muted,
        rate: v.playbackRate,
        shuffle: this._shuffle,
        repeat: this._repeat,
        mode: this._mode(),
        order: this._order ? this._order.slice() : null,
        tracks: this._trackPayload(),
      };
    }

    destroy() {
      this._unload("destroy");
      players.delete(this);
      const group = this._config.group;
      if (group && groups.has(group)) groups.get(group).delete(this);
      if (sessionOwner === this) sessionOwner = null;
      this._root.removeAttribute("data-dock");
      this._updateDock();
      clearTimeout(this._hideTimer);
      this._root.remove();
      this._events = {};
    }

    on(event, handler) {
      if (!this._events[event]) this._events[event] = new Set();
      this._events[event].add(handler);
    }

    off(event, handler) {
      if (this._events[event]) this._events[event].delete(handler);
    }

    // ── Rendering ────────────────────────────────────────────────────────

    _mode() {
      const mode = MODES.has(this._config.mode) ? this._config.mode : "auto";
      if (mode !== "auto") return mode;
      const item = this._items[this._index];
      return item ? kindOf(item) : "video";
    }

    _applyMode() {
      const mode = this._mode();
      const changed = this._root.dataset.mode !== mode;
      this._root.dataset.mode = mode;
      this._root.toggleAttribute("data-dock", mode === "audio" && this._config.dock === "bottom");
      this._updateDock();
      if (changed) this._emit("mode", { mode });
    }

    // While a docked bar shows, the page is padded by its height (see the
    // CSS), so it never covers content. One docked player owns the padding.
    _updateDock() {
      const docked = this._root.hasAttribute("data-dock") && this._index >= 0;
      const html = document.documentElement;
      if (docked) {
        if (!this._dockObserver && typeof ResizeObserver === "function") {
          this._dockObserver = new ResizeObserver(() => this._publishDock());
          this._dockObserver.observe(this._root);
        }
        this._publishDock();
      } else if (this._dockObserver) {
        this._dockObserver.disconnect();
        this._dockObserver = null;
        if (html.getAttribute("data-wapyt-media-docked") === this._dockId()) {
          html.removeAttribute("data-wapyt-media-docked");
          html.style.removeProperty("--wapyt-media-dock-height");
        }
      }
    }

    _publishDock() {
      const html = document.documentElement;
      html.setAttribute("data-wapyt-media-docked", this._dockId());
      html.style.setProperty("--wapyt-media-dock-height", `${Math.ceil(this._root.getBoundingClientRect().height)}px`);
    }

    _dockId() {
      if (!this._dockToken) this._dockToken = Math.random().toString(16).slice(2);
      return this._dockToken;
    }

    _renderInfo() {
      const item = this._items[this._index];
      const count = this._items.length;
      this._title.textContent = item ? item.title || "" : this._config.emptyText || "Nothing to play";
      this._subtitle.textContent = item ? item.subtitle || "" : "";
      this._subtitle.hidden = !this._subtitle.textContent;
      if (item && item.poster) {
        this._cover.src = item.poster;
        this._cover.hidden = false;
      } else {
        this._cover.removeAttribute("src");
        this._cover.hidden = true;
      }
      let line = "";
      if (count > 1 && this._index >= 0 && this._config.queueLine !== false) {
        const order = this._order || this._items.map((_, i) => i);
        const at = order.indexOf(this._index);
        line = `${at + 1} of ${count}`;
        const upcoming = this._step(1);
        if (upcoming != null && upcoming !== this._index && this._items[upcoming]) {
          line += ` · up next: ${this._items[upcoming].title || ""}`;
        }
      }
      this._queueLine.textContent = line;
      this._queueLine.hidden = !line;
      const multi = count > 1;
      this._prev.hidden = !multi;
      this._next.hidden = !multi;
      this._shuffleBtn.hidden = !multi || this._config.showShuffle === false;
      this._repeatBtn.hidden = this._config.showRepeat === false;
      this._root.toggleAttribute("data-empty", !item);
      // An action is about the current item: with none, it can't be pressed.
      this._actions.querySelectorAll(".wapyt-media-action").forEach((b) => {
        b.disabled = !item || b.dataset.disabled === "true";
      });
      this._updateDock();
      this._updateSession();
    }

    _renderPlaying() {
      const paused = this._video.paused;
      setIcon(this._play, paused ? "mdi-play" : "mdi-pause");
      this._play.setAttribute("aria-label", paused ? "Play" : "Pause");
      this._play.title = paused ? "Play" : "Pause";
      this._root.toggleAttribute("data-playing", !paused);
      this._bigPlay.hidden = !paused || this._mode() !== "video" || this._index < 0;
      if (paused) this._wake();
      if (navigator.mediaSession && sessionOwner === this) {
        navigator.mediaSession.playbackState = paused ? "paused" : "playing";
      }
    }

    _renderTime() {
      const v = this._video;
      const duration = v.duration;
      const live = duration === Infinity;
      this._root.toggleAttribute("data-live", live);
      this._duration.textContent = live ? "LIVE" : formatTime(duration);
      if (Number.isFinite(duration)) this._scrub.max = String(duration);
      if (!this._seeking) {
        this._scrub.value = String(v.currentTime || 0);
        this._current.textContent = formatTime(v.currentTime || 0);
      }
      const max = Number(this._scrub.max) || 0;
      this._root.style.setProperty("--wapyt-media-played", max ? `${(100 * (v.currentTime || 0)) / max}%` : "0%");
    }

    _renderBuffered() {
      const v = this._video;
      const max = Number.isFinite(v.duration) ? v.duration : 0;
      let end = 0;
      for (let i = 0; i < v.buffered.length; i++) {
        if (v.buffered.start(i) <= v.currentTime + 0.5) end = Math.max(end, v.buffered.end(i));
      }
      this._root.style.setProperty("--wapyt-media-buffered", max ? `${Math.min(100, (100 * end) / max)}%` : "0%");
    }

    _renderVolume() {
      const v = this._video;
      this._volume.value = String(v.muted ? 0 : v.volume);
      const icon = v.muted || v.volume === 0 ? "mdi-volume-off" : v.volume < 0.5 ? "mdi-volume-medium" : "mdi-volume-high";
      setIcon(this._mute, icon);
      this._mute.setAttribute("aria-label", v.muted ? "Unmute" : "Mute");
      this._mute.title = v.muted ? "Unmute" : "Mute";
    }

    _renderRepeat() {
      const icon = { off: "mdi-repeat-off", all: "mdi-repeat", one: "mdi-repeat-once" }[this._repeat];
      setIcon(this._repeatBtn, icon);
      const label = `Repeat: ${this._repeat}`;
      this._repeatBtn.setAttribute("aria-label", label);
      this._repeatBtn.title = label;
      this._repeatBtn.setAttribute("aria-pressed", String(this._repeat !== "off"));
    }

    _timeUpdate() {
      this._renderTime();
      this._renderBuffered();
      const interval = Number(this._config.timeUpdateInterval ?? 1);
      if (interval <= 0) return;
      const now = performance.now();
      if (now - this._lastTimeEmit < interval * 1000) return;
      this._lastTimeEmit = now;
      const v = this._video;
      this._emit("timeupdate", Object.assign(this._payload(), {
        position: v.currentTime || 0,
        duration: Number.isFinite(v.duration) ? v.duration : null,
      }));
      if (navigator.mediaSession && sessionOwner === this && Number.isFinite(v.duration) && navigator.mediaSession.setPositionState) {
        try {
          navigator.mediaSession.setPositionState({ duration: v.duration, position: Math.min(v.currentTime, v.duration), playbackRate: v.playbackRate || 1 });
        } catch (_) { /* a browser that disagrees with the numbers */ }
      }
    }

    _showStatus(message, isError) {
      this._status.textContent = message || "";
      this._status.hidden = !message;
      this._status.toggleAttribute("data-error", Boolean(isError));
    }

    _wake() {
      this._root.removeAttribute("data-idle");
      clearTimeout(this._hideTimer);
      if (this._mode() !== "video" || this._video.paused) return;
      this._hideTimer = setTimeout(() => {
        if (!this._video.paused && this._menu.hidden && !this._bar.contains(document.activeElement)) {
          this._root.setAttribute("data-idle", "");
        }
      }, HIDE_CONTROLS_MS);
    }

    // ── Tracks ───────────────────────────────────────────────────────────

    _trackPayload() {
      const text = Array.from(this._video.textTracks || []).map((track, i) => ({
        index: i, label: track.label || "", language: track.language || "", kind: track.kind, showing: track.mode === "showing",
      }));
      let audio = [];
      if (this._hls && this._hls.audioTracks) {
        audio = this._hls.audioTracks.map((track, i) => ({
          index: i, label: track.name || track.lang || `Audio ${i + 1}`, language: track.lang || "", enabled: i === this._hls.audioTrack,
        }));
      } else if (this._video.audioTracks) {
        audio = Array.from(this._video.audioTracks).map((track, i) => ({
          index: i, label: track.label || track.language || `Audio ${i + 1}`, language: track.language || "", enabled: track.enabled,
        }));
      }
      return { text, audio };
    }

    _renderTracks() {
      this._renderTrackButton();
      this._emitTracks();
    }

    _renderTrackButton() {
      const { text, audio } = this._trackPayload();
      this._tracksBtn.hidden = !text.length && audio.length < 2;
      const showing = text.some((track) => track.showing);
      setIcon(this._tracksBtn, showing ? "mdi-closed-caption" : "mdi-closed-caption-outline");
      this._tracksBtn.setAttribute("aria-pressed", String(showing));
    }

    _emitTracks() {
      this._emit("tracks", Object.assign(this._payload(), this._trackPayload()));
    }

    _toggleMenu() {
      if (!this._menu.hidden) {
        this._closeMenu();
        return;
      }
      const { text, audio } = this._trackPayload();
      this._menu.textContent = "";
      const section = (label) => {
        const heading = el("div", "wapyt-media-menu-heading");
        heading.textContent = label;
        this._menu.appendChild(heading);
      };
      const option = (label, checked, action) => {
        const button = el("button", "wapyt-media-menu-item", { type: "button", role: "menuitemradio", "aria-checked": String(checked) });
        button.textContent = label;
        button.addEventListener("click", () => { action(); this._closeMenu(); });
        this._menu.appendChild(button);
        return button;
      };
      if (text.length) {
        section("Subtitles");
        option("Off", !text.some((track) => track.showing), () => this.setTextTrack(-1));
        text.forEach((track) => option(track.label || track.language || `Track ${track.index + 1}`, track.showing, () => this.setTextTrack(track.index)));
      }
      if (audio.length > 1) {
        section("Audio");
        audio.forEach((track) => option(track.label, track.enabled, () => this.setAudioTrack(track.index)));
      }
      this._menu.hidden = false;
      this._tracksBtn.setAttribute("aria-expanded", "true");
      const first = this._menu.querySelector("[aria-checked='true']") || this._menu.querySelector("button");
      if (first) first.focus();
    }

    _closeMenu() {
      this._menu.hidden = true;
      this._tracksBtn.setAttribute("aria-expanded", "false");
    }

    // ── Keyboard, groups, OS media controls ──────────────────────────────

    _key(event) {
      if (this._config.keyboard === false || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target;
      const onRange = target && target.type === "range";
      const onButton = target && target.tagName === "BUTTON";
      if (event.key === "Escape" && !this._menu.hidden) {
        this._closeMenu();
        this._tracksBtn.focus();
        event.preventDefault();
        return;
      }
      if (!this._menu.hidden) return;
      const actions = {
        " ": () => !onButton && this.toggle(),
        k: () => this.toggle(),
        ArrowLeft: () => !onRange && this.skip(-5),
        ArrowRight: () => !onRange && this.skip(5),
        j: () => this.skip(-10),
        l: () => this.skip(10),
        ArrowUp: () => !onRange && this.setVolume(this._video.volume + 0.05),
        ArrowDown: () => !onRange && this.setVolume(this._video.volume - 0.05),
        m: () => this.setMuted(!this._video.muted),
        f: () => this._mode() === "video" && this.fullscreen(),
        n: () => this._items.length > 1 && this.next(),
        p: () => this._items.length > 1 && this.previous(),
        c: () => {
          const { text } = this._trackPayload();
          if (!text.length) return false;
          const showing = text.findIndex((track) => track.showing);
          this.setTextTrack(showing >= 0 ? -1 : 0);
          return true;
        },
      };
      const action = actions[event.key];
      if (!action) return;
      if (action() !== false) event.preventDefault();
    }

    _pauseGroup() {
      const group = this._config.group;
      if (!group || !groups.has(group)) return;
      groups.get(group).forEach((player) => { if (player !== this) player.pause(); });
    }

    _claimSession() {
      if (this._config.mediaSession === false || !navigator.mediaSession) return;
      sessionOwner = this;
      const session = navigator.mediaSession;
      const handle = (action, fn) => {
        try { session.setActionHandler(action, fn); } catch (_) { /* unsupported action */ }
      };
      handle("play", () => sessionOwner && sessionOwner.play());
      handle("pause", () => sessionOwner && sessionOwner.pause());
      handle("previoustrack", () => sessionOwner && sessionOwner.previous());
      handle("nexttrack", () => sessionOwner && sessionOwner.next());
      handle("seekto", (details) => sessionOwner && sessionOwner.seek(details.seekTime));
      handle("seekbackward", (details) => sessionOwner && sessionOwner.skip(-(details.seekOffset || 10)));
      handle("seekforward", (details) => sessionOwner && sessionOwner.skip(details.seekOffset || 10));
      this._updateSession();
    }

    _updateSession() {
      if (sessionOwner !== this || !navigator.mediaSession || typeof MediaMetadata !== "function") return;
      const item = this._items[this._index];
      navigator.mediaSession.metadata = item ? new MediaMetadata({
        title: item.title || "",
        artist: item.subtitle || "",
        album: item.album || "",
        artwork: item.poster ? [{ src: item.poster }] : [],
      }) : null;
    }

    /** Replace the app's buttons: [{id, icon, label, pressed?, disabled?}]. */
    setActions(actions) {
      this._actions.replaceChildren();
      (actions || []).forEach((action) => {
        if (!action || !action.id) return;
        const button = iconButton(action.icon || "mdi-dots-horizontal", action.label || action.id, "wapyt-media-action");
        button.dataset.action = action.id;
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          const r = button.getBoundingClientRect();
          // Where the button is on screen, so the app can open a menu beside it.
          this._emit("action", Object.assign(this._payload(), {
            action: action.id, rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height },
          }));
        });
        this._actions.appendChild(button);
        this.setAction(action.id, action);
      });
      this._actions.hidden = !this._actions.childElementCount;
    }

    /** Change one button: {icon, label, pressed, disabled}; omitted fields stay. */
    setAction(id, patch) {
      const button = this._actions.querySelector(`.wapyt-media-action[data-action="${CSS.escape(String(id))}"]`);
      if (!button || !patch) return;
      if (patch.icon) setIcon(button, patch.icon);
      if (patch.label) { button.setAttribute("aria-label", patch.label); button.title = patch.label; }
      if (patch.pressed !== undefined && patch.pressed !== null) button.setAttribute("aria-pressed", String(Boolean(patch.pressed)));
      if (patch.disabled !== undefined && patch.disabled !== null) button.dataset.disabled = String(Boolean(patch.disabled));
      button.disabled = this._index < 0 || button.dataset.disabled === "true";
    }

    _payload() {
      const item = this._items[this._index];
      return {
        index: this._index,
        title: item ? item.title || "" : "",
        subtitle: item ? item.subtitle || "" : "",
        kind: item ? kindOf(item) : "",
        data: item && item.data !== undefined ? item.data : null,
      };
    }

    _emit(event, payload) {
      (this._events[event] || new Set()).forEach((handler) => {
        try {
          handler(payload);
        } catch (error) {
          console.error("[wapyt] MediaPlayer listener failed", error);
        }
      });
    }
  }

  globalNS.MediaPlayer = MediaPlayer;
})();
