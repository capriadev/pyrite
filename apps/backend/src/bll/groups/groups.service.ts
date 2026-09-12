import { ConflictException, Injectable } from '@nestjs/common';
import { GroupsRepository, type GroupDomain } from '../../dal/groups/groups.repository';

@Injectable()
export class GroupsService {
  constructor(private readonly repo: GroupsRepository) {}

  async list(domain: GroupDomain) {
    return this.repo.findAll(domain);
  }

  async create(domain: GroupDomain, name: string) {
    const trimmed = (name ?? '').trim();
    if (!trimmed) throw new ConflictException('group name is required');
    const existing = await this.repo.findByName(domain, trimmed);
    if (existing) throw new ConflictException('group already exists');
    return this.repo.create(domain, trimmed);
  }

  async remove(domain: GroupDomain, id: string): Promise<void> {
    await this.repo.softDelete(domain, id);
  }
}
