/* @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getSkillBadgeMapMock, getSkillBadgeMapsMock, isSkillHighlightedMock } = vi.hoisted(() => ({
  getSkillBadgeMapMock: vi.fn(),
  getSkillBadgeMapsMock: vi.fn(),
  isSkillHighlightedMock: vi.fn(),
}))

vi.mock('./lib/badges', () => ({
  getSkillBadgeMap: getSkillBadgeMapMock,
  getSkillBadgeMaps: getSkillBadgeMapsMock,
  isSkillHighlighted: isSkillHighlightedMock,
}))

import { listPublicPageV2 } from './skills'

type ListArgs = {
  paginationOpts: { cursor: string | null; numItems: number; id?: number }
  sort?: 'newest' | 'updated' | 'downloads' | 'installs' | 'stars' | 'name'
  dir?: 'asc' | 'desc'
  highlightedOnly?: boolean
  nonSuspiciousOnly?: boolean
}

type ListResult = {
  page: Array<{ skill: { slug: string } }>
  continueCursor: string | null
  isDone: boolean
}

type WrappedHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>
}

const listPublicPageV2Handler = (listPublicPageV2 as unknown as WrappedHandler<ListArgs, ListResult>)
  ._handler

describe('skills.listPublicPageV2', () => {
  beforeEach(() => {
    getSkillBadgeMapMock.mockReset()
    getSkillBadgeMapsMock.mockReset()
    getSkillBadgeMapsMock.mockResolvedValue(new Map())
    isSkillHighlightedMock.mockReset()
    isSkillHighlightedMock.mockImplementation((skill: { slug?: string }) =>
      Boolean(skill.slug?.startsWith('hl-')),
    )
  })

  it('applies highlightedOnly and nonSuspiciousOnly together', async () => {
    // Keep pagination on the base sort index and apply both filters in JS while
    // `isSuspicious` is still being backfilled on existing rows.
    const highlightedClean = makeSkill('skills:hl-clean', 'hl-clean', 'users:1', 'skillVersions:1')
    const plainClean = makeSkill('skills:plain', 'plain', 'users:2', 'skillVersions:2')

    const paginateMock = vi.fn().mockResolvedValue({
      page: [highlightedClean, plainClean],
      continueCursor: 'next-cursor',
      isDone: false,
      pageStatus: null,
      splitCursor: null,
    })
    const orderMock = vi.fn(() => ({ paginate: paginateMock }))
    const eqMock = vi.fn(() => ({ eq: eqMock }))
    const withIndexMock = vi.fn((_index: string, builder: (q: { eq: typeof eqMock }) => unknown) => {
      builder({ eq: eqMock })
      return { order: orderMock }
    })
    const getMock = vi.fn(async (id: string) => {
      if (id.startsWith('users:')) return makeUser(id)
      if (id.startsWith('skillVersions:')) return makeVersion(id)
      return null
    })
    const ctx = {
      db: {
        query: vi.fn((table: string) => {
          if (table !== 'skillSearchDigest') throw new Error(`unexpected table ${table}`)
          return { withIndex: withIndexMock }
        }),
        get: getMock,
      },
    }

    const result = await listPublicPageV2Handler(ctx, {
      paginationOpts: { cursor: null, numItems: 25 },
      sort: 'downloads',
      dir: 'desc',
      highlightedOnly: true,
      nonSuspiciousOnly: true,
    })

    expect(result.page).toHaveLength(1)
    expect(result.page[0]?.skill.slug).toBe('hl-clean')
    expect(result.continueCursor).toBe('next-cursor')
    expect(result.isDone).toBe(false)
    expect(withIndexMock).toHaveBeenCalledWith('by_nonsuspicious_downloads', expect.any(Function))
    expect(orderMock).toHaveBeenCalledWith('desc')
    expect(paginateMock).toHaveBeenCalledWith({ cursor: null, numItems: 25 })
  })

  it('returns empty filtered page without multi-paginate when no rows match', async () => {
    const plain = makeSkill('skills:plain', 'plain', 'users:1', 'skillVersions:1')
    const paginateMock = vi.fn().mockResolvedValueOnce({
      page: [plain],
      continueCursor: 'next-cursor',
      isDone: false,
      pageStatus: null,
      splitCursor: null,
    })
    const ctx = {
      db: {
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({
            order: vi.fn(() => ({ paginate: paginateMock })),
          })),
        })),
        get: vi.fn(),
      },
    }

    const result = await listPublicPageV2Handler(ctx, {
      paginationOpts: { cursor: null, numItems: 25 },
      sort: 'downloads',
      dir: 'desc',
      highlightedOnly: true,
      nonSuspiciousOnly: false,
    })

    expect(result.page).toEqual([])
    expect(result.continueCursor).toBe('next-cursor')
    expect(result.isDone).toBe(false)
    expect(paginateMock).toHaveBeenCalledTimes(1)
  })

  it('returns exhausted when filtered pages remain empty to the end', async () => {
    const plain = makeSkill('skills:plain', 'plain', 'users:1', 'skillVersions:1')
    const paginateMock = vi.fn().mockResolvedValue({
      page: [plain],
      continueCursor: null,
      isDone: true,
      pageStatus: null,
      splitCursor: null,
    })
    const ctx = {
      db: {
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({
            order: vi.fn(() => ({ paginate: paginateMock })),
          })),
        })),
        get: vi.fn(),
      },
    }

    const result = await listPublicPageV2Handler(ctx, {
      paginationOpts: { cursor: null, numItems: 25 },
      sort: 'downloads',
      dir: 'desc',
      highlightedOnly: true,
      nonSuspiciousOnly: false,
    })

    expect(result.page).toEqual([])
    expect(result.continueCursor).toBeNull()
    expect(result.isDone).toBe(true)
    expect(paginateMock).toHaveBeenCalledTimes(1)
  })

  it('uses the base index and filters suspicious rows in JS when nonSuspiciousOnly is true', async () => {
    const clean = makeSkill('skills:clean', 'clean', 'users:1', 'skillVersions:1')
    const suspicious = makeSkill(
      'skills:suspicious',
      'suspicious',
      'users:2',
      'skillVersions:2',
      ['flagged.suspicious'],
    )
    const paginateMock = vi.fn().mockResolvedValueOnce({
      page: [suspicious, clean],
      continueCursor: 'after-clean',
      isDone: false,
      pageStatus: null,
      splitCursor: null,
    })
    const withIndexMock = vi.fn(() => ({
      order: vi.fn(() => ({ paginate: paginateMock })),
    }))
    const ctx = {
      db: {
        query: vi.fn(() => ({
          withIndex: withIndexMock,
        })),
        get: vi.fn(async (id: string) => {
          if (id.startsWith('users:')) return makeUser(id)
          if (id.startsWith('skillVersions:')) return makeVersion(id)
          return null
        }),
      },
    }

    const result = await listPublicPageV2Handler(ctx, {
      paginationOpts: { cursor: null, numItems: 25 },
      sort: 'downloads',
      dir: 'desc',
      highlightedOnly: false,
      nonSuspiciousOnly: true,
    })

    expect(result.page).toHaveLength(1)
    expect(result.page[0]?.skill.slug).toBe('clean')
    expect(result.continueCursor).toBe('after-clean')
    expect(result.isDone).toBe(false)
    expect(withIndexMock).toHaveBeenCalledTimes(1)
    expect(withIndexMock).toHaveBeenCalledWith('by_nonsuspicious_downloads', expect.any(Function))
    expect(paginateMock).toHaveBeenCalledTimes(1)
  })

  it('filters out skills whose owners are deleted or banned when digest lacks owner info', async () => {
    const active = makeSkill('skills:active', 'active', 'users:active', 'skillVersions:1')
    const banned = makeSkill('skills:banned', 'banned', 'users:banned', 'skillVersions:2')
    // Simulate digest row where owner info has been cleared after ban
    delete (banned as Record<string, unknown>).ownerHandle
    delete (banned as Record<string, unknown>).ownerName
    delete (banned as Record<string, unknown>).ownerDisplayName
    delete (banned as Record<string, unknown>).ownerImage
    const paginateMock = vi.fn().mockResolvedValueOnce({
      page: [banned, active],
      continueCursor: 'after-active',
      isDone: false,
      pageStatus: null,
      splitCursor: null,
    })
    const withIndexMock = vi.fn(() => ({
      order: vi.fn(() => ({ paginate: paginateMock })),
    }))
    const ctx = {
      db: {
        query: vi.fn(() => ({
          withIndex: withIndexMock,
        })),
        get: vi.fn(async (id: string) => {
          if (id === 'users:active') return makeUser(id)
          if (id === 'users:banned') return { ...makeUser(id), deletedAt: 123 }
          if (id.startsWith('skillVersions:')) return makeVersion(id)
          return null
        }),
      },
    }

    const result = await listPublicPageV2Handler(ctx, {
      paginationOpts: { cursor: null, numItems: 25 },
      sort: 'downloads',
      dir: 'desc',
      highlightedOnly: false,
      nonSuspiciousOnly: false,
    })

    expect(result.page).toHaveLength(1)
    expect(result.page[0]?.skill.slug).toBe('active')
    expect(result.continueCursor).toBe('after-active')
  })

  it('returns empty isDone page when cursor is stale', async () => {
    const paginateMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('Failed to parse cursor'))
    const ctx = {
      db: {
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({
            order: vi.fn(() => ({ paginate: paginateMock })),
          })),
        })),
        get: vi.fn(),
      },
    }

    const result = await listPublicPageV2Handler(ctx, {
      paginationOpts: { cursor: 'stale-cursor', numItems: 25, id: 123456 },
      sort: 'downloads',
      dir: 'desc',
      highlightedOnly: false,
      nonSuspiciousOnly: false,
    })

    expect(result.page).toEqual([])
    expect(result.isDone).toBe(true)
    expect(result.continueCursor).toBe('')
    expect(paginateMock).toHaveBeenCalledTimes(1)
    expect(paginateMock).toHaveBeenCalledWith({ cursor: 'stale-cursor', numItems: 25 })
  })

  it('drops pagination id from client options on first-page queries', async () => {
    const plain = makeSkill('skills:plain', 'plain', 'users:1', 'skillVersions:1')
    const paginateMock = vi.fn().mockResolvedValue({
      page: [plain],
      continueCursor: 'next-cursor',
      isDone: false,
      pageStatus: null,
      splitCursor: null,
    })
    const ctx = {
      db: {
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({
            order: vi.fn(() => ({ paginate: paginateMock })),
          })),
        })),
        get: vi.fn(async (id: string) => {
          if (id.startsWith('users:')) return makeUser(id)
          if (id.startsWith('skillVersions:')) return makeVersion(id)
          return null
        }),
      },
    }

    const result = await listPublicPageV2Handler(ctx, {
      paginationOpts: { cursor: null, numItems: 25, id: 999_999_999 },
      sort: 'downloads',
      dir: 'desc',
      highlightedOnly: false,
      nonSuspiciousOnly: false,
    })

    expect(result.page).toHaveLength(1)
    expect(paginateMock).toHaveBeenCalledTimes(1)
    expect(paginateMock).toHaveBeenCalledWith({ cursor: null, numItems: 25 })
    expect(paginateMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.any(Number),
      }),
    )
  })

  it('falls back to db.get(latestVersionId) when latestVersionSummary is absent', async () => {
    const oldRow = makeSkill('skills:old', 'old', 'users:1', 'skillVersions:1')
    // Simulate a pre-backfill digest row without latestVersionSummary
    delete (oldRow as Record<string, unknown>).latestVersionSummary

    const paginateMock = vi.fn().mockResolvedValue({
      page: [oldRow],
      continueCursor: 'next-cursor',
      isDone: false,
      pageStatus: null,
      splitCursor: null,
    })
    const getMock = vi.fn(async (id: string) => {
      if (id.startsWith('users:')) return makeUser(id)
      if (id.startsWith('skillVersions:')) return makeVersion(id)
      return null
    })
    const ctx = {
      db: {
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({
            order: vi.fn(() => ({ paginate: paginateMock })),
          })),
        })),
        get: getMock,
      },
    }

    const result = await listPublicPageV2Handler(ctx, {
      paginationOpts: { cursor: null, numItems: 25 },
      sort: 'downloads',
      dir: 'desc',
      highlightedOnly: false,
      nonSuspiciousOnly: false,
    })

    expect(result.page).toHaveLength(1)
    expect(result.page[0]?.skill.slug).toBe('old')
    // Should have fetched the version doc via db.get
    expect(getMock).toHaveBeenCalledWith('skillVersions:1')
  })

  it('skips db.get for owner when digest has pre-resolved ownerHandle', async () => {
    const skill = makeSkill('skills:s1', 's1', 'users:1', 'skillVersions:1')
    const paginateMock = vi.fn().mockResolvedValue({
      page: [skill],
      continueCursor: 'next-cursor',
      isDone: false,
      pageStatus: null,
      splitCursor: null,
    })
    const getMock = vi.fn(async (id: string) => {
      if (id === 'users:1') return makeUser(id)
      if (id.startsWith('skillVersions:')) return makeVersion(id)
      return null
    })
    const ctx = {
      db: {
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({
            order: vi.fn(() => ({ paginate: paginateMock })),
          })),
        })),
        get: getMock,
      },
    }

    const result = await listPublicPageV2Handler(ctx, {
      paginationOpts: { cursor: null, numItems: 25 },
      sort: 'downloads',
      dir: 'desc',
      highlightedOnly: false,
      nonSuspiciousOnly: false,
    })

    expect(result.page).toHaveLength(1)
    expect(result.page[0]?.skill.slug).toBe('s1')
    // Should NOT have called db.get for the user — pre-resolved from digest
    expect(getMock).not.toHaveBeenCalledWith('users:1')
  })

  it('falls back to db.get for owner when digest lacks ownerHandle', async () => {
    const skill = makeSkill('skills:old', 'old', 'users:1', 'skillVersions:1')
    // Simulate pre-backfill row without owner fields
    delete (skill as Record<string, unknown>).ownerHandle
    delete (skill as Record<string, unknown>).ownerName
    delete (skill as Record<string, unknown>).ownerDisplayName
    delete (skill as Record<string, unknown>).ownerImage

    const paginateMock = vi.fn().mockResolvedValue({
      page: [skill],
      continueCursor: 'next-cursor',
      isDone: false,
      pageStatus: null,
      splitCursor: null,
    })
    const getMock = vi.fn(async (id: string) => {
      if (id.startsWith('users:')) return makeUser(id)
      if (id.startsWith('skillVersions:')) return makeVersion(id)
      return null
    })
    const ctx = {
      db: {
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({
            order: vi.fn(() => ({ paginate: paginateMock })),
          })),
        })),
        get: getMock,
      },
    }

    const result = await listPublicPageV2Handler(ctx, {
      paginationOpts: { cursor: null, numItems: 25 },
      sort: 'downloads',
      dir: 'desc',
      highlightedOnly: false,
      nonSuspiciousOnly: false,
    })

    expect(result.page).toHaveLength(1)
    expect(result.page[0]?.skill.slug).toBe('old')
    // Should have fallen back to db.get for owner
    expect(getMock).toHaveBeenCalledWith('users:1')
  })

  it('does not swallow non-cursor paginate errors', async () => {
    const paginateMock = vi.fn().mockRejectedValue(new Error('database unavailable'))
    const ctx = {
      db: {
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({
            order: vi.fn(() => ({ paginate: paginateMock })),
          })),
        })),
        get: vi.fn(),
      },
    }

    await expect(
      listPublicPageV2Handler(ctx, {
        paginationOpts: { cursor: 'stale-cursor', numItems: 25, id: 999_999_999 },
        sort: 'downloads',
        dir: 'desc',
        highlightedOnly: false,
        nonSuspiciousOnly: false,
      }),
    ).rejects.toThrow('database unavailable')

    expect(paginateMock).toHaveBeenCalledTimes(1)
    expect(paginateMock).toHaveBeenCalledWith({ cursor: 'stale-cursor', numItems: 25 })
  })
})

function makeSkill(
  id: string,
  slug: string,
  ownerUserId: string,
  latestVersionId: string,
  moderationFlags?: string[],
) {
  return {
    _id: id,
    _creationTime: 1,
    skillId: id,
    slug,
    displayName: slug,
    summary: `${slug} summary`,
    ownerUserId,
    ownerHandle: 'owner',
    ownerName: 'Owner',
    ownerDisplayName: 'Owner',
    ownerImage: undefined as string | undefined,
    canonicalSkillId: undefined,
    forkOf: undefined,
    latestVersionId,
    latestVersionSummary: {
      version: '1.0.0',
      createdAt: 1,
      changelog: '',
      changelogSource: 'user' as const,
    },
    tags: {},
    badges: {},
    stats: {
      downloads: 0,
      stars: 0,
      installsCurrent: 0,
      installsAllTime: 0,
      versions: 1,
      comments: 0,
    },
    createdAt: 1,
    updatedAt: 1,
    softDeletedAt: undefined,
    moderationStatus: 'active',
    moderationFlags,
    moderationReason: undefined,
  }
}

function makeUser(id: string) {
  return {
    _id: id,
    _creationTime: 1,
    handle: 'owner',
    name: 'Owner',
    displayName: 'Owner',
    image: null,
    bio: null,
    deletedAt: undefined,
    deactivatedAt: undefined,
  }
}

function makeVersion(id: string) {
  return {
    _id: id,
    _creationTime: 1,
    version: '1.0.0',
    createdAt: 1,
    changelog: '',
    changelogSource: 'user',
    parsed: {},
  }
}
