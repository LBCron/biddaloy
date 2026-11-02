import type { TabSpec } from '../../codec/tab-spec';
import { reportDefinitionVersionsTab } from './report-definition-versions.tab';
import { reportDefinitionsTab } from './report-definitions.tab';
import { reportSchedulesTab } from './report-schedules.tab';

/** In dependency order: definitions first, then the versions and schedules that point at them. */
export const reportsTabs: readonly TabSpec<any, any>[] = [
  reportDefinitionsTab,
  reportDefinitionVersionsTab,
  reportSchedulesTab,
];
