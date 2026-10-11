const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const script = readFileSync('index.html', 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
const snapshot = JSON.parse(readFileSync('factory-health/data.json', 'utf8'));
async function render(data, ok = true) {
  class Element {
    constructor() { this.children = []; this.textContent = ''; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; }
    setAttribute() {}
  }
  const elements = new Map();
  const document = {
    getElementById(id) { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); },
    createElement() { return new Element(); },
  };
  const calls = [];
  await vm.runInNewContext(script, { document, Intl, Date, fetch: async (...args) => {
    calls.push(args); return { ok, json: async () => data };
  } });
  return { elements, calls };
}
function text(element) { return [element.textContent, ...element.children.map(text)].join(' '); }
test('valid snapshot renders all buckets and unavailable attribution without formatter errors', async () => {
  const data = structuredClone(snapshot);
  data.published_at = data.installations[0].observed_at = new Date(Date.now() - 1000).toISOString();
  const { elements, calls } = await render(data);
  assert.equal(elements.get('status').textContent, 'Latest published snapshot loaded.');
  assert.notEqual(elements.get('published').textContent, 'Unavailable');
  for (const label of ['REST core', 'GraphQL', 'Search', 'Observed 24h low']) assert.match(text(elements.get('budgets')), new RegExp(label));
  for (const id of ['consumers', 'actions', 'models']) assert.equal(elements.get(id).textContent, 'Unavailable');
  assert.deepEqual(calls.map(c => c[0]), ['./factory-health/data.json']);
});
test('fresh publication cannot hide stale or missing observations', async () => {
  for (const observed of [new Date(Date.now() - 3 * 3600000).toISOString(), undefined]) {
    const data = structuredClone(snapshot);
    data.published_at = new Date(Date.now() - 1000).toISOString();
    data.installations[0].observed_at = observed;
    const { elements } = await render(data);
    assert.match(elements.get('status').textContent, /stale/);
  }
});
test('HTTP failure and invalid schema visibly report unavailable telemetry', async () => {
  for (const [data, ok] of [[snapshot, false], [{ schema_version: 2 }, true]]) {
    const { elements } = await render(data, ok);
    assert.match(elements.get('status').textContent, /Telemetry unavailable/);
  }
});
