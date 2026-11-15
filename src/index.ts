import { REPOSITORY_URL, VERSION } from './const';
import { CARDS } from './registry';
import { EDITOR_TAG, MetronCardEditor } from './ui/editor';

const define = (tag: string, element: CustomElementConstructor): void => {
  if (customElements.get(tag)) return;

  customElements.define(tag, element);
};

define(EDITOR_TAG, MetronCardEditor);

window.customCards ??= [];

for (const card of CARDS) {
  define(card.type, card.element);

  if (!window.customCards.some((entry) => entry.type === card.type)) {
    window.customCards.push({
      type: card.type,
      name: card.name,
      description: card.description,
      preview: true,
      documentationURL: `${REPOSITORY_URL}#${card.type}`,
    });
  }
}

console.info(
  `%c METRON %c v${VERSION} `,
  'color: #15181c; background: #ffb547; font-weight: 700;',
  'color: #ffb547; background: #15181c; font-weight: 700;',
);
