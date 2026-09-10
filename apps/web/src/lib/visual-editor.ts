const EDITOR_SCRIPT_PATH = '/__sovereign_edit.js';
const AXE_SCRIPT_PATH = '/__sovereign_axe.js';
export const A11Y_MESSAGE_SOURCE = 'sovereign-a11y';
export const A11Y_MAX_ISSUES = 25;
export const A11Y_MAX_CHARS = 4000;

function overlayScriptTag(src: string): string {
  return `<script src="${src}"></script>`;
}

/** Patches the WC copy of index.html only — never persist the result as a ProjectFile. */
export function instrumentPreviewHtml(content: string): string {
  let tags = '';
  if (!content.includes(EDITOR_SCRIPT_PATH)) tags += overlayScriptTag(EDITOR_SCRIPT_PATH);
  if (!content.includes(AXE_SCRIPT_PATH)) tags += overlayScriptTag(AXE_SCRIPT_PATH);
  if (!tags) return content;
  const bodyClose = content.match(/<\/body\s*>/i);
  if (!bodyClose || bodyClose.index === undefined) return `${content}${tags}`;
  return `${content.slice(0, bodyClose.index)}${tags}${content.slice(bodyClose.index)}`;
}

function visualEditorRuntime() {
  const MESSAGE_SOURCE = 'sovereign-visual-editor';
  const getParentOrigin = () => {
    try {
      const o = window.parent.location.origin;
      return o && o !== 'null' ? o : '*';
    } catch {
      return '*';
    }
  };
  const UI_ID = 'sovereign-editor-ui';
  let enabled = false;
  let hovered: Element | null = null;
  let selected: Element | null = null;

  const style = document.createElement('style');
  style.textContent = `
    [data-sovereign-hovered]{outline:2px dashed #b8ff5a!important;outline-offset:2px!important;box-shadow:0 0 8px rgba(184,255,90,.35)!important}
    [data-sovereign-selected]{outline:2px solid #b8ff5a!important;outline-offset:2px!important;box-shadow:0 0 0 3px rgba(184,255,90,.25),0 0 16px rgba(184,255,90,.3)!important}
    html[data-sovereign-edit-mode] body *:not(#${UI_ID}):not(#${UI_ID} *){cursor:crosshair!important}
    #${UI_ID}{position:fixed;z-index:2147483647;width:min(430px,calc(100vw - 24px));font:13px/1.35 Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;color:#f7f7f5;filter:drop-shadow(0 16px 32px rgba(0,0,0,.6));display:none}
    #${UI_ID}[data-open]{display:block}
    #${UI_ID} *{box-sizing:border-box;cursor:default!important}
    #${UI_ID} .sv-label{position:absolute;left:0;bottom:calc(100% + 5px);padding:3px 8px;border-radius:6px 6px 0 0;background:#b8ff5a;color:#10130c;font:600 11px/16px ui-monospace,SFMono-Regular,monospace;letter-spacing:.02em;box-shadow:0 -2px 8px rgba(184,255,90,.2)}
    #${UI_ID} .sv-tools{display:flex;gap:4px;overflow-x:auto;padding:6px;border:1px solid rgba(255,255,255,.14);border-bottom:0;border-radius:14px 14px 0 0;background:#161618;scrollbar-width:none}
    #${UI_ID} .sv-tools::-webkit-scrollbar{display:none}
    #${UI_ID} .sv-tool{border:1px solid transparent;border-radius:8px;background:rgba(255,255,255,.05);padding:6px 10px;color:#b8b8b2;font:500 11px/1 system-ui;white-space:nowrap;transition:all 0.15s ease}
    #${UI_ID} .sv-tool:hover{background:rgba(184,255,90,.15);border-color:rgba(184,255,90,.3);color:#b8ff5a}
    #${UI_ID} .sv-prompt{display:flex;align-items:center;gap:8px;border:1px solid rgba(255,255,255,.14);border-radius:0 0 14px 14px;background:#101012;padding:8px;box-shadow:0 8px 24px rgba(0,0,0,.4)}
    #${UI_ID} .sv-back,#${UI_ID} .sv-send{display:grid;place-items:center;flex:0 0 32px;height:32px;border:0;border-radius:8px;background:rgba(255,255,255,.08);color:#b8b8b2;font-size:16px;transition:all 0.15s ease}
    #${UI_ID} .sv-back:hover{background:rgba(255,255,255,.15);color:#f7f7f5}
    #${UI_ID} .sv-send{background:rgba(184,255,90,.2);color:rgba(184,255,90,.5);font-size:15px;font-weight:bold}
    #${UI_ID} .sv-send:not(:disabled){background:#b8ff5a;color:#10130c;cursor:pointer!important;box-shadow:0 0 12px rgba(184,255,90,.35)}
    #${UI_ID} .sv-send:not(:disabled):hover{background:#c7ff7c}
    #${UI_ID} .sv-send:disabled{opacity:.4;cursor:not-allowed!important}
    #${UI_ID} textarea{min-width:0;flex:1;height:32px;max-height:96px;resize:none;border:0;outline:0;background:transparent;padding:6px 4px;color:#f7f7f5;font:13px/18px system-ui;cursor:text!important}
    #${UI_ID} textarea::placeholder{color:#74746e}
    @media (prefers-reduced-motion: reduce) {
      *:not(#${UI_ID}):not(#${UI_ID} *), *:not(#${UI_ID}):not(#${UI_ID} *)::before, *:not(#${UI_ID}):not(#${UI_ID} *)::after {
        animation-play-state: running !important;
      }
    }
  `;
  document.head.appendChild(style);

  const editor = document.createElement('div');
  editor.id = UI_ID;
  editor.innerHTML = `
    <span class="sv-label"></span>
    <div class="sv-tools" aria-label="Element edit options">
      <button class="sv-tool" data-prompt="Change the text to ">Text</button>
      <button class="sv-tool" data-prompt="Change the colors: ">Color</button>
      <button class="sv-tool" data-prompt="Update the typography: ">Typography</button>
      <button class="sv-tool" data-prompt="Adjust the spacing: ">Spacing</button>
      <button class="sv-tool" data-prompt="Change the layout and alignment: ">Layout</button>
      <button class="sv-tool" data-prompt="Change the border and corner radius: ">Border</button>
      <button class="sv-tool" data-prompt="Add or change the visual effects: ">Effects</button>
    </div>
    <div class="sv-prompt">
      <button class="sv-back" type="button" aria-label="Clear selected element">‹</button>
      <textarea rows="1" aria-label="Describe element change" placeholder="What to change?"></textarea>
      <button class="sv-send" type="button" aria-label="Send element edit" disabled>↑</button>
    </div>`;
  document.body.appendChild(editor);
  const input = editor.querySelector('textarea') as HTMLTextAreaElement;
  const sendButton = editor.querySelector('.sv-send') as HTMLButtonElement;
  const label = editor.querySelector('.sv-label') as HTMLElement;

  function clearHovered() {
    hovered?.removeAttribute('data-sovereign-hovered');
    hovered = null;
  }

  function clearSelected(notify = false) {
    selected?.removeAttribute('data-sovereign-selected');
    selected = null;
    editor.removeAttribute('data-open');
    input.value = '';
    sendButton.disabled = true;
    if (notify)
      window.parent.postMessage(
        { source: MESSAGE_SOURCE, type: 'selection-cleared' },
        getParentOrigin(),
      );
  }

  function cssPath(element: Element) {
    const parts: string[] = [];
    let current: Element | null = element;
    while (current && current !== document.body) {
      let part = current.tagName.toLowerCase();
      if (current.id) {
        part += '#' + CSS.escape(current.id);
        parts.unshift(part);
        break;
      }
      const siblings = current.parentElement
        ? Array.from(current.parentElement.children).filter(
            (child) => child.tagName === current?.tagName,
          )
        : [];
      if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
      parts.unshift(part);
      current = current.parentElement;
    }
    return ['body', ...parts].join(' > ');
  }

  function describe(element: Element) {
    const htmlElement = element as HTMLElement;
    const text = (htmlElement.innerText || element.textContent || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 240);
    const sourceFile =
      location.pathname === '/' ? 'index.html' : location.pathname.replace(/^\//, '');
    const cleanClone = element.cloneNode(true) as Element;
    cleanClone.removeAttribute('data-sovereign-hovered');
    cleanClone.removeAttribute('data-sovereign-selected');
    return {
      tagName: element.tagName.toLowerCase(),
      id: element.id || null,
      className: typeof element.className === 'string' ? element.className.slice(0, 400) : '',
      text,
      selector: cssPath(element),
      sourceFile,
      outerHTML: cleanClone.outerHTML.slice(0, 2000),
    };
  }

  function positionEditor() {
    if (!selected) return;
    const rect = selected.getBoundingClientRect();
    const width = Math.min(430, window.innerWidth - 24);
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
    const labelHeight = label.offsetHeight || 28;
    const panelHeight = editor.offsetHeight || 92;
    const gap = 16;
    const belowTop = rect.bottom + labelHeight + gap;
    const totalHeight = panelHeight + labelHeight + gap;

    let top: number;
    if (belowTop + panelHeight <= window.innerHeight - 12) {
      top = belowTop;
    } else if (rect.top - totalHeight >= 12) {
      top = rect.top - panelHeight - gap;
    } else {
      top = Math.max(labelHeight + 12, window.innerHeight - panelHeight - 12);
    }

    editor.style.left = `${left}px`;
    editor.style.top = `${top}px`;
  }

  function selectElement(target: Element) {
    clearHovered();
    selected?.removeAttribute('data-sovereign-selected');
    selected = target;
    selected.setAttribute('data-sovereign-selected', '');
    label.textContent = cssPath(target);
    editor.setAttribute('data-open', '');
    positionEditor();
    input.focus();
    window.parent.postMessage(
      { source: MESSAGE_SOURCE, type: 'element-selected', element: describe(target) },
      getParentOrigin(),
    );
  }

  function submit() {
    const prompt = input.value.trim();
    if (!selected || !prompt) return;
    window.parent.postMessage(
      {
        source: MESSAGE_SOURCE,
        type: 'edit-request',
        element: describe(selected),
        prompt,
      },
      getParentOrigin(),
    );
    input.value = '';
    sendButton.disabled = true;
  }

  editor.addEventListener('click', (event) => event.stopPropagation());
  editor.querySelector('.sv-back')?.addEventListener('click', () => clearSelected(true));
  editor.querySelectorAll<HTMLButtonElement>('[data-prompt]').forEach((button) => {
    button.addEventListener('click', () => {
      input.value = button.dataset.prompt || '';
      sendButton.disabled = !input.value.trim();
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
  });
  input.addEventListener('input', () => {
    sendButton.disabled = !input.value.trim();
    input.style.height = '32px';
    input.style.height = `${Math.min(input.scrollHeight, 96)}px`;
    positionEditor();
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
    if (event.key === 'Escape') {
      event.stopPropagation();
      clearSelected(true);
    }
  });
  sendButton.addEventListener('click', submit);

  document.addEventListener(
    'pointermove',
    (event) => {
      if (!enabled) return;
      const target = event.target instanceof Element ? event.target : null;
      if (
        !target ||
        target.closest(`#${UI_ID}`) ||
        target === hovered ||
        target === document.documentElement ||
        target === document.body
      )
        return;
      clearHovered();
      hovered = target;
      if (hovered !== selected) hovered.setAttribute('data-sovereign-hovered', '');
    },
    true,
  );
  document.addEventListener('pointerleave', clearHovered, true);
  document.addEventListener(
    'click',
    (event) => {
      if (!enabled) return;
      const target = event.target instanceof Element ? event.target : null;
      if (
        !target ||
        target.closest(`#${UI_ID}`) ||
        target === document.documentElement ||
        target === document.body
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      selectElement(target);
    },
    true,
  );
  document.addEventListener(
    'keydown',
    (event) => {
      if (!enabled || event.key !== 'Escape' || editor.contains(event.target as Node)) return;
      clearHovered();
      clearSelected(true);
    },
    true,
  );
  window.addEventListener('scroll', positionEditor, true);
  window.addEventListener('resize', positionEditor);
  window.addEventListener('message', (event) => {
    if (!event.data || event.data.source !== MESSAGE_SOURCE || event.data.type !== 'set-edit-mode')
      return;
    enabled = Boolean(event.data.enabled);
    document.documentElement.toggleAttribute('data-sovereign-edit-mode', enabled);
    if (!enabled) {
      clearHovered();
      clearSelected();
    }
  });
  window.parent.postMessage({ source: MESSAGE_SOURCE, type: 'ready' }, getParentOrigin());
}

export function capA11yViolations(violations: unknown[]): {
  violations: unknown[];
  serialized: string;
} {
  const capped = violations.slice(0, A11Y_MAX_ISSUES);
  let serialized = JSON.stringify(capped);
  if (serialized.length > A11Y_MAX_CHARS) serialized = serialized.slice(0, A11Y_MAX_CHARS);
  return { violations: capped, serialized };
}

function axeRuntime() {
  const MESSAGE_SOURCE = 'sovereign-a11y';
  const getParentOrigin = () => {
    try {
      const origin = window.parent.location.origin;
      return origin && origin !== 'null' ? origin : '*';
    } catch {
      return '*';
    }
  };

  function report(payload: Record<string, unknown>) {
    window.parent.postMessage({ source: MESSAGE_SOURCE, ...payload }, getParentOrigin());
  }

  function run() {
    const axe = (
      window as Window & {
        axe?: {
          run: (
            context: unknown,
            options: unknown,
            callback: (error: unknown, results: { violations?: unknown[] }) => void,
          ) => void;
        };
      }
    ).axe;
    // Full axe-core min is not vendored here (bundle size). This collector is a real
    // served file; it only reports violations when window.axe is actually present.
    if (!axe || typeof axe.run !== 'function') {
      report({
        type: 'skipped',
        reason: 'axe-core is not vendored in this preview overlay',
      });
      return;
    }
    void axe.run(
      document,
      { resultTypes: ['violations'] },
      (_error: unknown, results: { violations?: unknown[] }) => {
        report({ type: 'violations', violations: (results?.violations ?? []).slice(0, 25) });
      },
    );
  }

  function schedule() {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(run, { timeout: 1500 });
    } else {
      setTimeout(run, 1500);
    }
  }

  if (document.readyState === 'complete') schedule();
  else window.addEventListener('load', schedule);
}

export const VISUAL_EDITOR_SCRIPT = `;(${visualEditorRuntime.toString()})();`;
export const AXE_RUNTIME_SCRIPT = `;(${axeRuntime.toString()})();`;
export { EDITOR_SCRIPT_PATH, AXE_SCRIPT_PATH };
