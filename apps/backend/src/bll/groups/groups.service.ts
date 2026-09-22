import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, type OnApplicationBootstrap } from '@nestjs/common';
import { GroupsRepository, type GroupDomain, type GroupNode, type GroupRow } from '../../dal/groups/groups.repository';
import { isUuid } from '../../types/guards';

/** The folder the engine files payment tasks under when nothing else is configured (spec 021). */
export const SYSTEM_FINANCES_GROUP = 'finances';

/**
 * Shared per-domain tree of groups (spec 016). Each domain keeps its own namespace and,
 * inside it, the nodes form a tree: equality is per level, a node can be renamed or moved,
 * and a move that would close a cycle is rejected before touching SQL. Domains that never
 * nest (apis, notes, counts) keep working exactly as before because all their nodes are
 * roots.
 *
 * Spec 021 adds the system nodes: created by the code at boot, never renamed, never deleted
 * and never used as a parent. The engine resolves its destination by id, so rotating it leaves
 * the tasks already created where they are.
 */
@Injectable()
export class GroupsService implements OnApplicationBootstrap {
  private readonly log = new Logger(GroupsService.name);

  constructor(private readonly repo: GroupsRepository) {}

  /** `finances/` exists before any movement asks for it: the engine's default destination. */
  async onApplicationBootstrap(): Promise<void> {
    await this.ensureSystemGroup('tasks', SYSTEM_FINANCES_GROUP);
  }

  /** Idempotent: creating it twice is a no-op, which is what a restart needs. */
  async ensureSystemGroup(domain: GroupDomain, name: string): Promise<GroupRow> {
    const existing = await this.repo.findByName(domain, name, null);
    if (existing) return existing;
    const created = await this.repo.create(domain, name, null, true);
    this.log.log(`System group '${name}' created in domain '${domain}'`);
    return created;
  }

  /** The system nodes of a domain: what the tree read marks so the UI hides edit actions. */
  async systemGroups(domain: GroupDomain): Promise<GroupRow[]> {
    const all = await this.repo.findAll(domain);
    return all.filter((group) => group.isSystem);
  }

  /** Every active node of the domain, flat: the historical behaviour. */
  async list(domain: GroupDomain) {
    return this.repo.findAll(domain);
  }

  /** Direct children of a node (roots when `parentId` is null). */
  async children(domain: GroupDomain, parentId: string | null = null): Promise<GroupRow[]> {
    const all = await this.repo.findAll(domain);
    return all.filter((group) => group.parentId === parentId);
  }

  /** Nested read: the whole domain in one response, assembled in memory from the flat list. */
  async tree(domain: GroupDomain): Promise<GroupNode[]> {
    const all = await this.repo.findAll(domain);
    const nodes = new Map<string, GroupNode>(all.map((group) => [group.id, { ...group, children: [] }]));
    const roots: GroupNode[] = [];
    for (const node of nodes.values()) {
      const parent = node.parentId ? nodes.get(node.parentId) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    return roots;
  }

  async create(domain: GroupDomain, name: string, parentId: string | null = null) {
    const trimmed = this.name(name);
    if (parentId) await this.require(domain, parentId);
    const existing = await this.repo.findByName(domain, trimmed, parentId);
    if (existing) throw new ConflictException('group already exists at this level');
    return this.repo.create(domain, trimmed, parentId);
  }

  /** Rename and/or move in one call; each is validated before it is applied. */
  async update(domain: GroupDomain, id: string, input: { name?: string; parentId?: string | null }): Promise<GroupRow> {
    const current = await this.require(domain, id);
    this.refuseSystem(current, 'edited');
    const targetParent = input.parentId !== undefined ? input.parentId : current.parentId;
    if (input.name !== undefined) {
      const trimmed = this.name(input.name);
      const clash = await this.repo.findByName(domain, trimmed, targetParent);
      if (clash && clash.id !== id) throw new ConflictException('group already exists at this level');
      await this.repo.rename(domain, id, trimmed);
    }
    if (input.parentId !== undefined) await this.move(domain, id, input.parentId);
    return this.require(domain, id);
  }

  /** A node can never become a child of itself or of one of its own descendants. */
  async move(domain: GroupDomain, id: string, parentId: string | null): Promise<void> {
    if (parentId) {
      const parent = await this.require(domain, parentId);
      this.refuseSystem(parent, 'used as a parent');
      const lineage = await this.repo.ancestorsAndSelf(domain, parentId);
      if (lineage.includes(id)) throw new BadRequestException('a group cannot be moved inside itself');
    }
    await this.repo.move(domain, id, parentId);
  }

  /** Soft delete: children and tasks stay alive, they simply lose their parent. */
  async remove(domain: GroupDomain, id: string): Promise<void> {
    const current = await this.require(domain, id);
    this.refuseSystem(current, 'deleted');
    await this.repo.softDelete(domain, id);
  }

  /** The node plus its descendants: what a caller filtering by folder resolves. */
  async subtreeIds(domain: GroupDomain, id: string): Promise<string[]> {
    await this.require(domain, id);
    return this.repo.subtreeIds(domain, id);
  }

  /** Single node lookup: the validation entry point for the callers. */
  async find(domain: GroupDomain, id: string): Promise<GroupRow> {
    return this.require(domain, id);
  }

  private async require(domain: GroupDomain, id: string): Promise<GroupRow> {
    if (!isUuid(id)) throw new BadRequestException('invalid group id');
    const group = await this.repo.findById(domain, id);
    if (!group) throw new NotFoundException('group not found');
    return group;
  }

  private name(value: string): string {
    const trimmed = (value ?? '').trim();
    if (!trimmed) throw new ConflictException('group name is required');
    return trimmed;
  }

  /** System nodes are the engine's furniture, not the user's: they are read-only. */
  private refuseSystem(group: GroupRow, action: string): void {
    if (group.isSystem) {
      throw new BadRequestException(`the system group '${group.name}' cannot be ${action}`);
    }
  }
}

