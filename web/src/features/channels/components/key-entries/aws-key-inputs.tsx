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
import { useTranslation } from 'react-i18next'

import { Input } from '@/components/ui/input'

import {
  formatAwsKeyParts,
  parseAwsKeyParts,
  type AwsKeyParts,
  type KeyEntryFormat,
} from '../../lib/key-entry-serialization'

type AwsKeyInputsProps = {
  value: string
  format: KeyEntryFormat
  onChange: (value: string) => void
  disabled?: boolean
  /** The packed key is structurally invalid, e.g. a segment is missing. */
  invalid?: boolean
  inputId: string
}

/**
 * AWS packs several credentials into one pipe-separated key. Editing that as a
 * single string is where typos go unnoticed, so each segment gets its own
 * field and the packed value is rebuilt on every change.
 */
export function AwsKeyInputs(props: AwsKeyInputsProps) {
  const { t } = useTranslation()
  const parts = parseAwsKeyParts(props.value, props.format)

  const updatePart = (patch: Partial<AwsKeyParts>) => {
    props.onChange(formatAwsKeyParts({ ...parts, ...patch }, props.format))
  }

  if (props.format === 'aws_api_key') {
    return (
      <div className='grid gap-2 sm:grid-cols-2'>
        <Input
          id={props.inputId}
          value={parts.accessKey}
          onChange={(event) => updatePart({ accessKey: event.target.value })}
          disabled={props.disabled}
          aria-invalid={props.invalid}
          placeholder={t('API Key')}
          aria-label={t('API Key')}
          className='font-mono'
        />
        <Input
          value={parts.region}
          onChange={(event) => updatePart({ region: event.target.value })}
          disabled={props.disabled}
          aria-invalid={props.invalid}
          placeholder={t('Region')}
          aria-label={t('Region')}
          className='font-mono'
        />
      </div>
    )
  }

  return (
    <div className='grid gap-2 sm:grid-cols-3'>
      <Input
        id={props.inputId}
        value={parts.accessKey}
        onChange={(event) => updatePart({ accessKey: event.target.value })}
        disabled={props.disabled}
        aria-invalid={props.invalid}
        placeholder={t('Access Key')}
        aria-label={t('Access Key')}
        className='font-mono'
      />
      <Input
        value={parts.secretKey}
        onChange={(event) => updatePart({ secretKey: event.target.value })}
        disabled={props.disabled}
        aria-invalid={props.invalid}
        placeholder={t('Secret Access Key')}
        aria-label={t('Secret Access Key')}
        className='font-mono'
      />
      <Input
        value={parts.region}
        onChange={(event) => updatePart({ region: event.target.value })}
        disabled={props.disabled}
        aria-invalid={props.invalid}
        placeholder={t('Region')}
        aria-label={t('Region')}
        className='font-mono'
      />
    </div>
  )
}
