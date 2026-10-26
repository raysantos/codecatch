// CodeCatch content script: spots 2FA code fields, asks the background for a
// code from Gmail, then fills it or shows a "Paste 123456" chip.
(() => {
  if (window.__codecatch) return;
  window.__codecatch = true;

  const HINT = /one[-_ ]?time|otp|2fa|mfa|totp|verif|passcode|pass[-_ ]?code|security[-_ ]?code|auth\w*[-_ ]?code|login[-_ ]?code|sign[-_ ]?in[-_ ]?code|confirm\w*[-_ ]?code|sms[-_ ]?code|email[-_ ]?code|^code$|[-_ ]code$|^pin$|token/i;
  const SKIP = /zip|postal|promo|coupon|discount|gift|referral|country|area|phone|card|cvv|cvc|captcha/i;
  const POLL_MS = 3000;
  const POLL_FOR_MS = 3 * 60_000;

  let watching = null; // { target, until, timer }
  let chipHost = null;
  const handled = new WeakSet(); // fields the page scan has already watched

  // ---------- field detection ----------

  function labelText(el) {
    const parts = [el.name, el.id, el.placeholder, el.getAttribute('aria-label'), el.getAttribute('data-testid')];
    if (el.labels) for (const l of el.labels) parts.push(l.textContent);
    const by = el.getAttribute('aria-labelledby');
    if (by) by.split(/\s+/).forEach((id) => parts.push(document.getElementById(id)?.textContent));
    return parts.filter(Boolean).join(' ').slice(0, 300);
  }

  function isTextLike(el) {
    return el instanceof HTMLInputElement &&
      ['text', 'tel', 'number', 'password', ''].includes(el.type) &&
      !el.disabled && !el.readOnly;
  }

  // Returns { inputs: [..] } for a code field (one input, or a row of single-digit boxes).
  function codeTarget(el) {
    if (!isTextLike(el)) return null;
    const ac = (el.autocomplete || '').toLowerCase();
    const label = labelText(el);

    const group = splitGroup(el);
    if (group) return { inputs: group };

    if (el.type === 'password' && ac !== 'one-time-code') return null;
    if (ac === 'one-time-code') return { inputs: [el] };
    if (SKIP.test(label)) return null;
    if (HINT.test(label)) return { inputs: [el] };
    const max = el.maxLength;
    if (el.inputMode === 'numeric' && max >= 4 && max <= 8) return { inputs: [el] };
    return null;
  }

  // Sites that use 4–8 separate one-character boxes.
  function splitGroup(el) {
    if (el.maxLength !== 1) return null;
    let box = el.parentElement;
    for (let i = 0; i < 4 && box; i++, box = box.parentElement) {
      const inputs = [...box.querySelectorAll('input')].filter((i) => isTextLike(i) && i.maxLength === 1);
      if (inputs.length >= 4 && inputs.length <= 8 && inputs.includes(el)) return inputs;
    }
    return null;
  }

  function visible(el) {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  }

  function isEmpty(target) {
    return target.inputs.every((i) => !i.value.trim());
  }

  // ---------- filling ----------

  function setValue(input, value) {
    const proto = Object.getPrototypeOf(input);
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    setter ? setter.call(input, value) : (input.value = value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function fill(target, code) {
    const { inputs } = target;
    if (inputs.length === 1) {
      inputs[0].focus();
      setValue(inputs[0], code);
    } else {
      // Many split-box widgets handle a paste on the first box best.
      const first = inputs[0];
      first.focus();
      const dt = new DataTransfer();
      dt.setData('text/plain', code);
      const pasted = !first.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      if (!pasted || inputs.some((i, n) => i.value !== (code[n] || ''))) {
        inputs.forEach((input, n) => {
          input.focus();
          setValue(input, code[n] || '');
          input.dispatchEvent(new KeyboardEvent('keyup', { key: code[n] || '', bubbles: true }));
        });
      }
      inputs[Math.min(code.length, inputs.length) - 1].focus();
    }
  }

  // ---------- chip UI (shadow DOM so site CSS can't touch it) ----------

  function removeChip() {
    chipHost?.remove();
    chipHost = null;
  }

  function showChip(target, hit) {
    removeChip();
    const anchor = target.inputs[target.inputs.length - 1];
    const r = anchor.getBoundingClientRect();

    chipHost = document.createElement('codecatch-chip');
    const root = chipHost.attachShadow({ mode: 'closed' });
    root.innerHTML = `
      <style>
        :host { all: initial; position: fixed; z-index: 2147483647; }
        .chip { display: flex; align-items: center; gap: 4px; padding: 4px;
          background: #fff; border: 1px solid #dedede; border-radius: 999px;
          box-shadow: 0 4px 16px rgb(0 0 0 / .12);
          font: 600 14px/1 "Sofia Sans", system-ui, "Segoe UI", sans-serif; color: #363636;
          animation: in .15s cubic-bezier(.2,0,0,1); }
        @keyframes in { from { opacity: 0; transform: translateY(-4px); } }
        button { all: unset; cursor: pointer; display: flex; align-items: center; gap: 6px;
          padding: 8px 12px; border-radius: 999px; }
        .paste { background: linear-gradient(90deg, #ff7e5f, #feb47b); color: #fff; }
        .paste b { letter-spacing: .08em; font-variant-numeric: tabular-nums; }
        .ghost:hover { background: #f3f5f8; }
        .ghost { color: #54595f; padding: 8px 10px; }
        button:focus-visible { outline: 2px solid #1b3867; outline-offset: 2px; }
        .from { font-weight: 400; font-size: 12px; color: #54595f; padding: 0 6px 0 2px;
          max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      </style>
      <div class="chip" role="dialog" aria-label="CodeCatch">
        <button class="paste" title="Fill the code">Paste <b></b></button>
        <span class="from"></span>
        <button class="ghost copy" title="Copy to clipboard">Copy</button>
        <button class="ghost close" title="Dismiss" aria-label="Dismiss">✕</button>
      </div>`;
    root.querySelector('b').textContent = hit.code;
    root.querySelector('.from').textContent = hit.from || '';

    root.querySelector('.paste').addEventListener('click', () => {
      fill(target, hit.code);
      chrome.runtime.sendMessage({ type: 'used', id: hit.id });
      removeChip();
    });
    root.querySelector('.copy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(hit.code); }
      catch { chrome.runtime.sendMessage({ type: 'copy', code: hit.code }); }
      chrome.runtime.sendMessage({ type: 'used', id: hit.id });
      root.querySelector('.copy').textContent = 'Copied';
      setTimeout(removeChip, 900);
    });
    root.querySelector('.close').addEventListener('click', removeChip);

    // Keep the chip from stealing focus away from the field on mousedown.
    root.addEventListener('mousedown', (e) => e.preventDefault());

    chipHost.style.top = `${Math.min(r.bottom + 6, innerHeight - 52)}px`;
    chipHost.style.left = `${Math.max(8, Math.min(r.left, innerWidth - 320))}px`;
    document.documentElement.appendChild(chipHost);
  }

  // ---------- polling ----------

  function stopWatching() {
    if (watching) clearTimeout(watching.timer);
    watching = null;
  }

  async function poll() {
    if (!watching) return;
    if (Date.now() > watching.until || !document.contains(watching.target.inputs[0])) {
      return stopWatching();
    }
    let res;
    try {
      res = await chrome.runtime.sendMessage({ type: 'check' });
    } catch {
      return stopWatching(); // extension reloaded
    }
    if (!watching) return;

    if (res?.status === 'found') {
      const target = watching.target;
      stopWatching();
      if (!isEmpty(target)) return;
      if (res.settings?.autoFill) {
        fill(target, res.code);
        chrome.runtime.sendMessage({ type: 'used', id: res.id });
      } else {
        showChip(target, res);
      }
      return;
    }
    if (res?.status === 'signed-out') return stopWatching();
    watching.timer = setTimeout(poll, POLL_MS);
  }

  function watch(target) {
    if (watching && watching.target.inputs[0] === target.inputs[0]) return;
    if (!isEmpty(target)) return;
    stopWatching();
    handled.add(target.inputs[0]);
    watching = { target, until: Date.now() + POLL_FOR_MS, timer: null };
    poll();
  }

  document.addEventListener('focusin', (e) => {
    if (chipHost) return;
    const target = codeTarget(e.target);
    if (target) watch(target);
  }, true);

  // Also catch code fields that load already focused or appear later.
  function scan() {
    if (watching) return;
    for (const el of document.querySelectorAll('input')) {
      const target = codeTarget(el);
      if (target && visible(el) && !handled.has(target.inputs[0])) return watch(target);
    }
  }
  scan();
  let scanTimer;
  new MutationObserver(() => {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 400);
  }).observe(document.documentElement, { childList: true, subtree: true });

  addEventListener('scroll', removeChip, { passive: true });
  addEventListener('keydown', (e) => e.key === 'Escape' && removeChip());
})();
