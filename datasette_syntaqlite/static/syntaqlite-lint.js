/**
 * syntaqlite-lint.js
 * Datasette plugin: inline SQL linting via the /-/syntaqlite-lint endpoint.
 */

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Read the CSRF token injected by the plugin's extra_body_script hook.
 * Falls back to the ds_csrftoken cookie for resilience.
 * @returns {string}
 */
function getCsrfToken() {
  const el = document.getElementById("syntaqlite-csrftoken");
  if (el && el.value) return el.value;
  // Cookie fallback (e.g. when another plugin or Datasette itself set it)
  const prefix = "ds_csrftoken=";
  for (const part of document.cookie.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) {
      return decodeURIComponent(trimmed.slice(prefix.length));
    }
  }
  return "";
}

/**
 * Map a UTF-8 byte offset to a JavaScript string character index.
 * SQLite / syntaqlite reports offsets as byte positions in the UTF-8
 * encoding of the SQL string; JS strings are UTF-16, so we must convert.
 *
 * @param {string} str   - The full SQL string.
 * @param {number} byteOffset - Byte offset in the UTF-8 encoding.
 * @returns {number} Character index in the JS string.
 */
function byteOffsetToCharIndex(str, byteOffset) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder("utf-8");
  const fullBytes = encoder.encode(str);
  // Clamp to valid range
  const clamped = Math.max(0, Math.min(byteOffset, fullBytes.length));
  const slice = fullBytes.slice(0, clamped);
  return decoder.decode(slice).length;
}

/**
 * Simple debounce: returns a function that, when called, delays invoking
 * `fn` until after `delay` ms have elapsed since the last call.
 *
 * @param {Function} fn
 * @param {number} delay
 * @returns {Function}
 */
function debounce(fn, delay) {
  let timer = null;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

/**
 * Extract the database name from the current URL pathname.
 * Datasette paths look like:
 *   /          → "" (no database)
 *   /mydb      → "mydb"
 *   /mydb/table → "mydb"
 *   /mydb/-/query → "mydb"
 *   /-/query   → "" (built-in query, no specific database)
 *
 * @returns {string}
 */
function getDatabaseFromPath() {
  const parts = window.location.pathname.split("/").filter(Boolean);
  if (parts.length === 0) return "";
  // If the first segment starts with "-" it is a datasette-internal path.
  if (parts[0].startsWith("-")) return "";
  return parts[0];
}

// ---------------------------------------------------------------------------
// Severity metadata
// ---------------------------------------------------------------------------

const SEVERITY_META = {
  error: { color: "#c0392b", label: "Error" },
  warning: { color: "#e67e22", label: "Warning" },
  info: { color: "#2980b9", label: "Info" },
  hint: { color: "#27ae60", label: "Hint" },
};

// ---------------------------------------------------------------------------
// Lint panel rendering
// ---------------------------------------------------------------------------

/**
 * Set the panel into a "checking…" state.
 * @param {HTMLElement} panel
 */
function renderChecking(panel) {
  panel.innerHTML = "";
  const el = document.createElement("div");
  el.className = "syntaqlite-checking";
  el.textContent = "⏳ Checking…";
  panel.appendChild(el);
}

/**
 * Render the "lint unavailable" error state.
 * @param {HTMLElement} panel
 */
function renderUnavailable(panel) {
  panel.innerHTML = "";
  const el = document.createElement("div");
  el.className = "syntaqlite-checking";
  el.textContent = "⚠ Lint unavailable";
  panel.appendChild(el);
}

/**
 * Render an empty panel (no SQL entered yet).
 * @param {HTMLElement} panel
 */
function renderEmpty(panel) {
  panel.innerHTML = "";
}

/**
 * Render "✓ No issues".
 * @param {HTMLElement} panel
 */
function renderOk(panel) {
  panel.innerHTML = "";
  const el = document.createElement("div");
  el.className = "syntaqlite-ok";
  el.textContent = "✓ No issues";
  panel.appendChild(el);
}

/**
 * Render a list of diagnostics.
 *
 * @param {HTMLElement} panel
 * @param {Array<{severity: string, message: string, start_offset: number, end_offset: number}>} diagnostics
 * @param {string} sql
 * @param {HTMLTextAreaElement|null} textarea  - plain textarea for fallback mode
 * @param {object|null} cm                    - CodeMirror instance for jump-to
 */
function renderDiagnostics(panel, diagnostics, sql, textarea, cm) {
  panel.innerHTML = "";

  for (const diag of diagnostics) {
    const severity = (diag.severity || "info").toLowerCase();
    const meta = SEVERITY_META[severity] || SEVERITY_META.info;

    const row = document.createElement("div");
    row.className = `syntaqlite-diag syntaqlite-diag--${severity}`;

    // Colored bullet icon
    const icon = document.createElement("span");
    icon.className = "syntaqlite-icon";
    icon.textContent = "●";
    icon.setAttribute("aria-label", meta.label);
    row.appendChild(icon);

    // Message text
    const msg = document.createElement("span");
    msg.className = "syntaqlite-msg";
    msg.textContent = diag.message;
    row.appendChild(msg);

    // "Jump to" button — only shown when offset information is available
    if (
      typeof diag.start_offset === "number" &&
      typeof diag.end_offset === "number" &&
      (cm || textarea)
    ) {
      const charStart = byteOffsetToCharIndex(sql, diag.start_offset);
      const charEnd = byteOffsetToCharIndex(sql, diag.end_offset);

      const jump = document.createElement("button");
      jump.type = "button";
      jump.className = "syntaqlite-jump";
      jump.textContent = "Jump to";
      jump.addEventListener("click", (e) => {
        e.preventDefault();
        if (cm) {
          // Convert flat character indices to CodeMirror {line, ch} positions.
          const lines = sql.split("\n");
          let remaining = charStart;
          let startLine = 0;
          for (let i = 0; i < lines.length; i++) {
            // +1 for the newline character itself
            if (remaining <= lines[i].length) {
              startLine = i;
              break;
            }
            remaining -= lines[i].length + 1;
          }
          let remainingEnd = charEnd;
          let endLine = 0;
          let endCh = 0;
          for (let i = 0; i < lines.length; i++) {
            if (remainingEnd <= lines[i].length) {
              endLine = i;
              endCh = remainingEnd;
              break;
            }
            remainingEnd -= lines[i].length + 1;
          }
          cm.focus();
          cm.setSelection(
            { line: startLine, ch: remaining },
            { line: endLine, ch: endCh },
          );
          cm.scrollIntoView({ line: startLine, ch: remaining });
        } else if (textarea) {
          textarea.focus();
          textarea.selectionStart = charStart;
          textarea.selectionEnd = charEnd;
          try {
            const lineHeight =
              parseInt(getComputedStyle(textarea).lineHeight, 10) || 16;
            const lines = sql.slice(0, charStart).split("\n");
            textarea.scrollTop = (lines.length - 1) * lineHeight;
          } catch (_) {
            // Ignore scroll errors
          }
        }
      });
      row.appendChild(jump);
    }

    panel.appendChild(row);
  }
}

// ---------------------------------------------------------------------------
// Core lint function
// ---------------------------------------------------------------------------

/**
 * Run the linter for a single textarea / panel pair.
 *
 * @param {string} sql                    - Current SQL string to lint.
 * @param {HTMLElement} panel             - The lint panel element.
 * @param {string} database               - Datasette database name.
 * @param {HTMLTextAreaElement|null} textarea - Textarea for fallback jump-to.
 * @param {object|null} cm                - CodeMirror instance for jump-to.
 */
async function runLint(sql, panel, database, textarea, cm) {
  if (!sql.trim()) {
    renderEmpty(panel);
    return;
  }

  const csrfToken = getCsrfToken();
  if (!csrfToken) {
    return;
  }

  renderChecking(panel);

  let response;
  try {
    response = await fetch("/-/syntaqlite-lint", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(csrfToken ? { "X-CSRFToken": csrfToken } : {}),
      },
      body: JSON.stringify({ sql, database }),
    });
  } catch (networkError) {
    console.warn("[syntaqlite-lint] Linting request failed: network error", {
      sql,
      database,
      error: networkError,
    });
    renderUnavailable(panel);
    return;
  }

  if (!response.ok) {
    console.warn(
      `[syntaqlite-lint] Linting request failed: HTTP ${response.status} ${response.statusText}`,
      { sql, database },
    );
    renderUnavailable(panel);
    return;
  }

  let data;
  try {
    data = await response.json();
  } catch (parseError) {
    console.warn("[syntaqlite-lint] Failed to parse linting response as JSON", {
      sql,
      database,
      error: parseError,
    });
    renderUnavailable(panel);
    return;
  }

  if (!Array.isArray(data.diagnostics)) {
    console.warn(
      "[syntaqlite-lint] Unexpected response shape: `data.diagnostics` is not an array",
      {
        sql,
        database,
        data,
      },
    );
    renderUnavailable(panel);
    return;
  }

  if (data.diagnostics.length === 0) {
    renderOk(panel);
  } else {
    renderDiagnostics(panel, data.diagnostics, sql, textarea, cm);
  }
}

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

/**
 * Try to find a CodeMirror instance associated with a textarea.
 * CodeMirror 5 (used by Datasette) replaces the textarea with a wrapper div
 * and attaches the editor instance to that wrapper element as `.CodeMirror`.
 *
 * @param {HTMLTextAreaElement} textarea
 * @returns {object|null} CodeMirror editor instance, or null if not found.
 */
function getCodeMirrorForTextarea(textarea) {
  // CodeMirror inserts its wrapper div immediately after the textarea.
  const next = textarea.nextElementSibling;
  if (next && next.classList.contains("CodeMirror") && next.CodeMirror) {
    return next.CodeMirror;
  }
  // Fallback: search the closest ancestor form/container.
  const container = textarea.closest("form, p, div") || document.body;
  const wrapper = container.querySelector(".CodeMirror");
  if (wrapper && wrapper.CodeMirror) {
    return wrapper.CodeMirror;
  }
  return null;
}

function init() {
  const textareas = document.querySelectorAll("textarea[name='sql']");
  if (textareas.length === 0) return;

  const database = getDatabaseFromPath();

  for (const textarea of textareas) {
    // The panel is inserted after the textarea. CodeMirror's wrapper div will
    // also be inserted after the textarea (by Datasette's own script), so we
    // defer panel insertion to after the current script execution to ensure we
    // end up after the CodeMirror wrapper.
    const panel = document.createElement("div");
    panel.className = "syntaqlite-lint-panel";
    panel.setAttribute("aria-live", "polite");

    const debouncedLint = debounce((sql, cm) => {
      runLint(sql, panel, database, null, cm).catch(() =>
        renderUnavailable(panel),
      );
    }, 400);

    // Try to attach to CodeMirror. Datasette initialises CodeMirror in a
    // deferred/inline script that runs after DOMContentLoaded, so we poll
    // briefly to wait for the editor to be created.
    let attempts = 0;
    const maxAttempts = 40; // 40 × 50 ms = 2 s max wait

    const attach = () => {
      const cm = getCodeMirrorForTextarea(textarea);

      if (cm) {
        // Insert panel after the CodeMirror wrapper div (which is after the textarea).
        const cmWrapper = cm.getWrapperElement();
        cmWrapper.insertAdjacentElement("afterend", panel);

        // Hook into CodeMirror's change event.
        cm.on("change", () => {
          debouncedLint(cm.getValue(), cm);
        });

        // Run immediately if there's already content.
        if (cm.getValue().trim()) {
          runLint(cm.getValue(), panel, database, null, cm).catch(() =>
            renderUnavailable(panel),
          );
        }
      } else if (attempts < maxAttempts) {
        // CodeMirror not ready yet — try again shortly.
        attempts++;
        setTimeout(attach, 50);
      } else {
        // CodeMirror never appeared; fall back to plain textarea events.
        textarea.insertAdjacentElement("afterend", panel);
        const fallbackLint = debounce(() => {
          runLint(textarea.value, panel, database, textarea, null).catch(() =>
            renderUnavailable(panel),
          );
        }, 400);
        textarea.addEventListener("input", fallbackLint);
        if (textarea.value.trim()) {
          runLint(textarea.value, panel, database, textarea, null).catch(() =>
            renderUnavailable(panel),
          );
        }
      }
    };

    // Start polling on next tick so Datasette's own inline scripts have a
    // chance to run first.
    setTimeout(attach, 0);
  }
}

document.addEventListener("DOMContentLoaded", init);
