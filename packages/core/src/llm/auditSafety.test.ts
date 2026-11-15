import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { getLedgerFilePath, recordDailyTokens, loadDailyLedger, findRepoRoot } from './ledger.js';
import { getAuditFilePath, recordTokenAudit, TokenAuditRecord } from './audit.js';

describe('Audit and Ledger Safety Guards (Check 4)', () => {
  const originalAuditDir = process.env.AUDIT_DIR;
  const originalTokenAudit = process.env.TOKEN_AUDIT;

  beforeEach(() => {
    delete process.env.AUDIT_DIR;
    process.env.TOKEN_AUDIT = '1';
  });

  afterEach(() => {
    if (originalAuditDir !== undefined) {
      process.env.AUDIT_DIR = originalAuditDir;
    } else {
      delete process.env.AUDIT_DIR;
    }
    if (originalTokenAudit !== undefined) {
      process.env.TOKEN_AUDIT = originalTokenAudit;
    } else {
      delete process.env.TOKEN_AUDIT;
    }
  });

  it('routes writes to a temporary directory in test environments without skipping', () => {
    const defaultTestDir = path.join(os.tmpdir(), 'citewriter-test-audit');
    const expectedLedgerFile = path.join(defaultTestDir, 'ledger.json');
    const expectedAuditFile = path.join(defaultTestDir, 'calls.jsonl');

    // Clean test dir before test
    if (fs.existsSync(defaultTestDir)) {
      fs.rmSync(defaultTestDir, { recursive: true, force: true });
    }

    // 1. Verify file paths resolve to tempdir, NOT repo root
    expect(getLedgerFilePath()).toBe(expectedLedgerFile);
    expect(getAuditFilePath()).toBe(expectedAuditFile);
    expect(getLedgerFilePath()).not.toContain(path.join(findRepoRoot(), 'token-audit'));

    // 2. Perform write: ledger
    const testDate = '2099-01-01';
    recordDailyTokens('test/safety-model', 100, 50, false, testDate);

    // Verify file actually exists and was written to
    expect(fs.existsSync(expectedLedgerFile)).toBe(true);
    const ledgerData = loadDailyLedger();
    expect(ledgerData[testDate]?.['test/safety-model']?.totalTokens).toBe(150);

    // 3. Perform write: audit
    const sampleRecord: TokenAuditRecord = {
      run_id: 'test-safety-run',
      agent_name: 'test-agent',
      node_name: 'test-node',
      model_id: 'test/safety-model',
      provider: 'test-provider',
      input_tokens: 100,
      output_tokens: 50,
      reasoning_tokens: null,
      finish_reason: 'stop',
      latency_ms: 10,
      attempt: 1,
      counted_as_attempt: true,
      is_retry: false,
      is_estimated: false,
      is_truncated: false,
      rate_limit_headers: {},
      timestamp: new Date().toISOString(),
    };

    recordTokenAudit(sampleRecord);
    expect(fs.existsSync(expectedAuditFile)).toBe(true);
    const auditContent = fs.readFileSync(expectedAuditFile, 'utf-8');
    expect(auditContent).toContain('test-safety-run');

    // Clean up temp dir
    fs.rmSync(defaultTestDir, { recursive: true, force: true });
  });

  it('prohibits tests from ever targeting the root token-audit/ directory', () => {
    const prodAuditDir = path.join(findRepoRoot(), 'token-audit');

    process.env.AUDIT_DIR = prodAuditDir;

    // Both getLedgerFilePath and getAuditFilePath must immediately throw a safety violation
    expect(() => getLedgerFilePath()).toThrow(
      /Safety violation: Test attempted to write to production token-audit directory/,
    );
    expect(() => getAuditFilePath()).toThrow(
      /Safety violation: Test attempted to write to production token-audit directory/,
    );
  });
});

