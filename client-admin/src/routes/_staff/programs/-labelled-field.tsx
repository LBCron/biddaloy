/**
 * A visible label above one control — the programs pages' stand-in for the kit's
 * `FormField label=…` (the kit `FormField` is react-hook-form only). Lane-local on purpose.
 */
import { Label } from '@biddaloy/ui/components';
import * as React from 'react';

export function LabelledField({
  id,
  label,
  required,
  helpId,
  className,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  helpId?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`flex flex-col gap-1.5 ${className ?? ''}`}>
      <Label htmlFor={id} helpId={helpId} helpLabel={label}>
        {label}
        {required && (
          <span aria-hidden="true" className="text-destructive">
            {' *'}
          </span>
        )}
      </Label>
      {required && React.isValidElement<{ id?: string }>(children) && children.props.id === id
        ? React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
            'aria-required': true,
          })
        : children}
    </div>
  );
}
