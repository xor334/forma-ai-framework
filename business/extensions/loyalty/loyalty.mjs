import { validatePage } from '../../../packages/widget-contract/contract.mjs';

const fields = ['type', 'version', 'widgetId', 'title', 'pointsPerOrder', 'rewardCost', 'reward'];

function validateOffer(offer) {
  if (!offer || typeof offer !== 'object' || Array.isArray(offer)) throw new Error('Ожидается объект предложения');
  for (const key of Object.keys(offer)) {
    if (!fields.includes(key)) throw new Error('Неизвестное поле ' + key);
  }
  if (offer.type !== 'coffee.loyalty' || offer.version !== 1) throw new Error('Нужен тип coffee.loyalty версии 1');
  if (typeof offer.widgetId !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(offer.widgetId)) throw new Error('Некорректный widgetId');
  for (const field of ['pointsPerOrder', 'rewardCost']) {
    if (!Number.isInteger(offer[field]) || offer[field] < 1 || offer[field] > 10000) throw new Error(field + ' должно быть целым числом от 1 до 10000');
  }
  for (const field of ['title', 'reward']) {
    if (typeof offer[field] !== 'string' || !offer[field].trim() || [...offer[field]].length > 100 ||
        /[\u0000-\u001f\u007f]/u.test(offer[field])) throw new Error('Некорректный текст в поле ' + field);
  }
}

// Compose a new draft from the source on each build. validatePage also rejects an occupied widget ID.
export function withLoyaltyOffer(page, offer) {
  validateOffer(offer);
  validatePage(page);
  const orders = Math.ceil(offer.rewardCost / offer.pointsPerOrder);
  const plural = new Intl.PluralRules('ru');
  const noun = (number, one, few, many) => ({ one, few, many })[plural.select(number)] || many;
  const points = value => value + ' ' + noun(value, 'балл', 'балла', 'баллов');
  const body = 'За каждый заказ начисляем ' + points(offer.pointsPerOrder) + '. ' +
    'Награда за ' + points(offer.rewardCost) + ' — ' + offer.reward.trim() + '. ' +
    'Чтобы накопить с нуля, потребуется ' + orders + ' ' + noun(orders, 'заказ', 'заказа', 'заказов') + '.';
  const widget = {
    id: offer.widgetId,
    required: true,
    targets: ['web', 'ios', 'android'],
    layout: { phone: { span: 12 } },
    content: { type: 'forma.text', version: 1, props: { title: offer.title.trim(), body } }
  };
  return validatePage({ ...page, widgets: [...page.widgets, widget] });
}
