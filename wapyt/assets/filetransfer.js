(function () {
  const globalNS = (globalThis.wapyt = globalThis.wapyt || {});

  // File System Access handles cannot cross the Pyodide FFI usefully, so they
  // live here and Python refers to them by id.
  const handles = new Map();
  const aborters = new Map();
  // Downloads that ran out of retries, kept open so resume() can carry on:
  // transferId -> { writable, url, written, total, etag, onProgress }.
  const paused = new Map();

  // A dropped connection is retried this many times, with doubling backoff,
  // before the transfer pauses and waits for someone to press Resume.
  const RETRIES = 4;
  const RETRY_BASE_MS = 1000;
  let counter = 0;

  function register(handle) {
    const id = `h${(counter += 1)}`;
    handles.set(id, handle);
    return id;
  }

  function registerExternal(file) {
    // Adopt a File the page already has — from a drop, say — so it can be
    // uploaded through the same path as a picked one.
    return file ? register(file) : "";
  }

  function isAbort(error) {
    return error && (error.name === "AbortError" || error.name === "NotAllowedError");
  }

  function result(ok, extra) {
    return Object.assign({ ok }, extra || {});
  }

  function failure(error) {
    return result(false, {
      cancelled: isAbort(error),
      error: String((error && error.message) || error),
      name: (error && error.name) || "Error",
    });
  }

  // ── Capability ─────────────────────────────────────────────────────────────

  function supported() {
    return {
      // Chromium has the pickers; Firefox has none of them. Feature-detect and
      // tell the user, rather than silently falling back — a per-file Save-As
      // prompt is worse than not offering the feature at all.
      saveFile: typeof globalThis.showSaveFilePicker === "function",
      directory: typeof globalThis.showDirectoryPicker === "function",
      openFile: typeof globalThis.showOpenFilePicker === "function",
      // The pickers need a secure context. pytincture forces https off
      // loopback, so this should only ever be false in a misconfiguration.
      secureContext: Boolean(globalThis.isSecureContext),
    };
  }

  // ── Pickers ────────────────────────────────────────────────────────────────
  //
  // Every picker requires TRANSIENT USER ACTIVATION, which is consumed by the
  // first `await`. Callers must invoke these as the first thing in a click
  // handler, before fetching a file list or anything else async, or the browser
  // throws SecurityError on an otherwise valid setup.

  async function pickSaveFile(suggestedName) {
    try {
      const handle = await globalThis.showSaveFilePicker(
        suggestedName ? { suggestedName } : {}
      );
      return result(true, { id: register(handle), name: handle.name });
    } catch (error) {
      return failure(error);
    }
  }

  async function pickFolder() {
    try {
      const handle = await globalThis.showDirectoryPicker({ mode: "readwrite" });
      return result(true, { id: register(handle), name: handle.name });
    } catch (error) {
      return failure(error);
    }
  }

  async function pickFiles(options = {}) {
    const { multiple = true, directory = false } = options;
    try {
      if (directory || !supported().openFile) {
        // `showOpenFilePicker` is Chromium-only, and directory selection is
        // only exposed through the input element anyway.
        return await pickFilesViaInput(multiple, directory);
      }
      const picked = await globalThis.showOpenFilePicker({ multiple });
      const files = [];
      for (const handle of picked) {
        const file = await handle.getFile();
        files.push({
          id: register(file),
          name: file.name,
          size: file.size,
          path: file.name,
        });
      }
      return result(true, { files });
    } catch (error) {
      return failure(error);
    }
  }

  function pickFilesViaInput(multiple, directory) {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.multiple = Boolean(multiple);
      if (directory) {
        // Non-standard but supported across Chromium, Firefox and Safari; it is
        // the only way to select a whole folder for upload.
        input.webkitdirectory = true;
      }
      input.style.display = "none";
      document.body.appendChild(input);

      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        input.remove();
        resolve(value);
      };

      input.addEventListener("change", () => {
        const files = Array.from(input.files || []).map((file) => ({
          id: register(file),
          name: file.name,
          size: file.size,
          // webkitRelativePath carries the folder structure for a directory
          // pick; it is "" for ordinary file selection.
          path: file.webkitRelativePath || file.name,
        }));
        finish(files.length ? result(true, { files }) : result(false, { cancelled: true }));
      });

      // Dismissal is reported by the `cancel` event — Chrome 113+, Firefox
      // 109+, Safari 16.4+, all far older than the File System Access API this
      // module already needs.
      //
      // There is deliberately NO window-focus fallback. Focus returns the
      // moment the dialog closes, whereas `change` can arrive seconds later:
      // the browser still has to enumerate a chosen directory, and Chrome
      // interposes an "Upload N files to this site?" confirmation. A
      // focus-based timer therefore resolves "cancelled" while the real
      // selection is still on its way, and the upload silently never starts.
      input.addEventListener("cancel", () => {
        // Guard anyway: a late or spurious cancel must not discard a selection
        // that has already been made.
        if (input.files && input.files.length) return;
        finish(result(false, { cancelled: true }));
      });

      input.click();
    });
  }

  // ── Download ───────────────────────────────────────────────────────────────

  // ── Resumable streaming ──────────────────────────────────────────────────
  //
  // A dropped connection used to throw the whole download away. Now the bytes
  // already written stay in the writable, and the transfer asks the server for
  // the rest (Range: bytes=N-), sending back the ETag it started with in
  // If-Range. A 206 carries on; a 200 means the file changed on the server,
  // so it starts again from zero rather than splicing two versions together.
  //
  // After RETRIES failures the transfer pauses instead of failing: the
  // writable is left open -- the browser keeps the partial data in its swap
  // file, never under the real name -- and resume() picks it up again. Cancel
  // discards it. Only network failures and 5xx are retried; a 4xx is final.

  class Retryable extends Error {}

  async function pump(state, signal) {
    const headers = {};
    if (state.written > 0) {
      headers.Range = `bytes=${state.written}-`;
      if (state.etag) headers["If-Range"] = state.etag;
    }
    let response;
    try {
      response = await fetch(state.url, { credentials: "same-origin", signal, headers });
    } catch (error) {
      if (isAbort(error)) throw error;
      throw new Retryable(String((error && error.message) || error));
    }
    if (response.status >= 500) {
      throw new Retryable(`${response.status} ${response.statusText}`);
    }
    if (!response.ok) {
      let detail = `${response.status} ${response.statusText}`;
      try {
        const body = await response.json();
        if (body && body.detail) detail = body.detail;
      } catch (error) {
        /* not JSON */
      }
      const final = new Error(detail);
      final.status = response.status;
      throw final;
    }

    if (response.status === 206) {
      const range = /\/(\d+)\s*$/.exec(response.headers.get("content-range") || "");
      if (range) state.total = Number(range[1]);
    } else {
      // Whole file: the first attempt, or the server dropped our range
      // because the file changed. Either way, from the top.
      if (state.written > 0) {
        await state.writable.truncate(0);
        state.written = 0;
        state.restarted = true;
      }
      state.total = Number(response.headers.get("content-length") || 0);
      state.etag = response.headers.get("etag") || null;
    }
    if (state.written > 0) await state.writable.seek(state.written);

    const reader = response.body.getReader();
    let lastTick = 0;
    try {
      for (;;) {
        let chunk;
        try {
          chunk = await reader.read();
        } catch (error) {
          if (isAbort(error)) throw error;
          throw new Retryable(String((error && error.message) || error));
        }
        if (chunk.done) break;
        await state.writable.write(chunk.value);
        state.written += chunk.value.byteLength;
        const now = Date.now();
        // Throttled: a fast local transfer would otherwise cross the FFI
        // hundreds of times a second for no visible benefit.
        if (state.onProgress && (now - lastTick > 100 || state.written === state.total)) {
          lastTick = now;
          try {
            state.onProgress(state.written, state.total);
          } catch (error) {
            /* a reporting failure must not abort the transfer */
          }
        }
      }
    } finally {
      try { reader.releaseLock(); } catch (error) { /* already released */ }
    }
    // A connection that closes early without an error still left a hole.
    if (state.total && state.written < state.total) {
      throw new Retryable(`connection closed after ${state.written} of ${state.total} bytes`);
    }
  }

  async function runTransfer(state, transferId) {
    const controller = new AbortController();
    if (transferId) aborters.set(transferId, controller);
    let attempt = 0;
    try {
      for (;;) {
        try {
          await pump(state, controller.signal);
          await state.writable.close();
          paused.delete(transferId);
          return result(true, { bytes: state.written, retries: state.retries, restarted: !!state.restarted });
        } catch (error) {
          if (!(error instanceof Retryable)) throw error;
          attempt += 1;
          state.retries = (state.retries || 0) + 1;
          if (attempt > RETRIES) {
            // Out of retries: keep what we have and wait for Resume.
            if (transferId) paused.set(transferId, state);
            return result(false, {
              resumable: !!transferId,
              error: `Connection lost at ${state.written} of ${state.total || "?"} bytes (${error.message})`,
              bytes: state.written,
            });
          }
          await sleep(RETRY_BASE_MS * 2 ** (attempt - 1), controller.signal);
        }
      }
    } catch (error) {
      paused.delete(transferId);
      try {
        await state.writable.abort();
      } catch (abortError) {
        /* already closed */
      }
      return Object.assign(failure(error), error.status ? { status: error.status } : {});
    } finally {
      if (transferId) aborters.delete(transferId);
    }
  }

  function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new DOMException("Cancelled", "AbortError"));
      }, { once: true });
    });
  }

  async function streamInto(writable, url, transferId, onProgress) {
    return runTransfer({ writable, url, written: 0, total: 0, etag: null, onProgress }, transferId);
  }

  /**
   * Whether ``name`` is already taken inside a picked folder, by a file or a
   * directory. Lets a caller choose a free name instead of writing into an
   * existing file, which getFileHandle(name, {create: true}) does without a
   * word. The file system decides what counts as the same name, so on a
   * case-insensitive disk "Report.txt" finds "report.txt".
   */
  async function exists(folderId, name) {
    const folder = handles.get(folderId);
    if (!folder) return false;
    for (const lookup of ["getFileHandle", "getDirectoryHandle"]) {
      try {
        await folder[lookup](name);
        return true;
      } catch (error) {
        // Asked for a file, found a directory (or the reverse): still taken.
        if (error && error.name === "TypeMismatchError") return true;
      }
    }
    return false;
  }

  /** Carry on a paused download from where it stopped. */
  async function resume(transferId, onProgress) {
    const state = paused.get(transferId);
    if (!state) return result(false, { error: "Nothing to resume" });
    paused.delete(transferId);
    if (onProgress) state.onProgress = onProgress;
    return runTransfer(state, transferId);
  }

  async function saveFile(handleId, url, transferId, onProgress) {
    const handle = handles.get(handleId);
    if (!handle) return result(false, { error: "Unknown file handle" });
    try {
      const writable = await handle.createWritable();
      return await streamInto(writable, url, transferId, onProgress);
    } catch (error) {
      return failure(error);
    }
  }

  async function saveInto(folderId, relativePath, url, transferId, onProgress) {
    const folder = handles.get(folderId);
    if (!folder) return result(false, { error: "Unknown folder handle" });
    try {
      const parts = String(relativePath).split("/").filter(Boolean);
      const filename = parts.pop();
      let directory = folder;
      for (const part of parts) {
        directory = await directory.getDirectoryHandle(part, { create: true });
      }
      const handle = await directory.getFileHandle(filename, { create: true });
      const writable = await handle.createWritable();
      return await streamInto(writable, url, transferId, onProgress);
    } catch (error) {
      return failure(error);
    }
  }

  function downloadViaAnchor(url, suggestedName) {
    // Fallback where the pickers are unavailable: straight to the browser's
    // download directory, no choice of location.
    const anchor = document.createElement("a");
    anchor.href = url;
    if (suggestedName) anchor.download = suggestedName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    return result(true, { viaAnchor: true });
  }

  // ── Upload ─────────────────────────────────────────────────────────────────

  function upload(url, fileId, fields, transferId, onProgress) {
    const file = handles.get(fileId);
    if (!file) return Promise.resolve(result(false, { error: "Unknown file handle" }));

    return new Promise((resolve) => {
      const form = new FormData();
      Object.keys(fields || {}).forEach((key) => form.append(key, fields[key]));
      form.append("file", file, file.name);

      // XHR rather than fetch: fetch still cannot report upload progress
      // without request streams, which are not broadly available.
      const request = new XMLHttpRequest();
      if (transferId) {
        aborters.set(transferId, { abort: () => request.abort() });
      }
      request.open("POST", url, true);
      request.withCredentials = true;

      const csrf = csrfToken();
      if (csrf) request.setRequestHeader("X-CSRF-Token", csrf);

      request.upload.addEventListener("progress", (event) => {
        if (onProgress && event.lengthComputable) {
          try {
            onProgress(event.loaded, event.total);
          } catch (error) {
            /* ignore */
          }
        }
      });

      const settle = (value) => {
        if (transferId) aborters.delete(transferId);
        resolve(value);
      };

      request.addEventListener("load", () => {
        if (request.status >= 200 && request.status < 300) {
          settle(result(true, { bytes: file.size }));
          return;
        }
        let detail = `${request.status} ${request.statusText}`;
        try {
          const body = JSON.parse(request.responseText);
          if (body && body.detail) detail = body.detail;
        } catch (error) {
          /* not JSON */
        }
        settle(result(false, { error: detail, status: request.status }));
      });
      request.addEventListener("error", () =>
        settle(result(false, { error: "Network error" }))
      );
      request.addEventListener("abort", () =>
        settle(result(false, { cancelled: true, error: "Cancelled" }))
      );

      request.send(form);
    });
  }

  function csrfToken() {
    const match = document.cookie.match(/(?:^|;\s*)pytincture[^=]*csrf=([^;]+)/i);
    return match ? decodeURIComponent(match[1]) : "";
  }

  // ── Control ────────────────────────────────────────────────────────────────

  function cancel(transferId) {
    const waiting = paused.get(transferId);
    if (waiting) {
      paused.delete(transferId);
      waiting.writable.abort().catch(() => {});
      return true;
    }
    const controller = aborters.get(transferId);
    if (!controller) return false;
    try {
      controller.abort();
    } catch (error) {
      return false;
    }
    return true;
  }

  function release(handleId) {
    return handles.delete(handleId);
  }

  function releaseAll() {
    handles.clear();
    aborters.clear();
  }

  globalThis.wapyt.files = {
    supported,
    registerExternal,
    pickSaveFile,
    pickFolder,
    pickFiles,
    saveFile,
    saveInto,
    resume,
    exists,
    downloadViaAnchor,
    upload,
    cancel,
    release,
    releaseAll,
  };
})();
