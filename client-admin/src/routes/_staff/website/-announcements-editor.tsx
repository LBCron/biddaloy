/**
 * [40.3.05] The top announcement bar: up to five lines, each with bn/en text, an optional
 * on-site link, an optional from/until date and an on/off switch, plus how the bar moves (D30).
 *
 * Controlled: the Pages tab owns the draft and its save bar. `announcementsInvalid` tells that
 * tab to hold the save while a link or a date range is wrong; the message sits by the field.
 */
import {
  isSiteRelativeHref,
  SITE_ANNOUNCEMENTS_MAX,
  SiteAnnouncementStyle,
  SiteMarqueeSpeed,
  type SiteAnnouncement,
  type SiteAnnouncementBar,
} from '@biddaloy/shared';
import {
  BilingualField,
  Button,
  Card,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

/** Same cap the server enforces on every site text (`SITE_TEXT_MAX_CHARS` in site-themes). */
const TEXT_MAX = 2000;
const clip = (v: string) => v.slice(0, TEXT_MAX);

const day = (v: string | undefined) => (v ?? '').slice(0, 10);

const badLink = (a: SiteAnnouncement) => !!a.href && !isSiteRelativeHref(a.href);
const noText = (a: SiteAnnouncement) => a.text.bn.trim() === '';
const badRange = (a: SiteAnnouncement) => !!a.from && !!a.until && day(a.until) < day(a.from);

/** True while any line has a link off the site or an end date before its start date. */
export const announcementsInvalid = (bar: SiteAnnouncementBar) =>
  bar.items.some((a) => badLink(a) || badRange(a) || noText(a));

export interface AnnouncementsEditorProps {
  value: SiteAnnouncementBar;
  onChange: (value: SiteAnnouncementBar) => void;
}

export function AnnouncementsEditor({ value, onChange }: AnnouncementsEditorProps) {
  const { t } = useTranslation('website');
  const seq = React.useRef(0);
  const full = value.items.length >= SITE_ANNOUNCEMENTS_MAX;

  const setItems = (items: SiteAnnouncement[]) => onChange({ ...value, items });
  const patch = (id: string, next: Partial<SiteAnnouncement>) =>
    setItems(value.items.map((a) => (a.id === id ? { ...a, ...next } : a)));
  // An empty date/link is not stored at all (the server drops empty values the same way).
  const clearable = (id: string, key: 'href' | 'from' | 'until', v: string) =>
    setItems(
      value.items.map((a) => {
        if (a.id !== id) return a;
        const rest = { ...a };
        delete rest[key];
        return v === '' ? rest : { ...rest, [key]: v };
      }),
    );

  return (
    <Card className="flex flex-col gap-4 p-4 md:p-5">
      <h2 className="text-h2">{t('announcements.title')}</h2>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="announce-style">{t('announcements.style')}</Label>
          <Select
            value={value.style}
            onValueChange={(style) => onChange({ ...value, style: style as SiteAnnouncementStyle })}
          >
            <SelectTrigger id="announce-style">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.values(SiteAnnouncementStyle).map((s) => (
                <SelectItem key={s} value={s}>
                  {t(`announcements.styles.${s}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {value.style === SiteAnnouncementStyle.MARQUEE && (
          <div className="flex flex-col gap-1">
            <Label htmlFor="announce-speed">{t('announcements.speed')}</Label>
            <Select
              value={value.speed}
              onValueChange={(speed) => onChange({ ...value, speed: speed as SiteMarqueeSpeed })}
            >
              <SelectTrigger id="announce-speed">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.values(SiteMarqueeSpeed).map((s) => (
                  <SelectItem key={s} value={s}>
                    {t(`announcements.speeds.${s}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {value.items.length === 0 && (
        <p className="text-sm text-text-secondary">{t('announcements.empty')}</p>
      )}

      {value.items.map((a, i) => (
        <div
          key={a.id}
          data-testid="announcement-row"
          className="flex flex-col gap-3 rounded-lg border border-border-subtle p-3"
        >
          <BilingualField
            label={t('announcements.text')}
            value={a.text}
            onChange={(text) => patch(a.id, { text: { bn: clip(text.bn), en: clip(text.en) } })}
            enHint={t('editor.enHint')}
            required
          />
          {noText(a) && (
            <p role="alert" className="text-caption text-destructive">
              {t('announcements.textRequired')}
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor={`announce-link-${a.id}`}>{t('announcements.link')}</Label>
              <Input
                id={`announce-link-${a.id}`}
                dir="ltr"
                value={a.href ?? ''}
                aria-invalid={badLink(a)}
                onChange={(e) => clearable(a.id, 'href', e.target.value)}
              />
              <p className="text-caption text-text-secondary">
                {badLink(a) ? t('announcements.linkInvalid') : t('announcements.linkHint')}
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`announce-from-${a.id}`}>{t('announcements.from')}</Label>
              <Input
                id={`announce-from-${a.id}`}
                type="date"
                value={day(a.from)}
                onChange={(e) => clearable(a.id, 'from', e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`announce-until-${a.id}`}>{t('announcements.until')}</Label>
              <Input
                id={`announce-until-${a.id}`}
                type="date"
                value={day(a.until)}
                aria-invalid={badRange(a)}
                onChange={(e) => clearable(a.id, 'until', e.target.value)}
              />
              {badRange(a) && (
                <p role="alert" className="text-caption text-destructive">
                  {t('announcements.rangeInvalid')}
                </p>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={a.enabled} onCheckedChange={(enabled) => patch(a.id, { enabled })} />
              {t('announcements.enabled')}
            </label>
            <Button
              type="button"
              variant="ghost"
              aria-label={`${t('announcements.remove')} ${i + 1}`}
              onClick={() => setItems(value.items.filter((x) => x.id !== a.id))}
            >
              {t('announcements.remove')}
            </Button>
          </div>
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={full}
          onClick={() =>
            setItems([
              ...value.items,
              {
                id: `a-${Date.now().toString(36)}-${seq.current++}`,
                text: { bn: '', en: '' },
                enabled: true,
              },
            ])
          }
        >
          {t('announcements.add')}
        </Button>
        {full && (
          <span className="text-caption text-text-secondary">{t('announcements.limit')}</span>
        )}
      </div>
    </Card>
  );
}
