import { extractCode, htmlToText } from './extract.js';

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const DEFAULTS = { autoFill: false, notify: true, lookbackMinutes: 3 };

// ---------- settings + small state ----------

async function settings() {
  return { ...DEFAULTS, ...(await chrome.storage.sync.get(DEFAULTS)) };
}

// Message IDs already looked at (parsed result cached) and already used.
async function sessionGet(key, fallback) {
  const v = (await chrome.storage.session.get(key))[key];
  return v ?? fallback;
}
async function sessionSet(key, value) {
  await chrome.storage.session.set({ [key]: value });
}

// ---------- Gmail ----------

async function getToken(interactive) {
  try {
    const res = await chrome.identity.getAuthToken({ interactive });
    return typeof res === 'string' ? res : res?.token ?? null;
  } catch {
    return null;
  }
}

async function gmail(path, token) {
  const res = await fetch(`${API}/${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) {
    await chrome.identity.removeCachedAuthToken({ token });
    throw Object.assign(new Error('auth'), { auth: true });
  }
  if (!res.ok) throw new Error(`Gmail ${res.status}`);
  return res.json();
}

function decode(b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

function bodyText(payload) {
  let plain = '';
  let html = '';
  (function walk(part) {
    if (!part) return;
    const data = part.body?.data;
    if (data && part.mimeType === 'text/plain') plain += decode(data) + '\n';
    if (data && part.mimeType === 'text/html') html += decode(data) + '\n';
    (part.parts || []).forEach(walk);
  })(payload);
  return plain || htmlToText(html);
}

function header(payload, name) {
  return payload.headers?.find((h) => h.name.toLowerCase() === name)?.value || '';
}

// Returns the newest unused code from recent mail, or a status.
async function findCode({ interactive = false } = {}) {
  let token = await getToken(interactive);
  if (!token) return { status: 'signed-out' };

  const { lookbackMinutes } = await settings();
  const after = Math.floor((Date.now() - lookbackMinutes * 60_000) / 1000);
  const q = encodeURIComponent(`after:${after} -in:sent -in:drafts`);

  let list;
  try {
    list = await gmail(`messages?maxResults=8&q=${q}`, token);
  } catch (e) {
    if (!e.auth) return { status: 'error', message: e.message };
    token = await getToken(false);
    if (!token) return { status: 'signed-out' };
    list = await gmail(`messages?maxResults=8&q=${q}`, token);
  }

  const cache = await sessionGet('parsed', {});
  const used = await sessionGet('used', []);

  for (const { id } of list.messages || []) {
    if (used.includes(id)) continue;
    if (!(id in cache)) {
      const msg = await gmail(`messages/${id}?format=full`, token);
      const subject = header(msg.payload, 'subject');
      const code = extractCode(subject, bodyText(msg.payload));
      cache[id] = code
        ? { code, from: header(msg.payload, 'from').replace(/<.*>/, '').trim(), at: Number(msg.internalDate) }
        : null;
    }
    const hit = cache[id];
    if (hit) {
      await sessionSet('parsed', cache);
      return { status: 'found', id, ...hit };
    }
  }
  await sessionSet('parsed', cache);
  return { status: 'none' };
}

// ---------- clipboard + notifications ----------

async function copyToClipboard(text) {
  const url = 'src/offscreen.html';
  const existing = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (!existing.length) {
    await chrome.offscreen.createDocument({
      url,
      reasons: ['CLIPBOARD'],
      justification: 'Copy a 2FA code to the clipboard',
    });
  }
  await chrome.runtime.sendMessage({ target: 'offscreen', type: 'copy', text });
}

async function notifyOnce(hit) {
  const { notify } = await settings();
  if (!notify) return;
  const notified = await sessionGet('notified', []);
  if (notified.includes(hit.id)) return;
  await sessionSet('notified', [...notified, hit.id].slice(-50));
  chrome.notifications.create(`code:${hit.id}:${hit.code}`, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: `Code ${hit.code}`,
    message: hit.from ? `From ${hit.from}` : 'From your Gmail',
    buttons: [{ title: 'Copy code' }],
    priority: 2,
  });
}

chrome.notifications.onButtonClicked.addListener(async (nid) => {
  const [, id, code] = nid.split(':');
  await copyToClipboard(code);
  await markUsed(id);
  chrome.notifications.clear(nid);
});
chrome.notifications.onClicked.addListener(async (nid) => {
  const [, , code] = nid.split(':');
  await copyToClipboard(code);
  chrome.notifications.clear(nid);
});

async function markUsed(id) {
  const used = await sessionGet('used', []);
  if (!used.includes(id)) await sessionSet('used', [...used, id].slice(-100));
}

// ---------- messages from content script + popup ----------

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.target === 'offscreen') return false;
  (async () => {
    switch (msg.type) {
      case 'check': {
        const res = await findCode();
        if (res.status === 'found') await notifyOnce(res);
        return { ...res, settings: await settings() };
      }
      case 'checkInteractive':
        return findCode({ interactive: true });
      case 'used':
        await markUsed(msg.id);
        return { ok: true };
      case 'copy':
        await copyToClipboard(msg.code);
        if (msg.id) await markUsed(msg.id);
        return { ok: true };
      case 'signOut': {
        const token = await getToken(false);
        if (token) {
          await chrome.identity.removeCachedAuthToken({ token });
          fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`).catch(() => {});
        }
        await chrome.storage.session.clear();
        return { ok: true };
      }
      default:
        return { error: 'unknown' };
    }
  })().then(reply, (e) => reply({ status: 'error', message: e.message }));
  return true;
});
