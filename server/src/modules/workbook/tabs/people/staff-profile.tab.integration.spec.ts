import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource, Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { TestingModule } from '@nestjs/testing';
import { School } from '../../../schools/entities/school.entity';
import { User } from '../../../users/entities/user.entity';
import { StaffProfile } from '../../../staff-profiles/entities/staff-profile.entity';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { staffProfileTab, type StaffProfileRow } from './staff-profile.tab';

/**
 * `staff_profiles` is unique per school on both `employee_id` and `user_id`
 * (no soft delete). A restore row whose employee id was edited after export
 * must not insert a second profile for the same user (23505 aborting the
 * restore): it takes the user's own profile over, or names the clash.
 */
describe('staffProfileTab (integration)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let schoolRepo: Repository<School>;
  let userRepo: Repository<User>;
  let profileRepo: Repository<StaffProfile>;

  const TENANT_A = '33333333-3333-4333-8333-333333333333';
  const DOMAIN = '@staff-profile-tab.test';

  beforeAll(async () => {
    module = await createTestModule(ALL_ENTITIES, []);
    dataSource = module.get(DataSource);
    schoolRepo = module.get<Repository<School>>(getRepositoryToken(School));
    userRepo = module.get<Repository<User>>(getRepositoryToken(User));
    profileRepo = module.get<Repository<StaffProfile>>(getRepositoryToken(StaffProfile));
  });

  afterAll(async () => {
    await module?.close();
  });

  beforeEach(async () => {
    await profileRepo.delete({ tenant_id: TENANT_A });
    await userRepo
      .createQueryBuilder()
      .delete()
      .where('email LIKE :d', { d: `%${DOMAIN}` })
      .execute();
    await schoolRepo.delete({ id: TENANT_A });
    await schoolRepo.save(
      schoolRepo.create({ id: TENANT_A, name: 'Staff Tab School', slug: 'staff-profile-tab-a' }),
    );
  });

  const makeUser = (name: string) =>
    userRepo.save(
      userRepo.create({
        email: `${name}${DOMAIN}`,
        phone: null,
        full_name: name,
        password_hash: null,
      }),
    );

  const rowFor = (overrides: Partial<StaffProfileRow>): StaffProfileRow => ({
    id: '00000000-0000-4000-8000-000000000000',
    user_id: '',
    employee_id: 'STF-1',
    joining_date: null,
    card_no: null,
    user_key: '',
    ...overrides,
  });

  const upsert = (row: StaffProfileRow, existing: StaffProfile | null = null) =>
    staffProfileTab.upsert(row, existing, TENANT_A, dataSource.manager);

  it('stores card_no and keeps a null card null', async () => {
    const user = await makeUser('carded');
    const withCard = await upsert(rowFor({ user_id: user.id, card_no: 'C-7' }));
    expect((await profileRepo.findOneByOrFail({ id: withCard.id })).card_no).toBe('C-7');

    const other = await makeUser('nocard');
    const none = await upsert(rowFor({ user_id: other.id, employee_id: 'STF-2' }));
    expect((await profileRepo.findOneByOrFail({ id: none.id })).card_no).toBeNull();
  });

  it("takes over the user's own profile when no profile has the employee id (edited after export)", async () => {
    const user = await makeUser('renamed');
    const held = await upsert(rowFor({ user_id: user.id, employee_id: 'STF-OLD' }));

    const again = await upsert(rowFor({ user_id: user.id, employee_id: 'STF-NEW' }));

    expect(again.id).toBe(held.id);
    expect((await profileRepo.findOneByOrFail({ id: held.id })).employee_id).toBe('STF-NEW');
    expect(await profileRepo.countBy({ tenant_id: TENANT_A, user_id: user.id })).toBe(1);
  });

  it('refuses with a clear error when the user already holds a different profile (no 23505)', async () => {
    const user = await makeUser('holder');
    await upsert(rowFor({ user_id: user.id, employee_id: 'STF-HELD' }));
    const other = await upsert(
      rowFor({ user_id: (await makeUser('other')).id, employee_id: 'STF-OTHER' }),
    );

    await expect(
      upsert(rowFor({ user_id: user.id, employee_id: 'STF-OTHER', user_key: 'holder' }), other),
    ).rejects.toThrow(/already belongs to a different staff profile/);
  });
});
