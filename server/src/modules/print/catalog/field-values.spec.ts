import type { EntityManager } from 'typeorm';
import { schoolValues } from './field-values';
import { SchoolSite } from '../../website/entities/school-site.entity';

const SCHOOL = { id: 't1', name: 'Green', issuer_snapshot: null };

function mgr(site: Partial<SchoolSite> | null) {
  const findOne = vi.fn(async (entity: unknown) => (entity === SchoolSite ? site : SCHOOL));
  return { manager: { findOne } as unknown as EntityManager, findOne };
}

describe('schoolValues website fields', () => {
  beforeEach(() => {
    process.env.SITE_ROOT_DOMAIN = 'Schools.Test';
  });
  afterEach(() => {
    delete process.env.SITE_ROOT_DOMAIN;
  });

  const both = (v: Record<string, string>) => [v['school.website_url'], v['school.website_qr']];

  it('is empty when there is no site or it is off', async () => {
    expect(both(await schoolValues('t1', mgr(null).manager))).toEqual(['', '']);
    const off = { enabled: false, subdomain: 'green' };
    expect(both(await schoolValues('t1', mgr(off).manager))).toEqual(['', '']);
  });

  it('uses the subdomain on the root, and reads the site by tenant', async () => {
    const { manager, findOne } = mgr({ enabled: true, subdomain: 'green' });
    expect(both(await schoolValues('t1', manager))).toEqual([
      'https://green.schools.test',
      'https://green.schools.test',
    ]);
    expect(findOne).toHaveBeenCalledWith(SchoolSite, { where: { tenant_id: 't1' } });
  });

  it('uses an ACTIVE custom domain only', async () => {
    const site = { enabled: true, subdomain: 'green', custom_domain: 'www.green.edu.bd' };
    const active = { ...site, custom_domain_status: 'ACTIVE' };
    expect((await schoolValues('t1', mgr(active).manager))['school.website_url']).toBe(
      'https://www.green.edu.bd',
    );
    for (const st of ['PENDING_VALIDATION', 'FAILED', null]) {
      const v = await schoolValues('t1', mgr({ ...site, custom_domain_status: st }).manager);
      expect(v['school.website_url']).toBe('https://green.schools.test');
    }
  });

  it('is empty when the root domain is unset and no custom domain is live', async () => {
    delete process.env.SITE_ROOT_DOMAIN;
    const v = await schoolValues('t1', mgr({ enabled: true, subdomain: 'green' }).manager);
    expect(v['school.website_url']).toBe('');
  });
});
