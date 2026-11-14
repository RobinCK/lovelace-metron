import type { HomeAssistant } from '../types/ha';

export interface EntityQuery {
  readonly domain?: string;
  readonly deviceClass?: string;
  readonly keywords?: readonly string[];
}

export const findEntities = (
  hass: HomeAssistant | undefined,
  query: EntityQuery,
  limit = 1,
): string[] => {
  if (!hass) return [];

  const domain = query.domain ?? 'sensor';

  return Object.values(hass.states)
    .filter((entity) => {
      if (!entity?.entity_id.startsWith(`${domain}.`)) return false;
      if (query.deviceClass && entity.attributes.device_class !== query.deviceClass) return false;

      return (
        !query.keywords || query.keywords.some((keyword) => entity.entity_id.includes(keyword))
      );
    })
    .slice(0, limit)
    .map((entity) => entity?.entity_id ?? '');
};

export const findEntity = (
  hass: HomeAssistant | undefined,
  query: EntityQuery,
): string | undefined => findEntities(hass, query, 1)[0];
