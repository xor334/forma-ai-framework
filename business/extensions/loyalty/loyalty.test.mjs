import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { withLoyaltyOffer } from './loyalty.mjs';
import { makeRelease } from '../../../packages/widget-contract/contract.mjs';
import { nativeViewModel, renderWeb } from '../../../packages/widget-contract/renderers.mjs';

const json = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const draft = () => json('../../../examples/coffee/page.json');
const offer = () => json('./offer.json');

test('merchant source compiles deterministically to public built-ins across Web/iOS/Android', () => {
  const page = draft();
  const original = JSON.stringify(page);
  const compiled = withLoyaltyOffer(page, offer());
  assert.equal(JSON.stringify(page), original);
  assert.deepEqual(withLoyaltyOffer(page, offer()), compiled);
  const release = makeRelease(compiled);
  const node = release.page.widgets.at(-1);
  assert.equal(node.id, 'home-loyalty');
  assert.equal(node.content.type, 'forma.text');
  assert.match(node.content.props.body, /5 заказов/);
  assert.doesNotMatch(JSON.stringify(release), /coffee\.loyalty|pointsPerOrder|rewardCost/);
  assert.match(renderWeb(compiled), /Программа «Своя чашка»/);
  for (const target of ['ios', 'android']) {
    const widget = nativeViewModel(compiled, target, {generation: 1}).widgets.at(-1);
    assert.equal(widget.testID, node.id);
    assert.match(widget.children.at(-1).text, /100 баллов/);
  }
});

test('rounding, singular reward and edited offer change the published revision', () => {
  const source = offer();
  const next = withLoyaltyOffer(draft(), { ...source, pointsPerOrder: 40, rewardCost: 90 });
  assert.match(next.widgets.at(-1).content.props.body, /3 заказа/);
  assert.match(withLoyaltyOffer(draft(), { ...source, rewardCost: 20 }).widgets.at(-1).content.props.body, /1 заказ\./);
  assert.notEqual(makeRelease(next).id, makeRelease(withLoyaltyOffer(draft(), source)).id);
});

test('invalid business settings and collisions fail before publication', () => {
  for (const patch of [{ version: 2 }, { pointsPerOrder: 0 }, { rewardCost: 1.5 }, { title: ' ' }, { privateData: 'x' }, { widgetId: 'home-menu' }]) {
    assert.throws(() => withLoyaltyOffer(draft(), { ...offer(), ...patch }));
  }
});
