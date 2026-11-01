/**
 * Root barrel for `@biddaloy/ui`.
 *
 * Prefer the subpath exports (`@biddaloy/ui/components`, `/hooks`, `/utils`,
 * …) in application code — they keep import lines honest about what a module
 * actually depends on, and let a bundler drop the rest.
 */
export * from './components/index';
export * from './shells/index';
// Both barrels export a `StepIndicator` (the register card's one in
// components, the wizard's one in shells). The root keeps the components one;
// import the shells one from `@biddaloy/ui/shells`.
export { StepIndicator, type StepIndicatorProps } from './components/index';
export * from './hooks/index';
export * from './utils/index';
export * from './i18n/index';
export * from './api/index';
