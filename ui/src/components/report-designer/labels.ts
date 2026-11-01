/**
 * [8.15.39] Every word the report designer shows, built once from `reports.json` (`designer.*`,
 * Bangla first, glossary D21). The components take these as a `labels` prop and never call
 * `useTranslation` themselves, so a screen calls this hook once and hands the pieces down:
 *
 * ```tsx
 * const labels = useDesignerLabels();
 * <FieldPicker labels={labels.picker} … />
 * <FilterBuilder labels={labels.filter} … />
 * <LayoutSwitcher labels={labels.layout} … />
 * <FormatRulesEditor labels={labels.format} … />
 * ```
 *
 * Keys are written out in full (not built from a variable) so `check:i18n` can see each one.
 */
import * as React from 'react';

import { useTranslation } from '../../i18n';

import type { FieldPickerLabels } from './field-picker';
import type { FilterBuilderLabels } from './filter-builder';
import type { FormatRulesLabels } from './format-rules-editor';
import type { LayoutSwitcherLabels } from './layout-switcher';

export interface DesignerLabels {
  picker: FieldPickerLabels;
  filter: FilterBuilderLabels;
  layout: LayoutSwitcherLabels;
  format: FormatRulesLabels;
}

export function useDesignerLabels(): DesignerLabels {
  const { t } = useTranslation('reports');
  return React.useMemo(() => {
    const condition = {
      field: t('designer.filter.field'),
      pickField: t('designer.filter.pickField'),
      op: t('designer.filter.op'),
      value: t('designer.filter.value'),
      from: t('designer.filter.from'),
      to: t('designer.filter.to'),
      and: t('designer.filter.and'),
      yes: t('designer.filter.yes'),
      no: t('designer.filter.no'),
      textHint: t('designer.filter.textHint'),
      pickValues: t('designer.filter.pickValues'),
      notANumber: t('designer.filter.notANumber'),
      ops: {
        is: t('designer.filter.ops.is'),
        isNot: t('designer.filter.ops.isNot'),
        more: t('designer.filter.ops.more'),
        less: t('designer.filter.ops.less'),
        between: t('designer.filter.ops.between'),
      },
    };
    return {
      picker: {
        title: t('designer.picker.title'),
        searchLabel: t('designer.picker.searchLabel'),
        searchPlaceholder: t('designer.picker.searchPlaceholder'),
        found: (n: string) => t('designer.picker.found', { n }),
        noMatch: t('designer.picker.noMatch'),
        empty: t('designer.picker.empty'),
        remove: t('designer.picker.remove'),
        topics: {
          student: t('designer.picker.topics.student'),
          class: t('designer.picker.topics.class'),
          guardian: t('designer.picker.topics.guardian'),
          fee: t('designer.picker.topics.fee'),
          payment: t('designer.picker.topics.payment'),
          attendance: t('designer.picker.topics.attendance'),
          staff: t('designer.picker.topics.staff'),
          exam: t('designer.picker.topics.exam'),
          other: t('designer.picker.topics.other'),
        },
        trays: {
          show: t('designer.picker.trays.show'),
          split: t('designer.picker.trays.split'),
          count: t('designer.picker.trays.count'),
        },
        hints: {
          show: t('designer.picker.hints.show'),
          split: t('designer.picker.hints.split'),
          count: t('designer.picker.hints.count'),
        },
        lock: {
          PERSONAL: t('designer.picker.lock.PERSONAL'),
          CONTACT: t('designer.picker.lock.CONTACT'),
          FINANCIAL: t('designer.picker.lock.FINANCIAL'),
          SENSITIVE: t('designer.picker.lock.SENSITIVE'),
        },
      },
      filter: {
        ...condition,
        title: t('designer.filter.title'),
        add: t('designer.filter.add'),
        remove: t('designer.filter.remove'),
        empty: t('designer.filter.empty'),
        ask: t('designer.filter.ask'),
        params: {
          title: t('designer.params.title'),
          labelBn: t('designer.params.labelBn'),
          labelEn: t('designer.params.labelEn'),
          required: t('designer.params.required'),
          startsAs: t('designer.params.startsAs'),
          noDefault: t('designer.params.noDefault'),
          from: t('designer.params.from'),
          to: t('designer.params.to'),
          dependsOn: t('designer.params.dependsOn'),
          dependsNone: t('designer.params.dependsNone'),
          types: {
            ACADEMIC_YEAR: t('designer.params.types.ACADEMIC_YEAR'),
            CLASS: t('designer.params.types.CLASS'),
            SECTION: t('designer.params.types.SECTION'),
            DATE: t('designer.params.types.DATE'),
            DATE_RANGE: t('designer.params.types.DATE_RANGE'),
            ENUM: t('designer.params.types.ENUM'),
            TEXT: t('designer.params.types.TEXT'),
          },
        },
      },
      layout: {
        title: t('designer.layout.title'),
        suggested: t('designer.layout.suggested'),
        manual: t('designer.layout.manual'),
        backToSuggestion: t('designer.layout.backToSuggestion'),
        options: {
          TABLE: t('designer.layout.options.TABLE'),
          GROUPED: t('designer.layout.options.GROUPED'),
          CROSSTAB: t('designer.layout.options.CROSSTAB'),
          CHART: t('designer.layout.options.CHART'),
        },
        hints: {
          TABLE: t('designer.layout.hints.TABLE'),
          GROUPED: t('designer.layout.hints.GROUPED'),
          CROSSTAB: t('designer.layout.hints.CROSSTAB'),
          CHART: t('designer.layout.hints.CHART'),
        },
        reasons: {
          noSplit: t('designer.layout.reasons.noSplit'),
          noCount: t('designer.layout.reasons.noCount'),
          dateSplit: t('designer.layout.reasons.dateSplit'),
          oneSplit: t('designer.layout.reasons.oneSplit'),
          twoSplits: t('designer.layout.reasons.twoSplits'),
          twoSplitsManyCounts: t('designer.layout.reasons.twoSplitsManyCounts'),
          manySplits: t('designer.layout.reasons.manySplits'),
        },
      },
      format: {
        ...condition,
        title: t('designer.format.title'),
        add: t('designer.format.add'),
        remove: t('designer.format.remove'),
        empty: t('designer.format.empty'),
        if: t('designer.format.if'),
        then: t('designer.format.then'),
        tone: t('designer.format.tone'),
        tones: {
          good: t('designer.format.tones.good'),
          warn: t('designer.format.tones.warn'),
          bad: t('designer.format.tones.bad'),
          muted: t('designer.format.tones.muted'),
        },
      },
    };
  }, [t]);
}
