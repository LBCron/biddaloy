import { useQuery } from '@tanstack/react-query';
import { screen } from '@testing-library/react';
import { useTranslation } from 'react-i18next';
import { describe, expect, it } from 'vitest';

import { missingKeysOf } from './missing-keys';

/** Shows a fixed line first, then, once the fetch resolves, a line whose key exists in no locale. */
function FetchedView() {
  const { t } = useTranslation('notices');
  const { data } = useQuery({
    queryKey: ['missing-keys-regression'],
    queryFn: async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return 'loaded';
    },
  });
  return data ? (
    <p>{t('regression.deliberately_absent_key')}</p>
  ) : (
    <p aria-busy>{t('regression.loading_placeholder')}</p>
  );
}

describe('missingKeysOf', () => {
  it('reports a key looked up only by the fetched view', async () => {
    const missing = await missingKeysOf(<FetchedView />, () =>
      screen.findByText('regression.deliberately_absent_key'),
    );
    expect(missing).toContain('notices:regression.deliberately_absent_key');
  });
});
