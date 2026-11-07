import type { BilingualText } from '@biddaloy/shared';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { School } from '../../schools/entities/school.entity';

/**
 * [40.6.02] A photo-gallery album. Delete guards (Rule 27), mirror of migration
 * `SiteGallery1791900003600`:
 *  - `schools` -> albums / photos: ON DELETE CASCADE (website data dies with a HARD school delete).
 *  - album <- photos: RESTRICT. A stray `remove()` fails loudly; the gallery service refuses (409)
 *    to delete an album that still has photos (registered in `delete-guard-registry.ts`).
 *  - `site_media` <- photos: RESTRICT. A picture shown in a gallery cannot be deleted.
 * The photo FKs are composite `(tenant_id, id)`, so the DB refuses another school's album/picture.
 */
@Unique('UQ_site_gallery_albums_tenant_id', ['tenant_id', 'id'])
@Index('IDX_site_gallery_albums_tenant_sort', ['tenant_id', 'sort_order'])
@Entity('site_gallery_albums')
export class SiteGalleryAlbum {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id', foreignKeyConstraintName: 'FK_site_gallery_albums_tenant_id' })
  tenant: School;

  @Column({ type: 'jsonb' })
  title: BilingualText;

  @Column({ type: 'int', default: 0 })
  sort_order: number;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
