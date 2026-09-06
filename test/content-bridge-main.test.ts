// Tests the page-world bridge's trust boundary: it must act only on same-window, same-origin, correctly-shaped messages on its own channel, and must never throw on garbage input.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BRIDGE_CHANNEL, handleBridgeMessage } from '../src/content/bridge-main.ts';

interface FakeInstance {
  setData(html: string): void;
  getData(): string;
}

function makeInstance(initial = ''): FakeInstance {
  let data = initial;
  return {
    setData(html: string) { data = html; },
    getData() { return data; },
  };
}

interface FakeWindow {
  location: { origin: string };
  addEventListener: () => void;
  postMessage: (message: unknown, targetOrigin: string) => void;
  CKEDITOR?: { instances?: Record<string, FakeInstance | undefined> };
}

function fakeWin(origin: string, instances: Record<string, FakeInstance | undefined>): { win: FakeWindow; posted: { message: unknown; targetOrigin: string }[] } {
  const posted: { message: unknown; targetOrigin: string }[] = [];
  const win: FakeWindow = {
    location: { origin },
    addEventListener: () => {},
    postMessage: (message, targetOrigin) => { posted.push({ message, targetOrigin }); },
    CKEDITOR: { instances },
  };
  return { win, posted };
}

const REQUEST = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  channel: BRIDGE_CHANNEL,
  direction: 'request',
  id: 7,
  op: 'setEditorData',
  key: 'attribute138_Content',
  html: '<p>hi</p>',
  ...overrides,
});

test('handles a valid request: sets the editor data and replies to the page origin, never "*"', () => {
  const inst = makeInstance();
  const { win, posted } = fakeWin('https://ubuffalo.teamdynamix.com', { attribute138_Content: inst });

  handleBridgeMessage(win, { source: win, origin: win.location.origin, data: REQUEST() });

  assert.equal(inst.getData(), '<p>hi</p>');
  assert.equal(posted.length, 1);
  assert.equal(posted[0]?.targetOrigin, 'https://ubuffalo.teamdynamix.com');
  assert.notEqual(posted[0]?.targetOrigin, '*');
  const reply = posted[0]?.message as { ok: boolean; id: number; channel: string; direction: string };
  assert.equal(reply.ok, true);
  assert.equal(reply.id, 7);
  assert.equal(reply.channel, BRIDGE_CHANNEL);
  assert.equal(reply.direction, 'response');
});

test('ignores a message from a different origin', () => {
  const inst = makeInstance();
  const { win, posted } = fakeWin('https://ubuffalo.teamdynamix.com', { attribute138_Content: inst });

  handleBridgeMessage(win, { source: win, origin: 'https://evil.example', data: REQUEST() });

  assert.equal(inst.getData(), '');
  assert.equal(posted.length, 0);
});

test('ignores a message whose source is not this window', () => {
  const inst = makeInstance();
  const { win, posted } = fakeWin('https://ubuffalo.teamdynamix.com', { attribute138_Content: inst });

  handleBridgeMessage(win, { source: {}, origin: win.location.origin, data: REQUEST() });

  assert.equal(inst.getData(), '');
  assert.equal(posted.length, 0);
});

test('ignores a message on a different channel', () => {
  const inst = makeInstance();
  const { win, posted } = fakeWin('https://ubuffalo.teamdynamix.com', { attribute138_Content: inst });

  handleBridgeMessage(win, { source: win, origin: win.location.origin, data: REQUEST({ channel: 'not-tdxa' }) });

  assert.equal(inst.getData(), '');
  assert.equal(posted.length, 0);
});

test('reports failure for an unknown instance key instead of throwing', () => {
  const { win, posted } = fakeWin('https://ubuffalo.teamdynamix.com', {});

  handleBridgeMessage(win, { source: win, origin: win.location.origin, data: REQUEST({ key: 'missing' }) });

  assert.equal(posted.length, 1);
  const reply = posted[0]?.message as { ok: boolean; detail: string };
  assert.equal(reply.ok, false);
  assert.match(reply.detail, /no CKEDITOR instance/);
});

test('ignores malformed payloads without throwing and without replying', () => {
  const { win, posted } = fakeWin('https://ubuffalo.teamdynamix.com', {});

  assert.doesNotThrow(() => {
    handleBridgeMessage(win, { source: win, origin: win.location.origin, data: null });
    handleBridgeMessage(win, { source: win, origin: win.location.origin, data: REQUEST({ id: 'not-a-number' }) });
    handleBridgeMessage(win, { source: win, origin: win.location.origin, data: REQUEST({ html: 42 }) });
    handleBridgeMessage(win, { source: win, origin: win.location.origin, data: 'just a string' });
    handleBridgeMessage(win, { source: win, origin: win.location.origin, data: REQUEST({ op: 'evalArbitraryCode' }) });
  });

  assert.equal(posted.length, 0);
});
