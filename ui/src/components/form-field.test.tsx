import { zodResolver } from '@hookform/resolvers/zod';
import { render as rtlRender, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { useForm } from 'react-hook-form';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { I18nProvider, i18n, whenReady } from '../i18n';

import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from './form-field';
import { HelpProvider, type HelpIndex } from './help-hint';
import { Input } from './input';

const schema = z.object({
  studentName: z.string().min(1, 'Name is required'),
});

function NameForm({
  onSubmit,
  required,
  helpId,
}: {
  onSubmit: (values: z.infer<typeof schema>) => void;
  required?: boolean;
  helpId?: string;
}) {
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { studentName: '' },
  });

  return (
    <Form {...form}>
      <form onSubmit={(event) => void form.handleSubmit(onSubmit)(event)}>
        <FormField
          control={form.control}
          name="studentName"
          render={({ field }) => (
            <FormItem>
              <FormLabel required={required} helpId={helpId}>
                Student name
              </FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormDescription>As it appears on the birth certificate.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <button type="submit">Save</button>
      </form>
    </Form>
  );
}

const render = (ui: ReactElement) => rtlRender(ui, { wrapper: I18nProvider });

beforeEach(async () => {
  await whenReady(i18n);
  await i18n.changeLanguage('en');
});

describe('FormField', () => {
  it('links the label to the control via a real association', async () => {
    const { container } = render(<NameForm onSubmit={vi.fn()} />);
    const input = screen.getByRole('textbox', { name: 'Student name' });
    expect(input).toBeTruthy();
    await expect(container).toHaveNoViolations();
  });

  it('required label shows an aria-hidden star and an sr-only "(required)" in the accessible name', () => {
    render(<NameForm onSubmit={vi.fn()} required />);
    const star = screen.getByText('*');
    expect(star.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByText('(required)').className).toContain('sr-only');
    expect(screen.getByRole('textbox', { name: /\(required\)/ })).toBeTruthy();
  });

  it('with helpId, clicking the label still focuses the input and the (?) shows beside it', async () => {
    const user = userEvent.setup();
    const index: HelpIndex = {
      'x.field.name': {
        title: { bn: 'নাম', en: 'Name' },
        summary: { bn: 'নাম', en: 'Name help' },
        path: 'p',
        anchor: 'more',
        knownIssues: 0,
      },
    };
    rtlRender(
      <HelpProvider index={index} lang="en" baseUrl="https://g.test">
        <NameForm onSubmit={vi.fn()} helpId="x.field.name" />
      </HelpProvider>,
      { wrapper: I18nProvider },
    );
    expect(await screen.findByRole('button', { name: 'Help: Student name' })).toBeTruthy();
    await user.click(screen.getByText('Student name'));
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: /Student name/ }));
  });

  it('with helpId but no provider (no (?)), the label keeps its DOM: no wrapper span', () => {
    render(<NameForm onSubmit={vi.fn()} helpId="x.field.name" />);
    const label = screen.getByText('Student name');
    expect(label.tagName).toBe('LABEL');
    expect(label.parentElement!.tagName).not.toBe('SPAN');
  });

  it('has no star when not required', () => {
    render(<NameForm onSubmit={vi.fn()} />);
    expect(screen.queryByText('*')).toBeNull();
  });

  it('help text uses the caption ramp', () => {
    render(<NameForm onSubmit={vi.fn()} />);
    expect(screen.getByText('As it appears on the birth certificate.').className).toContain(
      'text-caption',
    );
  });

  it('error message renders the alert icon beside the text', async () => {
    const user = userEvent.setup();
    render(<NameForm onSubmit={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const alert = await screen.findByRole('alert');
    expect(alert.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(alert.textContent).toBe('Name is required');
  });

  it('has no aria-invalid and no error message before submit', () => {
    render(<NameForm onSubmit={vi.fn()} />);
    const input = screen.getByRole('textbox', { name: 'Student name' });
    expect(input.getAttribute('aria-invalid')).toBe('false');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('on a failed submit, sets aria-invalid, links the error via aria-describedby, and announces it via role=alert', async () => {
    const user = userEvent.setup();
    render(<NameForm onSubmit={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const input = await screen.findByRole('textbox', { name: 'Student name' });
    await waitFor(() => expect(input.getAttribute('aria-invalid')).toBe('true'));

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe('Name is required');

    const describedBy = input.getAttribute('aria-describedby') ?? '';
    expect(describedBy.split(' ')).toContain(alert.id);
  });

  it('calls onSubmit with valid data', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<NameForm onSubmit={onSubmit} />);
    await user.type(screen.getByRole('textbox', { name: 'Student name' }), 'Rahim Uddin');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({ studentName: 'Rahim Uddin' }, expect.anything()),
    );
  });

  it('useFormField throws outside a FormField/FormItem — a guardrail against a wrapper misuse, not a UI state', () => {
    // Rendered outside <Form>/<FormField> entirely: useFormContext() itself
    // throws first (a plain RHF error), proving nothing in this file swallows
    // a missing provider.
    function Broken() {
      return (
        <FormItem>
          <FormLabel>orphaned</FormLabel>
        </FormItem>
      );
    }
    expect(() => render(<Broken />)).toThrow();
  });

  it("FormLabel/FormControl throw this file's own error when used outside FormField, even with a real Form provider present", () => {
    function OutsideFormField() {
      const form = useForm({ defaultValues: { studentName: '' } });
      return (
        <Form {...form}>
          <FormItem>
            <FormLabel>orphaned</FormLabel>
          </FormItem>
        </Form>
      );
    }
    expect(() => render(<OutsideFormField />)).toThrow(
      'useFormField must be used within <FormField>',
    );
  });

  it("FormLabel throws this file's own error when used outside FormItem, even inside a real FormField", () => {
    function OutsideFormItem() {
      const form = useForm({ defaultValues: { studentName: '' } });
      return (
        <Form {...form}>
          <FormField
            control={form.control}
            name="studentName"
            render={() => <FormLabel>orphaned</FormLabel>}
          />
        </Form>
      );
    }
    expect(() => render(<OutsideFormItem />)).toThrow(
      'useFormField must be used within <FormItem>',
    );
  });
});
