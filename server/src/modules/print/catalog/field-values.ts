import type { EntityManager } from 'typeorm';
import { FIELD_CATALOG, type DocumentKind } from '@biddaloy/shared';
import { School } from '../../schools/entities/school.entity';
import { SchoolSite } from '../../website/entities/school-site.entity';
import { resolveIssuer } from '../../schools/profile/issuer-snapshot';

/** Every catalog key of `kind`, all ''. Resolvers overwrite what they know. */
export function blankValues(kind: DocumentKind): Record<string, string> {
  return Object.fromEntries(FIELD_CATALOG[kind].map((f) => [f.key, '']));
}

/** The `school.*` values shared by every kind (`school.logo` = the logo key). */
export async function schoolValues(
  tenantId: string,
  manager: EntityManager,
): Promise<Record<string, string>> {
  const school = await manager.findOne(School, { where: { id: tenantId } });
  if (!school) return {};
  const i = resolveIssuer({ issuer_snapshot: null }, school);
  // ponytail: second read, no join; fine at print volume.
  const site = await manager.findOne(SchoolSite, { where: { tenant_id: tenantId } });
  const website = websiteUrl(site);
  return {
    'school.name': i.name,
    'school.name_bn': i.name_bn ?? '',
    'school.address': i.address ?? '',
    'school.phone': i.phone ?? '',
    'school.eiin': i.registration_id ?? '',
    'school.logo': i.logo_key ?? '',
    'school.website_url': website,
    'school.website_qr': website,
  };
}

/** The live site address, or '' when the site is off. A custom domain counts only once ACTIVE (a FAILED claim is released). */
function websiteUrl(site: SchoolSite | null): string {
  if (!site?.enabled) return '';
  if (site.custom_domain && site.custom_domain_status === 'ACTIVE') {
    return `https://${site.custom_domain}`;
  }
  const root = process.env.SITE_ROOT_DOMAIN?.trim().toLowerCase();
  return root ? `https://${site.subdomain}.${root}` : '';
}
