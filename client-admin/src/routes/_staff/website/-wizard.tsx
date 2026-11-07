/**
 * [40.2.04] First-run wizard: 1 web address, 2 design, 3 logo and publish (D7, D34).
 *
 * All choices live in this component's state, and `WizardShell` keeps visited steps mounted, so
 * Back (or a stray Escape) never loses an earlier answer. Nothing is sent until the last button:
 * rename (if the address changed) → save the draft → publish → switch on, in that order, each
 * step using the version the previous one returned so a stale answer cannot publish unseen.
 */
import { SITE_SUBDOMAIN_RE, SiteMediaSlot } from '@biddaloy/shared';
import { ApiError } from '@biddaloy/ui/api';
import {
  Button,
  ImageSlotUpload,
  Input,
  PaletteSwatches,
  toast,
  type PaletteOption,
} from '@biddaloy/ui/components';
import {
  useDebouncedValue,
  usePublishWebsite,
  useRenameSubdomain,
  useSaveDraft,
  useSetWebsiteEnabled,
  useSubdomainCheck,
  useSubdomainSuggestions,
  useUploadSiteMedia,
  useWebsiteMedia,
  type WebsiteConfig,
  type WebsiteTheme,
} from '@biddaloy/ui/hooks';
import { useLocale, useTranslation } from '@biddaloy/ui/i18n';
import { WizardShell, useWizardShellStep } from '@biddaloy/ui/shells';
import * as React from 'react';

import { ThemeCard } from './-theme-card';

const STEP_IDS = ['address', 'design', 'publish'] as const;

type Text = { bn?: string; en?: string };
interface Palette {
  id: string;
  name: Text;
  vars: Record<string, string>;
}
// `ThemeSummaryDto` types these loosely; the shapes below are the theme manifest's.
const palettesOf = (theme: WebsiteTheme | undefined) =>
  (theme?.palettes ?? []) as unknown as Palette[];

export interface WebsiteWizardProps {
  config: WebsiteConfig;
  themes: readonly WebsiteTheme[];
  onDone: () => void;
}

export function WebsiteWizard({ config, themes, onDone }: WebsiteWizardProps) {
  const { t } = useTranslation('website');
  const { locale } = useLocale();
  const lang = locale === 'bn' ? 'bn' : 'en';
  const [step, setStep] = useWizardShellStep(STEP_IDS, { replace: true });

  const [address, setAddress] = React.useState(config.subdomain);
  const [themeId, setThemeId] = React.useState(config.theme);
  const [paletteId, setPaletteId] = React.useState(config.palette);

  const clean = address.trim().toLowerCase();
  const check = useSubdomainCheck(clean);
  const settled = useDebouncedValue(clean, 300) === clean;
  const suggestions = useSubdomainSuggestions();
  // The hook types this as a bare list; the API sends `{ suggestions }`. Accept both.
  const suggested = React.useMemo(() => {
    const raw: unknown = suggestions.data;
    const list = Array.isArray(raw) ? raw : ((raw as { suggestions?: unknown })?.suggestions ?? []);
    return (list as string[]).filter((s) => s !== config.subdomain);
  }, [suggestions.data, config.subdomain]);

  const addressOk =
    clean === config.subdomain ||
    (SITE_SUBDOMAIN_RE.test(clean) &&
      settled &&
      !check.isFetching &&
      check.data?.available === true);

  const theme = themes.find((x) => x.id === themeId) ?? themes[0];
  const palettes = palettesOf(theme);
  const paletteOptions: PaletteOption[] = palettes.map((p) => ({
    id: p.id,
    name: { bn: p.name.bn ?? p.name.en ?? p.id, en: p.name.en ?? p.name.bn ?? p.id },
    colors: Object.values(p.vars),
  }));

  function pickTheme(next: WebsiteTheme) {
    setThemeId(next.id);
    const nextPalettes = palettesOf(next);
    if (!nextPalettes.some((p) => p.id === paletteId)) setPaletteId(nextPalettes[0]?.id ?? '');
  }

  const rename = useRenameSubdomain();
  const save = useSaveDraft();
  const publish = usePublishWebsite();
  const enable = useSetWebsiteEnabled();
  const [busy, setBusy] = React.useState(false);

  async function finish() {
    setBusy(true);
    try {
      let site = clean === config.subdomain ? config : await rename.mutateAsync(clean);
      site = await save.mutateAsync({
        config: { ...site.draft, theme: themeId, palette: paletteId },
        draft_revision: site.draft_revision,
      });
      await publish.mutateAsync({
        version: site.version,
        draft_revision: site.draft_revision,
      });
      await enable.mutateAsync(true);
      onDone();
    } catch (error) {
      toast.error(
        error instanceof ApiError && error.statusCode === 409
          ? t('overview.stale')
          : t('wizard.error'),
      );
    } finally {
      setBusy(false);
    }
  }

  const media = useWebsiteMedia();
  const uploadLogo = useUploadSiteMedia(SiteMediaSlot.LOGO);
  const logo = media.data?.items.find((m) => m.slot === SiteMediaSlot.LOGO)?.url ?? null;

  const addressHint = !SITE_SUBDOMAIN_RE.test(clean)
    ? t('wizard.address.invalid')
    : clean === config.subdomain
      ? null
      : !settled || check.isFetching
        ? t('wizard.address.checking')
        : check.data?.available
          ? t('wizard.address.available')
          : t('wizard.address.taken');

  return (
    <WizardShell
      title={t('wizard.title')}
      currentStepId={step}
      onStepChange={setStep}
      onSubmit={() => void finish()}
      submitLabel={t('wizard.finish')}
      submitting={busy}
      steps={[
        {
          id: 'address',
          label: t('wizard.steps.address'),
          isValid: () => addressOk,
          content: (
            <section className="flex flex-col gap-3">
              <label htmlFor="website-address" className="text-sm font-medium">
                {t('wizard.address.label')}
              </label>
              <Input
                id="website-address"
                value={address}
                dir="ltr"
                lang="en"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                aria-invalid={!addressOk}
                aria-describedby="website-address-hint"
                onChange={(e) => setAddress(e.target.value)}
              />
              <p id="website-address-hint" role="status" className="text-caption">
                {addressHint ?? t('help.address')}
              </p>
              {suggested.length > 0 && (
                <div className="flex flex-col gap-2">
                  <span className="text-sm font-medium">{t('wizard.address.suggestions')}</span>
                  <div className="flex flex-wrap gap-2">
                    {suggested.map((s) => (
                      <Button key={s} type="button" variant="outline" onClick={() => setAddress(s)}>
                        {s}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </section>
          ),
        },
        {
          id: 'design',
          label: t('wizard.steps.design'),
          isValid: () => paletteId !== '',
          content: (
            <section className="flex flex-col gap-4">
              <h2 className="text-h2">{t('wizard.design.pick')}</h2>
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                {themes.map((th) => (
                  <ThemeCard
                    key={th.id}
                    name={(th.name as Text)[lang] ?? (th.name as Text).en ?? th.id}
                    colors={Object.values(palettesOf(th)[0]?.vars ?? {})}
                    selected={th.id === theme?.id}
                    onSelect={() => pickTheme(th)}
                  />
                ))}
              </div>
              <h2 className="text-h2">{t('wizard.design.colours')}</h2>
              <PaletteSwatches
                palettes={paletteOptions}
                value={paletteId}
                onChange={setPaletteId}
                lang={lang}
                label={t('wizard.design.colours')}
              />
            </section>
          ),
        },
        {
          id: 'publish',
          label: t('wizard.steps.publish'),
          content: (
            <section className="flex flex-col gap-4">
              <div>
                <h2 className="text-h2">{t('wizard.done.title')}</h2>
                <p className="text-text-secondary">{t('wizard.done.body')}</p>
              </div>
              <h3 className="text-sm font-medium">{t('wizard.logo.title')}</h3>
              <ImageSlotUpload
                slot={SiteMediaSlot.LOGO}
                value={logo}
                onUpload={async (blob) => {
                  try {
                    await uploadLogo.mutateAsync(blob);
                  } catch {
                    toast.error(t('overview.saveError'));
                  }
                }}
                labels={{
                  choose: t('wizard.logo.choose'),
                  zoom: t('wizard.logo.zoom'),
                  save: t('wizard.logo.save'),
                  svgRefused: t('wizard.logo.svgRefused'),
                  tooLarge: t('wizard.logo.tooLarge'),
                  unreadable: t('wizard.logo.unreadable'),
                  pan: t('wizard.logo.pan'),
                }}
              />
            </section>
          ),
        },
      ]}
    />
  );
}
