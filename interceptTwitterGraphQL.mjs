// Intercept Twitter/X GraphQL calls and log them (XHR + fetch).
// Paste into DevTools Console (or inject) before you load/scroll the page.

(function interceptTwitterGraphQL({
  // match Twitter GraphQL endpoints (XHR + fetch)
  targetUrl = [
    "/api/graphql",                // typical X web
    /\/api\/graphql\/[^/]+\/[^/?]+/ // /api/graphql/<hash>/<OperationName>
  ],

  // keep full responses? can get big
  maxBodyChars = 20000,
  maxRespChars = 20000,

  // enable/disable console logging
  logToConsole = true,

  // store logs here
  storeKey = "__TWITTER_GQL_LOG__",
} = {}) {
  const matches = (url) => {
    try {
      const u = String(url || "");
      return Array.isArray(targetUrl)
        ? targetUrl.some((t) => (t instanceof RegExp ? t.test(u) : u.includes(t)))
        : (targetUrl instanceof RegExp ? targetUrl.test(u) : u.includes(targetUrl));
    } catch {
      return false;
    }
  };

  const safeJson = (v) => {
    try { return { ok: true, value: JSON.parse(v) }; }
    catch (e) { return { ok: false, error: e }; }
  };

  const clip = (v, n) => {
    if (v == null) return v;
    const s = typeof v === "string" ? v : (() => { try { return JSON.stringify(v); } catch { return String(v); } })();
    return s.length > n ? s.slice(0, n) + `…(clipped ${s.length - n} chars)` : s;
  };

  const parseUrl = (raw) => {
    try {
      const u = new URL(raw, location.origin);
      const query = {};
      u.searchParams.forEach((v, k) => (query[k] = v));
      return { href: u.href, pathname: u.pathname, query };
    } catch {
      return { href: String(raw), pathname: "", query: {} };
    }
  };

  const extractOpName = (urlInfo, body, headers) => {
    // 1) From pathname: /api/graphql/<hash>/<OperationName>
    const parts = (urlInfo.pathname || "").split("/").filter(Boolean);
    const idx = parts.indexOf("graphql");
    if (idx >= 0 && parts[idx + 2]) return parts[idx + 2];

    // 2) From query params: variables/extensions can contain operation name
    const varsRaw = urlInfo.query?.variables;
    if (varsRaw) {
      const v = safeJson(varsRaw);
      if (v.ok && typeof v.value?.operationName === "string") return v.value.operationName;
    }

    // 3) From body (POST)
    if (body && typeof body === "object") {
      if (typeof body.operationName === "string") return body.operationName;
      if (typeof body?.variables?.operationName === "string") return body.variables.operationName;
    }

    // 4) Fallback: header hint (rare)
    const h = headers?.["x-twitter-client-language"] || headers?.["x-client-language"];
    return h ? "unknown(op)" : "unknown(op)";
  };

  const store = (entry) => {
    const arr = (window[storeKey] ||= []);
    arr.push(entry);
    // also emit an event you can listen to
    window.dispatchEvent(new CustomEvent("TWITTER_GQL_LOG", { detail: entry }));
  };

  const log = (...args) => { if (logToConsole) console.log(...args); };
  const warn = (...args) => { if (logToConsole) console.warn(...args); };

  // ----------------------
  // XHR hook
  // ----------------------
  const NativeXHR = window.XMLHttpRequest;
  window.XMLHttpRequest = new Proxy(NativeXHR, {
    construct(Target, args) {
      const xhr = new Target(...args);

      const nativeOpen = xhr.open;
      const nativeSend = xhr.send;
      const nativeSetHeader = xhr.setRequestHeader;

      let method = "GET";
      let url = "";
      const headers = {};

      xhr.setRequestHeader = new Proxy(nativeSetHeader, {
        apply(fn, thisArg, fnArgs) {
          const [k, v] = fnArgs;
          if (k) headers[String(k).toLowerCase()] = String(v);
          return fn.apply(thisArg, fnArgs);
        },
      });

      xhr.open = new Proxy(nativeOpen, {
        apply(fn, thisArg, fnArgs) {
          method = String(fnArgs[0] || "GET").toUpperCase();
          url = String(fnArgs[1] || "");
          return fn.apply(thisArg, fnArgs);
        },
      });

      xhr.send = new Proxy(nativeSend, {
        apply(fn, thisArg, fnArgs) {
          const bodyRaw = fnArgs[0];
          if (!matches(url)) return fn.apply(thisArg, fnArgs);

          const urlInfo = parseUrl(url);
          const ct = headers["content-type"] || "";
          let body = null;

          if (bodyRaw != null) {
            if (typeof bodyRaw === "string" && ct.includes("application/json")) {
              const p = safeJson(bodyRaw);
              body = p.ok ? p.value : bodyRaw;
            } else {
              body = bodyRaw;
            }
          }

          const op = extractOpName(urlInfo, body, headers);
          const startedAt = Date.now();

          const reqEntry = {
            kind: "request",
            transport: "xhr",
            startedAt,
            method,
            url: urlInfo.href,
            pathname: urlInfo.pathname,
            operation: op,
            query: urlInfo.query,
            headers,
            body: clip(body, maxBodyChars),
            page: location.href,
          };

          store(reqEntry);
          log("%c[X GQL][XHR] →", "color:#8ab4ff", op, reqEntry);

          xhr.addEventListener("load", function onLoad() {
            try {
              const rawHeaders = this.getAllResponseHeaders() || "";
              const respHeaders = {};
              rawHeaders.split("\r\n").forEach((line) => {
                const i = line.indexOf(":");
                if (i > 0) respHeaders[line.slice(0, i).toLowerCase()] = line.slice(i + 1).trim();
              });

              const respCT = respHeaders["content-type"] || "";
              let resp = this.response;

              // If responseType is "" or "text", response is string; if "json" might already be object
              if (typeof resp === "string" && respCT.includes("application/json")) {
                const p = safeJson(resp);
                resp = p.ok ? p.value : resp;
              }

              const resEntry = {
                kind: "response",
                transport: "xhr",
                finishedAt: Date.now(),
                durationMs: Date.now() - startedAt,
                method,
                url: urlInfo.href,
                pathname: urlInfo.pathname,
                operation: op,
                status: this.status,
                headers: respHeaders,
                response: clip(resp, maxRespChars),
                page: location.href,
              };

              store(resEntry);
              log("%c[X GQL][XHR] ←", "color:#b6ffcc", op, resEntry);
            } catch (e) {
              warn("[X GQL][XHR] response parse error:", e);
            }
          });

          return fn.apply(thisArg, fnArgs);
        },
      });

      return xhr;
    },
  });

  // ----------------------
  // fetch hook (Twitter uses fetch heavily too)
  // ----------------------
  const nativeFetch = window.fetch;
  window.fetch = async function patchedFetch(input, init = {}) {
    const url = typeof input === "string" ? input : (input && input.url) || "";
    if (!matches(url)) return nativeFetch.apply(this, arguments);

    const urlInfo = parseUrl(url);
    const method = String(init.method || (input && input.method) || "GET").toUpperCase();

    // headers normalization
    const headers = {};
    const h = new Headers(init.headers || (input && input.headers) || {});
    h.forEach((v, k) => (headers[k.toLowerCase()] = v));

    // body parsing (best effort; don’t consume streams)
    let body = null;
    if (init.body != null) {
      if (typeof init.body === "string" && (headers["content-type"] || "").includes("application/json")) {
        const p = safeJson(init.body);
        body = p.ok ? p.value : init.body;
      } else {
        body = init.body;
      }
    }

    const op = extractOpName(urlInfo, body, headers);
    const startedAt = Date.now();

    const reqEntry = {
      kind: "request",
      transport: "fetch",
      startedAt,
      method,
      url: urlInfo.href,
      pathname: urlInfo.pathname,
      operation: op,
      query: urlInfo.query,
      headers,
      body: clip(body, maxBodyChars),
      page: location.href,
    };

    store(reqEntry);
    log("%c[X GQL][fetch] →", "color:#8ab4ff", op, reqEntry);

    const res = await nativeFetch.apply(this, arguments);

    // clone so we can read without consuming caller’s stream
    try {
      const cloned = res.clone();
      const respCT = cloned.headers.get("content-type") || "";
      let respBody = null;

      if (respCT.includes("application/json")) {
        respBody = await cloned.json().catch(() => null);
      } else {
        respBody = await cloned.text().catch(() => null);
      }

      const resEntry = {
        kind: "response",
        transport: "fetch",
        finishedAt: Date.now(),
        durationMs: Date.now() - startedAt,
        method,
        url: urlInfo.href,
        pathname: urlInfo.pathname,
        operation: op,
        status: res.status,
        headers: Object.fromEntries([...cloned.headers.entries()].map(([k, v]) => [k.toLowerCase(), v])),
        response: clip(respBody, maxRespChars),
        page: location.href,
      };

      store(resEntry);
      log("%c[X GQL][fetch] ←", "color:#b6ffcc", op, resEntry);
    } catch (e) {
      warn("[X GQL][fetch] response parse error:", e);
    }

    return res;
  };

  // convenience helpers
  window.__twitterGql = {
    storeKey,
    dump() { return window[storeKey] || []; },
    clear() { window[storeKey] = []; },
  };

  console.log(
    "%cTwitter/X GraphQL interceptor enabled.",
    "color:#b6ffcc;font-weight:600",
    `Logs: window.${storeKey} (or __twitterGql.dump())`,
  );
})();

// Example: listen live
// window.addEventListener("TWITTER_GQL_LOG", (e) => console.log("EVENT:", e.detail));
