/**
 * The diagnostics a viewer copies from a source's settings and pastes to whoever runs the site when something does
 * not load. It holds the last checks of that source, the status view, the build and the browser, and the one
 * address of the source that was checked. Every other source is named, never addressed, so a report carries
 * nothing from the viewer's own settings beyond what they chose to check.
 */
import type { SourceType } from '@/swarm/sources';

import { checkLine } from './checkWords';
import type { StatusRow } from './providerStatus';
import type { StepState } from './sourceChecks';

interface TestedSource {
  readonly name: string;
  readonly address: string;
  readonly type: SourceType;
  readonly results: readonly StepState[];
}

interface ReportInput {
  readonly tested: TestedSource | null;
  readonly status: readonly StatusRow[];
  readonly build: string;
  readonly browser: string;
  readonly atMs: number;
}

/** One check as the report says it. */
function checkWords(result: StepState): string {
  switch (result.state) {
    case 'passed':
      return `passed, ${result.note ?? `${result.ms} ms`}.`;
    case 'failed':
      return `failed. ${result.failure.reason} ${result.failure.fix}`;
    case 'skipped':
      return 'not run, an earlier check failed.';
    case 'running':
    case 'waiting':
      return 'not finished.';
  }
}

export function reportText({ tested, status, build, browser, atMs }: ReportInput): string {
  const lines = [
    'Stream viewer report',
    `Made: ${new Date(atMs).toISOString()}`,
    `Build: ${build}`,
    `Browser: ${browser}`,
    '',
  ];
  if (tested === null) {
    lines.push('No source was checked.');
  } else {
    lines.push(`Checks of ${tested.name}${tested.address === '' ? '' : ` (${tested.address})`}`);
    for (const result of tested.results) {
      lines.push(`${checkLine(tested.type, result.step)}: ${checkWords(result)}`);
    }
  }
  lines.push('', 'Status, the last minute');
  for (const { label, route, answered } of status) {
    lines.push(`${label}: ${route} ${answered}`);
  }
  return `${lines.join('\n')}\n`;
}
