/**
How to use

Open X, paste the snippet in Console.

Go to the user’s Media tab and scroll (loads more pages).

Run:

__xStore.count() to confirm it’s catching.

__xStore.exportFile() to save all UserMedia responses joined with ---.
**/

(() => {
  // ========= config =========
  const ONLY_OP = "UserMedia";            // set to null to capture all ops
  const GRAPHQL_PATH_RE = /\/(i\/api|api)\/graphql\//; // typical X graphql endpoints

  // ========= store =========
  const store = (window.__xStore ||= {
    enabled: true,
    items: [],      // { ts, url, operation, status, request, response }
    push(x) { this.items.push(x); },
    clear() { this.items = []; console.log("[xStore] cleared"); },
    count() { return this.items.length; },
    exportText() {
      return this.items.map(i => JSON.stringify(i.response, null, 2)).join("\n---\n");
    },
    exportFile(filename = "UserMedia-responses.txt") {
      const blob = new Blob([this.exportText()], { type: "text/plain;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
      console.log(`[xStore] exported ${this.items.length} responses -> ${filename}`);
    },
  });

  const log = (...a) => console.log("%c[xStore]", "color:#8ab4ff", ...a);

  // ========= helpers =========
  function safeJsonParse(s) {
    try { return { ok: true, value: JSON.parse(s) }; }
    catch (e) { return { ok: false, error: e }; }
  }

  function looksGraphQL(url) {
    try {
      const u = new URL(url, location.origin);
      return GRAPHQL_PATH_RE.test(u.pathname) || u.pathname.includes("/api/graphql");
    } catch { return false; }
  }

  function getOperation(url, bodyText) {
    // X graphql: /i/api/graphql/<hash>/<OperationName>
    try {
      const u = new URL(url, location.origin);
      const parts = u.pathname.split("/").filter(Boolean);
      const opFromPath = parts.at(-1);
      if (opFromPath && opFromPath.length < 64) return opFromPath;
      const opFromQuery = u.searchParams.get("operationName");
      if (opFromQuery) return opFromQuery;
    } catch {}

    // Sometimes operationName is in JSON body
    if (bodyText) {
      const parsed = safeJsonParse(bodyText);
      if (parsed.ok) {
        return parsed.value?.operationName || parsed.value?.queryId || null;
      }
    }
    return null;
  }

  function shouldKeep({ url, operation, status }) {
    if (!looksGraphQL(url)) return false;
    if (ONLY_OP && operation !== ONLY_OP) return false;
    if (typeof status === "number" && status >= 400) return false;
    return true;
  }

  async function cloneAndReadResponse(res) {
    // read as text then parse JSON if possible
    const ctype = (res.headers.get("content-type") || "").toLowerCase();
    const text = await res.clone().text().catch(() => "");
    if (ctype.includes("application/json") || text.trim().startsWith("{") || text.trim().startsWith("[")) {
      const parsed = safeJsonParse(text);
      return parsed.ok ? parsed.value : { _parseError: String(parsed.error), _raw: text };
    }
    return { _raw: text };
  }

  // ========= fetch hook =========
  if (!window.__xFetchHooked) {
    window.__xFetchHooked = true;
    const origFetch = window.fetch;

    window.fetch = async function(input, init = {}) {
      const url = typeof input === "string" ? input : (input?.url || "");
      const method = (init?.method || (typeof input !== "string" ? input?.method : null) || "GET").toUpperCase();

      let bodyText = "";
      try {
        const b = init?.body;
        if (typeof b === "string") bodyText = b;
        // (Don’t try to read streams/FormData here)
      } catch {}

      const operation = getOperation(url, bodyText);

      const res = await origFetch.apply(this, arguments);

      // Only inspect after we have a response
      if (!store.enabled) return res;

      try {
        const status = res.status;
        if (!shouldKeep({ url, operation, status })) return res;

        const responseJson = await cloneAndReadResponse(res);

        store.push({
          ts: new Date().toISOString(),
          url,
          operation,
          status,
          request: { method, url, body: bodyText ? (safeJsonParse(bodyText).ok ? safeJsonParse(bodyText).value : bodyText) : null },
          response: responseJson,
        });

        log(`captured ${operation} (${status})`, url, `total=${store.count()}`);
      } catch (e) {
        log("fetch capture error:", e);
      }

      return res;
    };

    log("fetch() hooked");
  }

  // ========= XHR hook (backup) =========
  if (!window.__xXhrHooked) {
    window.__xXhrHooked = true;
    const OrigXHR = window.XMLHttpRequest;

    window.XMLHttpRequest = function() {
      const xhr = new OrigXHR();
      let _url = "";
      let _method = "GET";
      let _body = "";

      const origOpen = xhr.open;
      xhr.open = function(method, url) {
        _method = String(method || "GET").toUpperCase();
        _url = String(url || "");
        return origOpen.apply(this, arguments);
      };

      const origSend = xhr.send;
      xhr.send = function(body) {
        if (typeof body === "string") _body = body;
        return origSend.apply(this, arguments);
      };

      xhr.addEventListener("load", () => {
        if (!store.enabled) return;

        try {
          const operation = getOperation(_url, _body);
          const status = xhr.status;

          if (!shouldKeep({ url: _url, operation, status })) return;

          const text = xhr.responseText || "";
          const parsed = safeJsonParse(text);
          const responseJson = parsed.ok ? parsed.value : { _parseError: String(parsed.error), _raw: text };

          store.push({
            ts: new Date().toISOString(),
            url: _url,
            operation,
            status,
            request: { method: _method, url: _url, body: _body ? (safeJsonParse(_body).ok ? safeJsonParse(_body).value : _body) : null },
            response: responseJson,
          });

          log(`captured XHR ${operation} (${status})`, _url, `total=${store.count()}`);
        } catch (e) {
          log("xhr capture error:", e);
        }
      });

      return xhr;
    };

    log("XMLHttpRequest hooked");
  }

  // ========= convenience =========
  window.__xStore = store;
  log("ready. Commands: __xStore.clear(), __xStore.count(), __xStore.exportFile()");
})();

