import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { layoutAt, makeRelease, resolveWidgets, validatePage, verifyRelease } from './contract.mjs';
import { nativeViewModel, renderWeb } from './renderers.mjs';

const fixtureURL = new URL('../../examples/coffee/page.json', import.meta.url);
const releaseURL = new URL('../../examples/coffee/release.json', import.meta.url);
const fixture = () => JSON.parse(readFileSync(fixtureURL, 'utf8'));

test('example validates and keys stay stable across all three render targets', () => {
  const page = validatePage(fixture());
  const ids = page.widgets.map(w => w.id);
  for (const target of ['web', 'ios', 'android']) {
    assert.deepEqual(resolveWidgets(page, target).map(w => w.id), ids);
  }
  assert.equal(nativeViewModel(page, 'android').widgets[0].children.at(-1).component, 'Pressable');
  assert.equal(nativeViewModel(page, 'ios').widgets[0].children.at(-1).action.target, 'home-menu');
});

test('mobile defaults and wider overrides inherit per property', () => {
  const layout = { phone: { span: 12, align: 'center' }, tablet: { span: 8 }, wide: { span: 6, align: 'end' } };
  assert.deepEqual(layoutAt(layout, 'phone'), { span: 12, align: 'center' });
  assert.deepEqual(layoutAt(layout, 'tablet'), { span: 8, align: 'center' });
  assert.deepEqual(layoutAt(layout, 'wide'), { span: 6, align: 'end' });
});

test('previous app generation uses supported fallback, unsupported optional without fallback is skipped', () => {
  const page = fixture();
  const primaryType = resolveWidgets(page, 'android', 2).find(w => w.id === 'home-hours').content.type;
  assert.equal(primaryType, 'forma.hours');
  const oldWidget = resolveWidgets(page, 'android', 1).find(w => w.id === 'home-hours');
  assert.equal(oldWidget.content.type, 'forma.text');
  assert.match(nativeViewModel(page, 'ios', { generation: 1 }).widgets[2].children[1].text, /выходным/);
  delete page.widgets[2].fallback;
  assert.equal(resolveWidgets(page, 'ios', 1).length, 3);
});

test('required missing renderer stops its target; excluded target can still resolve', () => {
  const page = fixture();
  const hours = page.widgets[2];
  hours.required = true;
  assert.throws(() => resolveWidgets(page, 'ios', 1), /обязательного/);
  hours.content.type = 'fork.unimplemented';
  hours.targets = ['android'];
  assert.equal(resolveWidgets(page, 'ios', 1).length, 3);
  assert.throws(() => makeRelease(page), /android.*обязательного/);
});

test('publishing checks installed app generations while single-target previews remain available', () => {
  const page = fixture();
  page.widgets[2].required = true;
  assert.doesNotThrow(() => renderWeb(page));
  assert.throws(() => makeRelease(page), /ios.*обязательного/);
  assert.doesNotThrow(() => makeRelease(page, { web: [2], ios: [2], android: [2] }));
});

test('invalid widget data, duplicate IDs, invalid responsive sizes and unsupported actions are rejected', () => {
  for (const change of [
    p => { p.widgets[1].id = p.widgets[0].id; },
    p => { p.widgets[0].layout.phone.span = 18; },
    p => { p.widgets[1].content.props.items[0].priceRub = '230'; },
    p => { p.widgets[0].content.props.action.kind = 'execute'; },
    p => { p.widgets[3].content.props.action.target = 'orders@example.com?bcc=other@example.com'; },
    p => { p.schemaVersion = 50; },
    p => { p.widgets[0].content.props.script = 'untrusted'; }
  ]) {
    const page = fixture(); change(page); assert.throws(() => validatePage(page));
  }
});

test('section action must resolve after target filtering', () => {
  const page = fixture();
  page.widgets[1].targets = ['web', 'android'];
  assert.throws(() => resolveWidgets(page, 'ios'), /отсутствующий раздел/);
  assert.match(renderWeb(page), /href="#widget-home-menu"/);
});

test('public HTML escapes strings and renders offline; native keeps safe text as data', () => {
  const page = fixture();
  page.widgets[0].content.props.title = '<script>alert("x")</script>';
  const html = renderWeb(page);
  assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script|<iframe|src="https?:/i);
  const native = nativeViewModel(page, 'ios').widgets[0].children;
  assert.equal(native.find(n => n.accessibilityRole === 'header').text, page.widgets[0].content.props.title);
});

test('release matches pinned fixture, ignores input key order, detects modified content and isolates draft', () => {
  const page = fixture();
  const release = makeRelease(page);
  assert.deepEqual(release, verifyRelease(JSON.parse(readFileSync(releaseURL, 'utf8'))));
  const reordered = Object.fromEntries(Object.entries(page).reverse());
  assert.equal(makeRelease(reordered).id, release.id);
  page.widgets[0].content.props.title = 'Новый черновик';
  assert.notEqual(page.widgets[0].content.props.title, release.page.widgets[0].content.props.title);
  assert.throws(() => { release.page.widgets[0].id = 'other'; }, TypeError);
  const modified = JSON.parse(JSON.stringify(release));
  modified.page.title = 'Другая страница';
  assert.throws(() => verifyRelease(modified), /изменено/);
});

test('render CLI writes an autonomous UTF-8 page to stdout', () => {
  const cli = fileURLToPath(new URL('./render.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [cli, fileURLToPath(fixtureURL)], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, renderWeb(fixture()));
  assert.match(result.stdout, /Капучино/);
});
