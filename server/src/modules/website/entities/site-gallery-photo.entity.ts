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
} from 'typeorm';
import { School } from '../../schools/entities/school.entity';
import { SiteGalleryAlbum } from './site-gallery-album.entity';
import { SiteMedia } from './site-media.entity';

/** [40.6.02] One photo in an album. Delete guards: see `site-gallery-album.entity.ts` header. */
@Unique('UQ_site_gallery_photos_album_media', ['album_id', 'media_id'])
@Index('IDX_site_gallery_photos_album_sort', ['album_id', 'sort_order'])
@Index('IDX_site_gallery_photos_media', ['tenant_id', 'media_id'])
@Entity('site_gallery_photos')
export class SiteGalleryPhoto {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id', foreignKeyConstraintName: 'FK_site_gallery_photos_tenant_id' })
  tenant: School;

  @Column({ type: 'uuid' })
  album_id: string;

  // In the DB this FK is composite: (tenant_id, album_id) -> site_gallery_albums(tenant_id, id).
  @ManyToOne(() => SiteGalleryAlbum, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'album_id', foreignKeyConstraintName: 'FK_site_gallery_photos_album_id' })
  album: SiteGalleryAlbum;

  @Column({ type: 'uuid' })
  media_id: string;

  // Composite too: (tenant_id, media_id) -> site_media(tenant_id, id).
  @ManyToOne(() => SiteMedia, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'media_id', foreignKeyConstraintName: 'FK_site_gallery_photos_media_id' })
  media: SiteMedia;

  @Column({ type: 'jsonb', nullable: true })
  caption: BilingualText | null;

  @Column({ type: 'int', default: 0 })
  sort_order: number;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
