import { useQuery } from '@tanstack/react-query';
import { screen } from '@testing-library/react';
import { useTranslation } from 'react-i18next';
import { describe, expect, it } from 'vitest';

import { missingKeysOf } from './missing-keys';

/** Shows a fixed line first, then, once the fetch resolves, a line whose key exists in no locale. */
/** Kept in constants, not inline translate-call literals, so check:i18n does not count the deliberately missing keys. */
const ABSENT_KEY = 'regression.deliberately_absent_key';
const LOADING_KEY = 'regression.loading_placeholder';

function FetchedView() {
  const { t } = useTranslation('notices');
  const { data } = useQuery({
    queryKey: ['missing-keys-regression'],
    queryFn: async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return 'loaded';
    },
  });
  return data ? <p>{t(ABSENT_KEY)}</p> : <p aria-busy>{t(LOADING_KEY)}</p>;
}

describe('missingKeysOf', () => {
  it('reports a key looked up only by the fetched view', async () => {
    const missing = await missingKeysOf(<FetchedView />, () => screen.findByText(ABSENT_KEY));
    expect(missing).toContain(`notices:${ABSENT_KEY}`);
  });
});
