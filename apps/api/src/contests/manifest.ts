import { canonical, hash } from '../practice/package.js'

export function computeManifestHash(input: {
  contestId: string
  revision: number
  title: string
  slug: string
  description?: string | null | undefined
  startTime: string
  endTime: string
  registrationOpensAt: string
  registrationClosesAt: string
  freezeAt?: string | null | undefined
  capacity: number
  isRated: boolean
  divisionMin?: number | null | undefined
  divisionMax?: number | null | undefined
  scoringPolicy: string
  ratingPolicy: string
  problems: {
    label: string
    orderIndex: number
    problemId: string
    versionId: string
    packageHash: string
    points: number
    title: string
  }[]
  runtimePolicyHash: string
}): string {
  const normalized = {
    contestId: input.contestId,
    revision: input.revision,
    title: input.title,
    slug: input.slug,
    description: input.description ?? '',
    startTime: input.startTime,
    endTime: input.endTime,
    registrationOpensAt: input.registrationOpensAt,
    registrationClosesAt: input.registrationClosesAt,
    freezeAt: input.freezeAt ?? null,
    capacity: input.capacity,
    isRated: input.isRated,
    divisionMin: input.divisionMin ?? null,
    divisionMax: input.divisionMax ?? null,
    scoringPolicy: input.scoringPolicy,
    ratingPolicy: input.ratingPolicy,
    problems: input.problems.map(p => ({
      label: p.label,
      orderIndex: p.orderIndex,
      problemId: p.problemId,
      versionId: p.versionId,
      packageHash: p.packageHash,
      points: p.points,
      title: p.title,
    })),
    runtimePolicyHash: input.runtimePolicyHash,
  }
  return hash(canonical(normalized))
}
