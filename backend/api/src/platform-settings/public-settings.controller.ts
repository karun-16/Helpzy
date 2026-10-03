import { Controller, Get, UseGuards } from '@nestjs/common';
import { OptionalAuthGuard } from '../auth/optional-auth.guard';

import { PlatformSettingsService } from './platform-settings.service';

/**
 * The public slice of platform settings.
 *
 * Unauthenticated on purpose: an announcement and a maintenance notice have to be
 * readable by someone who has not signed in yet, otherwise a first-time visitor
 * during an outage sees an empty app with no explanation.
 *
 * It returns `publicView` and never the whole document. `publicView` is built from
 * fields chosen individually, so adding an internal setting later cannot leak it by
 * forgetting to exclude it.
 */
@Controller('platform/settings')
@UseGuards(OptionalAuthGuard)
export class PublicSettingsController {
  constructor(private readonly settings: PlatformSettingsService) {}

  @Get()
  async read() {
    const document = await this.settings.current();
    const response = await this.settings.response(document, null);
    return { publicView: response.publicView };
  }
}
