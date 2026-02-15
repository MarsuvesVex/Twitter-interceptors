# Twitter-interceptors


## interceptTwitterGraphQL

Intercept Twitter/X GraphQL calls in the browser, capture **UserMedia** responses in memory, and export them as a single file with `---` separators.

This is designed for **DevTools Console / userscript** style usage and works even when X uses `fetch()` (not just XHR).

---

## What it does

- Hooks **both** `window.fetch` and `XMLHttpRequest`
- Filters GraphQL calls to a target operation (default: `UserMedia`)
- Stores matched responses in `window.__xStore.items`
- Exports all captured responses as text, separated by:

```text
---
````

---

## Quick start (DevTools)

1. Open X (twitter.com / x.com)
2. Open **DevTools → Console**
3. Paste the interceptor script and hit Enter
4. Navigate to a user’s **Media** tab and **scroll** to trigger GraphQL pagination
5. Export:

```js
__xStore.count()
__xStore.exportFile("UserMedia-responses.txt")
```

---

## Files

* `interceptTwitterGraphQL.js` (or similar): the browser interceptor
* `README.md`: this doc

If your repo also contains additional tooling (like server-side downloaders), document them below.

---

## Usage details

### Available commands

Once injected, you get:

* `__xStore.count()`
  Returns how many responses have been captured.

* `__xStore.clear()`
  Clears memory.

* `__xStore.exportText()`
  Returns a big string where each response is JSON and separated by `---`.

* `__xStore.exportFile(filename?)`
  Downloads a `.txt` file in the browser containing `exportText()` output.

Example:

```js
__xStore.clear()
__xStore.count()
__xStore.exportFile()
```

---

## Configuration

Inside the script:

* `ONLY_OP`
  Defaults to `"UserMedia"`. Set to `null` to capture **all** GraphQL operations.

```js
const ONLY_OP = "UserMedia"; // or null
```

* `GRAPHQL_PATH_RE`
  Matcher for typical X GraphQL endpoints:

```js
const GRAPHQL_PATH_RE = /\/(i\/api|api)\/graphql\//;
```

If your requests go through a different path, adjust this.

---

## Troubleshooting

### “It’s not catching anything”

Most common reasons:

1. You injected **after** requests already fired.
   Fix: refresh the page, inject the script, then scroll again.

2. X GraphQL endpoint differs from the default matcher.
   Fix: open **Network → Fetch/XHR**, find a request to GraphQL, then update `GRAPHQL_PATH_RE`.

3. The operation name isn’t `UserMedia`.
   Fix: set `ONLY_OP = null` and verify what operation names are being captured, then set it back.

### Verify it’s hooked

In console, you should see logs like:

```
[xStore] fetch() hooked
[xStore] XMLHttpRequest hooked
[xStore] ready...
```

---

## Notes

* This captures **responses**, not just request metadata.
* Responses are stored in-memory; large scroll sessions will consume memory.
* Intended for debugging / personal tooling. Respect site terms and local laws.

---


