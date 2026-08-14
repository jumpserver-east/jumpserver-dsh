import { describe, expect, it } from 'vitest'
import { assertSqlAllowed, classifySql } from '../src/sql-kind.js'
import { JumpServerError } from '../src/types.js'

describe('classifySql', () => {
  it('treats SELECT / SHOW / DESCRIBE / EXPLAIN as queries', () => {
    expect(classifySql('SELECT * FROM users')).toBe('query')
    expect(classifySql('show tables')).toBe('query')
    expect(classifySql('DESCRIBE orders')).toBe('query')
    expect(classifySql('EXPLAIN SELECT 1')).toBe('query')
  })

  it('treats INSERT / UPDATE / DELETE as writes', () => {
    expect(classifySql('INSERT INTO t VALUES (1)')).toBe('write')
    expect(classifySql('UPDATE t SET a = 1')).toBe('write')
    expect(classifySql('DELETE FROM t WHERE id = 1')).toBe('write')
  })

  it('fails closed on unknown verbs and empty input', () => {
    expect(classifySql('CALL do_thing()')).toBe('write')
    expect(() => classifySql('   ')).toThrow(JumpServerError)
  })

  it('ignores comments and classifies each statement', () => {
    expect(classifySql('-- note\nSELECT 1')).toBe('query')
    expect(classifySql('SELECT 1; DELETE FROM t')).toBe('write')
    expect(classifySql('/* INSERT INTO t */ SELECT 1')).toBe('query')
  })

  it('treats WITH as a query unless a write verb follows', () => {
    expect(classifySql('WITH x AS (SELECT 1) SELECT * FROM x')).toBe('query')
    expect(classifySql('WITH x AS (SELECT 1) INSERT INTO t SELECT * FROM x')).toBe('write')
  })

  it('classifies Redis GET as query and SET as write', () => {
    expect(classifySql('GET foo', 'redis')).toBe('query')
    expect(classifySql('KEYS *', 'redis')).toBe('query')
    expect(classifySql('SET foo bar', 'redis')).toBe('write')
    expect(classifySql('DEL foo', 'redis')).toBe('write')
  })

  it('classifies Mongo find as query and insert as write', () => {
    expect(classifySql('db.users.find({ active: true })', 'mongodb')).toBe('query')
    expect(classifySql('db.users.insertOne({ name: "a" })', 'mongodb')).toBe('write')
  })
})

describe('assertSqlAllowed', () => {
  it('does not check host SSH commands', () => {
    expect(() => assertSqlAllowed('rm -rf /', 'ssh', false)).not.toThrow()
  })

  it('allows queries without write authorization', () => {
    expect(() => assertSqlAllowed('SELECT 1', 'mysql', false)).not.toThrow()
  })

  it('rejects writes without write authorization', () => {
    expect(() => assertSqlAllowed('DELETE FROM t', 'mysql', false)).toThrow(/JUMPSERVER_ENABLE_DB_WRITE/)
  })

  it('allows writes when authorized', () => {
    expect(() => assertSqlAllowed('DELETE FROM t', 'postgresql', true)).not.toThrow()
  })
})
