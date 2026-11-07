import { describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';
import { NotFoundException } from '@nestjs/common';
import { SchoolStatus, SiteMediaSlot } from '@biddaloy/shared';
import { PublicSiteService } from './public-site.service';
import { buildManifest } from './page-read-model';

const TENANT = 'tenant-a';
const published = {
  theme: 'basic',
  palette: 'green',
  typography: {},
  announcements: { items: [] },
  pages: [],
} as never;
const school = (logo_key: string | null) =>
  ({
    status: SchoolStatus.ACTIVE,
    name: 'S',
    name_bn: null,
    logo_key,
    updated_at: new Date(0),
  }) as never;

function make(siteLogo: { id: string; storage_key: string } | null, profileKey: string | null) {
  const mediaFindOne = vi.fn().mockResolvedValue(siteLogo);
  const getForTenant = vi.fn().mockResolvedValue({ body: Readable.from(['x']) });
  const svc = new PublicSiteService(
    {
      resolve: async () => ({ site: { tenant_id: TENANT, enabled: true, published, version: 1 } }),
    } as never,
    { getOrLoad: async (_t: string, _v: number, _k: string, f: () => unknown) => f() } as never,
    { getForTenant } as never,
    { findOne: async () => school(profileKey) } as never,
    { findOne: mediaFindOne } as never,
    {} as never,
    {} as never,
  );
  return { svc, mediaFindOne, getForTenant };
}

describe('public site logo', () => {
  it('the logo from the website screens beats the school profile logo', async () => {
    const { svc, getForTenant, mediaFindOne } = make(
      { id: 'm', storage_key: 'site-key' },
      'profile-key',
    );
    await svc.mediaFile('h', 'logo');
    expect(getForTenant).toHaveBeenCalledWith('site-key', TENANT);
    // Tenant isolation: only this school's rows, newest first.
    expect(mediaFindOne).toHaveBeenCalledWith({
      where: { tenant_id: TENANT, slot: SiteMediaSlot.LOGO },
      order: { created_at: 'DESC', id: 'DESC' },
    });
    const m = await svc.manifest('h');
    expect('data' in m && m.data.logo).toBe('/media/logo');
  });

  it('with no site logo the profile logo is used', async () => {
    const { svc, getForTenant } = make(null, 'profile-key');
    await svc.mediaFile('h', 'logo');
    expect(getForTenant).toHaveBeenCalledWith('profile-key', TENANT);
  });

  it('with neither, /media/logo is 404 and the manifest has no logo', async () => {
    const { svc } = make(null, null);
    await expect(svc.mediaFile('h', 'logo')).rejects.toBeInstanceOf(NotFoundException);
    const m = await svc.manifest('h');
    expect('data' in m && m.data.logo).toBeUndefined();
  });

  it('buildManifest shows a logo when only the site logo exists', () => {
    expect(buildManifest(published, false, { logo_key: null } as never, true).logo).toBe(
      '/media/logo',
    );
  });
});
