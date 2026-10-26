// Service workers can't touch the clipboard, so this hidden page does it.
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.target !== 'offscreen' || msg.type !== 'copy') return false;
  const t = document.getElementById('t');
  t.value = msg.text;
  t.select();
  document.execCommand('copy');
  t.value = '';
  reply({ ok: true });
  return false;
});
