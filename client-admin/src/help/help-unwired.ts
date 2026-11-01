/**
 * [Epic 44 / #2562] Guide ids that deliberately have no (?) in code: id -> reason.
 * `help-guard.test.ts` fails when one of these is missing from the guide or is used in code (E6),
 * and when a reason does not start with an issue number (`#<n>: …`), or is the E11 public-page
 * reason on an id outside `start.signIn` / `admin.createSchool` (44.3.12). The guard checks the
 * format only, not that the issue is open.
 * The issue that wires an id deletes its line here.
 */
export const PUBLIC = 'E11: public page, no shell';
export const HELP_UNWIRED: Record<string, string> = {
  'start.signIn': PUBLIC,
  'start.signIn.action.submit': PUBLIC,
  'start.signIn.field.identifier': PUBLIC,
  'admin.createSchool': PUBLIC,
  'admin.createSchool.action.continue': PUBLIC,
  'admin.createSchool.action.verify': PUBLIC,

  // 44.3.12: declared in the guide after the wave-3 pass ran
};
