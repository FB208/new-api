/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { describe, expect, it } from 'vitest'

import {
  KEY_REMARK_MAX_LENGTH,
  createKeyEntry,
  formatAwsKeyParts,
  parseAwsKeyParts,
  parseKeyFieldValues,
  resolveKeyEntryFormat,
  toKeyEntriesPayload,
  validateKeyEntry,
} from '../key-entry-serialization'

describe('toKeyEntriesPayload', () => {
  it('joins keys with newlines and indexes each remark to its key', () => {
    const entries = [
      createKeyEntry('sk-a', 'primary'),
      createKeyEntry('sk-b', ''),
    ]

    expect(toKeyEntriesPayload(entries, 'plain')).toEqual({
      key: 'sk-a\nsk-b',
      remarks: { 0: 'primary' },
    })
  })

  // A blank row must not consume an index, or later remarks would shift.
  it('drops blank rows and re-indexes the remaining remarks', () => {
    const entries = [
      createKeyEntry('sk-a', 'first'),
      createKeyEntry('   ', 'orphan'),
      createKeyEntry(' sk-b ', 'second'),
    ]

    expect(toKeyEntriesPayload(entries, 'plain')).toEqual({
      key: 'sk-a\nsk-b',
      remarks: { 0: 'first', 1: 'second' },
    })
  })

  it('leaves the key empty when every row is blank', () => {
    expect(toKeyEntriesPayload([createKeyEntry('  ')], 'vertex_json')).toEqual({
      key: '',
      remarks: {},
    })
  })

  // The create endpoint only accepts Vertex service accounts as a JSON array.
  it('sends compacted Vertex credentials as a JSON array', () => {
    const entries = [
      createKeyEntry('{\n  "client_email": "a@x.com"\n}'),
      createKeyEntry('{"client_email":"b@x.com"}'),
    ]

    expect(toKeyEntriesPayload(entries, 'vertex_json').key).toBe(
      '[{"client_email":"a@x.com"},{"client_email":"b@x.com"}]'
    )
  })
})

describe('parseKeyFieldValues', () => {
  it('splits plain text on newlines and drops blank lines', () => {
    expect(parseKeyFieldValues('sk-a\n\n  \nsk-b', 'plain')).toEqual([
      'sk-a',
      'sk-b',
    ])
  })

  // Service account files are pretty-printed; splitting on newlines would
  // turn one credential into several broken keys.
  it('reads a pretty printed Vertex object as one key', () => {
    expect(
      parseKeyFieldValues('{\n  "client_email": "a@x.com"\n}', 'vertex_json')
    ).toEqual(['{"client_email":"a@x.com"}'])
  })

  it('reads a Vertex JSON array as one key per element', () => {
    expect(
      parseKeyFieldValues(
        '[{"client_email":"a@x.com"},{"client_email":"b@x.com"}]',
        'vertex_json'
      )
    ).toEqual(['{"client_email":"a@x.com"}', '{"client_email":"b@x.com"}'])
  })
})

describe('resolveKeyEntryFormat', () => {
  it.each([
    [33, 'ak_sk', undefined, 'aws_ak_sk'],
    [33, 'api_key', undefined, 'aws_api_key'],
    [41, undefined, 'json', 'vertex_json'],
    [41, undefined, 'api_key', 'plain'],
    [1, undefined, undefined, 'plain'],
  ] as const)(
    'type %s with aws %s and vertex %s uses the %s format',
    (type, awsKeyType, vertexKeyType, expected) => {
      expect(resolveKeyEntryFormat(type, awsKeyType, vertexKeyType)).toBe(
        expected
      )
    }
  )
})

describe('AWS key parts', () => {
  it('round trips a three segment access key credential', () => {
    const parts = parseAwsKeyParts('AK|SK|us-east-1', 'aws_ak_sk')

    expect(parts).toEqual({
      accessKey: 'AK',
      secretKey: 'SK',
      region: 'us-east-1',
    })
    expect(formatAwsKeyParts(parts, 'aws_ak_sk')).toBe('AK|SK|us-east-1')
  })

  it('round trips a two segment api key credential', () => {
    const parts = parseAwsKeyParts('APIKEY|eu-west-1', 'aws_api_key')

    expect(parts).toEqual({
      accessKey: 'APIKEY',
      secretKey: '',
      region: 'eu-west-1',
    })
    expect(formatAwsKeyParts(parts, 'aws_api_key')).toBe('APIKEY|eu-west-1')
  })
})

describe('validateKeyEntry', () => {
  it.each([
    ['plain', '  ', 'Key is required'],
    ['plain', 'sk-a', null],
    [
      'aws_ak_sk',
      'AK||',
      'AWS key must be in the format AccessKey|SecretAccessKey|Region',
    ],
    ['aws_ak_sk', 'AK|SK|us-east-1', null],
    [
      'aws_ak_sk',
      'AK|SK|us-east-1|extra',
      'AWS key must be in the format AccessKey|SecretAccessKey|Region',
    ],
    ['aws_api_key', 'APIKEY|', 'AWS key must be in the format APIKey|Region'],
    [
      'aws_api_key',
      'AK|SK|us-east-1',
      'AWS key must be in the format APIKey|Region',
    ],
    [
      'vertex_json',
      'not-json',
      'Vertex AI service account key must be valid JSON',
    ],
    [
      'vertex_json',
      '[{"a":1}]',
      'Vertex AI service account key must be valid JSON',
    ],
    ['vertex_json', '{"client_email":"a@x"}', null],
  ] as const)('a %s key %j is reported as %s', (format, value, expected) => {
    expect(validateKeyEntry(createKeyEntry(value), format)).toBe(expected)
  })

  it('rejects a remark longer than the shared limit', () => {
    const entry = createKeyEntry('sk-a', 'x'.repeat(KEY_REMARK_MAX_LENGTH + 1))

    expect(validateKeyEntry(entry, 'plain')).toBe(
      'Remark must not exceed {{max}} characters'
    )
  })
})
