import { jp } from './jp';
import type { JurisdictionId, RulePack } from './types';
import { us } from './us';

export * from './types';
export { jp, us };

export const rulePacks: Readonly<Record<JurisdictionId, RulePack>> = { us, jp };

export function getRulePack(id: JurisdictionId): RulePack {
  return rulePacks[id];
}
