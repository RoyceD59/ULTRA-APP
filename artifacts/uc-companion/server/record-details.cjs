const { articleInlineLinks } = require('@workspace/api-zod/blog-inline-links-core');

/** Render the same authored sections without depending on app JavaScript.
 * Only public editorial fields are accepted; operations/contact data are not.
 */
function renderRecordDetails(record, escape) {
  const label = key => key.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, c => c.toUpperCase());
  const inline = value => articleInlineLinks(String(value)).map(part =>
    part.kind === 'link' ? `<a href="${escape(part.url)}">${escape(part.text)}</a>` : escape(part.text)).join('');
  const render = (value, depth = 0) => {
    if (value == null || value === '' || depth > 8) return '';
    if (Array.isArray(value)) {
      const items = value.map(item => render(item, depth + 1)).filter(Boolean);
      return items.length ? `<ul>${items.map(item => `<li>${item}</li>`).join('')}</ul>` : '';
    }
    if (typeof value === 'object') {
      return Object.entries(value).filter(([, v]) => v != null && v !== '')
        .map(([key, v]) => {
          const content = render(v, depth + 1);
          return content ? `<div><strong>${escape(label(key))}</strong>${content}</div>` : '';
        }).join('');
    }
    return `<p>${inline(value)}</p>`;
  };
  const sections = [
    ['Benefits', record.benefits],
    ['Suitability', record.suitability],
    ['Evidence and limits', { claims: record.claims, limits: record.evidenceLimits }],
    ['Package and setup', record.package],
    ['Ownership and replacement costs', record.ownership],
    ['Service and support', record.service],
    ['Reference estimate', record.savings],
  ].map(([title, value]) => {
    const content = render(value);
    return content ? `<section><h2>${escape(title)}</h2>${content}</section>` : '';
  }).join('');
  const questions = Array.isArray(record.faq) ? record.faq.filter(item => item.q && item.a)
    .map(item => `<details><summary>${escape(item.q)}</summary>${render(item.a)}</details>`).join('') : '';
  return sections + (questions ? `<section><h2>Questions and answers</h2>${questions}</section>` : '');
}
module.exports = { renderRecordDetails };
