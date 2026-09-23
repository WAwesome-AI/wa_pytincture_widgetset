(function () {
  const globalNS = (globalThis.wapyt = globalThis.wapyt || {});

  // File System Access handles cannot cross the Pyodide FFI usefully, so they
  // live here and Python refers to them by id.
  const handles = new Map();
  const aborters = new Map();
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

      // There is no cancel event on a file input. `cancel` fires in modern
      // browsers; the focus fallback covers the rest.
      input.addEventListener("cancel", () => finish(result(false, { cancelled: true })));
      window.addEventListener(
        "focus",
        () => setTimeout(() => finish(result(false, { cancelled: true })), 700),
        { once: true }
      );

      input.click();
    });
  }

  // ── Download ───────────────────────────────────────────────────────────────

  function countingStream(total, onProgress) {
    let seen = 0;
    let lastTick = 0;
    return new TransformStream({
      transform(chunk, controller) {
        seen += chunk.byteLength;
        const now = Date.now();
        // Throttle: a fast local transfer would otherwise cross the FFI
        // hundreds of times a second for no visible benefit.
        if (onProgress && (now - lastTick > 100 || seen === total)) {
          lastTick = now;
          try {
            onProgress(seen, total);
          } catch (error) {
            /* a reporting failure must not abort the transfer */
          }
        }
        controller.enqueue(chunk);
      },
    });
  }

  async function streamInto(writable, url, transferId, onProgress) {
    const controller = new AbortController();
    if (transferId) {
      aborters.set(transferId, controller);
    }
    try {
      const response = await fetch(url, {
        credentials: "same-origin",
        signal: controller.signal,
      });
      if (!response.ok) {
        let detail = `${response.status} ${response.statusText}`;
        try {
          const body = await response.json();
          if (body && body.detail) detail = body.detail;
        } catch (error) {
          /* not JSON */
        }
        await writable.abort();
        return result(false, { error: detail, status: response.status });
      }

      const total = Number(response.headers.get("content-length") || 0);
      // Streamed straight from the socket to disk: a multi-gigabyte file costs
      // a buffer, never its own size in memory.
      await response.body
        .pipeThrough(countingStream(total, onProgress))
        .pipeTo(writable);
      return result(true, { bytes: total });
    } catch (error) {
      try {
        await writable.abort();
      } catch (abortError) {
        /* already closed */
      }
      return failure(error);
    } finally {
      if (transferId) aborters.delete(transferId);
    }
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
    downloadViaAnchor,
    upload,
    cancel,
    release,
    releaseAll,
  };
})();
