import { describe, it, expect } from 'vitest';
import { extractToolDetail } from './tool-detail.ts';

describe('extractToolDetail', () => {
  it('extracts file_path basename for Edit', () => {
    expect(extractToolDetail('Edit', { file_path: '/home/user/src/app.ts' })).toBe('app.ts');
  });

  it('extracts file_path basename for Read', () => {
    expect(extractToolDetail('Read', { file_path: '/a/b/config.json' })).toBe('config.json');
  });

  it('extracts file_path basename for Write', () => {
    expect(extractToolDetail('Write', { file_path: '/x/y/z.md' })).toBe('z.md');
  });

  it('extracts pattern for Glob', () => {
    expect(extractToolDetail('Glob', { pattern: '**/*.ts' })).toBe('**/*.ts');
  });

  it('extracts pattern for Grep', () => {
    expect(extractToolDetail('Grep', { pattern: 'function\\s+' })).toBe('function\\s+');
  });

  it('extracts and truncates command for Bash', () => {
    expect(extractToolDetail('Bash', { command: 'npm test' })).toBe('npm test');
    const long = 'x'.repeat(120);
    expect(extractToolDetail('Bash', { command: long })).toHaveLength(80);
  });

  it('extracts description for Task', () => {
    expect(extractToolDetail('Task', { description: 'Run tests' })).toBe('Run tests');
  });

  it('extracts hostname for WebFetch', () => {
    expect(extractToolDetail('WebFetch', { url: 'https://docs.example.com/path' })).toBe('docs.example.com');
  });

  it('extracts query for WebSearch', () => {
    expect(extractToolDetail('WebSearch', { query: 'react hooks api' })).toBe('react hooks api');
  });

  it('returns null for unknown tool', () => {
    expect(extractToolDetail('UnknownTool', {})).toBeNull();
  });

  it('returns null when expected field is missing', () => {
    expect(extractToolDetail('Edit', {})).toBeNull();
  });

  it('returns null for null/undefined input', () => {
    expect(extractToolDetail('Edit', undefined)).toBeNull();
  });
});
