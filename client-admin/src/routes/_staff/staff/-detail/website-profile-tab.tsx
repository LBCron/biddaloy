/**
 * [40.3.09] Staff detail › Website profile: whether and how this person appears on the school
 * website (D16 WEBSITE_MANAGE, D19 photo, D27 at most 8 featured). Mounted by `$userId.tsx` only
 * behind that permission. Saves with PUT /website/teachers/:userId.
 */
import { SiteMediaSlot } from '@biddaloy/shared';
import {
  BilingualField,
  Button,
  Checkbox,
  ErrorState,
  ImageSlotUpload,
  Input,
  Label,
  Skeleton,
  toast,
  type BilingualValue,
} from '@biddaloy/ui/components';
import {
  useUploadSiteMedia,
  useUpsertWebTeacher,
  useWebTeachers,
  type WebTeacher,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

/** D27: the home page shows at most this many people. */
export const MAX_FEATURED = 8;

const toValue = (v: WebTeacher['bio']): BilingualValue => ({ bn: v?.bn ?? '', en: v?.en ?? '' });
const fromValue = (v: BilingualValue): Record<string, string> | null =>
  v.bn.trim() || v.en.trim() ? { bn: v.bn, en: v.en } : null;

export interface WebsiteProfileTabProps {
  userId: string;
}

export function WebsiteProfileTab({ userId }: WebsiteProfileTabProps) {
  const { t } = useTranslation('staff');
  const list = useWebTeachers();
  const row = list.data?.find((p) => p.user_id === userId);
  if (list.isPending) return <Skeleton className="h-40 w-full" />;
  if (list.isError || !row) {
    return (
      <ErrorState
        message={t('tabs.websiteProfileFields.loadError')}
        retryLabel={t('tabs.websiteProfileFields.retry')}
        onRetry={() => void list.refetch()}
      />
    );
  }
  const othersFeatured = list.data?.filter((p) => p.featured && p.user_id !== userId).length ?? 0;
  return <ProfileForm key={row.user_id} row={row} othersFeatured={othersFeatured} />;
}

function ProfileForm({ row, othersFeatured }: { row: WebTeacher; othersFeatured: number }) {
  const { t } = useTranslation('staff');
  const f = (k: string, opts: Record<string, unknown> = {}) =>
    t(`tabs.websiteProfileFields.${k}`, opts);
  const save = useUpsertWebTeacher();
  const upload = useUploadSiteMedia(SiteMediaSlot.PERSON);
  const [show, setShow] = React.useState(row.show_on_website);
  const [featured, setFeatured] = React.useState(row.featured);
  const [order, setOrder] = React.useState(String(row.sort_order));
  const [subjects, setSubjects] = React.useState(row.subjects.join(', '));
  const [bio, setBio] = React.useState(toValue(row.bio));
  const [credentials, setCredentials] = React.useState(toValue(row.credentials));
  const [photoId, setPhotoId] = React.useState(row.photo_media_id);

  const capReached = othersFeatured >= MAX_FEATURED && !featured;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    save.mutate(
      {
        userId: row.user_id,
        show_on_website: show,
        featured: show && featured,
        sort_order: Math.max(0, Math.trunc(Number(order) || 0)),
        subjects: subjects
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        bio: fromValue(bio),
        credentials: fromValue(credentials),
        photo_media_id: photoId,
      },
      {
        onSuccess: () => toast.success(f('saved')),
        onError: () => toast.error(f('saveError')),
      },
    );
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <div className="flex items-center gap-2">
        <Checkbox id="web-show" checked={show} onCheckedChange={(c) => setShow(c === true)} />
        <Label htmlFor="web-show">{f('show')}</Label>
      </div>
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Checkbox
            id="web-featured"
            checked={featured && show}
            disabled={!show || capReached}
            onCheckedChange={(c) => setFeatured(c === true)}
          />
          <Label htmlFor="web-featured">{f('featured')}</Label>
        </div>
        {capReached && (
          <p role="status" className="text-caption text-text-secondary">
            {f('featuredFull', { max: MAX_FEATURED })}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="web-order">{f('order')}</Label>
        <Input
          id="web-order"
          type="number"
          min={0}
          value={order}
          onChange={(e) => setOrder(e.target.value)}
          className="w-28"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="web-subjects">{f('subjects')}</Label>
        <Input id="web-subjects" value={subjects} onChange={(e) => setSubjects(e.target.value)} />
        <p className="text-caption text-text-secondary">{f('subjectsHint')}</p>
      </div>
      <BilingualField label={f('bio')} value={bio} onChange={setBio} multiline />
      <BilingualField label={f('credentials')} value={credentials} onChange={setCredentials} />
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{f('photo')}</span>
        <ImageSlotUpload
          slot={SiteMediaSlot.PERSON}
          onUpload={async (blob) => {
            try {
              setPhotoId((await upload.mutateAsync(blob)).id);
              toast.success(f('photoReady'));
            } catch {
              toast.error(f('saveError'));
            }
          }}
          labels={{
            choose: f('photoLabels.choose'),
            zoom: f('photoLabels.zoom'),
            save: f('photoLabels.save'),
            svgRefused: f('photoLabels.svgRefused'),
            tooLarge: f('photoLabels.tooLarge'),
            unreadable: f('photoLabels.unreadable'),
            pan: f('photoLabels.pan'),
          }}
        />
      </div>
      <div>
        <Button type="submit" disabled={save.isPending}>
          {f('save')}
        </Button>
      </div>
    </form>
  );
}
