/**
 * [8.15.39] The report designer's building blocks: a field picker, "only those who…" filters, a
 * layout suggester and colour rules, in the plain words of the reports glossary (D21). All of them
 * are props-only; `useDesignerLabels()` builds the words from `reports.json`.
 */
export {
  DESIGNER_TOPICS,
  EMPTY_PICKS,
  FIELD_TRAYS,
  FieldPicker,
  allowedTrays,
  defaultTopicOf,
  fieldsFromMeta,
  matchesField,
  type DesignerField,
  type DesignerTopic,
  type FieldPickerLabels,
  type FieldPickerProps,
  type FieldPickerValue,
  type FieldTray,
  type MetaAreaLike,
} from './field-picker';
export {
  ConditionEditor,
  FilterBuilder,
  canAsk,
  filterOpFor,
  opWordOf,
  opWordsFor,
  parameterFor,
  type ConditionEditorProps,
  type ConditionLabels,
  type EnumLabel,
  type FilterBuilderLabels,
  type FilterBuilderProps,
  type FilterBuilderValue,
  type OpWord,
} from './filter-builder';
export {
  FORMAT_TONES,
  FormatRulesEditor,
  type FormatRulesEditorProps,
  type FormatRulesLabels,
  type FormatTone,
} from './format-rules-editor';
export {
  LAYOUT_CHOICES,
  LayoutSwitcher,
  type LayoutSwitcherLabels,
  type LayoutSwitcherProps,
} from './layout-switcher';
export { useDesignerLabels, type DesignerLabels } from './labels';
export { ParamEditor, type ParamEditorLabels, type ParamEditorProps } from './param-editor';
export {
  buildLayout,
  suggestLayout,
  type LayoutPicks,
  type LayoutReason,
  type LayoutSuggestion,
} from './suggest-layout';
