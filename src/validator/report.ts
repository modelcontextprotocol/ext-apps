/**
 * Finding and report types shared by the validator's checks and reporters.
 *
 * @module validator
 */

import { getRule, type Rule, type RuleId } from "./rules.js";

/** A single rule violation (or advisory) found during validation. */
export interface Finding {
  rule: Rule;
  /** What was wrong, with enough context to locate it. */
  message: string;
  /** The tool, resource URI, or message the finding is about, if any. */
  subject?: string;
}

/** Result of a validation run. */
export interface ValidationReport {
  /** The target that was validated (URL, command, or file path). */
  target: string;
  /** Rule violations, in detection order. */
  findings: Finding[];
  /** Rule ids that were checked (a finding's absence is only meaningful for these). */
  checkedRules: RuleId[];
  /** Rule ids that were skipped, with the reason (e.g. behavioral checks disabled). */
  skippedRules: { id: RuleId; reason: string }[];
}

export function makeFinding(
  id: RuleId,
  message: string,
  subject?: string,
): Finding {
  return { rule: getRule(id), message, subject };
}

export function errorCount(report: ValidationReport): number {
  return report.findings.filter((f) => f.rule.severity === "error").length;
}

export function warningCount(report: ValidationReport): number {
  return report.findings.filter((f) => f.rule.severity === "warning").length;
}

/** Render a human-readable report. */
export function formatPretty(report: ValidationReport): string {
  const lines: string[] = [];
  lines.push(`MCP App validation: ${report.target}`);
  lines.push("");
  if (report.findings.length === 0) {
    lines.push("No issues found.");
  }
  for (const finding of report.findings) {
    const label = finding.rule.severity === "error" ? "ERROR" : "WARN ";
    const subject = finding.subject ? ` [${finding.subject}]` : "";
    lines.push(`${label} ${finding.rule.id}${subject} ${finding.message}`);
    lines.push(`      spec: ${finding.rule.specSection}`);
  }
  lines.push("");
  lines.push(
    `${errorCount(report)} error(s), ${warningCount(report)} warning(s); ` +
      `${report.checkedRules.length} rule(s) checked, ${report.skippedRules.length} skipped.`,
  );
  for (const skipped of report.skippedRules) {
    lines.push(`  skipped ${skipped.id}: ${skipped.reason}`);
  }
  return lines.join("\n");
}

/** Render the report as JSON (stable shape for CI consumption). */
export function formatJson(report: ValidationReport): string {
  return JSON.stringify(
    {
      target: report.target,
      findings: report.findings.map((f) => ({
        ruleId: f.rule.id,
        severity: f.rule.severity,
        title: f.rule.title,
        message: f.message,
        subject: f.subject,
        specSection: f.rule.specSection,
      })),
      checkedRules: report.checkedRules,
      skippedRules: report.skippedRules,
      errors: errorCount(report),
      warnings: warningCount(report),
    },
    null,
    2,
  );
}
