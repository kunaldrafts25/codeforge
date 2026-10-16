import type { Prisma, PracticeVersion } from '@codeforge/db'
import { PracticePackage } from '@codeforge/shared'
import { conflict } from '../errors.js'
import { canonical, hash } from '../practice/package.js'

/** Verify durable worker evidence, rather than trusting a JSON success flag. */
export async function assertContestVersionValidated(
  db: Pick<Prisma.TransactionClient, 'practiceJob'>,
  version: Pick<
    PracticeVersion,
    'id' | 'status' | 'withdrawnAt' | 'package' | 'packageHash' | 'validation'
  >,
  policyHash: string
) {
  const artifact = version.validation as {
    executed?: boolean
    packageHash?: string
    policyHash?: string
    jobs?: unknown
  } | null
  if (!['VALIDATED', 'PUBLISHED'].includes(version.status) || version.withdrawnAt) {
    throw conflict('VERSION_NOT_VALIDATED', `Version ${version.id} must be validated and available`)
  }
  if (
    artifact?.executed !== true ||
    artifact.packageHash !== version.packageHash ||
    artifact.policyHash !== policyHash ||
    !Array.isArray(artifact.jobs) ||
    !artifact.jobs.length ||
    !artifact.jobs.every(id => typeof id === 'string')
  ) {
    throw conflict(
      'VERSION_VALIDATION_INCOMPLETE',
      `Version ${version.id} needs exact package and policy validation evidence`
    )
  }
  const pkg = PracticePackage.parse(version.package)
  if (hash(canonical(pkg)) !== version.packageHash) {
    throw conflict('PACKAGE_HASH_MISMATCH', `Version ${version.id} package hash is invalid`)
  }
  const jobs = await db.practiceJob.findMany({
    where: {
      id: { in: artifact.jobs as string[] },
      versionId: version.id,
      kind: 'VALIDATE',
      scope: 'PRACTICE',
      state: 'TERMINAL',
      verdict: 'ACCEPTED',
    },
  })
  if (
    !pkg.references.every(reference =>
      jobs.some(job => {
        const { packageHash, ...runtime } = job.policy as Prisma.JsonObject
        return (
          job.language === reference.language &&
          job.sourceHash === hash(reference.code) &&
          packageHash === version.packageHash &&
          hash(canonical(runtime)) === policyHash &&
          (job.privateResult as Prisma.JsonObject | null)?.executed === true
        )
      })
    )
  ) {
    throw conflict(
      'VERSION_VALIDATION_INCOMPLETE',
      `Version ${version.id} validation job evidence is incomplete`
    )
  }
}
