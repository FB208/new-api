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
import { Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { LoadingState } from '@/components/loading-state'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import {
  KEY_REMARK_MAX_LENGTH,
  type KeyEntry,
  type KeyEntryFormat,
} from '../../lib/key-entry-serialization'
import type { ChannelKeyTestResult } from '../../types'
import { AwsKeyInputs } from './aws-key-inputs'

const REMARK_TOO_LONG = 'Remark must not exceed {{max}} characters'

type KeyEntryRowProps = {
  entry: KeyEntry
  index: number
  format: KeyEntryFormat
  error: string | null
  disabled?: boolean
  onValueChange: (value: string) => void
  onRemarkChange: (remark: string) => void
  onRemove: () => void
  inputId: string
  onTest?: () => void
  testingDisabled?: boolean
  testResult?: ChannelKeyTestResult
}

export function KeyEntryRow(props: KeyEntryRowProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const remarkInvalid = props.error === REMARK_TOO_LONG

  return (
    <div className='flex flex-col gap-1'>
      <div className='grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] items-start gap-2'>
        {renderKeyInput(props, t)}
        <Input
          value={props.entry.remark}
          onChange={(event) => props.onRemarkChange(event.target.value)}
          disabled={props.disabled}
          maxLength={KEY_REMARK_MAX_LENGTH}
          aria-invalid={remarkInvalid}
          placeholder={t('Remark (optional)')}
          aria-label={t('Remark for key {{number}}', {
            number: props.index + 1,
          })}
        />
        <div className='flex items-center gap-1'>
          {props.onTest && (
            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={props.onTest}
              disabled={props.disabled || props.testingDisabled}
              aria-label={t('Test key {{number}}', { number: props.index + 1 })}
            >
              {t('Test key')}
            </Button>
          )}
          <Button
            type='button'
            variant='ghost'
            size='icon'
            onClick={props.onRemove}
            disabled={props.disabled}
            className='h-9 w-9'
            aria-label={t('Delete key {{number}}', { number: props.index + 1 })}
          >
            <Trash2 className='h-4 w-4' aria-hidden='true' />
          </Button>
        </div>
      </div>
      {props.error && (
        <p role='alert' className='text-destructive text-xs'>
          {t(props.error, { max: KEY_REMARK_MAX_LENGTH })}
        </p>
      )}
      {props.testResult && (
        <div
          role='status'
          className='flex min-w-0 flex-wrap items-center gap-2 text-xs'
        >
          {props.testResult.status === 'testing' && (
            <LoadingState inline size='sm' message={t('Testing...')} />
          )}
          {props.testResult.status === 'pending' && (
            <span className='text-muted-foreground'>
              {t('Waiting to test')}
            </span>
          )}
          {props.testResult.status === 'success' && (
            <>
              <StatusBadge
                copyable={false}
                variant='success'
                label={t('Success')}
              />
              <span>
                {t('Test time: {{time}} s', {
                  time: formatNumber(props.testResult.time, locale),
                })}
              </span>
            </>
          )}
          {props.testResult.status === 'error' && (
            <>
              <StatusBadge
                copyable={false}
                variant='danger'
                label={t('Failed')}
              />
              <span className='text-destructive min-w-0 basis-full break-words whitespace-pre-wrap'>
                {props.testResult.message || t('Test failed')}
              </span>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function renderKeyInput(
  props: KeyEntryRowProps,
  t: (key: string, options?: Record<string, unknown>) => string
) {
  const label = t('Key {{number}}', { number: props.index + 1 })
  const keyInvalid = props.error !== null && props.error !== REMARK_TOO_LONG

  if (props.format === 'aws_ak_sk' || props.format === 'aws_api_key') {
    return (
      <AwsKeyInputs
        inputId={props.inputId}
        value={props.entry.value}
        format={props.format}
        invalid={keyInvalid}
        onChange={props.onValueChange}
        disabled={props.disabled}
      />
    )
  }

  if (props.format === 'vertex_json') {
    return (
      <Textarea
        id={props.inputId}
        value={props.entry.value}
        onChange={(event) => props.onValueChange(event.target.value)}
        disabled={props.disabled}
        rows={4}
        aria-invalid={keyInvalid}
        placeholder='{"type": "service_account", ...}'
        aria-label={label}
        className='font-mono text-xs'
      />
    )
  }

  return (
    <Input
      id={props.inputId}
      value={props.entry.value}
      onChange={(event) => props.onValueChange(event.target.value)}
      disabled={props.disabled}
      placeholder='sk-...'
      aria-invalid={keyInvalid}
      aria-label={label}
      className='font-mono'
    />
  )
}
