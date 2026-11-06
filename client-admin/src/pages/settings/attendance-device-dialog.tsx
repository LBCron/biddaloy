/**
 * [76.5.02] Add / rotate / revoke an attendance machine (D10, D23). The secret
 * key comes back from the server exactly once (create and rotate), so the key
 * view is the only place it is ever shown, and closing it asks for confirmation.
 */
import {
  Button,
  Combobox,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  toast,
} from '@biddaloy/ui/components';
import {
  useCreateAttendanceDevice,
  useRevokeAttendanceDevice,
  useRotateAttendanceDeviceKey,
  type AttendanceDevice,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { CopyIcon } from 'lucide-react';
import * as React from 'react';

import { useSectionOptions } from '../../features/attention/use-section-options';

export const DEVICE_KINDS = ['BIOMETRIC', 'FACE', 'RFID', 'OTHER'] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];

/** English fallbacks, used only if a `settings:attendanceDevices.*` key is missing. */
export const KIND_FALLBACK: Record<DeviceKind, string> = {
  BIOMETRIC: 'Fingerprint',
  FACE: 'Face',
  RFID: 'Card',
  OTHER: 'Other',
};

export function useDeviceText() {
  const { t } = useTranslation('settings');
  return (key: string, defaultValue: string, vars?: Record<string, string>) =>
    t(`attendanceDevices.${key}`, { defaultValue, ...vars });
}

/** Shows the key once. Closing asks "did you copy it?" first. */
function KeyView({ secret, onDone }: { secret: string; onDone: () => void }) {
  const d = useDeviceText();
  const [copied, setCopied] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      toast.success(d('key.copied', 'Key copied'));
    } catch {
      toast.error(d('key.copyError', 'Could not copy. Select the key and copy it by hand.'));
    }
  }

  const close = () => (copied ? onDone() : setConfirming(true));

  return (
    <>
      <Dialog open onOpenChange={(open) => !open && close()}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>{d('key.title', 'Copy key now — shown once')}</DialogTitle>
          </DialogHeader>
          <p className="text-text-secondary">
            {d('key.explainer', 'Put this key into the machine. It cannot be shown again.')}
          </p>
          <div className="flex flex-col gap-2 md:flex-row">
            <Input
              readOnly
              aria-label={d('key.label', 'Secret key')}
              value={secret}
              className="font-mono"
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button type="button" variant="outline" onClick={() => void copy()}>
              <CopyIcon aria-hidden="true" />
              {d('key.copy', 'Copy')}
            </Button>
          </div>
          <DialogFooter>
            <Button type="button" onClick={close}>
              {d('key.done', 'Done')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={d('key.confirmTitle', 'Did you copy the key?')}
        description={d('key.confirmBody', 'You will not see this key again.')}
        confirmLabel={d('key.confirmYes', 'Yes, I copied it')}
        cancelLabel={d('key.confirmNo', 'Go back')}
        tone="default"
        onConfirm={onDone}
      />
    </>
  );
}

export function AddDeviceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const d = useDeviceText();
  const create = useCreateAttendanceDevice();
  const sectionOptions = useSectionOptions();
  const [name, setName] = React.useState('');
  const [kind, setKind] = React.useState<DeviceKind>('BIOMETRIC');
  const [sectionId, setSectionId] = React.useState<string | null>(null);
  const [rosterAccess, setRosterAccess] = React.useState(false);
  const [secret, setSecret] = React.useState<string | null>(null);
  const [nameError, setNameError] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setName('');
      setKind('BIOMETRIC');
      setSectionId(null);
      setRosterAccess(false);
      setSecret(null);
      setNameError(false);
      create.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return setNameError(true);
    create.mutate(
      {
        name: trimmed,
        kind,
        roster_access: rosterAccess,
        ...(sectionId ? { section_id: sectionId } : {}),
      },
      { onSuccess: (res) => setSecret(res.key) },
    );
  }

  if (secret !== null) {
    return open ? (
      <KeyView
        secret={secret}
        onDone={() => {
          // Drop the key from state and the mutation cache once it has been copied.
          setSecret(null);
          create.reset();
          onOpenChange(false);
        }}
      />
    ) : null;
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (create.isPending ? undefined : onOpenChange(next))}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{d('add.title', 'Add attendance machine')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <div>
            <label htmlFor="device-name" className="text-label text-text-primary">
              {d('form.name', 'Name')}
            </label>
            <Input
              id="device-name"
              className="mt-1.5"
              maxLength={80}
              value={name}
              aria-invalid={nameError}
              onChange={(e) => {
                setName(e.target.value);
                setNameError(false);
              }}
            />
            {nameError ? (
              <p role="alert" className="mt-1 text-caption text-destructive">
                {d('form.nameError', 'Enter a name for the machine.')}
              </p>
            ) : null}
          </div>
          <div>
            <label htmlFor="device-kind" className="text-label text-text-primary">
              {d('form.kind', 'Kind')}
            </label>
            <Select value={kind} onValueChange={(v) => setKind(v as DeviceKind)}>
              <SelectTrigger id="device-kind" className="mt-1.5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DEVICE_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {d(`kind.${k}`, KIND_FALLBACK[k])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <span className="text-label text-text-primary">
              {d('form.section', 'Section (optional)')}
            </span>
            <Combobox
              className="mt-1.5"
              aria-label={d('form.section', 'Section (optional)')}
              placeholder={d('wholeSchool', 'Whole school')}
              options={sectionOptions}
              value={sectionId}
              onValueChange={setSectionId}
            />
          </div>
          <div className="flex min-h-11 items-center justify-between gap-3">
            <label htmlFor="device-roster">
              <span className="block font-medium">{d('form.roster', 'Roster access')}</span>
              <span className="block text-text-secondary">
                {d('form.rosterHelp', 'Lets the machine download the student list.')}
              </span>
            </label>
            <Switch id="device-roster" checked={rosterAccess} onCheckedChange={setRosterAccess} />
          </div>
          {create.isError ? (
            <p role="alert" className="text-caption text-destructive">
              {d('form.saveError', 'Could not add the machine. Try again.')}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={create.isPending} onClick={() => onOpenChange(false)}>
              {d('form.cancel', 'Cancel')}
            </Button>
            <Button type="submit" loading={create.isPending}>
              {d('form.save', 'Add machine')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Rotate: confirm, then show the new key once. Mounted per device (the hook binds the id). */
export function RotateDeviceDialog({
  device,
  onClose,
}: {
  device: AttendanceDevice;
  onClose: () => void;
}) {
  const d = useDeviceText();
  const rotate = useRotateAttendanceDeviceKey(device.id);
  const [secret, setSecret] = React.useState<string | null>(null);

  if (secret !== null) {
    return (
      <KeyView
        secret={secret}
        onDone={() => {
          setSecret(null);
          rotate.reset();
          onClose();
        }}
      />
    );
  }
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={d('rotate.title', 'Make a new key?')}
      description={d(
        'rotate.body',
        '{{name}} stops working until you put the new key into it. The old key stops now.',
        { name: device.name },
      )}
      confirmLabel={d('rotate.confirm', 'Make new key')}
      cancelLabel={d('form.cancel', 'Cancel')}
      tone="default"
      busy={rotate.isPending}
      onConfirm={() =>
        rotate.mutate(undefined, {
          onSuccess: (res) => setSecret(res.key),
          onError: () => toast.error(d('rotate.error', 'Could not make a new key. Try again.')),
        })
      }
    />
  );
}

export function RevokeDeviceDialog({
  device,
  onClose,
}: {
  device: AttendanceDevice;
  onClose: () => void;
}) {
  const d = useDeviceText();
  const revoke = useRevokeAttendanceDevice(device.id);
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={d('revoke.title', 'Revoke this machine?')}
      description={d(
        'revoke.body',
        '{{name}} will no longer send attendance. Past attendance stays.',
        { name: device.name },
      )}
      confirmLabel={d('revoke.confirm', 'Revoke')}
      cancelLabel={d('form.cancel', 'Cancel')}
      busy={revoke.isPending}
      onConfirm={() =>
        revoke.mutate(undefined, {
          onSuccess: () => toast.success(d('revoke.done', 'Machine revoked')),
          onError: () => toast.error(d('revoke.error', 'Could not revoke the machine. Try again.')),
          onSettled: onClose,
        })
      }
    />
  );
}
