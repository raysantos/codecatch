const $ = (id) => document.getElementById(id);
const DEFAULTS = { autoFill: false, notify: true, lookbackMinutes: 3 };
let current = null;

function render(res) {
  const signedIn = res.status !== 'signed-out';
  $('signedOut').hidden = signedIn;
  $('signedIn').hidden = !signedIn;
  $('signOut').hidden = !signedIn;
  $('status').textContent = signedIn ? 'Gmail connected' : 'Not connected';
  $('status').classList.toggle('on', signedIn);

  current = res.status === 'found' ? res : null;
  $('codeCard').hidden = !current;
  $('empty').hidden = res.status !== 'none';
  if (res.status === 'error') { $('empty').hidden = false; $('empty').textContent = `Couldn't reach Gmail (${res.message}).`; }
  if (current) {
    $('code').textContent = current.code;
    const mins = Math.max(0, Math.round((Date.now() - current.at) / 60000));
    $('from').textContent = `${current.from || 'Gmail'} · ${mins ? `${mins} min ago` : 'just now'}`;
  }
}

async function check(interactive = false) {
  $('check').textContent = 'Checking…';
  const res = await chrome.runtime.sendMessage({ type: interactive ? 'checkInteractive' : 'check' });
  $('check').textContent = 'Check now';
  render(res || { status: 'error', message: 'no response' });
}

$('connect').onclick = () => check(true);
$('check').onclick = () => check(false);
$('copy').onclick = async () => {
  if (!current) return;
  await navigator.clipboard.writeText(current.code);
  chrome.runtime.sendMessage({ type: 'used', id: current.id });
  $('copy').textContent = 'Copied';
  setTimeout(() => window.close(), 700);
};
$('signOut').onclick = async () => {
  await chrome.runtime.sendMessage({ type: 'signOut' });
  render({ status: 'signed-out' });
};

chrome.storage.sync.get(DEFAULTS).then((s) => {
  $('autoFill').checked = s.autoFill;
  $('notify').checked = s.notify;
  $('lookbackMinutes').value = String(s.lookbackMinutes);
});
for (const id of ['autoFill', 'notify']) {
  $(id).onchange = () => chrome.storage.sync.set({ [id]: $(id).checked });
}
$('lookbackMinutes').onchange = () => chrome.storage.sync.set({ lookbackMinutes: Number($('lookbackMinutes').value) });

check(false);
