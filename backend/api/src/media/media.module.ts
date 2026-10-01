import { Module } from '@nestjs/common';

import { ProfilePhotoService } from './profile-photo.service';
import { LocalMediaStorageProvider, MediaStorageService } from './media-storage.service';

/**
 * Registers media storage. Only the local development provider exists today;
 * the {@link MediaStorageService} facade is what feature code injects, so adding
 * a real vendor means implementing the provider here and nothing else.
 */
@Module({
  providers: [MediaStorageService, LocalMediaStorageProvider, ProfilePhotoService],
  exports: [MediaStorageService, ProfilePhotoService],
})
export class MediaModule {}
