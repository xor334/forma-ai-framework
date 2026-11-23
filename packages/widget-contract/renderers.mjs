import { resolveWidgets, layoutAt } from './contract.mjs';

function escape(value) {
  return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function link(action) {
  if (!action) return '';
  const href = action.kind === 'section' ? '#widget-' + action.target : 'mailto:' + action.target;
  return '<a href="' + escape(href) + '">' + escape(action.label) + '</a>';
}

function webWidget(widget) {
  const { type, props } = widget.content;
  const title = escape(props.title);
  let inner = '<h2>' + title + '</h2>';
  if (type === 'forma.hero') {
    inner = (props.eyebrow ? '<p class="eyebrow">' + escape(props.eyebrow) + '</p>' : '') + '<h1>' + title + '</h1>';
  }
  if (type === 'forma.image') {
    inner += '<img style="max-width:100%;height:auto" src="/media/' + escape(props.mediaHash) + '" alt="' + escape(props.alt) + '">';
  } else if (type === 'forma.menu') {
    inner += '<ul>' + props.items.map(item => '<li><span>' + escape(item.name) + '</span><b>' + item.priceRub + ' ₽</b></li>').join('') + '</ul>';
  } else {
    inner += '<p>' + escape(props.body ?? props.schedule) + '</p>' + link(props.action);
  }
  const styles = ['phone', 'tablet', 'wide'].flatMap(size => {
    const layout = layoutAt(widget.layout, size);
    const width = layout.widthPercent === undefined ? layout.span : layout.widthPercent + '%';
    return ['--' + size + ':' + width, '--a-' + size + ':' + layout.align, '--h-' + size + ':' + (layout.minHeightPx ?? 0) + 'px'];
  });
  return '<section class="' + type.split('.')[1] + '" id="widget-' + widget.id + '" style="' + styles.join(';') + '">' + inner + '</section>';
}

export const css = `
:root{color-scheme:light;font-family:system-ui,sans-serif;color:#292017;background:#f4f0e6}
*{box-sizing:border-box}body{margin:0}main{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:1rem;width:min(100% - 2rem,65rem);margin:1rem auto}
section{grid-column:span var(--phone);text-align:var(--a-phone);padding:clamp(1.25rem,4vw,3rem);border-radius:1.2rem;background:#fffaf1;overflow-wrap:anywhere}
.hero{color:#fffaf1;background:#392c25}.hours,.text{background:#dfcbb4}.cta{background:#dfe7d8}
h1,h2,p{margin:0}h1,h2{font-family:Georgia,serif;font-weight:500;line-height:1.08}h1{font-size:clamp(2.6rem,6vw,5.4rem);max-width:16ch}h2{font-size:clamp(1.6rem,3vw,2.5rem)}
p{margin:.9rem 0 0;line-height:1.55;max-width:54ch}.eyebrow{margin:0 0 1.2rem;letter-spacing:.13em;font-size:.72rem;font-weight:750}
a{display:inline-block;margin-top:1.2rem;padding:.75rem 1rem;border-radius:3rem;background:#2f3829;color:white;font-weight:650;text-decoration:none}.hero a{background:#e9be8e;color:#312317}
a:focus-visible{outline:3px solid #89721f;outline-offset:4px}ul{list-style:none;padding:0;margin:1rem 0 0}li{display:flex;gap:1rem;justify-content:space-between;border-top:1px solid #ddd2c2;padding:.75rem 0}li b{white-space:nowrap}
@media(min-width:48rem){section{grid-column:span var(--tablet);text-align:var(--a-tablet)}main{margin:2rem auto}}
@media(min-width:70rem){section{grid-column:span var(--wide);text-align:var(--a-wide)}}
.page-v2{display:flex;flex-wrap:wrap;gap:1rem 0;align-items:flex-start}.page-v2 section{margin-inline:.5rem;width:calc(var(--phone) - 1rem);min-height:var(--h-phone)}
@media(min-width:48rem){.page-v2 section{width:calc(var(--tablet) - 1rem);min-height:var(--h-tablet)}}
@media(min-width:70rem){.page-v2 section{width:calc(var(--wide) - 1rem);min-height:var(--h-wide)}}
`;

export function webSections(page, generation = 3) {
  return resolveWidgets(page, 'web', generation).map(webWidget).join('\n');
}

export function renderWeb(page, generation = 3) {
  const sections = webSections(page, generation);
  return '<!doctype html>\n<html lang="' + escape(page.locale) + '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' +
    escape(page.title) + '</title><style>' + css + '</style></head><body><main class="page-v' + page.schemaVersion + '">' + sections + '</main></body></html>\n';
}

// Declarative adapter output. An actual RN/Expo screen implements these primitives and actions.
export function nativeViewModel(page, target, { size = 'phone', generation = 3 } = {}) {
  if (!['ios', 'android'].includes(target)) throw new Error('Ожидается ios или android');
  const widgets = resolveWidgets(page, target, generation).map(({ id, content, layout }) => {
    const { props } = content;
    const children = [];
    if (props.eyebrow) children.push({ component: 'Text', text: props.eyebrow });
    children.push({ component: 'Text', accessibilityRole: 'header', text: props.title });
    if (content.type === 'forma.image') {
      children.push({component:'Image',path:'/media/'+props.mediaHash,alt:props.alt});
    } else if (props.items) {
      for (const item of props.items) children.push({ component: 'Text', text: item.name + ' · ' + item.priceRub + ' ₽' });
    } else {
      children.push({ component: 'Text', text: props.body ?? props.schedule });
    }
    if (props.action) children.push({ component: 'Pressable', accessibilityRole: 'button', label: props.action.label, action: { ...props.action } });
    return { component: 'View', testID: id, layout: layoutAt(layout, size), children };
  });
  return { platform: target, pageId: page.pageId, root: 'ScrollView', widgets };
}
