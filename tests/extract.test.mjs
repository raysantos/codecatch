import { extractCode, htmlToText } from '../src/extract.js';
import assert from 'node:assert/strict';

const cases = [
  ['G-482913 is your Google verification code', '', '482913'],
  ['Your Amazon verification code', 'Your one-time password is: 739201. Do not share it.', '739201'],
  ['Sign in to Microsoft', 'Security code: 5521\nIf you didn\'t request this, ignore it.', '5521'],
  ['Your login code', 'Use 123 456 to sign in. It expires in 10 minutes.', '123456'],
  ['Order #558812 shipped', 'Your order 558812 is on the way. Total $129.00', null],
  ['Your receipt', 'Thanks for your payment of $2024. Account ending in 4417.', null],
  ['Verify your email', 'Enter this code: AB3D9K to continue', 'AB3D9K'],
  ['Your verification code', 'Copyright 2026 Example Inc. Your code is 840117. Call 800-555-1212 for help.', '840117'],
  ['Weekly newsletter', 'Here are 12345 reasons to read on.', null],
];

let pass = 0;
for (const [subject, body, expected] of cases) {
  const got = extractCode(subject, body);
  assert.equal(got, expected, `"${subject}" → expected ${expected}, got ${got}`);
  pass++;
}

const html = '<html><style>.x{}</style><p>Your code is</p><p><b>906413</b></p></html>';
assert.equal(extractCode('Verification', htmlToText(html)), '906413');
pass++;

console.log(`${pass} extractor tests passed`);
