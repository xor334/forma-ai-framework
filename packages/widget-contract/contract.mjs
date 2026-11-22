import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const schema = JSON.parse(readFileSync(new URL('./page.schema.json', import.meta.url), 'utf8'));
export const targets = Object.freeze(['web', 'ios', 'android']);
const currentRegistry = new Set(['forma.hero@1', 'forma.menu@1', 'forma.cta@1', 'forma.text@1', 'forma.hours@2']);

// Enforce the keywords used by our bundled schema. This is not a general-purpose JSON Schema engine.
function check(rule, value, path) {
  const fail = reason => { throw new TypeError(path + ' — ' + reason); };
  const object = value !== null && typeof value === 'object' && !Array.isArray(value);
  if (rule.$ref) {
    const key = rule.$ref.split('/').at(-1);
    return check(schema.$defs[key], value, path);
  }
  if (Object.hasOwn(rule, 'const') && value !== rule.const) fail('ожидается ' + rule.const);
  if (rule.enum && !rule.enum.includes(value)) fail('ожидается одно из ' + rule.enum.join(', '));
  if (rule.type === 'array') {
    if (!Array.isArray(value)) fail('ожидается массив');
    if (value.length < rule.minItems || value.length > rule.maxItems) fail('недопустимая длина массива');
    if (rule.uniqueItems && new Set(value).size !== value.length) fail('повторяющиеся значения');
    value.forEach((item, i) => check(rule.items, item, path + '[' + i + ']'));
  } else if (rule.type === 'object' && !object) {
    fail('ожидается объект');
  } else if (rule.type === 'integer') {
    if (!Number.isInteger(value) || value < rule.minimum || value > rule.maximum) fail('целое число вне диапазона');
  } else if (rule.type === 'string') {
    if (typeof value !== 'string') fail('ожидается строка');
    const length = [...value].length;
    if (length < rule.minLength || length > rule.maxLength) fail('недопустимая длина строки');
    if (rule.pattern && !new RegExp(rule.pattern, 'u').test(value)) fail('неверный формат');
  } else if (rule.type === 'boolean' && typeof value !== 'boolean') {
    fail('ожидается логическое значение');
  }
  if (object && rule.properties) {
    for (const key of rule.required || []) {
      if (!Object.hasOwn(value, key)) fail('отсутствует поле ' + key);
    }
    for (const key of Object.keys(value)) {
      if (Object.hasOwn(rule.properties, key)) check(rule.properties[key], value[key], path + '.' + key);
      else if (rule.additionalProperties === false) fail('неизвестное поле ' + key);
    }
  }
  for (const nested of rule.allOf || []) check(nested, value, path);
  if (rule.if) {
    let matches = true;
    try { check(rule.if, value, path); } catch { matches = false; }
    if (matches) check(rule.then, value, path);
  }
}

export function validatePage(page) {
  check(schema, page, 'page');
  const ids = new Set();
  for (const widget of page.widgets) {
    if (ids.has(widget.id)) throw new Error('Повторяется ID виджета ' + widget.id);
    ids.add(widget.id);
  }
  return page;
}

export function registryFor(target, generation = 2) {
  if (!targets.includes(target)) throw new Error('Неизвестная платформа ' + target);
  if (![1, 2].includes(generation)) throw new Error('Неизвестное поколение клиента');
  const registry = new Set(currentRegistry);
  if (generation === 1) registry.delete('forma.hours@2');
  return registry;
}

function contentKey(content) {
  return content.type + '@' + content.version;
}

export function resolveWidgets(page, target, generation = 2) {
  validatePage(page);
  const registry = registryFor(target, generation);
  const resolved = [];
  for (const widget of page.widgets) {
    if (!widget.targets.includes(target)) continue;
    let content = widget.content;
    if (!registry.has(contentKey(content))) {
      if (widget.required) throw new Error(target + ': нет обязательного ' + contentKey(content));
      if (!widget.fallback || !registry.has(contentKey(widget.fallback))) continue;
      content = widget.fallback;
    }
    resolved.push({ id: widget.id, layout: widget.layout, content });
  }
  const ids = new Set(resolved.map(widget => widget.id));
  for (const widget of resolved) {
    const action = widget.content.props.action;
    if (action?.kind === 'section' && !ids.has(action.target)) {
      throw new Error(target + ': ссылка ' + widget.id + ' ведёт в отсутствующий раздел ' + action.target);
    }
  }
  return resolved;
}

// Breakpoints inherit omitted properties from narrower layouts.
export function layoutAt(layout, size) {
  if (!['phone', 'tablet', 'wide'].includes(size)) throw new Error('Неизвестный размер окна');
  const result = { align: 'start', ...layout.phone };
  if (size !== 'phone') Object.assign(result, layout.tablet);
  if (size === 'wide') Object.assign(result, layout.wide);
  return result;
}

function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  }
  if (value === null || ['string', 'boolean'].includes(typeof value) || Number.isFinite(value)) return JSON.stringify(value);
  throw new Error('Релиз принимает только данные JSON');
}

function freezeTree(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeTree(child);
    Object.freeze(value);
  }
  return value;
}

function snapshot(page) {
  const data = canonical(page);
  const digest = createHash('sha256').update(data, 'utf8').digest('hex');
  return freezeTree({ format: 'forma.release/1', id: 'sha256:' + digest, page: JSON.parse(data) });
}

// The reference fork supports the current browser and two installed app generations.
export function makeRelease(page, supported = { web: [2], ios: [1, 2], android: [1, 2] }) {
  for (const target of targets) {
    const generations = supported[target];
    if (!Array.isArray(generations) || !generations.length) throw new Error('Нет профиля выпуска ' + target);
    for (const generation of generations) resolveWidgets(page, target, generation);
  }
  return snapshot(page);
}

export function verifyRelease(release) {
  if (!release || release.format !== 'forma.release/1' || typeof release.id !== 'string') throw new Error('Неверный формат релиза');
  const rebuilt = snapshot(validatePage(release.page));
  if (rebuilt.id !== release.id) throw new Error('Содержимое релиза изменено');
  return rebuilt;
}
