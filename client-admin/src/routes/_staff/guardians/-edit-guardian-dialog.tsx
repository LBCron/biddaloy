/**
 * [8.11.4]'s guardian edit form — a `FullPageShell` (8 fields, D21) over
 * `useUpdateGuardian`, opened by the route's `?edit=1` search key and
 * mounted only while open so its state is fresh each time. Plain `useState`
 * per field, no `react-hook-form`. `student_ids` is deliberately not a
 * field here — the Linked Students tab owns that edit, via its own
 * `StudentPicker`.
 * [68.4.05] A guardian linked to a login (`user_id`) shows phone and email
 * read-only: they belong to the login, and the server refuses a change (409).
 */
import {
  Card,
  ConfirmDialog,
  Input,
  Label,
  PhoneInput,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@biddaloy/ui/components';
import { useUpdateGuardian, type Guardian, type UpdateGuardianInput } from '@biddaloy/ui/hooks';
import { useTranslation, type RegionConfig } from '@biddaloy/ui/i18n';
import { FullPageShell } from '@biddaloy/ui/shells';
import { formatPhone } from '@biddaloy/ui/utils';
import * as React from 'react';

const PREFERRED_COMMUNICATION_OPTIONS = [
  'SMS',
  'WHATSAPP',
  'EMAIL',
  'PHONE_CALL',
  'MESSENGER',
] as const;

export interface EditGuardianDialogProps {
  guardian: Guardian;
  config: RegionConfig;
  onClose: () => void;
}

interface FormState {
  full_name: string;
  relationship: string;
  phone: string;
  email: string;
  alternate_phone: string;
  address: string;
  occupation: string;
  preferred_communication: Guardian['preferred_communication'];
}

function toFormState(guardian: Guardian): FormState {
  return {
    full_name: guardian.full_name,
    relationship: guardian.relationship,
    phone: guardian.phone ?? '',
    email: guardian.email ?? '',
    alternate_phone: guardian.alternate_phone ?? '',
    address: guardian.address ?? '',
    occupation: guardian.occupation ?? '',
    preferred_communication: guardian.preferred_communication,
  };
}

export function EditGuardianDialog({ guardian, config, onClose }: EditGuardianDialogProps) {
  const { t } = useTranslation('guardians');
  const { t: tCommon } = useTranslation('common');
  const [initial] = React.useState(() => toFormState(guardian));
  const [form, setForm] = React.useState<FormState>(initial);
  const [fullNameError, setFullNameError] = React.useState<string | undefined>(undefined);
  const [discarding, setDiscarding] = React.useState(false);
  const formRef = React.useRef<HTMLFormElement>(null);
  const updateGuardian = useUpdateGuardian(guardian.id);
  const pending = updateGuardian.isPending;
  const contactOwnedByLogin = guardian.user_id != null;

  // Every one of the 8 editable fields counts.
  const dirty = (Object.keys(initial) as (keyof FormState)[]).some((k) => form[k] !== initial[k]);

  // A pending save cannot be dismissed — Esc and Close route through here.
  const close = () => {
    if (!pending) onClose();
  };
  // `FullPageShell`'s footer `secondary` bypasses its own `requestClose`.
  const cancel = () => {
    if (pending) return;
    if (dirty) setDiscarding(true);
    else onClose();
  };

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    const fullName = form.full_name.trim();
    if (fullName === '') {
      setFullNameError(t('editDialog.fullNameRequired'));
      return;
    }
    setFullNameError(undefined);

    // Sent as `''`, not omitted, when the user cleared a field — omitting
    // an emptied field here would silently leave the old value in place
    // instead of clearing it (`GuardianService.update` maps `''` to NULL
    // for these nullable columns; see its own comment).
    const input: UpdateGuardianInput = {
      full_name: fullName,
      relationship: form.relationship.trim(),
      ...(contactOwnedByLogin ? {} : { phone: form.phone.trim(), email: form.email.trim() }),
      alternate_phone: form.alternate_phone.trim(),
      address: form.address.trim(),
      occupation: form.occupation.trim(),
      preferred_communication: form.preferred_communication,
    };
    updateGuardian.mutate(input, { onSuccess: onClose });
  }

  const field = (
    id: string,
    label: string,
    control: React.ReactNode,
    className?: string,
    opts?: { helpId?: string },
  ) => (
    <div className={className}>
      <Label htmlFor={id} helpId={opts?.helpId} helpLabel={label}>
        {label}
      </Label>
      <div className="mt-1.5">{control}</div>
    </div>
  );

  return (
    <FullPageShell
      title={t('editDialog.title')}
      onClose={close}
      dirty={dirty}
      size="form"
      secondary={{ label: tCommon('actions.cancel'), onClick: cancel }}
      primary={{
        label: pending ? t('editDialog.saving') : t('editDialog.save'),
        onClick: () => formRef.current?.requestSubmit(),
        busy: pending,
      }}
    >
      <form ref={formRef} onSubmit={handleSubmit} noValidate>
        <Card padded>
          <h2 className="text-h3">{t('editDialog.sectionTitle')}</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="guardian-edit-full-name">
                {t('editDialog.fields.fullName')}
                <span aria-hidden="true"> *</span>
              </Label>
              <Input
                id="guardian-edit-full-name"
                className="mt-1.5"
                aria-required="true"
                aria-invalid={fullNameError !== undefined}
                aria-describedby={fullNameError ? 'guardian-edit-full-name-error' : undefined}
                value={form.full_name}
                onChange={(event) => setForm({ ...form, full_name: event.target.value })}
              />
              {fullNameError && (
                <p
                  id="guardian-edit-full-name-error"
                  role="alert"
                  className="mt-1.5 text-destructive"
                >
                  {fullNameError}
                </p>
              )}
            </div>
            {field(
              'guardian-edit-relationship',
              t('editDialog.fields.relationship'),
              <Input
                id="guardian-edit-relationship"
                value={form.relationship}
                onChange={(event) => setForm({ ...form, relationship: event.target.value })}
              />,
              undefined,
              { helpId: 'people.guardians.field.relationship' },
            )}
            {contactOwnedByLogin ? (
              <div className="md:col-span-2">
                <dl className="grid gap-4 md:grid-cols-2">
                  <div>
                    <dt className="text-caption text-text-secondary">
                      {t('editDialog.fields.phone')}
                    </dt>
                    <dd className="text-text-primary">{formatPhone(form.phone, config)}</dd>
                  </div>
                  <div>
                    <dt className="text-caption text-text-secondary">
                      {t('editDialog.fields.email')}
                    </dt>
                    <dd className="text-text-primary">{form.email || '—'}</dd>
                  </div>
                </dl>
                <p className="mt-2 text-caption text-text-secondary">
                  {t('editDialog.contactOwnedByLogin')}
                </p>
              </div>
            ) : (
              field(
                'guardian-edit-phone',
                t('editDialog.fields.phone'),
                <PhoneInput
                  id="guardian-edit-phone"
                  value={form.phone}
                  config={config}
                  onValueChange={(value) => setForm({ ...form, phone: value })}
                />,
                undefined,
                { helpId: 'people.guardians.field.phone' },
              )
            )}
            {field(
              'guardian-edit-alternate-phone',
              t('editDialog.fields.alternatePhone'),
              <PhoneInput
                id="guardian-edit-alternate-phone"
                value={form.alternate_phone}
                config={config}
                onValueChange={(value) => setForm({ ...form, alternate_phone: value })}
              />,
            )}
            {!contactOwnedByLogin &&
              field(
                'guardian-edit-email',
                t('editDialog.fields.email'),
                <Input
                  id="guardian-edit-email"
                  type="email"
                  value={form.email}
                  onChange={(event) => setForm({ ...form, email: event.target.value })}
                />,
              )}
            {field(
              'guardian-edit-occupation',
              t('editDialog.fields.occupation'),
              <Input
                id="guardian-edit-occupation"
                value={form.occupation}
                onChange={(event) => setForm({ ...form, occupation: event.target.value })}
              />,
            )}
            {field(
              'guardian-edit-preferred-communication',
              t('editDialog.fields.preferredCommunication'),
              <Select
                value={form.preferred_communication}
                onValueChange={(value) =>
                  setForm({
                    ...form,
                    preferred_communication: value as Guardian['preferred_communication'],
                  })
                }
              >
                <SelectTrigger id="guardian-edit-preferred-communication">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PREFERRED_COMMUNICATION_OPTIONS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {t(`preferredCommunicationOptions.${option}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>,
              undefined,
              { helpId: 'people.guardians.field.preferredCommunication' },
            )}
            {field(
              'guardian-edit-address',
              t('editDialog.fields.address'),
              <Textarea
                id="guardian-edit-address"
                value={form.address}
                onChange={(event) => setForm({ ...form, address: event.target.value })}
              />,
              'md:col-span-2',
            )}
          </div>
          {updateGuardian.isError && (
            <p role="alert" className="mt-4 text-destructive">
              {t('editDialog.errorMessage')}
            </p>
          )}
        </Card>
      </form>
      <ConfirmDialog
        open={discarding}
        onOpenChange={setDiscarding}
        tone="danger"
        title={tCommon('fullPage.discardTitle')}
        description={tCommon('fullPage.discardDescription')}
        confirmLabel={tCommon('fullPage.discardConfirm')}
        cancelLabel={tCommon('fullPage.keepEditing')}
        onConfirm={() => {
          setDiscarding(false);
          onClose();
        }}
      />
    </FullPageShell>
  );
}
