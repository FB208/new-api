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

/**
 * Conversion between the row-based key editor and the channel form's flat
 * `key` field, which holds every key of a multi-key channel in one string.
 */

const CHANNEL_TYPE_AWS = 33
const CHANNEL_TYPE_VERTEX_AI = 41

/** Per-key remark cap, mirrored by the backend. */
export const KEY_REMARK_MAX_LENGTH = 128

/**
 * The shape of ONE key. Codex and Vertex AI in api_key mode cannot be created
 * as multi-key channels, so they need no format of their own.
 */
export type KeyEntryFormat =
  | 'plain'
  | 'aws_ak_sk'
  | 'aws_api_key'
  | 'vertex_json'

export type KeyEntry = {
  /** Stable list identity for React. Never serialized. */
  id: string
  value: string
  remark: string
}

export type AwsKeyParts = {
  accessKey: string
  secretKey: string
  region: string
}

let entryIdCounter = 0

export function createKeyEntry(value = '', remark = ''): KeyEntry {
  entryIdCounter += 1
  return { id: `key-entry-${entryIdCounter}`, value, remark }
}

export function resolveKeyEntryFormat(
  channelType: number,
  awsKeyType: string | undefined,
  vertexKeyType: string | undefined
): KeyEntryFormat {
  if (channelType === CHANNEL_TYPE_AWS) {
    return awsKeyType === 'api_key' ? 'aws_api_key' : 'aws_ak_sk'
  }
  if (channelType === CHANNEL_TYPE_VERTEX_AI && vertexKeyType !== 'api_key') {
    return 'vertex_json'
  }
  return 'plain'
}

/**
 * Split key text into individual keys, dropping blank ones. A Vertex value may
 * be a JSON array or a single, possibly pretty-printed, JSON object; splitting
 * either on newlines would break one credential into several keys.
 */
export function parseKeyFieldValues(
  value: string,
  format: KeyEntryFormat
): string[] {
  if (format === 'vertex_json') {
    const credentials = parseVertexCredentials(value.trim())
    if (credentials) return credentials
  }
  return value
    .split('\n')
    .map((key) => key.trim())
    .filter((key) => key !== '')
}

function parseVertexCredentials(value: string): string[] | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return null
  }
  if (Array.isArray(parsed)) {
    return parsed
      .map((item) =>
        typeof item === 'string' ? item.trim() : JSON.stringify(item)
      )
      .filter((key) => key !== '')
  }
  if (typeof parsed === 'object' && parsed !== null) {
    return [JSON.stringify(parsed)]
  }
  return null
}

/**
 * Collapse rows into the create request's `key` field and remark map. Blank
 * rows are dropped and remarks are indexed against the remaining keys.
 *
 * Vertex AI service accounts are sent as a JSON array because the create
 * endpoint parses that format for them; every other type is newline-joined.
 */
export function toKeyEntriesPayload(
  entries: KeyEntry[],
  format: KeyEntryFormat
): { key: string; remarks: Record<string, string> } {
  const remarks: Record<string, string> = {}
  const values: string[] = []

  for (const entry of entries) {
    const value = entry.value.trim()
    if (value === '') continue
    const remark = entry.remark.trim()
    if (remark !== '') {
      remarks[String(values.length)] = remark
    }
    values.push(value)
  }

  // An empty list stays empty so the form's "key is required" check reports it.
  if (values.length === 0) return { key: '', remarks }

  if (format === 'vertex_json') {
    const items = values.map((value) => {
      try {
        return JSON.stringify(JSON.parse(value))
      } catch {
        // Keep the raw text so the invalid row fails validation visibly.
        return value
      }
    })
    return { key: `[${items.join(',')}]`, remarks }
  }
  return { key: values.join('\n'), remarks }
}

/**
 * AWS packs several credentials into one key separated by "|":
 * `AccessKey|SecretAccessKey|Region`, or `APIKey|Region` in api_key mode.
 */
export function parseAwsKeyParts(
  value: string,
  format: KeyEntryFormat
): AwsKeyParts {
  const segments = value.split('|')
  if (format === 'aws_api_key') {
    return {
      accessKey: segments[0] ?? '',
      secretKey: '',
      region: segments.slice(1).join('|'),
    }
  }
  return {
    accessKey: segments[0] ?? '',
    secretKey: segments[1] ?? '',
    region: segments.slice(2).join('|'),
  }
}

export function formatAwsKeyParts(
  parts: AwsKeyParts,
  format: KeyEntryFormat
): string {
  if (format === 'aws_api_key') {
    return [parts.accessKey, parts.region].join('|')
  }
  return [parts.accessKey, parts.secretKey, parts.region].join('|')
}

export type KeyEntryValidationError =
  | 'Key is required'
  | 'AWS key must be in the format AccessKey|SecretAccessKey|Region'
  | 'AWS key must be in the format APIKey|Region'
  | 'Vertex AI service account key must be valid JSON'
  | 'Remark must not exceed {{max}} characters'

/** Validate one row. Returns an i18n key, or null when the row is valid. */
export function validateKeyEntry(
  entry: KeyEntry,
  format: KeyEntryFormat
): KeyEntryValidationError | null {
  if (entry.remark.trim().length > KEY_REMARK_MAX_LENGTH) {
    return 'Remark must not exceed {{max}} characters'
  }

  const value = entry.value.trim()
  if (value === '') return 'Key is required'

  // Count segments rather than checking parsed parts: parsing folds extra "|"
  // segments into the region, which would let a key the AWS relay rejects
  // (e.g. a three-segment key in api_key mode) pass as valid.
  const segments = value.split('|').map((segment) => segment.trim())

  if (format === 'aws_ak_sk') {
    if (segments.length !== 3 || segments.includes('')) {
      return 'AWS key must be in the format AccessKey|SecretAccessKey|Region'
    }
    return null
  }

  if (format === 'aws_api_key') {
    if (segments.length !== 2 || segments.includes('')) {
      return 'AWS key must be in the format APIKey|Region'
    }
    return null
  }

  if (format === 'vertex_json' && !isJsonObjectText(value)) {
    return 'Vertex AI service account key must be valid JSON'
  }

  return null
}

function isJsonObjectText(value: string): boolean {
  try {
    const parsed: unknown = JSON.parse(value)
    return (
      typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
    )
  } catch {
    return false
  }
}
