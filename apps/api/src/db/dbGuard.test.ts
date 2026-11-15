import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  extractDatabaseName,
  resolveDatabaseUrl,
  createDatabase,
  DatabaseGuardError,
} from './index.js';

describe('Test Database Safety Guard', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.VITEST = 'true';
    delete process.env.DATABASE_URL_TEST;
    process.env.DATABASE_URL = 'postgresql://citewriter:secret@prod-db.internal:5432/citewriter_production';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('extractDatabaseName', () => {
    it('correctly parses database names from standard connection strings', () => {
      expect(extractDatabaseName('postgresql://user:pass@localhost:5432/citewriter_test')).toBe(
        'citewriter_test',
      );
      expect(
        extractDatabaseName('postgresql://user:pass@localhost:5432/my_app_test?sslmode=disable'),
      ).toBe('my_app_test');
      expect(extractDatabaseName('postgres://user@db-host/prod_db')).toBe('prod_db');
    });
  });

  describe('resolveDatabaseUrl', () => {
    it('refuses to connect if DATABASE_URL_TEST is unset in test mode', () => {
      expect(() => resolveDatabaseUrl()).toThrow(DatabaseGuardError);
      expect(() => resolveDatabaseUrl()).toThrow(/DATABASE_URL_TEST is not defined/i);
    });

    it('refuses to fall back to DATABASE_URL in test mode', () => {
      process.env.DATABASE_URL = 'postgresql://localhost:5432/citewriter_production';
      delete process.env.DATABASE_URL_TEST;

      expect(() => resolveDatabaseUrl()).toThrow(DatabaseGuardError);
      expect(() => resolveDatabaseUrl()).toThrow(/Refusing to fall back to DATABASE_URL/i);
    });

    it('refuses connection if caller explicitly passes DATABASE_URL in test mode', () => {
      process.env.DATABASE_URL = 'postgresql://localhost:5432/citewriter_production';
      process.env.DATABASE_URL_TEST = 'postgresql://localhost:5432/citewriter_test';

      expect(() => resolveDatabaseUrl(process.env.DATABASE_URL)).toThrow(DatabaseGuardError);
      expect(() => resolveDatabaseUrl(process.env.DATABASE_URL)).toThrow(
        /Refusing to use production\/dev DATABASE_URL/i,
      );
    });

    it('rejects database names that do not end with _test', () => {
      process.env.DATABASE_URL_TEST = 'postgresql://localhost:5432/citewriter_prod';
      expect(() => resolveDatabaseUrl()).toThrow(DatabaseGuardError);
      expect(() => resolveDatabaseUrl()).toThrow(/must end with "_test"/i);

      process.env.DATABASE_URL_TEST = 'postgresql://localhost:5432/citewriter';
      expect(() => resolveDatabaseUrl()).toThrow(DatabaseGuardError);
      expect(() => resolveDatabaseUrl()).toThrow(/must end with "_test"/i);

      process.env.DATABASE_URL_TEST = 'postgresql://localhost:5432/test_citewriter';
      expect(() => resolveDatabaseUrl()).toThrow(DatabaseGuardError);
      expect(() => resolveDatabaseUrl()).toThrow(/must end with "_test"/i);
    });

    it('accepts valid database names ending with _test', () => {
      process.env.DATABASE_URL_TEST = 'postgresql://localhost:5432/citewriter_test';
      const resolved = resolveDatabaseUrl();
      expect(resolved).toBe('postgresql://localhost:5432/citewriter_test');
    });

    it('createDatabase throws DatabaseGuardError before creating a pool when guard fails', () => {
      process.env.DATABASE_URL_TEST = 'postgresql://localhost:5432/production_danger';
      expect(() => createDatabase()).toThrow(DatabaseGuardError);
    });
  });

  describe('Non-test environment fallback', () => {
    it('uses DATABASE_URL or default when NODE_ENV is not test and VITEST is unset', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.VITEST;
      process.env.DATABASE_URL = 'postgresql://user:pass@prod:5432/citewriter_live';

      const resolved = resolveDatabaseUrl();
      expect(resolved).toBe('postgresql://user:pass@prod:5432/citewriter_live');
    });
  });
});
