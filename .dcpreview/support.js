// Throwaway stand-in for the canvas runtime, only used to eyeball the artboards locally.
(function () {
  class DCLogic {
    constructor(props) { this.props = props || {}; this.state = {}; }
    setState(patch) { this.state = Object.assign({}, this.state, patch); window.__dcRender && window.__dcRender(); }
  }
  window.DCLogic = DCLogic;

  function getPath(scope, path) {
    const p = path.trim();
    if (p === 'true') return true;
    if (p === 'false') return false;
    return p.split('.').reduce(function (o, k) { return (o === null || o === undefined) ? undefined : o[k]; }, scope);
  }

  function subst(str, scope) {
    return str.replace(/\{\{([^}]*)\}\}/g, function (m, p) {
      const v = getPath(scope, p);
      return (v === undefined || v === null) ? '' : String(v);
    });
  }

  function render(tpl, scope) {
    const frag = document.createDocumentFragment();
    Array.prototype.forEach.call(tpl.childNodes, function (n) {
      if (n.nodeType === 3) { frag.appendChild(document.createTextNode(subst(n.nodeValue, scope))); return; }
      if (n.nodeType !== 1) return;
      const tag = n.localName.toLowerCase();
      if (tag === 'sc-if') {
        if (getPath(scope, n.getAttribute('value').replace(/[{}]/g, ''))) frag.appendChild(render(n, scope));
        return;
      }
      if (tag === 'sc-for') {
        const list = getPath(scope, n.getAttribute('list').replace(/[{}]/g, '')) || [];
        const as = n.getAttribute('as');
        list.forEach(function (item, i) {
          const s2 = Object.create(scope);
          s2[as] = item; s2.$index = i;
          frag.appendChild(render(n, s2));
        });
        return;
      }
      const el = document.createElementNS(n.namespaceURI, n.localName);
      Array.prototype.forEach.call(n.attributes, function (a) {
        if (a.name.toLowerCase() === 'onclick') {
          const fn = getPath(scope, a.value.replace(/[{}]/g, ''));
          if (typeof fn === 'function') el.addEventListener('click', fn);
          return;
        }
        el.setAttribute(a.name, subst(a.value, scope));
      });
      el.appendChild(render(n, scope));
      frag.appendChild(el);
    });
    return frag;
  }

  window.addEventListener('DOMContentLoaded', function () {
    const dc = document.querySelector('x-dc');
    const helmet = dc.querySelector('helmet');
    if (helmet) { document.head.insertAdjacentHTML('beforeend', helmet.innerHTML); helmet.remove(); }
    const tpl = dc.cloneNode(true);
    dc.remove();

    const scriptEl = document.querySelector('script[data-dc-script]');
    const decl = JSON.parse(scriptEl.getAttribute('data-props') || '{}');
    const q = new URLSearchParams(location.search);
    const props = {};
    Object.keys(decl).forEach(function (k) { props[k] = q.get(k) || decl[k].default; });

    const Comp = eval('(function(){' + scriptEl.textContent + '; return Component;})()');
    const inst = new Comp(props);

    const host = document.createElement('div');
    host.id = 'dc-host';
    document.body.appendChild(host);

    window.__dcRender = function () {
      const vals = inst.renderVals();
      host.innerHTML = '';
      host.appendChild(render(tpl, vals));
    };
    window.__dcRender();
  });
})();
