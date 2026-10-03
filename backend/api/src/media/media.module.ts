import { Module } from '@nestjs/common';

import { ProfilePhotoService } from './profile-photo.service';
import {
  LocalMediaStorageProvider,
  MediaStorageService,
  PrivateMediaStorageProvider,
} from './media-storage.service';

/**
 * Registers media storage.
 *
 * Two providers with deliberately different exposure:
 * {@link LocalMediaStorageProvider} produces public URLs for profile photos, while
 * {@link PrivateMediaStorageProvider} has no URL concept at all and backs
 * verification documents. The {@link MediaStorageService} facade is what feature
 * code injects, so adding a real vendor means implementing a provider here and
 * nothing else.
 */
@Module({
  providers: [
    MediaStorageService,
    LocalMediaStorageProvider,
    PrivateMediaStorageProvider,
    ProfilePhotoService,
  ],
  exports: [MediaStorageService, ProfilePhotoService],
})
export class MediaModule {}
