export const openMoreInfo = (node: HTMLElement, entityId: string | undefined): void => {
  if (!entityId) return;

  node.dispatchEvent(
    new CustomEvent('hass-more-info', {
      detail: { entityId },
      bubbles: true,
      composed: true,
    }),
  );
};
