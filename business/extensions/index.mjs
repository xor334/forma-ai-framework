import { withLoyaltyOffer } from './loyalty/loyalty.mjs'
import { validatePage } from '../../packages/widget-contract/contract.mjs'

// A fork registers its trusted adapters here. Stored documents contain only data.
const adapters = new Map([['coffee.loyalty@1', withLoyaltyOffer]])
export function compileExtensions(page, offers) {
  if (!Array.isArray(offers)) throw Error('Конфигурация расширений должна быть массивом')
  let compiled = structuredClone(page)
  for (const offer of offers) {
    const name = offer?.type + '@' + offer?.version,
      apply = adapters.get(name)
    if (!apply) throw Error('Расширение не зарегистрировано: ' + name)
    compiled = validatePage(apply(compiled, offer))
  }
  return compiled
}
