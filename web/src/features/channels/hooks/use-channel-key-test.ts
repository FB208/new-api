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
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { getServerErrorMessage } from '@/lib/server-error-message'

import { testChannelKey } from '../api'
import {
  transformFormDataToCreatePayload,
  type ChannelFormValues,
} from '../lib/channel-form'
import {
  validateKeyEntry,
  type KeyEntry,
  type KeyEntryFormat,
} from '../lib/key-entry-serialization'
import type {
  ChannelKeyTestConfig,
  ChannelKeyTestProgress,
  ChannelKeyTestResult,
} from '../types'

type KeyTestProps = {
  open: boolean
  channelId: number | null
  enabled: boolean
  entries: KeyEntry[]
  format: KeyEntryFormat
  values: ChannelFormValues
}

/** Manage tests for the visible draft, retaining results only while inputs match. */
export function useChannelKeyTest(props: KeyTestProps) {
  const { t } = useTranslation()
  const [results, setResults] = useState<Record<string, ChannelKeyTestResult>>(
    {}
  )
  const [progress, setProgress] = useState<ChannelKeyTestProgress | null>(null)
  const [isTesting, setIsTesting] = useState(false)
  const operation = useRef<AbortController | null>(null)

  // Reuse the save serializer for provider settings, but never send the key list.
  const payload = transformFormDataToCreatePayload(props.values).channel
  const config: ChannelKeyTestConfig = {
    type: props.values.type,
    base_url: payload.base_url,
    openai_organization: payload.openai_organization,
    models: props.values.models,
    test_model: payload.test_model,
    model_mapping: payload.model_mapping,
    status_code_mapping: payload.status_code_mapping,
    setting: payload.setting,
    settings: payload.settings ?? '{}',
    other: payload.other ?? '',
    param_override: payload.param_override,
    header_override: payload.header_override,
  }
  const model =
    config.test_model?.trim() || config.models.split(',')[0]?.trim() || ''
  const configIdentity = JSON.stringify([
    props.open,
    props.channelId,
    props.enabled,
    props.format,
    config,
  ])
  const rowsIdentity = JSON.stringify(
    props.entries.map((entry) => [entry.id, entry.value])
  )
  const previousConfig = useRef(configIdentity)
  const previousRows = useRef(
    new Map(props.entries.map((entry) => [entry.id, entry.value]))
  )

  useEffect(() => {
    const configChanged = previousConfig.current !== configIdentity
    const rows: [string, string][] = JSON.parse(rowsIdentity)
    const unchangedIds = new Set(
      rows
        .filter(([id, value]) => previousRows.current.get(id) === value)
        .map(([id]) => id)
    )
    operation.current?.abort()
    operation.current = null
    setIsTesting(false)
    setProgress(null)
    setResults((current) =>
      Object.fromEntries(
        Object.entries(current).filter(
          ([id, result]) =>
            !configChanged &&
            unchangedIds.has(id) &&
            result.status !== 'pending' &&
            result.status !== 'testing'
        )
      )
    )
    previousConfig.current = configIdentity
    previousRows.current = new Map(rows)
    return () => {
      operation.current?.abort()
      operation.current = null
    }
  }, [configIdentity, rowsIdentity])

  // Each run uses one snapshot; cancellation prevents late replies from restoring old results.
  async function runTests(entryId?: string) {
    if (!props.open || !props.enabled || operation.current || !model) return
    const entries =
      entryId === undefined
        ? props.entries
        : props.entries.filter((entry) => entry.id === entryId)
    if (entries.length === 0) return
    const current = new AbortController()
    operation.current = current
    setIsTesting(true)
    setResults((previous) => ({
      ...previous,
      ...Object.fromEntries(
        entries.map((entry) => [entry.id, { status: 'pending' as const }])
      ),
    }))
    const batch = {
      total: entries.length,
      completed: 0,
      succeeded: 0,
      failed: 0,
    }
    setProgress(entryId === undefined ? { ...batch } : null)
    let next = 0

    // A small worker pool shares the next index; no additional queue or background task.
    const worker = async () => {
      while (!current.signal.aborted && next < entries.length) {
        const entry = entries[next++]
        setResults((previous) => ({
          ...previous,
          [entry.id]: { status: 'testing' },
        }))
        let result: ChannelKeyTestResult
        const validation = validateKeyEntry(
          { ...entry, remark: '' },
          props.format
        )
        if (validation) {
          result = { status: 'error', message: t(validation) }
        } else {
          try {
            const response = await testChannelKey(
              { ...config, key: entry.value.trim() },
              current.signal
            )
            result = {
              status: response.available ? 'success' : 'error',
              message: response.message,
              time: response.time,
              model: response.model,
            }
          } catch (error) {
            result = {
              status: 'error',
              message: getServerErrorMessage(error, t('Test failed')),
            }
          }
        }
        if (current.signal.aborted || operation.current !== current) return
        setResults((previous) => ({ ...previous, [entry.id]: result }))
        batch.completed++
        if (result.status === 'success') batch.succeeded++
        else batch.failed++
        if (entryId === undefined) setProgress({ ...batch })
      }
    }

    try {
      await Promise.all(
        Array.from({ length: Math.min(3, entries.length) }, worker)
      )
    } finally {
      if (operation.current === current) {
        operation.current = null
        setIsTesting(false)
      }
    }
  }

  return { results, progress, isTesting, model, runTests }
}
