import { Controller, Get, Post, Param, Body, HttpException, HttpStatus } from '@nestjs/common';
import { AuthService } from '../../bll/auth/auth.service';
import { type SectionName } from '../../services/crypto/crypto-config';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

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