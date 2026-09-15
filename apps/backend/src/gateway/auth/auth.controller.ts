import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Res,
  HttpCode,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthService } from '../../bll/auth/auth.service';
import {
  RotationService,
  type RotationApplied,
  type RotationProgress,
  type RotationStarted,
} from '../../bll/rotation/rotation.service';
import { type SectionName } from '../../services/crypto/crypto-config';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly rotation: RotationService,
  ) {}

  @Get('status')
  async status(): Promise<Record<string, boolean>> {
    return this.auth.status();
  }

  @Post('login')
  async login(@Body() body: { password: string }): Promise<{ ok: boolean }> {
    const ok = await this.auth.login(body.password);
    if (!ok) throw new HttpException({ ok: false }, HttpStatus.UNAUTHORIZED);
    return { ok };
  }

  @Post('set-login')
  async setLogin(@Body() body: { password: string }): Promise<{ ok: boolean }> {
    await this.auth.setLoginPassword(body.password);
    return { ok: true };
  }

  @Post('unlock/:section')
  async unlock(
    @Param('section') section: string,
    @Body() body: { passphrase: string },
  ): Promise<{ ok: boolean }> {
    if (!this.auth.validSection(section)) {
      throw new HttpException({ ok: false, message: 'invalid section' }, HttpStatus.BAD_REQUEST);
    }
    const ok = await this.auth.unlockSection(section as SectionName, body.passphrase);
    if (!ok) throw new HttpException({ ok: false }, HttpStatus.UNAUTHORIZED);
    return { ok };
  }

  @Post('lock/:section')
  lock(@Param('section') section: string): { ok: boolean } {
    if (section === 'all') {
      this.auth.lockAll();
      return { ok: true };
    }
    if (!this.auth.validSection(section)) {
      throw new HttpException({ ok: false, message: 'invalid section' }, HttpStatus.BAD_REQUEST);
    }
    this.auth.lockSection(section as SectionName);
    return { ok: true };
  }

  // ============ ROTATION (spec 013) ============

  /**
   * Starts the rotation of a section, or resumes the job already open for it. 202 when the
   * work moved to the background, 200 when the section had nothing to stage and the swap
   * happened inline; the guards of the request answer 400, 401 and 409.
   */
  @Post('change-passphrase/:section')
  async changePassphrase(
    @Param('section') section: string,
    @Body() body: { current?: string; next?: string },
    @Res({ passthrough: true }) res: Response,
  ): Promise<RotationStarted | RotationApplied> {
    const result = await this.rotation.start(section, body?.current ?? '', body?.next ?? '');
    res.status('jobId' in result ? HttpStatus.ACCEPTED : HttpStatus.OK);
    return result;
  }

  @Get('change-passphrase/:section/status')
  rotationStatus(@Param('section') section: string): Promise<RotationProgress> {
    return this.rotation.status(section);
  }

  @Post('change-passphrase/:section/cancel')
  @HttpCode(HttpStatus.OK)
  cancelRotation(@Param('section') section: string): Promise<{ ok: true; discarded: number }> {
    return this.rotation.cancel(section);
  }

  @Post('set-passphrase/:section')
  async setPassphrase(
    @Param('section') section: string,
    @Body() body: { passphrase: string },
  ): Promise<{ ok: boolean }> {
    if (!this.auth.validSection(section)) {
      throw new HttpException({ ok: false, message: 'invalid section' }, HttpStatus.BAD_REQUEST);
    }
    const alreadySet = await this.auth.isSectionSet(section as SectionName);
    if (alreadySet) {
      // Change passphrase requires re-encryption (future)
      throw new HttpException({ ok: false, message: 'passphrase already set; use change-passphrase' }, HttpStatus.CONFLICT);
    }
    await this.auth.setSectionPassphrase(section as SectionName, body.passphrase);
    return { ok: true };
  }
}