import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'

const cliFilesThatMustFailHard = [
  'runHSEReportExporter.ts',
  'runStorzAudit.ts',
  'runTriangulation.ts',
  'runDriveRpoAudit.ts',
  'runStorzHistoryReport.ts',
  'testGoogleDriveApi.ts',
]

describe('CLI error handling', () => {
  it.each(cliFilesThatMustFailHard)(
    '%s exits with a non-zero status when main rejects',
    fileName => {
      const source = fs.readFileSync(
        path.join(process.cwd(), 'src', 'cli', fileName),
        'utf-8'
      )

      expect(source).toMatch(
        /main\(\)\.catch\(err => \{[\s\S]*process\.exit\(1\)[\s\S]*\}\)/
      )
    }
  )
})
