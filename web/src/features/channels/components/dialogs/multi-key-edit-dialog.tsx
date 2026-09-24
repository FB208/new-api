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
import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { handleServerError } from '@/lib/handle-server-error'

import { updateMultiKey } from '../../api'
import {
  MULTI_KEY_ERROR_MESSAGES,
  MULTI_KEY_SUCCESS_MESSAGES,
} from '../../constants'
import {
  KEY_REMARK_MAX_LENGTH,
  createKeyEntry,
  validateKeyEntry,
  type KeyEntryFormat,
} from '../../lib/key-entry-serialization'
import type { KeyStatus } from '../../types'

type MultiKeyEditDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  channelId: number
  keyStatus: KeyStatus | null
  format: KeyEntryFormat
  onSaved: () => void
}

/**
 * Edits one key by index.
 *
 * The existing key is never sent down to the browser: the admin sees only its
 * masked preview and types a replacement. Leaving the field empty keeps the
 * stored key, so a remark can be corrected without touching key material.
 */
export function MultiKeyEditDialog(props: MultiKeyEditDialogProps) {
  const { t } = useTranslation()
  const [keyValue, setKeyValue] = useState('')
  const [remark, setRemark] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (!props.open) return
    setKeyValue('')
    setRemark(props.keyStatus?.remark ?? '')
  }, [props.open, props.keyStatus])

  if (!props.keyStatus) return null

  const keyIndex = props.keyStatus.index
  const trimmedKey = keyValue.trim()
  const validationError = trimmedKey
    ? validateKeyEntry(createKeyEntry(trimmedKey, remark), props.format)
    : null
  const remarkTooLong = remark.trim().length > KEY_REMARK_MAX_LENGTH
  const canSave = !validationError && !remarkTooLong && !isSaving

  const handleSave = async () => {
    if (!canSave) return
    const changes: { key?: string; remark?: string } = {}
    if (trimmedKey) changes.key = trimmedKey
    if (remark.trim() !== (props.keyStatus?.remark ?? '')) {
      changes.remark = remark.trim()
    }
    if (Object.keys(changes).length === 0) {
      props.onOpenChange(false)
      return
    }

    setIsSaving(true)
    try {
      const response = await updateMultiKey(props.channelId, keyIndex, changes)
      if (!response.success) {
        handleServerError(
          response,
          t(MULTI_KEY_ERROR_MESSAGES.UPDATE_KEY_FAILED)
        )
        return
      }
      toast.success(t(MULTI_KEY_SUCCESS_MESSAGES.KEY_UPDATED))
      props.onSaved()
      props.onOpenChange(false)
    } catch (error: unknown) {
      handleServerError(error, t(MULTI_KEY_ERROR_MESSAGES.UPDATE_KEY_FAILED))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('Edit key {{number}}', { number: keyIndex + 1 })}
      description={t('Leave the key empty to keep the stored one.')}
      bodyClassName='space-y-4'
      footer={
        <>
          <Button
            variant='outline'
            onClick={() => props.onOpenChange(false)}
            disabled={isSaving}
          >
            {t('Cancel')}
          </Button>
          <Button onClick={handleSave} disabled={!canSave}>
            {isSaving && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
            {t('Save')}
          </Button>
        </>
      }
    >
      <div className='flex flex-col gap-2'>
        <Label>{t('Current key')}</Label>
        <Input
          readOnly
          value={props.keyStatus.key_preview ?? ''}
          className='font-mono'
          aria-label={t('Current key')}
        />
      </div>

      <div className='flex flex-col gap-2'>
        <Label htmlFor='multi-key-edit-value'>{t('New key')}</Label>
        {props.format === 'vertex_json' ? (
          <Textarea
            id='multi-key-edit-value'
            value={keyValue}
            onChange={(event) => setKeyValue(event.target.value)}
            rows={5}
            placeholder={t('Leave empty to keep existing key')}
            className='font-mono text-xs'
          />
        ) : (
          <Input
            id='multi-key-edit-value'
            value={keyValue}
            onChange={(event) => setKeyValue(event.target.value)}
            placeholder={t('Leave empty to keep existing key')}
            className='font-mono'
          />
        )}
        {validationError && (
          <p role='alert' className='text-destructive text-xs'>
            {t(validationError, { max: KEY_REMARK_MAX_LENGTH })}
          </p>
        )}
      </div>

      <div className='flex flex-col gap-2'>
        <Label htmlFor='multi-key-edit-remark'>{t('Remark (optional)')}</Label>
        <Input
          id='multi-key-edit-remark'
          value={remark}
          onChange={(event) => setRemark(event.target.value)}
          maxLength={KEY_REMARK_MAX_LENGTH}
          placeholder={t('Remark (optional)')}
        />
      </div>
    </Dialog>
  )
}
